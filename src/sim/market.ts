// Рынок API: спрос, доли по логиту, обслуживание, выручка (FR-8). TSK-006.

import { LABS } from '../data/labs';
import { pool } from './compute';
import {
  ARENA_OPEN_DATE,
  CONTEXT_MARKET_K,
  CONTEXT_RATIO_MAX,
  CONTEXT_RATIO_MIN,
  CONTEXT_REF,
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
  context: number; // токенов
  quality: number; // Q = Elo + k_h × hype[owner]
  utility: number;
  share: number; // доля спроса в токенах, 0..1 (до ограничения мощностью)
  tokens: number; // спрос в токенах в день (до ограничения мощностью)
}

export interface MarketSnapshot {
  entries: MarketEntry[]; // по убыванию доли
  noneShare: number; // доля внешнего варианта (спрос, не ушедший никому)
  totalTokens: number; // T(t) с модификатором demand
}

/** Доли после ограничения мощностью: по моделям (ключи как в s.market.shares) и по лабораториям. */
export interface ServedShares {
  shares: Record<string, number>;
  labShares: Record<HypeOwner | 'none', number>;
}

// Отношение цены к опорной в логарифме зажато в [1/20; 20]: дешевле P_ref/20 доля уже не растёт, дороже 20·P_ref - не падает.
const PRICE_RATIO_MIN = 1 / 20;
const PRICE_RATIO_MAX = 20;
// Минимальная цена - сотая часть опорной.
const MIN_PRICE_SHARE = 1 / 100;

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
  context: number;
}

/** T(t): lerpByDate(DEMAND_TOKENS, log) × модификатор demand. */
export function demandTokens(s: GameState): number {
  return lerpByDate(DEMAND_TOKENS, s.day, true) * modValue(s, 'demand').mult;
}

/** Опорная цена $ за 1М токенов (интерполяция в логарифме). */
export function refPrice(day: number): number {
  return lerpByDate(REF_PRICE, day, true);
}

/** Минимальная цена $ за 1 млн токенов: опорная / 100, до тысячных (столько знаков показывает интерфейс). */
export function minPrice(day: number): number {
  return Math.round(refPrice(day) * MIN_PRICE_SHARE * 1000) / 1000;
}

/** Отношение цены к опорной в пределах [1/20; 20]; битая цена (NaN, ноль, минус) считается нижней границей. */
function priceRatio(price: number, pRef: number): number {
  const ratio = price / pRef;
  if (ratio > PRICE_RATIO_MAX) return PRICE_RATIO_MAX;
  return ratio >= PRICE_RATIO_MIN ? ratio : PRICE_RATIO_MIN;
}

/** Обычный контекст на рынке в этот день (интерполяция в логарифме). */
export function refContext(day: number): number {
  return lerpByDate(CONTEXT_REF, day, true);
}

/** Прибавка к полезности за контекст: CONTEXT_MARKET_K × ln(контекст / обычный), отношение в пределах [1/64; 8]. */
export function contextUtility(context: number, day: number): number {
  const ratio = context > 0 ? context / refContext(day) : CONTEXT_RATIO_MIN;
  return CONTEXT_MARKET_K * Math.log(Math.min(CONTEXT_RATIO_MAX, Math.max(CONTEXT_RATIO_MIN, ratio)));
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

/** Множитель шумихи в качестве: HYPE_K_BEFORE_ARENA (1,5) до открытия «Арены», HYPE_K_AFTER_ARENA (1) после. */
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
      context: m.plan.context,
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
      context: def.context,
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
    const u =
      (quals[i] - 1000) / 100 + brand - PRICE_ELASTICITY * Math.log(priceRatio(r.price, pRef)) + contextUtility(r.context, s.day);
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
      context: r.context,
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
 * Доли после ограничения мощностью: модели игрока получают share × served, а потерянный спрос уходит
 * соперникам и внешнему варианту пропорционально их весам (сумма по-прежнему 1).
 */
export function servedShares(snap: MarketSnapshot, served: number): ServedShares {
  const k = Number.isFinite(served) ? Math.min(1, Math.max(0, served)) : 1;
  let playerShare = 0;
  let otherShare = snap.noneShare;
  for (const e of snap.entries) {
    if (e.ref.kind === 'player') playerShare += e.share;
    else otherShare += e.share;
  }
  const lost = playerShare * (1 - k);
  // Ни соперников, ни внешнего варианта (их веса ушли в ноль): потерянное остаётся внешнему варианту.
  const gain = otherShare > 0 ? 1 + lost / otherShare : 1;
  const none = otherShare > 0 ? snap.noneShare * gain : snap.noneShare + lost;
  const shares: Record<string, number> = { none };
  const labShares = { none } as Record<HypeOwner | 'none', number>;
  for (const o of HYPE_OWNERS) labShares[o] = 0;
  for (const e of snap.entries) {
    const share = e.ref.kind === 'player' ? e.share * k : e.share * gain;
    shares[e.key] = share;
    labShares[e.owner] += share;
  }
  return { shares, labShares };
}

/**
 * Ежедневно: снимок, ограничение мощностью pool(inference), выручка earn('api'),
 * падение шумихи при нехватке, запись s.market (shares, labShares, playerTokens, lostFraction, totalTokens).
 * Доли в s.market - после ограничения мощностью: необслуженный спрос игрока достаётся соперникам.
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
    const earned = (tokens * price) / 1e6;
    revenue += earned;
    const model = s.models.find((m) => m.id === e.ref.id);
    if (model) model.earned += earned;
  }
  earn(s, 'api', revenue);

  if (need > 0) s.hype.player = Math.max(0, s.hype.player - HYPE_LOST_DEMAND_K * lostFraction);

  const { shares, labShares } = servedShares(snap, served);
  s.market = { shares, labShares, playerTokens, lostFraction, totalTokens: snap.totalTokens };
}
