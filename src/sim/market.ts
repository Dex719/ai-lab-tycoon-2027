// Рынок API: спрос, доли по логиту, обслуживание, выручка (FR-8). TSK-006.

import type { GameState, HypeOwner, ModelRef } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export interface MarketEntry {
  key: string; // 'player:<id>' | 'rival:<id>'
  ref: ModelRef;
  owner: HypeOwner;
  name: string;
  price: number; // $ за 1М токенов
  elo: number;
  quality: number; // Q = Elo + k_h × hype[owner]
  utility: number;
  share: number; // доля токенов, 0..1
  tokens: number; // спрос в токенах в день (до ограничения мощностью)
}

export interface MarketSnapshot {
  entries: MarketEntry[]; // по убыванию доли
  noneShare: number; // доля внешнего варианта (спрос, не ушедший никому)
  totalTokens: number; // T(t) с модификатором demand
}

/** T(t): lerpByDate(DEMAND_TOKENS, log) × модификатор demand. */
export function demandTokens(_s: GameState): number { return TODO(); }
export function refPrice(_day: number): number { return TODO(); }
export function refQuality(_day: number): number { return TODO(); }
/** Бренд: игрок — (rep − 50)/50 × PLAYER_BRAND_K; лаборатория — brand + модификатор labBrand(target = lab).add. */
export function labBrand(_s: GameState, _owner: HypeOwner): number { return TODO(); }
/** Q = elo + k_h × hype[owner]; k_h зависит от флага arenaOpen. */
export function perceivedQuality(_s: GameState, _owner: HypeOwner, _elo: number): number { return TODO(); }
/** Чистый расчёт долей (без изменения состояния). */
export function marketSnapshot(_s: GameState): MarketSnapshot { return TODO(); }
/** H100e, нужные для обслуживания спроса на модели игрока. */
export function inferenceNeed(_s: GameState, _snap: MarketSnapshot): number { return TODO(); }
/**
 * Ежедневно: снимок, ограничение мощностью pool(inference), выручка earn('api'),
 * падение шумихи при нехватке, запись s.market (shares, labShares, playerTokens, lostFraction, totalTokens).
 */
export function dayStep(_s: GameState): void { TODO(); }
