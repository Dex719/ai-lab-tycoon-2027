// Проекты обучения, способности моделей игрока, Арена игрока, подгонка и разоблачение (FR-4, FR-6, FR-7). TSK-005.

import { benchDef, benchScore, DOMAIN_NAMES, introducedBenchmarks } from './benchmarks';
import { pool } from './compute';
import {
  ALGO_MULT,
  ARCH_MULT,
  ARENA_OPEN_DATE,
  ARENA_WEIGHTS,
  BENCH_DATA_PENALTY,
  BENCH_SHARE_MAX,
  CONTEXT_FLOP_PER_DOUBLING,
  CONTEXT_LEVELS,
  CAP_BASE_OFFSET,
  CHIN_K,
  CHIN_OPT_RATIO,
  ELO_BASE,
  ELO_PER_CAP,
  ELO_RLHF_BASE,
  ELO_RLHF_PER_ALGO,
  EXPOSE_ARENA_BONUS,
  EXPOSE_HYPE_MULT,
  EXPOSE_MAX,
  EXPOSE_PER_PP,
  EXPOSE_REP,
  FAIL_BASE,
  FAIL_BIG_JUMP,
  FAIL_CONTINUE_PENALTY,
  FAIL_JUMP_RATIO,
  FAIL_ROLLBACK,
  MAX_BENCH_TARGETS,
  MAX_TOKENS_B,
  MIX_K,
  OVERFIT_K,
  PARAMS_B_MAX,
  PARAMS_B_MIN,
  RLHF_FLOP_EXTRA,
  RLHF_LABELERS_BASE,
  RLHF_LABELERS_PER_B,
  RLHF_LANGUAGE_BONUS,
  TOKENS_B_MIN,
  TRAIN_FLOP_PER_H100E_DAY,
} from './constants';
import { addMail, awaitingEvent, dropChoices, triggerEvent } from './events';
import { spend } from './finance';
import { contextLabel, maxContext } from './research';
import { EXPOSE_CAP_WITH_RIVALS, exposureMultIn } from './rivalry';
import { chance, randRange } from './rng';
import { endSentence } from './text';
import { byYear, dateToDay, yearOf } from './time';
import { DOMAINS } from './types';
import type { BenchmarkId, DomainId, GameState, PlayerModel, Result, TrainingPlan } from './types';

export type Arch = 'lstm' | 'transformer';

export interface TrainingEstimate {
  flop: number;
  days: number | null; // null - доля «Обучение» = 0
  arch: Arch;
  labelers: number; // $ разметчикам при старте (RLHF)
  error: string | null; // текст ошибки validatePlan или null
  forecast: null | {
    caps: Record<DomainId, number>;
    scores: Partial<Record<BenchmarkId, number>>; // показанные (с подгонкой), по вышедшим бенчмаркам
    elo: number;
  }; // null, если не исследованы «Законы масштабирования»
  optimal: null | { paramsB: number; tokensB: number }; // подсказка по Шиншилле для того же FLOP (только со scaling)
}

// ---------- Форматирование для писем и ошибок ----------

function fmtNum(x: number): string {
  return String(x).replace('.', ',');
}

