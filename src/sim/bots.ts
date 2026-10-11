// Боты для проверки баланса (NFR-2): играют через те же действия, что и игрок.

import { newGame, releaseModel, setOnApi, setOnSubs, startReview } from './actions';
import { activeBenchmarks } from './benchmarks';
import { availableGpus, pool, rentCapFor, rentMaxFor, rentPerGpuDay, setAllocation, setRent, totalH100e } from './compute';
import { FAIL_ROLLBACK, RENT_OVER_CAP_MULT, ROUND_COOLDOWN_DAYS, TIER_API_PRICE_MULT, TRAIN_FLOP_PER_H100E_DAY } from './constants';
import { applyTender, canApply, contractWorkFor } from './contracts';
import { applyChoice, pendingChoice } from './events';
import { overheadPerDay } from './finance';
import { canRaise, raiseRound } from './investors';
import { inferenceNeed, marketSnapshot, minPrice, refPrice, subsOpen } from './market';
import { canResearch, maxContext, setResearch, techHistoryDay, yearsEarly } from './research';
import { botPriceReflex } from './rivalry';
import type { Difficulty } from './rivalry';
import { advanceDay } from './tick';
import { END_DAY } from './time';
import {
  archFor,
  arenaElo,
  capsFromPlan,
  contextFlopMult,
  labelersCost,
  maxTokensB,
  modelTechs,
  reviewCost,
  startTraining,
  tierOf,
  trainingPoolPerRun,
} from './training';
import type { Allocation, GameState, GpuId, TechId, TrainingPlan } from './types';

export type BotKind = 'idle' | 'reasonable' | 'strong' | 'benchmaxx';

interface BotProfile {
  rentShareOfCash: number; // какую часть денег можно «проесть» арендой за 120 дней
  revenueReinvest: number; // какую часть выручки пускать в аренду
  roundFraction: number;
  benchShare: number;
  trainDays: number; // на сколько дней планировать один проект
}

// Рынок v2: с подписками выручка «разумного» выросла почти вдвое, оценка у инвесторов - тоже, и при раундах по 20 %
// он получал вчетверо больше вычислений и побеждал на всех зёрнах. revenueReinvest не помогает: бюджет аренды
// определяется кассой (rentShareOfCash), а меньшая доля аренды копит кассу сверх годовых расходов. Раунды по 10 %
// возвращают бота на 3-е место (balance.test.ts); «подгонщик» - тот же профиль с подгонкой.
const PROFILES: Record<Exclude<BotKind, 'idle'>, BotProfile> = {
  reasonable: { rentShareOfCash: 0.35, revenueReinvest: 0.6, roundFraction: 0.1, benchShare: 0, trainDays: 60 },
  strong: { rentShareOfCash: 0.6, revenueReinvest: 0.9, roundFraction: 0.3, benchShare: 0, trainDays: 110 },
  benchmaxx: { rentShareOfCash: 0.35, revenueReinvest: 0.6, roundFraction: 0.1, benchShare: 0.25, trainDays: 60 },
};

// RLHF раньше истории дорог (EARLY_PENALTY_PER_YEAR.rlhf): бот берёт его, когда до исторической даты меньше полугода.
const BOT_RLHF_YEARS_EARLY = 0.5;
// Меньше стольких дней до конца игры новый проект не начинается.
const BOT_MIN_TRAIN_DAYS = 20;
// Не больше такой доли мощности уходит на контракты; заявки подаются, пока работа помещается в эту долю.
const BOT_CONTRACTS_MAX_SHARE = 0.5;
// Запас денег: кассы с выручкой API должно хватать на аренду и накладные до следующего возможного раунда,
// но не меньше чем на столько дней (BANKRUPT_DAYS в минусе - банкротство).
const BOT_RUNWAY_DAYS = 60;
// Обслуживание клиентов: не больше такой доли мощности на один канал (API или подписки) и на оба вместе.
const BOT_SERVE_MAX = 0.5;
const BOT_SERVE_TOTAL_MAX = 0.7;
// Внешнюю проверку бот начинает, когда денег хватает на столько проверок.
const BOT_REVIEW_CASH_MULT = 3;

