// Формулы бенчмарков и их появление (FR-5). Реализуется в TSK-005.

import type { BenchmarkDef, BenchmarkId, GameState } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export function benchDef(_id: BenchmarkId): BenchmarkDef { return TODO(); }
/** score = 100 × (g + (1 − g) × σ((cap + overfit − Dif) / S)), в %. */
export function benchScore(_id: BenchmarkId, _cap: number, _overfit?: number): number { return TODO(); }
/** Обратная формула: способность по баллу; балл обрезается в (g, 100) с запасом, итог — в [Dif − 40, Dif + 40]. */
export function capFromScore(_id: BenchmarkId, _score: number): number { return TODO(); }
/** Вышедшие бенчмарки (introduced), по порядку данных. */
export function introducedBenchmarks(_s: GameState): BenchmarkId[] { return TODO(); }
/** Вышедшие и не насыщенные. */
export function activeBenchmarks(_s: GameState): BenchmarkId[] { return TODO(); }
/** Ежедневно: отметить introduced у бенчмарков, чья дата наступила (≤ сегодня), и отправить письмо (kind 'benchmark'). */
export function introduceDue(_s: GameState): void { TODO(); }
