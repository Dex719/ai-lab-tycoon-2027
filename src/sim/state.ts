// Создание начального состояния новой игры (FR-13). Используется actions.newGame и тестами.

import { DEFAULT_ALLOC, HYPE_OWNERS, START_CASH, START_REPUTATION } from './constants';
import type { BenchmarkId, GameState, HypeOwner, MonthLedger } from './types';
import { BENCHMARK_IDS } from './types';

export function emptyLedger(): MonthLedger {
  return {
    income: { api: 0, contracts: 0, investors: 0 },
    expense: { rent: 0, overhead: 0, labelers: 0, penalties: 0 },
  };
}

export function createInitialState(labName: string, seed: number): GameState {
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
    outcome: null,
    cash: START_CASH,
    reputation: START_REPUTATION,
    founderShare: 1,
    lastRoundDay: null,
    hype,
    compute: { rented: { p100: 0, v100: 0, a100: 0, h100: 0, h200: 0 }, alloc: { ...DEFAULT_ALLOC } },
    research: { current: null, points: { attention: 0, scaling: 0, rlhf: 0, algo: 0 }, done: [], algoLevel: 0 },
    training: null,
    bestFlop: 0,
    nextModelNum: 1,
    models: [],
    rivalsReleased: [],
    benchmarks,
    tenders: [],
    contracts: [],
    nextTenderNum: 1,
    mail: [],
    nextMailNum: 1,
    firedEvents: [],
    modifiers: [],
    flags: {},
    finance: { month: emptyLedger(), history: [], revenueDaily: [], negativeDays: 0 },
    market: { shares: {}, labShares: { ...hype, none: 1 }, playerTokens: 0, lostFraction: 0, totalTokens: 0 },
  };
}
