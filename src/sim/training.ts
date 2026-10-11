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
  CODE_TRAIN_CAP,
  COT_REASONING_CAP,
  DISTILL_LIGHT_CAP,
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
  FRONTIER_PARAMS_B,
  INSTRUCT_ELO,
  MAX_BENCH_TARGETS,
  MAX_TOKENS_B,
  MAX_TRAININGS,
  MIX_K,
  OVERFIT_K,
  PARAMS_B_MAX,
  PARAMS_B_MIN,
  REVIEW_CODE_GAP,
  REVIEW_COST_BASE,
  REVIEW_COST_PER_B,
  REVIEW_DAYS_EXTRA,
  REVIEW_DAYS_MIN,
  REVIEW_ELO_GAP,
  RLHF_FLOP_EXTRA,
  RLHF_LABELERS_BASE,
  RLHF_LABELERS_PER_B,
  RLHF_LANGUAGE_BONUS,
  SYNTHETIC_TOKENS_MULT,
  TIER_PARAMS_RATIO,
  TIER_PRESET_RATIO,
  TIER_SUBS_PRICE,
  TOKENS_B_MIN,
  TRAIN_FLOP_PER_H100E_DAY,
} from './constants';
import { addMail, awaitingEvent, dropChoices, triggerEvent } from './events';
import { spend } from './finance';
import { codeLevel, rivalCodeFrontier, rivalFrontierElo } from './leaderboard';
import { contextLabel, maxContext } from './research';
import { EXPOSE_CAP_WITH_RIVALS, exposureMultIn } from './rivalry';
import { chance, randRange } from './rng';
import { endSentence } from './text';
import { byYear, dateToDay, formatDate, lerpByDate, yearOf } from './time';
import { DOMAINS, TIER_NAMES } from './types';
import type { BenchmarkId, DomainId, GameState, PlayerModel, Result, TechId, Tier, TrainingPlan, TrainingRun } from './types';

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

/** «1 день», «3 дня», «45 дней». */
function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/** Размер в млрд параметров для ошибок: 0,05 → «0,05», 61,25 → «61,3», 1800 → «1 800». */
function fmtParams(x: number): string {
  if (x >= 100) return fmtInt(x);
  const r = Math.round(x * 100) / 100;
  return String(r).replace('.', ',');
}

// ---------- Технологии, влияющие на модель ----------

/** Технологии, чей эффект задаётся при старте обучения и остаётся с моделью (снимок TrainingRun.techs / PlayerModel.techs). */
export const MODEL_TECHS: readonly TechId[] = ['distill', 'moe', 'codetrain', 'instruct', 'cot', 'multimodal'];

/** Снимок для нового проекта: изученные технологии из MODEL_TECHS. */
export function modelTechs(s: GameState): TechId[] {
  return MODEL_TECHS.filter((t) => s.research.done.includes(t));
}

/** Наибольший объём данных в этом году, млрд токенов: MAX_TOKENS_B × SYNTHETIC_TOKENS_MULT после «Синтетических данных». */
export function maxTokensB(s: GameState): number {
  const base = byYear(MAX_TOKENS_B, yearOf(s.day));
  return s.research.done.includes('synthetic') ? base * SYNTHETIC_TOKENS_MULT : base;
}

// ---------- Уровни моделей (design market-v2, раздел 3) ----------

/** Передний край по параметрам на день, млрд (FRONTIER_PARAMS_B, интерполяция в логарифме). */
export function frontierParams(day: number): number {
  return lerpByDate(FRONTIER_PARAMS_B, day, true);
}

/** Уровень по размеру относительно переднего края: ≥ 0,35 - флагман, ≥ 0,08 - средняя, иначе лёгкая. */
export function tierOf(paramsB: number, day: number): Tier {
  const r = paramsB / frontierParams(day);
  if (r >= TIER_PARAMS_RATIO.flagship[0]) return 'flagship';
  if (r >= TIER_PARAMS_RATIO.mid[0]) return 'mid';
  return 'light';
}

/** Границы размера уровня на день, млрд: [от, до]; у лёгких снизу PARAMS_B_MIN. Пустой диапазон (от ≥ до) - уровень недоступен. */
export function tierRange(day: number, tier: Tier): [number, number] {
  const f = frontierParams(day);
  const [lo, hi] = TIER_PARAMS_RATIO[tier];
  return [Math.max(PARAMS_B_MIN, lo * f), Math.min(PARAMS_B_MAX, hi * f)];
}

/** Уровень доступен: его диапазон размеров не пуст (в 2017 году флагман - 0,35…1,5 млрд, лёгкие - 0,05…0,08). */
export function tierAvailable(day: number, tier: Tier): boolean {
  const [lo, hi] = tierRange(day, tier);
  return lo < hi;
}

