// Тендеры на дообучение и RLHF (FR-9). TSK-008.

import { CLIENTS } from '../data/clients';
import { activeBenchmarks, benchDef, benchScore, introducedBenchmarks } from './benchmarks';
import { cheapestH100eDay, pool } from './compute';
import {
  CAP_LEVEL,
  REP_CONTRACT_FAIL,
  REP_CONTRACT_OK,
  RLHF_TENDER_LABELERS,
  RLHF_TENDER_PAY_MULT,
  TENDER_EXPIRE_DAYS,
  TENDER_PENALTY,
  TENDERS_PER_MONTH,
  WORK_BASE,
  WORK_SIZE_EXP,
  WORK_SIZE_MAX,
  WORK_SIZE_MIN,
  WORK_SIZE_REF,
} from './constants';
import { addMail } from './events';
import { earn, spend } from './finance';
import { chance, pick, randInt, randRange } from './rng';
import { endSentence } from './text';
import { byYear, dateToDay, lerpByDate, yearOf } from './time';
import { frontierParams, modelScore } from './training';
import type { BenchmarkId, Contract, GameState, PlayerModel, Result, Tender } from './types';

// Числа, которых нет в constants.ts: доля RLHF-тендеров и формула шанса победы.
const RLHF_TENDER_SHARE = 0.3; // доля RLHF среди новых тендеров (если RLHF изучен)
const CAP_SPREAD = 15; // насколько требование может быть легче уровня года
const BENCH_MIN_OVER_GUESS = 10; // бенчмарк берётся в тендер, если балл уровня года не ниже угадывания + 10 п.п.
const REQ_MIN_OVER_GUESS = 3; // требование не ниже угадывания + 3 п.п.
const DURATION_MIN = 45; // тендеры крупные (WORK_BASE ×5); было 60…180 дней - оплата (после сдачи) приходила слишком поздно
const DURATION_MAX = 150;
const PAY_MULT_MIN = 2;
const PAY_MULT_MAX = 3.5;
const WORK_MULT_MIN = 0.5;
const WORK_MULT_MAX = 1.5;
const CHANCE_BASE = 0.2;
const CHANCE_REP = 0.6; // × репутация / 100
const CHANCE_MARGIN_MAX = 0.3; // запас балла над требованием, который даёт прибавку
const CHANCE_MIN = 0.05;
const CHANCE_MAX = 0.92;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** «$1,2 млн», «$350 тыс.», «$800». */
function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  // Пороги чуть ниже круглых чисел, чтобы после округления не вышло «$1000 тыс.».
  if (x >= 999_950_000) return `$${one(x / 1e9)} млрд`;
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

/** Балл с одним знаком после запятой: «79,6». */
function fmtScore(x: number): string {
  return String(Math.round(x * 10) / 10).replace('.', ',');
}

function clientName(clientId: string): string {
  return CLIENTS.find((c) => c.id === clientId)?.name ?? 'Клиент';
}

function removeById<T extends { id: string }>(list: T[], id: string): void {
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list.splice(i, 1);
}

function addReputation(s: GameState, delta: number): void {
  s.reputation = clamp(s.reputation + delta, 0, 100);
}

/** Угадывание в процентах: балл, который даёт модель без всяких способностей. */
function guessPct(id: BenchmarkId): number {
  return benchDef(id).guess * 100;
}

/**
 * Бенчмарк годится для тендера, если на уровне года даёт не меньше угадывания + 10 п.п.:
 * иначе требование упёрлось бы в пол (GPQE «25 %» проходила любая модель, SWE-banch давал «1 %»).
 */
function feasible(id: BenchmarkId, level: number): boolean {
  return benchScore(id, level, 0) >= guessPct(id) + BENCH_MIN_OVER_GUESS;
}

/**
 * Бенчмарк для нового тендера: случайный активный (для RLHF - только языковой), проходящий порог feasible.
 * Если таких активных нет - самый новый из вышедших (для RLHF - самый новый языковой), тоже проходящий порог.
 * null - подходящих вышедших бенчмарков нет вовсе.
 */
function pickBenchmark(s: GameState, rlhf: boolean, level: number): BenchmarkId | null {
  const fits = (id: BenchmarkId) => (!rlhf || benchDef(id).domain === 'language') && feasible(id, level);
  const active = activeBenchmarks(s).filter(fits);
  if (active.length > 0) return pick(s, active);
  let best: BenchmarkId | null = null;
  let bestDay = -Infinity;
  for (const id of introducedBenchmarks(s).filter(fits)) {
    const d = dateToDay(benchDef(id).introduced);
    if (d >= bestDay) {
      best = id;
      bestDay = d;
    }
  }
  return best;
}

