// Боты для проверки баланса (NFR-2): играют через те же действия, что и игрок.

import { newGame, releaseModel, setOnApi } from './actions';
import { activeBenchmarks } from './benchmarks';
import { availableGpus, pool, rentCapFor, rentPerGpuDay, setAllocation, setRent, totalH100e } from './compute';
import { MAX_TOKENS_B, TRAIN_FLOP_PER_H100E_DAY } from './constants';
import { applyTender, canApply } from './contracts';
import { applyChoice, pendingChoice } from './events';
import { canRaise, raiseRound } from './investors';
import { inferenceNeed, marketSnapshot, refPrice } from './market';
import { canResearch, maxContext, setResearch, techHistoryDay } from './research';
import { advanceDay } from './tick';
import { byYear, yearOf } from './time';
import { archFor, arenaElo, capsFromPlan, contextFlopMult, labelersCost, startTraining } from './training';
import type { Allocation, GameState, GpuId, TechId, TrainingPlan } from './types';

export type BotKind = 'idle' | 'reasonable' | 'strong' | 'benchmaxx';

interface BotProfile {
  rentShareOfCash: number; // какую часть денег можно «проесть» арендой за 120 дней
  revenueReinvest: number; // какую часть выручки пускать в аренду
  roundFraction: number;
  benchShare: number;
  trainDays: number; // на сколько дней планировать один проект
}

const PROFILES: Record<Exclude<BotKind, 'idle'>, BotProfile> = {
  reasonable: { rentShareOfCash: 0.35, revenueReinvest: 0.6, roundFraction: 0.2, benchShare: 0, trainDays: 60 },
  strong: { rentShareOfCash: 0.6, revenueReinvest: 0.8, roundFraction: 0.3, benchShare: 0, trainDays: 75 },
  benchmaxx: { rentShareOfCash: 0.35, revenueReinvest: 0.6, roundFraction: 0.2, benchShare: 0.25, trainDays: 60 },
};

function nextTech(s: GameState): TechId {
  const done = (t: TechId) => s.research.done.includes(t);
  if (!done('attention')) return 'attention';
  if (s.research.algoLevel < 2) return 'algo';
  if (!done('scaling')) return 'scaling';
  // Следующий уровень контекста - как только он появился в истории (без переплаты за опережение).
  if (canResearch(s, 'context') && techHistoryDay(s, 'context') <= s.day) return 'context';
  if (!done('rlhf')) return 'rlhf';
  return 'algo';
}

function avgDailyRevenue(s: GameState, days: number): number {
  const r = s.finance.revenueDaily.slice(-days);
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
}

/** Арендовать самые дешёвые H100e на бюджет, остальные типы вернуть. */
function manageRent(s: GameState, p: BotProfile): void {
  const budgetPerDay = Math.max(0, (s.cash * p.rentShareOfCash) / 120 + p.revenueReinvest * avgDailyRevenue(s, 30));
  let best: { id: GpuId; perH: number } | null = null;
  for (const g of availableGpus(s)) {
    const perH = rentPerGpuDay(s, g.id) / g.h100e;
    if (!best || perH < best.perH) best = { id: g.id, perH };
  }
  if (!best) return;
  const id = best.id;
  const count = Math.min(rentCapFor(s, id), Math.floor(budgetPerDay / rentPerGpuDay(s, id)));
  for (const g of availableGpus(s)) if (g.id !== id && s.compute.rented[g.id] > 0) setRent(s, g.id, 0);
  setRent(s, id, Math.max(0, count));
}

function manageAlloc(s: GameState): void {
  const total = totalH100e(s);
  if (total <= 0) return;
  let need = 0;
  try {
    need = inferenceNeed(s, marketSnapshot(s));
  } catch {
    need = 0;
  }
  const inference = Math.min(0.6, (need * 1.15) / total);
  const contracts = s.contracts.length > 0 ? 0.12 : 0;
  const rest = Math.max(0, 1 - inference - contracts);
  const a: Allocation = s.training
    ? { training: rest * 0.7, experiments: rest * 0.3, contracts, inference }
    : { training: 0, experiments: rest, contracts, inference };
  setAllocation(s, a);
}

/** План по Шиншилле на бюджет FLOP с учётом лимита данных года. */
export function chinchillaPlan(s: GameState, budget: number, name: string, benchShare: number): TrainingPlan {
  const maxTokens = byYear(MAX_TOKENS_B, yearOf(s.day));
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
  };
}

function bestReleasedElo(s: GameState): number {
  return s.models.filter((m) => m.releasedDay !== null).reduce((b, m) => Math.max(b, m.arenaElo), 0);
}

function manageTraining(s: GameState, p: BotProfile): void {
  if (s.training) return;
  // На время обучения доля «Обучение» ≈ 0,7 от свободной мощности.
  const trainPool = Math.max(pool(s, 'training'), totalH100e(s) * 0.55);
  if (trainPool <= 0) return;
  const flop = trainPool * TRAIN_FLOP_PER_H100E_DAY * p.trainDays;
  const plan = chinchillaPlan(s, flop, `Бот-${s.nextModelNum}`, p.benchShare);
  if (plan.rlhf && s.cash < labelersCost(plan) * 3) plan.rlhf = false;
  const elo = arenaElo(capsFromPlan(plan, s.research.algoLevel, archFor(s)), plan.rlhf, s.research.algoLevel);
  if (elo < bestReleasedElo(s) + 15) return;
  if (startTraining(s, plan).ok) {
    manageAlloc(s);
  }
}

function manageModels(s: GameState): void {
  const released = s.models.filter((m) => m.releasedDay !== null);
  const best = released.reduce((b, m) => Math.max(b, m.arenaElo), 0);
  for (const m of s.models) {
    if (m.releasedDay === null && m.arenaElo > best) releaseModel(s, m.id, Math.max(0.05, refPrice(s.day) * 0.8));
  }
  // В продаже - две лучшие модели.
  const sorted = s.models.filter((m) => m.releasedDay !== null).sort((a, b) => b.arenaElo - a.arenaElo);
  sorted.forEach((m, i) => setOnApi(s, m.id, i < 2));
}

function manageTenders(s: GameState): void {
  for (const t of s.tenders) {
    if (t.application) continue;
    const model = s.models.find((m) => canApply(s, t, m) === null);
    if (model) applyTender(s, t.id, model.id);
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
  const tech = nextTech(s);
  if (s.research.current !== tech && canResearch(s, tech)) setResearch(s, tech);
  manageRent(s, p);
  manageTraining(s, p);
  manageModels(s);
  manageTenders(s);
  manageInvestors(s, p);
  manageAlloc(s);
}

export interface BotResult {
  state: GameState;
  days: number;
}

/** Прогнать всю игру ботом. Выбор в почте - первый вариант. */
export function runBot(kind: BotKind, seed: number, maxDays = 4000): BotResult {
  const s = newGame('Бот', seed);
  let days = 0;
  while (!s.outcome && days < maxDays) {
    const pending = pendingChoice(s);
    if (pending) {
      applyChoice(s, pending.id, 0);
      continue;
    }
    if (s.day % 7 === 0) botAct(s, kind);
    advanceDay(s);
    days++;
  }
  return { state: s, days };
}