// Новые технологии бот берёт после их исторической даты (без переплаты), в порядке дат.
const BOT_HISTORIC_TECHS: readonly TechId[] = ['distill', 'moe', 'codetrain', 'instruct', 'cot', 'quant', 'multimodal', 'synthetic'];

export function nextTech(s: GameState): TechId {
  const done = (t: TechId) => s.research.done.includes(t);
  if (!done('attention')) return 'attention';
  if (s.research.algoLevel < 2) return 'algo';
  if (!done('scaling')) return 'scaling';
  // Следующий уровень контекста - как только он появился в истории (без переплаты за опережение).
  if (canResearch(s, 'context') && techHistoryDay(s, 'context') <= s.day) return 'context';
  if (!done('rlhf') && yearsEarly(s, 'rlhf') <= BOT_RLHF_YEARS_EARLY) return 'rlhf';
  for (const t of BOT_HISTORIC_TECHS) if (canResearch(s, t) && techHistoryDay(s, t) <= s.day) return t;
  return 'algo';
}

function avgDailyRevenue(s: GameState, days: number): number {
  const r = s.finance.revenueDaily.slice(-days);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
}

/** Сколько карт типа id помещается в дневной бюджет: сверх лимита они дороже в RENT_OVER_CAP_MULT раз, не выше потолка. */
export function affordableRent(s: GameState, id: GpuId, budgetPerDay: number): number {
  const price = rentPerGpuDay(s, id);
  if (!(price > 0) || !(budgetPerDay > 0)) return 0;
  const cap = rentCapFor(s, id);
  let count = Math.floor(budgetPerDay / price);
  if (count > cap) count = cap + Math.floor((budgetPerDay - cap * price) / (price * RENT_OVER_CAP_MULT));
  return Math.min(rentMaxFor(s, id), count);
}

/** Дней до следующего возможного раунда инвестиций (0 - раунд доступен сейчас). */
function daysToRound(s: GameState): number {
  return s.lastRoundDay === null ? 0 : Math.max(0, s.lastRoundDay + ROUND_COOLDOWN_DAYS - s.day);
}

/** Оплата активных контрактов со сроком в пределах горизонта: карты под них арендуются, сдача - до срока. */
function contractPayoutsDue(s: GameState, horizon: number): number {
  let sum = 0;
  for (const c of s.contracts) if (c.deadlineDay <= s.day + horizon) sum += c.tender.payment;
  return sum;
}

/**
 * Потолок аренды в день, чтобы дожить до следующего раунда (или конца игры, но не меньше BOT_RUNWAY_DAYS):
 * касса с оплатой контрактов на горизонт плюс выручка API за последний закрытый месяц минус накладные.
 * Ближние BOT_RUNWAY_DAYS покрывает одна касса: оплата приходит в конце работы. Средняя выручка за 30 дней
 * сюда не идёт: разовую оплату контракта бот «проедал» арендой и уходил в минус.
 */
function runwayRentPerDay(s: GameState): number {
  const horizon = Math.max(BOT_RUNWAY_DAYS, Math.min(daysToRound(s), END_DAY - s.day));
  const perDay = Math.min(s.cash / BOT_RUNWAY_DAYS, (s.cash + contractPayoutsDue(s, horizon)) / horizon);
  const apiPerDay = (s.finance.history.at(-1)?.income.api ?? 0) / 30;
  return perDay + apiPerDay - overheadPerDay(s);
}

/** Дневной бюджет аренды: доля денег за 120 дней плюс доля выручки, не выше потолка запаса денег. */
function rentBudget(s: GameState, p: BotProfile): number {
  const wanted = (s.cash * p.rentShareOfCash) / 120 + p.revenueReinvest * avgDailyRevenue(s, 30);
  return Math.max(0, Math.min(wanted, runwayRentPerDay(s)));
}