/**
 * Раз в месяц: TENDERS_PER_MONTH(год) + randInt(0, 1) новых тендеров (1…2) по правилам design.md («Тендеры»).
 * Требование = max(угадывание + 3, балл при способности «уровень года − 0…15»);
 * оплата умножается на 1 + (требование − угадывание) / 100: сложнее бенчмарк - дороже тендер.
 * Письма о новых тендерах нет; при включённом автоподборе (s.autoApply) заявки подаются сразу, одним письмом.
 */
export function generateMonthly(s: GameState): void {
  const year = yearOf(s.day);
  const level = byYear(CAP_LEVEL, year);
  const count = byYear(TENDERS_PER_MONTH, year) + randInt(s, 0, 1);
  const rlhfOpen = s.research.done.includes('rlhf');
  const unitPrice = cheapestH100eDay(s);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return; // нет доступных GPU: оплату не посчитать
  const created: Tender[] = [];
  for (let i = 0; i < count; i++) {
    let rlhf = rlhfOpen && chance(s, RLHF_TENDER_SHARE);
    const client = pick(s, CLIENTS);
    let benchmark = pickBenchmark(s, rlhf, level);
    if (benchmark === null && rlhf) {
      rlhf = false; // языковых бенчмарков ещё нет: вместо RLHF выходит обычное дообучение
      benchmark = pickBenchmark(s, false, level);
    }
    if (benchmark === null) continue;
    const cap = level - randRange(s, 0, CAP_SPREAD);
    const guess = guessPct(benchmark);
    const requirement = Math.max(Math.round(guess) + REQ_MIN_OVER_GUESS, Math.round(benchScore(benchmark, cap, 0)));
    const difficulty = 1 + (requirement - guess) / 100;
    const work = lerpByDate(WORK_BASE, s.day) * randRange(s, WORK_MULT_MIN, WORK_MULT_MAX);
    const durationDays = randInt(s, DURATION_MIN, DURATION_MAX);
    const payment =
      work * unitPrice * randRange(s, PAY_MULT_MIN, PAY_MULT_MAX) * (rlhf ? RLHF_TENDER_PAY_MULT : 1) * difficulty;
    const tender: Tender = {
      id: `t${s.nextTenderNum++}`,
      clientId: client.id,
      type: rlhf ? 'rlhf' : 'finetune',
      benchmark,
      requirement,
      work,
      durationDays,
      payment,
      penalty: TENDER_PENALTY * payment,
      appearedDay: s.day,
      expiresDay: s.day + TENDER_EXPIRE_DAYS,
      application: null,
    };
    s.tenders.push(tender);
    created.push(tender);
  }
  if (s.autoApply) autoApplyTenders(s, created);
}

/** Действие: включить или выключить автоподбор - заявки на новые тендеры в начале месяца. */
export function setAutoApply(s: GameState, on: boolean): Result {
  s.autoApply = on;
  return { ok: true };
}

/**
 * Модель для автозаявки: выпущенная, проходит canApply и честный балл не ниже требования
 * (лаборатория не берёт контракт, который провалит на сдаче); из таких - с самым высоким показанным баллом,
 * то есть с лучшим шансом. null - подходящей модели нет.
 */
export function bestAutoModel(s: GameState, tender: Tender): PlayerModel | null {
  let best: PlayerModel | null = null;
  let bestShown = -Infinity;
  for (const m of s.models) {
    if (canApply(s, tender, m) !== null) continue;
    if (modelScore(m, tender.benchmark, true) < tender.requirement) continue;
    const shown = modelScore(m, tender.benchmark, false);
    if (shown > bestShown) {
      best = m;
      bestShown = shown;
    }
  }
  return best;
}

/**
 * Автоподбор: подать заявки на tenders лучшей подходящей моделью (правила applyTender) и прислать
 * одно письмо со сводкой. Без единой заявки письма нет. Заявка помечается auto: о проигрыше письма не будет.
 */