function fmtInt(x: number): string {
  return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function fmtPct(x: number): string {
  return `${x.toFixed(1).replace('.', ',')} %`;
}

/** «$1,2 млн», «$350 тыс.», «$800». Пороги чуть ниже круглых чисел, чтобы после округления не вышло «$1000 тыс.» или «$1000 млн». */
function fmtMoney(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const dec = (x: number): string => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (a >= 1e9 - 5e6) return `${sign}$${dec(a / 1e9)} млрд`;
  if (a >= 1e6 - 500) return `${sign}$${dec(a / 1e6)} млн`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)} тыс.`;
  return `${sign}$${Math.round(a)}`;
}

/** «очко / очка / очков» по числу. */
function pointsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'очко';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'очка';
  return 'очков';
}

// ---------- Формулы ----------

/** Надбавка за контекст: +CONTEXT_FLOP_PER_DOUBLING за каждое удвоение сверх 512 токенов. */
export function contextFlopMult(context: number): number {
  const ratio = context > 512 ? context / 512 : 1;
  return 1 + CONTEXT_FLOP_PER_DOUBLING * Math.log2(ratio);
}

/** 6 × N × D × (1 + RLHF_FLOP_EXTRA, если rlhf) × надбавка за контекст. */
export function planFlop(plan: TrainingPlan): number {
  return 6 * plan.paramsB * 1e9 * plan.tokensB * 1e9 * (plan.rlhf ? 1 + RLHF_FLOP_EXTRA : 1) * contextFlopMult(plan.context);
}

/** Трансформер доступен после «Механизма внимания», раньше - LSTM. */
export function archFor(s: GameState): Arch {
  return s.research.done.includes('attention') ? 'transformer' : 'lstm';
}

/** chin = exp(−0,2 × ln²((D/N)/20)); лучшее соотношение данных и параметров - 20 токенов на параметр. */
export function chinchillaFactor(paramsB: number, tokensB: number): number {
  if (!(paramsB > 0) || !(tokensB > 0)) return 0;
  const l = Math.log(tokensB / paramsB / CHIN_OPT_RATIO);
  return Math.exp(-CHIN_K * l * l);
}

/** E = 6·N·D·(1 − b)·arch·algoMult·chin (без надбавки RLHF). */
export function effectiveCompute(plan: TrainingPlan, algoLevel: number, arch: Arch): number {
  const flop = 6 * plan.paramsB * 1e9 * plan.tokensB * 1e9;
  return (
    flop *
    (1 - plan.benchShare) *
    ARCH_MULT[arch] *
    ALGO_MULT ** algoLevel *
    chinchillaFactor(plan.paramsB, plan.tokensB)
  );
}

/** base = 10·(log10 E − 18). */
export function baseLevel(effective: number): number {
  if (!(effective > 0)) return -100;
  return 10 * (Math.log10(effective) - CAP_BASE_OFFSET);
}

/** cap_d = base + 8·(3·m_d − 1) − 15·b − failPenalty; у языка ещё +2 при RLHF. */
export function capsFromPlan(plan: TrainingPlan, algoLevel: number, arch: Arch, failPenalty = 0): Record<DomainId, number> {
  const base = baseLevel(effectiveCompute(plan, algoLevel, arch));
  const caps = {} as Record<DomainId, number>;
  for (const d of DOMAINS) {
    caps[d] =
      base +
      MIX_K * (3 * plan.mix[d] - 1) -
      BENCH_DATA_PENALTY * plan.benchShare -
      failPenalty +
      (d === 'language' && plan.rlhf ? RLHF_LANGUAGE_BONUS : 0);
  }
  return caps;
}

/** Подгонка: каждой цели достаётся OVERFIT_K × b / sqrt(число целей) очков способности. */
export function overfitFromPlan(plan: TrainingPlan): Partial<Record<BenchmarkId, number>> {
  const targets = [...new Set(plan.benchTargets)];
  const out: Partial<Record<BenchmarkId, number>> = {};
  if (!(plan.benchShare > 0) || targets.length === 0) return out;
  const each = (OVERFIT_K * plan.benchShare) / Math.sqrt(targets.length);
  for (const t of targets) out[t] = each;
  return out;
}

/** Elo = ELO_BASE + ELO_PER_CAP × capA + (rlhf ? ELO_RLHF_BASE + ELO_RLHF_PER_ALGO × algoLevel : 0). Подгонка не участвует. */
export function arenaElo(caps: Record<DomainId, number>, rlhf: boolean, algoLevel: number): number {
  let capA = 0;
  for (const d of DOMAINS) capA += ARENA_WEIGHTS[d] * caps[d];
  return ELO_BASE + ELO_PER_CAP * capA + (rlhf ? ELO_RLHF_BASE + ELO_RLHF_PER_ALGO * algoLevel : 0);
}

/** Балл модели игрока: honest - без подгонки; иначе с подгонкой, если модель не разоблачена. */
export function modelScore(model: PlayerModel, bid: BenchmarkId, honest: boolean): number {
  const overfit = !honest && !model.exposed ? (model.overfit[bid] ?? 0) : 0;
  return benchScore(bid, model.caps[benchDef(bid).domain], overfit);
}

/** Разметчикам при старте RLHF-проекта: $200 тыс. + $2 тыс. за миллиард параметров. */
export function labelersCost(plan: TrainingPlan): number {
  return plan.rlhf ? RLHF_LABELERS_BASE + RLHF_LABELERS_PER_B * plan.paramsB : 0;
}

// ---------- Проверка и оценка проекта ----------

/** Ошибка или null: размеры в границах, токены ≤ MAX_TOKENS_B(год), микс ≈ 1, b в [0, 0.5], ≤ 3 цели (только вышедшие бенчмарки), rlhf только после исследования, нет идущего проекта, хватает денег на разметчиков. */
export function validatePlan(s: GameState, plan: TrainingPlan): string | null {
  if (s.training) return 'Уже идёт другой проект обучения. Его нужно завершить или отменить.';
  const name = plan.name.trim();
  if (!name) return 'Название модели не указано.';
  if (name.length > 40) return 'Название модели - не длиннее 40 символов.';
  if (!Number.isFinite(plan.paramsB) || plan.paramsB < PARAMS_B_MIN || plan.paramsB > PARAMS_B_MAX) {
    return `Размер модели - от ${fmtNum(PARAMS_B_MIN)} до ${fmtInt(PARAMS_B_MAX)} млрд параметров.`;
  }
  const year = yearOf(s.day);
  const maxTokens = byYear(MAX_TOKENS_B, year);
  if (!Number.isFinite(plan.tokensB) || plan.tokensB < TOKENS_B_MIN) {
    return `Объём данных - не меньше ${fmtNum(TOKENS_B_MIN)} млрд токенов.`;
  }
  if (plan.tokensB > maxTokens) {
    return `Максимальный объём данных в ${year} году - ${fmtInt(maxTokens)} млрд токенов.`;
  }
  const mix = DOMAINS.map((d) => plan.mix[d]);
  if (mix.some((m) => !Number.isFinite(m) || m < 0) || Math.abs(mix.reduce((a, b) => a + b, 0) - 1) > 0.01) {
    return 'Сумма долей данных по областям должна быть 100 %.';
  }
  if (!Number.isFinite(plan.benchShare) || plan.benchShare < 0 || plan.benchShare > BENCH_SHARE_MAX) {
    return `Доля данных под бенчмарки - от 0 до ${Math.round(BENCH_SHARE_MAX * 100)} %.`;
  }
  const targets = [...new Set(plan.benchTargets)];
  if (targets.length > MAX_BENCH_TARGETS) return `Целевых бенчмарков не больше ${MAX_BENCH_TARGETS}.`;
  for (const t of targets) {
    if (!s.benchmarks[t]?.introduced) return 'Нельзя подгонять под бенчмарк, который ещё не вышел.';
  }
  if (plan.rlhf && !s.research.done.includes('rlhf')) return 'Требуется исследование «Обучение на отзывах людей (RLHF)».';
  if (!CONTEXT_LEVELS.some(([tokens]) => tokens === plan.context)) return 'Неизвестная длина контекста.';
  if (plan.context > maxContext(s)) {
    return `Контекст ${contextLabel(plan.context)} токенов ещё не открыт: нужно исследование «Длинный контекст».`;
  }
  const labelers = labelersCost(plan);
  // Деньги нужны только тем, кто платит разметчикам: без RLHF (labelers = 0) проект можно начать и при минусе на счету.
  if (labelers > 0 && labelers > s.cash) {
    return `Не хватает денег на разметчиков: нужно ${fmtMoney(labelers)}, на счету ${endSentence(fmtMoney(s.cash))}`;
  }
  return null;
}

/** Оценка проекта для формы: объём вычислений, срок, разметчики; с «Законами масштабирования» - прогноз и подсказка. */
export function estimate(s: GameState, plan: TrainingPlan): TrainingEstimate {
  const flop = planFlop(plan);
  const arch = archFor(s);
  const perDay = pool(s, 'training') * TRAIN_FLOP_PER_H100E_DAY;
  // Срок известен, только если есть мощность и объём вычислений конечен и положителен.
  const days = perDay > 0 && flop > 0 && Number.isFinite(flop) ? Math.max(1, Math.ceil(flop / perDay)) : null;
  const result: TrainingEstimate = {
    flop,
    days,
    arch,
    labelers: labelersCost(plan),
    error: validatePlan(s, plan),
    forecast: null,
    optimal: null,
  };
  // Прогноз считаем только для осмысленных чисел: иначе в форме появились бы NaN.
  const sane =
    plan.paramsB > 0 &&
    plan.tokensB > 0 &&
    Number.isFinite(flop) &&
    Number.isFinite(plan.benchShare) &&
    DOMAINS.every((d) => Number.isFinite(plan.mix[d]));
  if (!sane || !s.research.done.includes('scaling')) return result;

  const algoLevel = s.research.algoLevel;
  const caps = capsFromPlan(plan, algoLevel, arch, 0);
  const overfit = overfitFromPlan(plan);
  const scores: Partial<Record<BenchmarkId, number>> = {};
  for (const bid of introducedBenchmarks(s)) {
    scores[bid] = benchScore(bid, caps[benchDef(bid).domain], overfit[bid] ?? 0);
  }
  result.forecast = { caps, scores, elo: arenaElo(caps, plan.rlhf, algoLevel) };

  // Для того же объёма вычислений: 6·N·D = 120·N² при D = 20·N (надбавка RLHF остаётся за рамками).
  const baseFlop = flop / ((plan.rlhf ? 1 + RLHF_FLOP_EXTRA : 1) * contextFlopMult(plan.context));
  const n = Math.sqrt(baseFlop / (6 * CHIN_OPT_RATIO)) / 1e9;
  result.optimal = { paramsB: n, tokensB: CHIN_OPT_RATIO * n };
  return result;
}

// ---------- Действия ----------

/** Действие: начать проект (списать разметчиков, бросить шанс срыва). */
export function startTraining(s: GameState, plan: TrainingPlan): Result {
  const error = validatePlan(s, plan);
  if (error) return { ok: false, error };
  const copy: TrainingPlan = {
    ...plan,
    name: plan.name.trim(),
    mix: { ...plan.mix },
    benchTargets: [...new Set(plan.benchTargets)],
  };
  spend(s, 'labelers', labelersCost(copy));
  const flop = planFlop(copy);
  const failChance = FAIL_BASE + (s.bestFlop > 0 && flop > FAIL_JUMP_RATIO * s.bestFlop ? FAIL_BIG_JUMP : 0);
  const failAtFraction = chance(s, failChance) ? randRange(s, 0.2, 0.8) : null;
  s.training = {
    plan: copy,
    arch: archFor(s),
    algoLevel: s.research.algoLevel,
    flopTotal: flop,
    flopDone: 0,
    startedDay: s.day,
    failAtFraction,
    failPenalty: 0,
  };
  return { ok: true };
}

/** Отменить идущий проект. Деньги разметчикам не возвращаются. */
export function cancelTraining(s: GameState): Result {
  if (!s.training) return { ok: false, error: 'Сейчас ничего не обучается.' };
  s.training = null;
  dropChoices(s, 'training-fail', 'Проект отменён, решение не требуется.');
  return { ok: true };
}

/** Выбор в событии «срыв обучения» (вызывается из data/events.ts). */
export function applyFailChoice(s: GameState, choice: 'rollback' | 'continue'): void {
  const t = s.training;
  if (!t) return;
  if (choice === 'rollback') t.flopDone = Math.max(0, t.flopDone - FAIL_ROLLBACK * t.flopTotal);
  else t.failPenalty = FAIL_CONTINUE_PENALTY;
}

/** Строка с баллами новой модели по активным бенчмаркам (если все насыщены - по всем вышедшим). */
function keyScores(s: GameState, model: PlayerModel): string {
  const active = introducedBenchmarks(s).filter((b) => !s.benchmarks[b].saturated);
  const list = active.length > 0 ? active : introducedBenchmarks(s);
  return list.map((b) => `${benchDef(b).name} ${fmtPct(modelScore(model, b, false))}`).join(', ');
}

function finishTraining(s: GameState): void {
  const t = s.training;
  if (!t) return;
  const caps = capsFromPlan(t.plan, t.algoLevel, t.arch, t.failPenalty);
  const model: PlayerModel = {
    id: `p${s.nextModelNum++}`,
    name: t.plan.name,
    plan: t.plan,
    arch: t.arch,
    algoLevel: t.algoLevel,
    trainedDay: s.day,
    releasedDay: null,
    caps,
    overfit: overfitFromPlan(t.plan),
    rlhf: t.plan.rlhf,
    arenaElo: arenaElo(caps, t.plan.rlhf, t.algoLevel),
    price: 0,
    onApi: false,
    exposed: false,
    earned: 0,
  };
  s.models.push(model);
  s.bestFlop = Math.max(s.bestFlop, t.flopTotal);
  s.training = null;

  const lines: string[] = [];
  const scores = keyScores(s, model);
  if (scores) lines.push(`Баллы: ${scores}.`);
  lines.push(`«Арена»: около ${fmtInt(model.arenaElo)} Эло.`);
  if (Object.keys(model.overfit).length > 0) {
    lines.push('Баллы на целевых бенчмарках завышены подгонкой; на «Арене» и в реальных задачах подгонка не помогает.');
  }
  if (t.failPenalty > 0) {
    lines.push(`Из-за срыва обучения способности модели ниже на ${fmtNum(t.failPenalty)} ${pointsWord(t.failPenalty)}.`);
  }
  lines.push('Модель добавлена в окно «Модели», продажа доступа начинается после выпуска.');
  addMail(s, { kind: 'training', title: `Модель «${model.name}» готова`, body: lines.join(' '), important: true });
}

/** Ежедневно: прогресс; срыв (triggerEvent 'training-fail'); завершение → PlayerModel в s.models, bestFlop, письмо. */
export function progressDay(s: GameState): void {
  const t = s.training;
  if (!t) return;
  // После срыва проект стоит, пока игрок не решит, что делать (письмо можно отложить).
  if (awaitingEvent(s, 'training-fail')) return;
  t.flopDone += pool(s, 'training') * TRAIN_FLOP_PER_H100E_DAY;

  if (t.failAtFraction !== null && t.flopDone >= t.failAtFraction * t.flopTotal) {
    // Срыв случается в точке отказа: дальше проект не идёт, пока игрок не выберет, что делать.
    t.flopDone = t.failAtFraction * t.flopTotal;
    t.failAtFraction = null;
    triggerEvent(s, 'training-fail');
    return;
  }
  if (t.flopDone >= t.flopTotal) finishTraining(s);
}

/**
 * Шанс разоблачения модели в этом месяце (0, если нечего разоблачать). Модификаторы exposure (сложность, «Отрицать» в
 * проверке баллов соперника) умножают шанс; с множителем выше 1 потолок EXPOSE_CAP_WITH_RIVALS вместо EXPOSE_MAX.
 */
export function exposureChance(s: GameState, model: PlayerModel): number {
  if (model.releasedDay === null || model.exposed) return 0;
  let gap = 0;
  let any = false;
  for (const bid of Object.keys(model.overfit) as BenchmarkId[]) {
    const st = s.benchmarks[bid];
    if (!st.introduced || st.saturated) continue;
    any = true;
    gap = Math.max(gap, modelScore(model, bid, false) - modelScore(model, bid, true));
  }
  if (!any) return 0;
  const arena = s.day >= dateToDay(ARENA_OPEN_DATE) ? EXPOSE_ARENA_BONUS : 0;
  const mult = exposureMultIn(s, model.id);
  const cap = mult > 1 ? EXPOSE_CAP_WITH_RIVALS : EXPOSE_MAX;
  return Math.min(cap, (EXPOSE_PER_PP * gap + arena) * mult);
}

/** Раз в месяц: шанс разоблачения выпущенных подогнанных моделей. */
export function monthlyExposure(s: GameState): void {
  for (const m of s.models) {
    const p = exposureChance(s, m);
    if (p <= 0 || !chance(s, p)) continue;
    // Пример для письма: бенчмарк с самым большим завышением.
    let worst: BenchmarkId | null = null;
    let worstGap = -1;
    for (const bid of Object.keys(m.overfit) as BenchmarkId[]) {
      if (!s.benchmarks[bid].introduced || s.benchmarks[bid].saturated) continue;
      const g = modelScore(m, bid, false) - modelScore(m, bid, true);
      if (g > worstGap) {
        worstGap = g;
        worst = bid;
      }
    }
    const example =
      worst === null
        ? ''
        : ` На ${benchDef(worst).name} (${DOMAIN_NAMES[benchDef(worst).domain].toLowerCase()}) вместо заявленных ${fmtPct(modelScore(m, worst, false))} получилось ${fmtPct(modelScore(m, worst, true))}.`;
    m.exposed = true;
    const repBefore = s.reputation;
    s.reputation = Math.min(100, Math.max(0, s.reputation + EXPOSE_REP));
    s.hype.player *= EXPOSE_HYPE_MULT;
    const hypeDropPct = Math.round((1 - EXPOSE_HYPE_MULT) * 100);
    addMail(s, {
      kind: 'news',
      title: `Подгонка раскрыта: ${m.name}`,
      important: true,
      body:
        `Независимые исследователи заново проверили «${m.name}» на свежих вопросах, которых не было в публичных тестах.${example} ` +
        `Репутация лаборатории упала на ${fmtNum(Math.round(repBefore - s.reputation))}, шумиха - на ${hypeDropPct} %; ` +
        'в таблице теперь честные баллы модели.',
    });
  }
}