/** Самый дешёвый по H100e тип карт и сколько их помещается в бюджет; null - карт ещё нет. */
function cheapestPlan(s: GameState, p: BotProfile): { id: GpuId; h100e: number; count: number } | null {
  let best: { id: GpuId; perH: number; h100e: number } | null = null;
  for (const g of availableGpus(s)) {
    const perH = rentPerGpuDay(s, g.id) / g.h100e;
    if (!best || perH < best.perH) best = { id: g.id, perH, h100e: g.h100e };
  }
  if (!best) return null;
  return { id: best.id, h100e: best.h100e, count: affordableRent(s, best.id, rentBudget(s, p)) };
}

/** Арендовать самые дешёвые H100e на бюджет (при деньгах - и сверх лимита), остальные типы вернуть. */
function manageRent(s: GameState, p: BotProfile): void {
  const plan = cheapestPlan(s, p);
  if (!plan) return;
  let count = plan.count;
  // Выигранные контракты окупают аренду: карт должно хватать, чтобы доля «Контракты» закрывала все сроки.
  const needed = Math.ceil(loadNeed(activeLoad(s)) / BOT_CONTRACTS_MAX_SHARE / plan.h100e);
  if (needed > count) count = Math.min(rentMaxFor(s, plan.id), needed);
  for (const g of availableGpus(s)) if (g.id !== plan.id && s.compute.rented[g.id] > 0) setRent(s, g.id, 0);
  setRent(s, plan.id, Math.max(0, count));
}

// Нагрузка контрактов: пул «Контракты» делится поровну, поэтому нужна самая требовательная работа в день × число контрактов.
interface ContractLoad {
  worst: number; // H100e в день у самого требовательного контракта
  count: number;
}

function addLoad(l: ContractLoad, work: number, days: number): ContractLoad {
  return { worst: Math.max(l.worst, work / Math.max(1, days)), count: l.count + 1 };
}

/** H100e в день, чтобы все контракты нагрузки успели к сроку (с запасом четверть). */
function loadNeed(l: ContractLoad): number {
  return l.worst * l.count * 1.25;
}

/** Нагрузка активных контрактов: остаток работы к сроку минус неделя запаса. */
function activeLoad(s: GameState): ContractLoad {
  let l: ContractLoad = { worst: 0, count: 0 };
  for (const c of s.contracts) l = addLoad(l, Math.max(0, c.tender.work - c.workDone), c.deadlineDay - s.day - 7);
  return l;
}

/** Нагрузка с учётом поданных заявок: если их выиграть, работу тоже придётся делать. */
function plannedLoad(s: GameState): ContractLoad {
  let l = activeLoad(s);
  for (const t of s.tenders) if (t.application !== null) l = addLoad(l, t.application.work ?? t.work, t.durationDays - 7);
  return l;
}

/** Доли «API» и «Подписки» по нужной мощности с запасом 15 %: не больше BOT_SERVE_MAX каждая и BOT_SERVE_TOTAL_MAX вместе. */
function serveShares(s: GameState, total: number): { api: number; subs: number } {
  let need = { api: 0, subs: 0 };
  try {
    need = inferenceNeed(s, marketSnapshot(s));
  } catch {
    need = { api: 0, subs: 0 };
  }
  let api = Math.min(BOT_SERVE_MAX, (need.api * 1.15) / total);
  let subs = Math.min(BOT_SERVE_MAX, (need.subs * 1.15) / total);
  const both = api + subs;
  if (both > BOT_SERVE_TOTAL_MAX) {
    api *= BOT_SERVE_TOTAL_MAX / both;
    subs *= BOT_SERVE_TOTAL_MAX / both;
  }
  return { api, subs };
}