export function autoApplyTenders(s: GameState, tenders: Tender[]): void {
  const lines: string[] = [];
  for (const t of tenders) {
    if (t.application !== null) continue;
    const model = bestAutoModel(s, t);
    if (!model) continue;
    placeApplication(s, t, model, true);
    const chance = Math.round(t.application!.chance * 100);
    lines.push(
      `${clientName(t.clientId)}: ${benchDef(t.benchmark).name}, требование ${t.requirement} %, ` +
        `модель «${model.name}», оплата ${fmtMoney(t.payment)}, шанс ${chance} %.`,
    );
  }
  if (lines.length === 0) return;
  const skipped = tenders.length - lines.length;
  addMail(s, {
    kind: 'contract',
    title: `Заявки поданы: ${lines.length} из ${tenders.length}`,
    body:
      `Новых тендеров: ${tenders.length}, заявок подано: ${lines.length}. Решение - при закрытии тендера.\n` +
      lines.join('\n') +
      (skipped > 0 ? `\nБез подходящей модели: ${skipped}.` : ''),
  });
}

/**
 * Объём работы по тендеру для выбранной модели: work × clamp((параметры / эталон)^0,5, 0,4…2,5),
 * эталон - 0,17 переднего края года. Меньшая модель - меньше работы и мощности, большая - больше.
 */
export function contractWorkFor(s: GameState, tender: Tender, model: PlayerModel): number {
  const ref = frontierParams(s.day) * WORK_SIZE_REF;
  const k = clamp(Math.pow(model.plan.paramsB / ref, WORK_SIZE_EXP), WORK_SIZE_MIN, WORK_SIZE_MAX);
  return tender.work * k;
}

/** Записать заявку в тендер; auto - подана автоподбором. */
function placeApplication(s: GameState, tender: Tender, model: PlayerModel, auto: boolean): void {
  tender.application = {
    modelId: model.id,
    appliedDay: s.day,
    resolveDay: tender.expiresDay, // решение в день закрытия тендера
    chance: applyChance(s, tender, model),
    work: contractWorkFor(s, tender, model),
    ...(auto ? { auto: true } : {}), // у ручной заявки поля нет вовсе: сохранение короче
  };
}

/** Причина, по которой модель не может подать заявку, или null. */
export function canApply(_s: GameState, tender: Tender, model: PlayerModel): string | null {
  if (model.releasedDay === null) return 'Модель ещё не выпущена';
  if (tender.application !== null) return 'Заявка на этот тендер уже подана';
  if (tender.type === 'rlhf' && !model.rlhf) return 'Для этого тендера нужна модель, обученная с RLHF';
  const shown = modelScore(model, tender.benchmark, false);
  if (shown < tender.requirement) {
    return `Балл модели ${fmtScore(shown)} % ниже требования ${tender.requirement} %`;
  }
  return null;
}

/** Шанс победы по формуле design.md. */
export function applyChance(s: GameState, tender: Tender, model: PlayerModel): number {
  const shown = modelScore(model, tender.benchmark, false);
  const margin = clamp((shown - tender.requirement) / Math.max(tender.requirement, 1), 0, CHANCE_MARGIN_MAX);
  return clamp(CHANCE_BASE + (CHANCE_REP * s.reputation) / 100 + margin, CHANCE_MIN, CHANCE_MAX);
}

/** Действие: подать заявку выпущенной моделью. */
export function applyTender(s: GameState, tenderId: string, modelId: string): Result {
  const tender = s.tenders.find((t) => t.id === tenderId);
  if (!tender) return { ok: false, error: 'Нет такого тендера' };
  const model = s.models.find((m) => m.id === modelId);
  if (!model) return { ok: false, error: 'Нет такой модели' };
  const reason = canApply(s, tender, model);
  if (reason !== null) return { ok: false, error: reason };
  placeApplication(s, tender, model, false);
  return { ok: true };
}

/**
 * Контракт закрыт: штраф, падение репутации, письмо. Заголовок - «<событие>: <клиент>».
 * Важное (игра встаёт на паузу), если провал случился не по воле игрока.
 */
function failContract(s: GameState, c: Contract, title: string, reason: string, important = true): void {
  const t = c.tender;
  spend(s, 'penalties', t.penalty);
  addReputation(s, REP_CONTRACT_FAIL);
  removeById(s.contracts, c.id);
  addMail(s, {
    kind: 'contract',
    title: `${title}: ${clientName(t.clientId)}`,
    body: `${reason} Штраф ${fmtMoney(t.penalty)}, репутация −${Math.abs(REP_CONTRACT_FAIL)}.`,
    important,
  });
}

