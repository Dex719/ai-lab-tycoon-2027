// Рынок API: спрос, доли по логиту, обслуживание, выручка (FR-8). TSK-006.

import { LABS } from '../data/labs';
import { pool } from './compute';
import {
  ARENA_OPEN_DATE,
  DEMAND_TOKENS,
  HYPE_K_AFTER_ARENA,
  HYPE_K_BEFORE_ARENA,
  HYPE_LOST_DEMAND_K,
  HYPE_OWNERS,
  INF_FLOP_PER_H100E_DAY,
  PLAYER_BRAND_K,
  PRICE_ELASTICITY,
  REF_PRICE,
  REF_QUALITY,
} from './constants';
import { modValue } from './events';
import { earn } from './finance';
import { marketRivals, rivalPrice } from './rivals';
import { dateToDay, lerpByDate } from './time';
import type { GameState, HypeOwner, ModelRef } from './types';

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

// Цена ниже этого порога в логарифме не учитывается (защита от ln(0)).
const PRICE_FLOOR = 0.01;

// День открытия «Арены»: с него шумиха весит меньше.
const ARENA_OPEN_DAY = dateToDay(ARENA_OPEN_DATE);

// Модель на рынке до расчёта долей.
interface Candidate {
  key: string;
  ref: ModelRef;
  owner: HypeOwner;
  name: string;
  price: number;
  elo: number;
}

/** T(t): lerpByDate(DEMAND_TOKENS, log) × модификатор demand. */
export function demandTokens(s: GameState): number {
  return lerpByDate(DEMAND_TOKENS, s.day, true) * modValue(s, 'demand').mult;
}

/** Опорная цена $ за 1М токенов (интерполяция в логарифме). */
export function refPrice(day: number): number {
  return lerpByDate(REF_PRICE, day, true);
}

/** Опорное качество внешнего варианта (линейная интерполяция). */
export function refQuality(day: number): number {
  return lerpByDate(REF_QUALITY, day, false);
}

/** Бренд: игрок - (rep − 50)/50 × PLAYER_BRAND_K; лаборатория - brand + модификатор labBrand(target = lab).add. */
export function labBrand(s: GameState, owner: HypeOwner): number {
  if (owner === 'player') {
    // Репутация 0..100; если другой модуль выйдет за границы, бренд всё равно остаётся в рамках ±PLAYER_BRAND_K.
    const rep = Math.min(100, Math.max(0, s.reputation));
    return ((rep - 50) / 50) * PLAYER_BRAND_K;
  }
  const base = LABS.find((l) => l.id === owner)?.brand ?? 0;
  return base + modValue(s, 'labBrand', owner).add;
}

/** Множитель шумихи в качестве: 3 до открытия «Арены», 1,5 после. */
export function hypeK(day: number): number {
  return day >= ARENA_OPEN_DAY ? HYPE_K_AFTER_ARENA : HYPE_K_BEFORE_ARENA;
}

/** Q = elo + k_h × hype[owner]; k_h зависит от даты открытия «Арены». */
export function perceivedQuality(s: GameState, owner: HypeOwner, elo: number): number {
  return elo + hypeK(s.day) * (s.hype[owner] ?? 0);
}