function manageAlloc(s: GameState): void {
  const total = totalH100e(s);
  if (total <= 0) return;
  const { api, subs } = serveShares(s, total);
  const contracts = Math.min(BOT_CONTRACTS_MAX_SHARE, loadNeed(activeLoad(s)) / total);
  const rest = Math.max(0, 1 - api - subs - contracts);
  const a: Allocation =
    s.trainings.length > 0
      ? { training: rest * 0.7, experiments: rest * 0.3, contracts, api, subs }
      : { training: 0, experiments: rest, contracts, api, subs };
  setAllocation(s, a);
}

/** План по Шиншилле на бюджет FLOP с учётом лимита данных года. */
export function chinchillaPlan(s: GameState, budget: number, name: string, benchShare: number): TrainingPlan {
  const maxTokens = maxTokensB(s);
  // Надбавка за контекст входит в бюджет: модель должна уложиться в тот же срок.
  const flop = budget / contextFlopMult(maxContext(s));
  let paramsB = Math.sqrt(flop / 120) / 1e9;
  let tokensB = 20 * paramsB;
  if (tokensB > maxTokens) {
    tokensB = maxTokens;
    paramsB = flop / (6 * tokensB * 1e18);
  }
  paramsB = Math.min(2000, Math.max(0.05, paramsB));
  tokensB = Math.min(maxTokens, Math.max(0.5, tokensB));
  const targets = benchShare > 0 ? activeBenchmarks(s).slice(-1) : [];
  return {
    name,
    paramsB,
    tokensB,
    mix: { language: 0.45, code: 0.3, reasoning: 0.25 },
    benchShare: targets.length ? benchShare : 0,
    benchTargets: targets,
    rlhf: s.research.done.includes('rlhf'),
    context: maxContext(s),
    tier: tierOf(paramsB, s.day),
  };
}

function bestReleasedElo(s: GameState): number {
  return s.models.filter((m) => m.releasedDay !== null).reduce((b, m) => Math.max(b, m.arenaElo), 0);
}

/** Бот ведёт один проект за раз. */
function manageTraining(s: GameState, p: BotProfile): void {
  if (s.trainings.length > 0) return;
  // На время обучения доля «Обучение» ≈ 0,7 от свободной мощности.
  const trainPool = Math.max(pool(s, 'training'), totalH100e(s) * 0.55);
  if (trainPool <= 0) return;
  // Последний проект растягивается до конца игры: модель, которая не успеет выйти, никому не нужна.
  const daysLeft = END_DAY - s.day;
  if (daysLeft < BOT_MIN_TRAIN_DAYS) return;
  const trainDays = daysLeft < 1.5 * p.trainDays ? daysLeft - 3 : p.trainDays;
  const flop = trainPool * TRAIN_FLOP_PER_H100E_DAY * trainDays;
  const plan = chinchillaPlan(s, flop, `Бот-${s.nextModelNum}`, p.benchShare);
  if (plan.rlhf && s.cash < labelersCost(plan) * 3) plan.rlhf = false;
  const techs = modelTechs(s);
  const elo = arenaElo(capsFromPlan(plan, s.research.algoLevel, archFor(s), 0, techs), plan.rlhf, s.research.algoLevel, techs);
  if (elo < bestReleasedElo(s) + 15) return;
  if (startTraining(s, plan).ok) {
    manageAlloc(s);
  }
}

/**
 * Выпуск по цене 0,8 × множитель уровня × опорная; в продаже - две лучшие модели по обоим каналам (подписка - после
 * чат-момента, без незавершённой проверки); сильной модели бот заказывает проверку, когда денег хватает на три.
 */