/** Работа сделана: проверяем настоящий балл модели, без подгонки. */
function finishContract(s: GameState, c: Contract): void {
  const t = c.tender;
  const model = s.models.find((m) => m.id === c.modelId);
  const honest = model ? modelScore(model, t.benchmark, true) : 0;
  const bench = benchDef(t.benchmark).name;
  if (model && honest >= t.requirement) {
    earn(s, 'contracts', t.payment);
    addReputation(s, REP_CONTRACT_OK);
    removeById(s.contracts, c.id);
    addMail(s, {
      kind: 'contract',
      title: `Контракт выполнен: ${clientName(t.clientId)}`,
      body:
        `Работа сдана. Модель показала ${fmtScore(honest)} % на ${bench} ` +
        `при требовании ${t.requirement} %. Оплата ${fmtMoney(t.payment)}, репутация +${REP_CONTRACT_OK}.`,
    });
    return;
  }
  failContract(
    s,
    c,
    'Контракт провален',
    `Работа сдана, но модель не справилась с реальными задачами клиента: ` +
      `${fmtScore(honest)} % на ${bench} при требовании ${t.requirement} %.`,
  );
}

/** Действие: отказаться от контракта (штраф, репутация REP_CONTRACT_FAIL). */
export function cancelContract(s: GameState, contractId: string): Result {
  const c = s.contracts.find((x) => x.id === contractId);
  if (!c) return { ok: false, error: 'Нет такого контракта' };
  failContract(s, c, 'Контракт расторгнут', 'Лаборатория отказалась от контракта.', false); // решение игрока: пауза не нужна
  return { ok: true };
}

/** Заявка решена: победа даёт контракт, поражение - только письмо (у автозаявки и письма нет). */
function resolveApplication(s: GameState, t: Tender): void {
  const a = t.application;
  if (!a) return;
  removeById(s.tenders, t.id);
  const model = s.models.find((m) => m.id === a.modelId);
  const won = chance(s, a.chance) && model !== undefined;
  const client = clientName(t.clientId);
  if (!won || !model) {
    if (a.auto) return; // проигрыш автозаявки не засоряет почту: игрок её не подавал
    addMail(s, {
      kind: 'contract',
      title: `Тендер проигран: ${client}`,
      body:
        'Тендер достался другому исполнителю. ' +
        `Требование было ${t.requirement} % на ${benchDef(t.benchmark).name}.`,
    });
    return;
  }
  s.contracts.push({
    id: t.id.replace(/^t/, 'c'),
    tender: { ...t, work: a.work ?? t.work }, // объём уже посчитан под модель заявки
    modelId: model.id,
    startedDay: s.day,
    deadlineDay: s.day + t.durationDays,
    workDone: 0,
  });
  let labelersNote = '';
  if (t.type === 'rlhf') {
    const labelers = RLHF_TENDER_LABELERS * t.payment;
    spend(s, 'labelers', labelers);
    labelersNote = ` Разметчикам заплачено ${endSentence(fmtMoney(labelers))}`;
  }
  // Пауза нужна, только если работать нечем: тендеры выигрываются часто, и пауза на каждом мешала бы.
  const noCompute = s.compute.alloc.contracts <= 0;
  addMail(s, {
    kind: 'contract',
    title: `Тендер выигран: ${client}`,
    important: noCompute,
    body:
      `Исполнитель - модель «${model.name}». ` +
      `Срок - ${t.durationDays} дн., оплата после сдачи - ${endSentence(fmtMoney(t.payment))} ` +
      (noCompute
        ? 'Доля «Контракты» равна 0 %: работа не начнётся, пока мощность не выделена в окне «Мощности».'
        : 'Мощность берётся из доли «Контракты».') +
      labelersNote,
  });
}

/**
 * Ежедневно: убрать просроченные тендеры без заявки; решить заявки (победа → контракт, для RLHF - разметчики;
 * поражение → письмо, если заявка была ручной); работа контрактов за счёт pool(contracts) поровну;
 * завершение → проверка честного балла, оплата или штраф; просрочка → штраф.
 */
export function progressDay(s: GameState): void {
  for (const t of [...s.tenders]) {
    if (t.application === null && t.expiresDay <= s.day) removeById(s.tenders, t.id);
  }

  for (const t of [...s.tenders]) {
    if (t.application !== null && s.day >= t.application.resolveDay) resolveApplication(s, t);
  }

  const active = [...s.contracts];
  if (active.length === 0) return;
  const share = pool(s, 'contracts') / active.length;
  for (const c of active) {
    c.workDone += share;
    if (c.workDone >= c.tender.work) {
      finishContract(s, c);
    } else if (s.day >= c.deadlineDay) {
      failContract(s, c, 'Контракт просрочен', 'Срок истёк, работа не завершена.');
    }
  }
}
