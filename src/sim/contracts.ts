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
  TENDER_APPLY_DAYS,
  TENDER_EXPIRE_DAYS,
  TENDER_PENALTY,
  TENDERS_PER_MONTH,
  WORK_BASE,
} from './constants';
import { addMail } from './events';
import { earn, spend } from './finance';
import { chance, pick, randInt, randRange } from './rng';
import { endSentence } from './text';
import { byYear, dateToDay, lerpByDate, yearOf } from './time';
import { modelScore } from './training';
import type { BenchmarkId, Contract, GameState, PlayerModel, Result, Tender } from './types';

// Числа, которых нет в constants.ts: доля RLHF-тендеров и формула шанса победы.
const RLHF_TENDER_SHARE = 0.3; // доля RLHF среди новых тендеров (если RLHF изучен)
const CAP_SPREAD = 15; // насколько требование может быть легче уровня года
const DURATION_MIN = 45;
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

/**
 * Бенчмарк для нового тендера: случайный активный (для RLHF — только языковой).
 * Если активных нет — самый новый из вышедших (для RLHF — самый новый языковой).
 * null — подходящих вышедших бенчмарков нет вовсе.
 */
function pickBenchmark(s: GameState, rlhf: boolean): BenchmarkId | null {
  const fits = (id: BenchmarkId) => !rlhf || benchDef(id).domain === 'language';
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

/** Раз в месяц: TENDERS_PER_MONTH(год) + randInt(0, 1) новых тендеров по правилам design.md («Тендеры»). */
export function generateMonthly(s: GameState): void {
  const year = yearOf(s.day);
  const count = byYear(TENDERS_PER_MONTH, year) + randInt(s, 0, 1);
  const rlhfOpen = s.research.done.includes('rlhf');
  const unitPrice = cheapestH100eDay(s);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return; // нет доступных GPU: оплату не посчитать
  for (let i = 0; i < count; i++) {
    let rlhf = rlhfOpen && chance(s, RLHF_TENDER_SHARE);
    const client = pick(s, CLIENTS);
    let benchmark = pickBenchmark(s, rlhf);
    if (benchmark === null && rlhf) {
      rlhf = false; // языковых бенчмарков ещё нет: вместо RLHF выходит обычное дообучение
      benchmark = pickBenchmark(s, false);
    }
    if (benchmark === null) continue;
    const cap = byYear(CAP_LEVEL, year) - randRange(s, 0, CAP_SPREAD);
    const requirement = Math.max(1, Math.round(benchScore(benchmark, cap, 0)));
    const work = lerpByDate(WORK_BASE, s.day) * randRange(s, WORK_MULT_MIN, WORK_MULT_MAX);
    const durationDays = randInt(s, DURATION_MIN, DURATION_MAX);
    const payment = work * unitPrice * randRange(s, PAY_MULT_MIN, PAY_MULT_MAX) * (rlhf ? RLHF_TENDER_PAY_MULT : 1);
    s.tenders.push({
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
    });
  }
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
  tender.application = {
    modelId: model.id,
    appliedDay: s.day,
    resolveDay: s.day + TENDER_APPLY_DAYS,
    chance: applyChance(s, tender, model),
  };
  return { ok: true };
}

/**
 * Контракт закрыт: штраф, падение репутации, письмо. Заголовок — «<событие>: <клиент>».
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

/** Заявка решена: победа даёт контракт, поражение — только письмо. */
function resolveApplication(s: GameState, t: Tender): void {
  const a = t.application;
  if (!a) return;
  removeById(s.tenders, t.id);
  const model = s.models.find((m) => m.id === a.modelId);
  const won = chance(s, a.chance) && model !== undefined;
  const client = clientName(t.clientId);
  if (!won || !model) {
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
    tender: { ...t },
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
      `Исполнитель — модель «${model.name}». ` +
      `Срок — ${t.durationDays} дн., оплата после сдачи — ${endSentence(fmtMoney(t.payment))} ` +
      (noCompute
        ? 'Доля «Контракты» равна 0 %: работа не начнётся, пока мощность не выделена в окне «Мощности».'
        : 'Мощность берётся из доли «Контракты».') +
      labelersNote,
  });
}

/**
 * Ежедневно: убрать просроченные тендеры без заявки; решить заявки (победа → контракт, для RLHF — разметчики;
 * поражение → письмо); работа контрактов за счёт pool(contracts) поровну; завершение → проверка честного балла,
 * оплата или штраф; просрочка → штраф.
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