function manageModels(s: GameState): void {
  const released = s.models.filter((m) => m.releasedDay !== null);
  const best = released.reduce((b, m) => Math.max(b, m.arenaElo), 0);
  for (const m of s.models) {
    if (m.releasedDay !== null || m.arenaElo <= best) continue;
    const price = Math.max(minPrice(s.day), refPrice(s.day) * 0.8 * (TIER_API_PRICE_MULT[m.plan.tier] ?? 1));
    releaseModel(s, m.id, price);
  }
  const sorted = s.models.filter((m) => m.releasedDay !== null).sort((a, b) => b.arenaElo - a.arenaElo);
  const open = subsOpen(s.day);
  sorted.forEach((m, i) => {
    const top = i < 2;
    setOnApi(s, m.id, top);
    if (top && open && m.review === 'required' && s.cash >= BOT_REVIEW_CASH_MULT * reviewCost(m)) startReview(s, m.id);
    setOnSubs(s, m.id, top && open && (m.review === 'none' || m.review === 'passed'));
  });
}

/** Подать заявки на тендеры, работа которых помещается в долю «Контракты» мощности по бюджету (не в долг). */
function manageTenders(s: GameState, p: BotProfile): void {
  const plan = cheapestPlan(s, p);
  if (!plan) return;
  const capacity = plan.count * plan.h100e * BOT_CONTRACTS_MAX_SHARE;
  let load = plannedLoad(s);
  for (const t of s.tenders) {
    if (t.application) continue;
    const model = s.models.find((m) => canApply(s, t, m) === null);
    if (!model) continue;
    const next = addLoad(load, contractWorkFor(s, t, model), t.durationDays - 7);
    if (loadNeed(next) > capacity) continue;
    if (applyTender(s, t.id, model.id).ok) load = next;
  }
}

function manageInvestors(s: GameState, p: BotProfile): void {
  if (canRaise(s) !== null) return;
  // Раунд - когда денег меньше чем на год текущих расходов.
  const last = s.finance.history.at(-1);
  const monthlyCost = (last?.expense.rent ?? 0) + (last?.expense.overhead ?? 100_000);
  if (s.cash < monthlyCost * 12) raiseRound(s, p.roundFraction);
}

/** Один «ход» бота (вызывается раз в неделю). */
export function botAct(s: GameState, kind: BotKind): void {
  if (kind === 'idle') return;
  const p = PROFILES[kind];
  // Единственный ответ бота на ходы соперников: доля за месяц упала на четверть - цены моделей на API ×0,85.
  botPriceReflex(s);
  const tech = nextTech(s);
  if (s.research.current !== tech && canResearch(s, tech)) setResearch(s, tech);
  manageRent(s, p);
  manageTraining(s, p);
  manageModels(s);
  manageTenders(s, p);
  manageInvestors(s, p);
  manageAlloc(s);
}

export interface BotResult {
  state: GameState;
  days: number;
}

/**
 * Выбор бота в письме: первый вариант, кроме срыва обучения, когда откат к чекпоинту не успеет
 * до конца игры, - тогда «Продолжить» (модель слабее, но она выйдет).
 */
export function botChoice(s: GameState, eventId: string | undefined): number {
  const t = s.trainings.find((r) => r.failed);
  if (eventId !== 'training-fail' || !t) return 0;
  const perDay = trainingPoolPerRun(s) * TRAIN_FLOP_PER_H100E_DAY;
  if (perDay <= 0) return 0;
  const daysAfterRollback = (t.flopTotal - t.flopDone + FAIL_ROLLBACK * t.flopTotal) / perDay;
  return daysAfterRollback > END_DAY - s.day - 3 ? 1 : 0;
}

/** Прогнать всю игру ботом. Выбор в почте - botChoice. Опоры баланса считаются на Обычной сложности. */
export function runBot(kind: BotKind, seed: number, maxDays = 4000, difficulty: Difficulty = 'normal'): BotResult {
  const s = newGame('Бот', seed, difficulty);
  let days = 0;
  while (!s.outcome && days < maxDays) {
    const pending = pendingChoice(s);
    if (pending) {
      applyChoice(s, pending.id, botChoice(s, pending.eventId));
      continue;
    }
    if (s.day % 7 === 0) botAct(s, kind);
    advanceDay(s);
    days++;
  }
  return { state: s, days };
}
