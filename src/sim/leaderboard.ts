// Таблица бенчмарков и Арена: строки, места, шумиха выпуска, насыщение (FR-5, FR-6). TSK-007.

import type { BenchmarkId, GameState, HypeOwner, ModelRef } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export interface BoardRow {
  ref: ModelRef;
  name: string;
  owner: HypeOwner; // лаборатория или 'player'
  releasedDay: number;
  /** Только вышедшие на сегодня бенчмарки. Игрок: показанный балл (modelScore honest=false). */
  scores: Partial<Record<BenchmarkId, { value: number; estimated: boolean }>>;
  elo: number;
  eloEstimated: boolean;
  flagged: boolean; // ⚠: разоблачённая модель игрока или соперник с contaminated
  exposed: boolean; // модель игрока разоблачена (баллы честные)
  onMarket: boolean;
}

/** Все выпущенные модели (соперники из rivalsReleased + модели игрока с releasedDay), новые сверху. */
export function leaderboard(_s: GameState): BoardRow[] { return TODO(); }
/** Место (1 = лучший) по показанному баллу среди выпущенных моделей; null — бенчмарк не вышел или модели нет. */
export function benchRank(_s: GameState, _ref: ModelRef, _bid: BenchmarkId): number | null { return TODO(); }
/** Место на Арене по Эло среди всех выпущенных моделей. */
export function arenaRank(_s: GameState, _ref: ModelRef): number | null { return TODO(); }
/** Место на Арене среди моделей, которые сейчас на рынке (для инвесторов). */
export function marketArenaRank(_s: GameState, _ref: ModelRef): number | null { return TODO(); }
/** Бонус шумихи при выпуске модели: по активным бенчмаркам места 1/2/3 → HYPE_RANK_BONUS, №1 Арены → +HYPE_ARENA_TOP_BONUS. */
export function releaseHypeBonus(_s: GameState, _ref: ModelRef): number { return TODO(); }
/** Лучший Эло среди выпущенных моделей владельца (или 0). */
export function bestElo(_s: GameState, _owner: HypeOwner): number { return TODO(); }
/** Проверить насыщение активных бенчмарков по лучшему показанному баллу; насыщенные — флаг и письмо kind 'benchmark'. */
export function updateSaturation(_s: GameState): void { TODO(); }
