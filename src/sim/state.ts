// Создание начального состояния новой игры (FR-13). Используется actions.newGame и тестами.

import { DEFAULT_ALLOC, HYPE_OWNERS, START_CASH, START_REPUTATION } from './constants';
import { emptyRivalry } from './rivalry';
import type { Difficulty } from './rivalry';
import type { BenchmarkId, GameState, HypeOwner, MonthLedger, SegmentId, SegmentShares, TechId } from './types';
import { BENCHMARK_IDS, SEGMENT_IDS, TECH_IDS } from './types';

export function emptyLedger(): MonthLedger {
  return {
    income: { api: 0, subs: 0, contracts: 0, investors: 0 },
    expense: { rent: 0, overhead: 0, labelers: 0, penalties: 0, review: 0, capex: 0, power: 0 },
  };
}

/** Очки по всем технологиям, по нулям. */
export function emptyTechPoints(): Record<TechId, number> {
  const out = {} as Record<TechId, number>;
  for (const t of TECH_IDS) out[t] = 0;
  return out;
}

function emptyLabShares(): Record<HypeOwner | 'none', number> {
  const out = { none: 1 } as Record<HypeOwner | 'none', number>;
  for (const o of HYPE_OWNERS) out[o] = 0;
  return out;
}

/** Пустые доли сегмента: моделей нет, весь спрос у внешнего варианта. */
export function emptySegmentShares(): SegmentShares {
  return { shares: {}, labShares: emptyLabShares(), total: 0 };
}

/** Рынок до первого тика: пустые доли по всем сегментам (так же дополняются старые сохранения). */
export function emptyMarket(): GameState['market'] {
  const segments = Object.fromEntries(SEGMENT_IDS.map((id) => [id, emptySegmentShares()])) as Record<SegmentId, SegmentShares>;
  return {
    shares: {},
    labShares: emptyLabShares(),
    playerTokens: 0,
    lostFraction: 0,
    totalTokens: 0,
    playerSubs: 0,
    totalSubs: 0,
    lostApi: 0,
    lostSubs: 0,
    segments,
  };
}

/** Цели и случайные события: свой поток случайных чисел, производный от зерна (основной поток не трогаем). */
export function emptyYearly(seed: number, day = 0): GameState['yearly'] {
  const rng = (seed ^ 0x9e3779b9) >>> 0;
  return { year: 0, goals: [], reviews: [], rng, nextEventDay: day + 75, eventUnit: 0, lastFired: {} };
}

export function createInitialState(labName: string, seed: number, difficulty: Difficulty = 'normal'): GameState {
  const hype = Object.fromEntries(HYPE_OWNERS.map((o) => [o, 0])) as Record<HypeOwner, number>;
  const benchmarks = Object.fromEntries(
    BENCHMARK_IDS.map((id) => [id, { introduced: false, saturated: false }]),
  ) as Record<BenchmarkId, { introduced: boolean; saturated: boolean }>;
  return {
    version: 1,
    seed,
    rng: seed >>> 0,
    day: 0,
    labName: labName.trim() || 'Моя лаборатория',
    founderName: '',
    outcome: null,
    cash: START_CASH,
    reputation: START_REPUTATION,
    founderShare: 1,
    lastRoundDay: null,
    monthsFirst: 0,
    hype,
    compute: { rented: { p100: 0, v100: 0, a100: 0, h100: 0, h200: 0 }, alloc: { ...DEFAULT_ALLOC } },
    datacenters: { unlockedDay: null, list: [] },
    research: { current: null, points: emptyTechPoints(), done: [], algoLevel: 0, contextLevel: 0, queue: [] },
    trainings: [],
    nextRunNum: 1,
    bestFlop: 0,
    nextModelNum: 1,
    models: [],
    rivalsReleased: [],
    benchmarks,
    tenders: [],
    contracts: [],
    nextTenderNum: 1,
    autoApply: false,
    mail: [],
    nextMailNum: 1,
    firedEvents: [],
    modifiers: [],
    flags: {},
    finance: { month: emptyLedger(), history: [], revenueDaily: [], negativeDays: 0 },
    tutorial: { step: 0, active: false },
    difficulty,
    rivalry: emptyRivalry(),
    yearly: emptyYearly(seed),
    market: emptyMarket(),
  };
}