/** Пресет уровня: размер TIER_PRESET_RATIO × передний край в границах уровня, данные по Шиншилле (20 токенов на параметр) в лимите года. */
export function tierPreset(s: GameState, tier: Tier): { paramsB: number; tokensB: number } {
  const [lo, hi] = tierRange(s.day, tier);
  const paramsB = Math.min(hi, Math.max(lo, TIER_PRESET_RATIO[tier] * frontierParams(s.day)));
  const maxTokens = maxTokensB(s);
  const tokensB = Math.min(maxTokens, Math.max(TOKENS_B_MIN, CHIN_OPT_RATIO * paramsB));
  return { paramsB, tokensB };
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

/** Прибавка к способности от технологий снимка: код, рассуждения, дистилляция лёгких моделей. */
export function techCapBonus(plan: TrainingPlan, d: DomainId, techs: readonly TechId[]): number {
  let bonus = 0;
  if (d === 'code' && techs.includes('codetrain')) bonus += CODE_TRAIN_CAP;
  if (d === 'reasoning' && techs.includes('cot')) bonus += COT_REASONING_CAP;
  if (plan.tier === 'light' && techs.includes('distill')) bonus += DISTILL_LIGHT_CAP;
  return bonus;
}

/**
 * cap_d = base + 8·(3·m_d − 1) − 15·b − failPenalty; у языка ещё +2 при RLHF; плюс прибавки технологий снимка
 * (techs: «Обучение на коде», «Цепочки рассуждений», «Дистилляция» у лёгких).
 */
export function capsFromPlan(
  plan: TrainingPlan,
  algoLevel: number,
  arch: Arch,
  failPenalty = 0,
  techs: readonly TechId[] = [],
): Record<DomainId, number> {
  const base = baseLevel(effectiveCompute(plan, algoLevel, arch));
  const caps = {} as Record<DomainId, number>;
  for (const d of DOMAINS) {
    caps[d] =
      base +
      MIX_K * (3 * plan.mix[d] - 1) -
      BENCH_DATA_PENALTY * plan.benchShare -
      failPenalty +
      (d === 'language' && plan.rlhf ? RLHF_LANGUAGE_BONUS : 0) +
      techCapBonus(plan, d, techs);
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

/**
 * Elo = ELO_BASE + ELO_PER_CAP × capA + (rlhf ? ELO_RLHF_BASE + ELO_RLHF_PER_ALGO × algoLevel : 0)
 * + INSTRUCT_ELO у моделей без RLHF, если в снимке есть «Дообучение на инструкциях» (RLHF его перекрывает).
 * Подгонка не участвует.
 */
export function arenaElo(caps: Record<DomainId, number>, rlhf: boolean, algoLevel: number, techs: readonly TechId[] = []): number {
  let capA = 0;
  for (const d of DOMAINS) capA += ARENA_WEIGHTS[d] * caps[d];
  return (
    ELO_BASE +
    ELO_PER_CAP * capA +
    (rlhf ? ELO_RLHF_BASE + ELO_RLHF_PER_ALGO * algoLevel : 0) +
    (!rlhf && techs.includes('instruct') ? INSTRUCT_ELO : 0)
  );
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

/** Мощность на один проект: доля «Обучение» делится поровну между идущими проектами (extra - ещё не начатые, для оценки срока). */
export function trainingPoolPerRun(s: GameState, extra = 0): number {
  return pool(s, 'training') / Math.max(1, s.trainings.length + extra);
}

/**
 * Ошибка или null: не больше MAX_TRAININGS проектов, размеры в границах, уровень совпадает с размером (tierOf),
 * токены ≤ MAX_TOKENS_B(год), микс ≈ 1, b в [0, 0.5], ≤ 3 цели (только вышедшие бенчмарки), rlhf только после
 * исследования, хватает денег на разметчиков.
 */
export function validatePlan(s: GameState, plan: TrainingPlan): string | null {
  if (s.trainings.length >= MAX_TRAININGS) return 'Одновременно идут не больше двух проектов обучения.';
  const name = plan.name.trim();
  if (!name) return 'Название модели не указано.';
  if (name.length > 40) return 'Название модели - не длиннее 40 символов.';
  if (!Number.isFinite(plan.paramsB) || plan.paramsB < PARAMS_B_MIN || plan.paramsB > PARAMS_B_MAX) {
    return `Размер модели - от ${fmtNum(PARAMS_B_MIN)} до ${fmtInt(PARAMS_B_MAX)} млрд параметров.`;
  }
  if (!(plan.tier in TIER_NAMES)) return 'Уровень модели не указан.';
  if (plan.tier !== tierOf(plan.paramsB, s.day)) {
    const [lo, hi] = tierRange(s.day, plan.tier);
    return `Размер модели не соответствует уровню «${TIER_NAMES[plan.tier]}»: в этом году от ${fmtParams(lo)} до ${fmtParams(hi)} млрд параметров.`;
  }
  const year = yearOf(s.day);
  const maxTokens = maxTokensB(s);
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
  // Новый проект разделит долю «Обучение» с уже идущими: срок считается по мощности на проект.
  const perDay = trainingPoolPerRun(s, 1) * TRAIN_FLOP_PER_H100E_DAY;
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
  const techs = modelTechs(s);
  const caps = capsFromPlan(plan, algoLevel, arch, 0, techs);
  const overfit = overfitFromPlan(plan);
  const scores: Partial<Record<BenchmarkId, number>> = {};
  for (const bid of introducedBenchmarks(s)) {
    scores[bid] = benchScore(bid, caps[benchDef(bid).domain], overfit[bid] ?? 0);
  }
  result.forecast = { caps, scores, elo: arenaElo(caps, plan.rlhf, algoLevel, techs) };

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
  s.trainings.push({
    id: `t${s.nextRunNum++}`,
    failed: false,
    plan: copy,
    arch: archFor(s),
    algoLevel: s.research.algoLevel,
    techs: modelTechs(s),
    flopTotal: flop,
    flopDone: 0,
    startedDay: s.day,
    failAtFraction,
    failPenalty: 0,
  });
  return { ok: true };
}

/** Отменить проект по id. Деньги разметчикам не возвращаются; если проект ждал решения по срыву, письмо снимается с выбора. */
export function cancelTraining(s: GameState, runId: string): Result {
  const i = s.trainings.findIndex((r) => r.id === runId);
  if (i < 0) return { ok: false, error: 'Нет такого проекта обучения.' };
  const [run] = s.trainings.splice(i, 1);
  if (run.failed) dropChoices(s, 'training-fail', 'Проект отменён, решение не требуется.');
  return { ok: true };
}

/** Выбор в событии «срыв обучения» (вызывается из data/events.ts): проект, который ждёт решения (failed), снова идёт. */
export function applyFailChoice(s: GameState, choice: 'rollback' | 'continue'): void {
  const t = s.trainings.find((r) => r.failed);
  if (!t) return;
  if (choice === 'rollback') t.flopDone = Math.max(0, t.flopDone - FAIL_ROLLBACK * t.flopTotal);
  else t.failPenalty = FAIL_CONTINUE_PENALTY;
  t.failed = false;
  t.failAtFraction = null;
}

/** Строка с баллами новой модели по активным бенчмаркам (если все насыщены - по всем вышедшим). */
function keyScores(s: GameState, model: PlayerModel): string {
  const active = introducedBenchmarks(s).filter((b) => !s.benchmarks[b].saturated);
  const list = active.length > 0 ? active : introducedBenchmarks(s);
  return list.map((b) => `${benchDef(b).name} ${fmtPct(modelScore(model, b, false))}`).join(', ');
}

function finishTraining(s: GameState, t: TrainingRun): void {
  const techs = t.techs ?? [];
  const caps = capsFromPlan(t.plan, t.algoLevel, t.arch, t.failPenalty, techs);
  const model: PlayerModel = {
    id: `p${s.nextModelNum++}`,
    name: t.plan.name,
    plan: t.plan,
    arch: t.arch,
    algoLevel: t.algoLevel,
    techs: [...techs],
    trainedDay: s.day,
    releasedDay: null,
    caps,
    overfit: overfitFromPlan(t.plan),
    rlhf: t.plan.rlhf,
    arenaElo: arenaElo(caps, t.plan.rlhf, t.algoLevel, techs),
    price: 0,
    onApi: false,
    exposed: false,
    earned: 0,
    onSubs: false,
    subsPrice: TIER_SUBS_PRICE[t.plan.tier] ?? TIER_SUBS_PRICE.mid,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
  };
  s.models.push(model);
  s.bestFlop = Math.max(s.bestFlop, t.flopTotal);
  s.trainings = s.trainings.filter((r) => r !== t);

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

/**
 * Ежедневно, для каждого проекта: прогресс по мощности на проект (trainingPoolPerRun); срыв (triggerEvent
 * 'training-fail') - проект стоит (failed), пока игрок не решит, что делать; второй срыв ждёт решения по первому
 * (проект зажат в точке срыва, failAtFraction остаётся); завершение → PlayerModel в s.models, bestFlop, письмо.
 */
export function progressDay(s: GameState): void {
  if (s.trainings.length === 0) return;
  const perRun = trainingPoolPerRun(s) * TRAIN_FLOP_PER_H100E_DAY;
  for (const t of [...s.trainings]) {
    if (t.failed) continue;
    t.flopDone += perRun;
    if (t.failAtFraction !== null && t.flopDone >= t.failAtFraction * t.flopTotal) {
      // Срыв случается в точке отказа: дальше проект не идёт, пока игрок не выберет, что делать.
      t.flopDone = t.failAtFraction * t.flopTotal;
      if (awaitingEvent(s, 'training-fail')) continue; // письмо о срыве другого проекта ещё ждёт ответа
      t.failAtFraction = null;
      t.failed = true;
      triggerEvent(s, 'training-fail');
      continue;
    }
    if (t.flopDone >= t.flopTotal) finishTraining(s, t);
  }
}

// ---------- Внешняя проверка сильной модели (design market-v2, раздел 4.2) ----------

/**
 * Почему модели нужна внешняя проверка перед подпиской, или null: Эло не ниже лучшего соперника минус REVIEW_ELO_GAP,
 * либо уровень по коду выше лучшего соперника на REVIEW_CODE_GAP. Без соперников на рынке проверка не нужна.
 */
export function reviewReason(s: GameState, m: PlayerModel): string | null {
  const frontier = rivalFrontierElo(s);
  if (frontier > 0 && m.arenaElo >= frontier - REVIEW_ELO_GAP) {
    return `Эло ${fmtInt(m.arenaElo)} против ${fmtInt(frontier)} у лучшего соперника`;
  }
  const code = codeLevel(s, { kind: 'player', id: m.id });
  const rivalCode = rivalCodeFrontier(s);
  if (code !== null && rivalCode !== null && code >= rivalCode + REVIEW_CODE_GAP) return 'уровень по коду выше лучшего соперника';
  return null;
}

/** Нужна ли модели внешняя проверка перед подпиской (считается один раз при выпуске: край только растёт). */
export function reviewRequired(s: GameState, m: PlayerModel): boolean {
  return reviewReason(s, m) !== null;
}

/** Стоимость проверки: REVIEW_COST_BASE + REVIEW_COST_PER_B × млрд параметров (1,8 трлн - $3,9 млн). */
export function reviewCost(m: PlayerModel): number {
  return REVIEW_COST_BASE + REVIEW_COST_PER_B * m.plan.paramsB;
}

/** Срок проверки, дней: 30 + round(15 × min(1, размер / передний край)) - 30…45, без случайности. */
export function reviewDays(s: GameState, m: PlayerModel): number {
  return REVIEW_DAYS_MIN + Math.round(REVIEW_DAYS_EXTRA * Math.min(1, m.plan.paramsB / frontierParams(s.day)));
}

/** Действие: начать внешнюю проверку (списать деньги, поставить срок). Пока она идёт, подписку включить нельзя. */
export function startReview(s: GameState, modelId: string): Result {
  const m = s.models.find((x) => x.id === modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (m.releasedDay === null) return { ok: false, error: 'Модель ещё не выпущена' };
  if (m.review === 'pending') return { ok: false, error: 'Проверка уже идёт.' };
  if (m.review !== 'required') return { ok: false, error: 'Этой модели проверка не нужна.' };
  const cost = reviewCost(m);
  if (cost > s.cash) {
    return { ok: false, error: `Не хватает денег на проверку: нужно ${fmtMoney(cost)}, на счету ${endSentence(fmtMoney(s.cash))}` };
  }
  spend(s, 'review', cost);
  m.review = 'pending';
  m.reviewEndDay = s.day + reviewDays(s, m);
  addMail(s, {
    kind: 'training',
    title: `Внешняя проверка начата: «${m.name}»`,
    body: `Независимые эксперты проверяют модель до ${formatDate(m.reviewEndDay)}. Списано ${endSentence(fmtMoney(cost))}`,
  });
  return { ok: true };
}

/** Ежедневно (после обучения): проверки, чей срок наступил, пройдены; важное письмо. */
export function reviewDay(s: GameState): void {
  for (const m of s.models) {
    if (m.review !== 'pending' || m.reviewEndDay === null || s.day < m.reviewEndDay) continue;
    m.review = 'passed';
    addMail(s, {
      kind: 'training',
      title: `Внешняя проверка пройдена: «${m.name}»`,
      important: true,
      body: 'Замечаний нет. Подписку можно включить в окне «Модели».',
    });
  }
}

/** Текст для письма о выпуске: сколько займёт и будет стоить проверка. */
export function reviewTerms(s: GameState, m: PlayerModel): string {
  return `Проверка займёт ${daysWord(reviewDays(s, m))} и стоит ${fmtMoney(reviewCost(m))}`;
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