/** Чистый расчёт долей (без изменения состояния). */
export function marketSnapshot(s: GameState): MarketSnapshot {
  const total = demandTokens(s);
  const pRef = refPrice(s.day);
  const u0 = (refQuality(s.day) - 1000) / 100;

  // Кандидаты на рынке: выпущенные модели игрока на API и модели соперников.
  const raw: Candidate[] = [];
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onApi) continue;
    raw.push({
      key: `player:${m.id}`,
      ref: { kind: 'player', id: m.id },
      owner: 'player',
      name: m.name,
      price: m.price,
      elo: m.arenaElo,
    });
  }
  for (const def of marketRivals(s)) {
    raw.push({
      key: `rival:${def.id}`,
      ref: { kind: 'rival', id: def.id },
      owner: def.lab,
      name: def.gameName,
      price: rivalPrice(def, s.day),
      elo: def.arenaElo,
    });
  }

  // Полезность каждой модели.
  const brands = new Map<HypeOwner, number>();
  const quals: number[] = raw.map((r) => perceivedQuality(s, r.owner, r.elo));
  const utils: number[] = raw.map((r, i) => {
    let brand = brands.get(r.owner);
    if (brand === undefined) {
      brand = labBrand(s, r.owner);
      brands.set(r.owner, brand);
    }
    const price = r.price > PRICE_FLOOR ? r.price : PRICE_FLOOR;
    const u = (quals[i] - 1000) / 100 + brand - PRICE_ELASTICITY * Math.log(price / pRef);
    // Нечисловая полезность (например, из-за битого Эло) даёт почти нулевую долю, а не портит весь расчёт.
    return Number.isFinite(u) ? u : -1e9;
  });

  // Устойчивый softmax: вычитаем максимум.
  const maxU = Math.max(u0, ...utils);
  const w0 = Math.exp(u0 - maxU);
  const ws = utils.map((u) => Math.exp(u - maxU));
  const sum = ws.reduce((a, b) => a + b, w0);

  const entries: MarketEntry[] = raw.map((r, i) => {
    const share = ws[i] / sum;
    return {
      key: r.key,
      ref: r.ref,
      owner: r.owner,
      name: r.name,
      price: r.price,
      elo: r.elo,
      quality: quals[i],
      utility: utils[i],
      share,
      tokens: share * total,
    };
  });
  entries.sort((a, b) => b.share - a.share);
  return { entries, noneShare: w0 / sum, totalTokens: total };
}

/** H100e, нужные для обслуживания спроса на модели игрока. */
export function inferenceNeed(s: GameState, snap: MarketSnapshot): number {
  let flop = 0;
  for (const e of snap.entries) {
    if (e.ref.kind !== 'player') continue;
    const id = e.ref.id;
    const m = s.models.find((x) => x.id === id);
    if (!m) continue;
    flop += e.tokens * 2 * m.plan.paramsB * 1e9;
  }
  return flop / INF_FLOP_PER_H100E_DAY;
}

/**
 * Ежедневно: снимок, ограничение мощностью pool(inference), выручка earn('api'),
 * падение шумихи при нехватке, запись s.market (shares, labShares, playerTokens, lostFraction, totalTokens).
 */
export function dayStep(s: GameState): void {
  const snap = marketSnapshot(s);
  const need = inferenceNeed(s, snap);
  // Какую часть спроса игрока удалось обслужить.
  const served = need > 0 ? Math.min(1, pool(s, 'inference') / need) : 1;
  const lostFraction = need > 0 ? 1 - served : 0;

  let revenue = 0;
  let playerTokens = 0;
  for (const e of snap.entries) {
    if (e.ref.kind !== 'player') continue;
    const tokens = e.tokens * served;
    playerTokens += tokens;
    // Битая цена (NaN, минус) не должна съедать выручку других моделей.
    const price = Number.isFinite(e.price) && e.price > 0 ? e.price : 0;
    revenue += (tokens * price) / 1e6;
  }
  earn(s, 'api', revenue);

  if (need > 0) s.hype.player = Math.max(0, s.hype.player - HYPE_LOST_DEMAND_K * lostFraction);

  const shares: Record<string, number> = { none: snap.noneShare };
  const labShares = { none: snap.noneShare } as Record<HypeOwner | 'none', number>;
  for (const o of HYPE_OWNERS) labShares[o] = 0;
  for (const e of snap.entries) {
    shares[e.key] = e.share;
    labShares[e.owner] += e.share;
  }
  s.market = { shares, labShares, playerTokens, lostFraction, totalTokens: snap.totalTokens };
}
