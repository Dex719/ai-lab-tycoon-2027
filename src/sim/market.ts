// Рынок (FR-8, design market-v2, раздел 2): три сегмента спроса - обычные пользователи (подписка на чат),
// корпоративные клиенты и разработчики (API). Доли по логиту внутри сегмента, обслуживание по каналам
// (доли «API» и «Подписки»), выручка earn('api') и earn('subs'). Общие доли - взвешенная по потенциальной
// выручке сумма сегментов (сумма 1), чтобы соперники, инвесторы и история месяцев работали без правок.

import { LABS } from '../data/labs';
import { pool } from './compute';
import {
  ARENA_OPEN_DATE,
  CAP_LEVEL,
  CHAT_MOMENT_DATE,
  CODE_DIFF_CAP,
  CODE_UTILITY_SCALE,
  CONTEXT_MARKET_K,
  CONTEXT_RATIO_MAX,
  CONTEXT_RATIO_MIN,
  CONTEXT_REF,
  DEMAND_TOKENS,
  DEV_SHARE_OF_API,
  HYPE_K_AFTER_ARENA,
  HYPE_K_BEFORE_ARENA,
  HYPE_LOST_DEMAND_K,
  HYPE_OWNERS,
  INF_FLOP_PER_H100E_DAY,
  MOE_SERVING_MULT,
  MULTIMODAL_CONSUMER_UTILITY,
  PLAYER_BRAND_K,
  QUANT_SERVING_COST,
  REF_PRICE,
  REF_QUALITY,
  SEGMENT_DEF,
  SUBS_PRICE_RATIO_MAX,
  SUBS_PRICE_RATIO_MIN,
  SUBS_REF_PRICE,
  SUBS_USERS,
  TOKENS_PER_USER_DAY,
} from './constants';
import { addMail, modValue } from './events';
import { staffEffect } from './staffEffects';
import { earn } from './finance';
import { codeLevel } from './leaderboard';

// Уровень по коду живёт в leaderboard.ts (его читает и training.reviewRequired); отсюда он доступен как часть рынка.
export { codeLevel };
import { marketRivals, rivalSubsPrice, rivalTier } from './rivals';
import { rivalContextIn, rivalEloIn, rivalPriceIn } from './rivalry';
import { byYear, dateToDay, lerpByDate, yearOf } from './time';
import { SEGMENT_IDS } from './types';
import type { Channel, GameState, HypeOwner, ModelRef, SegmentId, SegmentShares, TechId, Tier } from './types';

export interface MarketEntry {
  key: string; // 'player:<id>' | 'rival:<id>'
  ref: ModelRef;
  owner: HypeOwner;
  name: string;
  price: number; // канал api - $ за 1 млн токенов; канал subs - $ в месяц за пользователя
  elo: number;
  context: number; // токенов
  tier: Tier;
  codeLevel: number | null; // уровень по коду (leaderboard.codeLevel); null - бенчмарков кода ещё нет
  quality: number; // Q = Elo + hypeMult × k_h × hype[owner]
  utility: number;
  share: number; // доля спроса сегмента, 0..1 (до ограничения мощностью)
  demand: number; // спрос в единицах сегмента: токены в день (api) или пользователи (subs), до ограничения мощностью
  tokens: number; // токены в день (у подписки demand × TOKENS_PER_USER_DAY)
}

export interface SegmentSnapshot {
  id: SegmentId;
  channel: Channel;
  entries: MarketEntry[]; // по убыванию доли
  noneShare: number; // доля внешнего варианта (спрос, не ушедший никому)
  total: number; // спрос сегмента: токены в день или пользователи
  weight: number; // доля сегмента в потенциальной выручке рынка (сумма по сегментам 1)
}

export interface MarketSnapshot {
  segments: Record<SegmentId, SegmentSnapshot>;
  totalTokens: number; // T(t) с модификатором demand
  totalSubs: number; // платёжеспособных пользователей чата (0 до чат-момента)
}

/** Доли после ограничения мощностью: по моделям (ключи как в s.market.shares) и по лабораториям. */
export interface ServedShares {
  shares: Record<string, number>;
  labShares: Record<HypeOwner | 'none', number>;
}

/** Продажи модели игрока за вчерашний день по записи s.market (после ограничения мощностью). */
export interface PlayerSales {
  apiTokens: number;
  subsUsers: number;
  apiRevenueDay: number;
  subsRevenueDay: number;
}

// Отношение цены к опорной в логарифме зажато в [1/20; 20]: дешевле P_ref/20 доля уже не растёт, дороже 20·P_ref - не падает.
const PRICE_RATIO_MIN = 1 / 20;
const PRICE_RATIO_MAX = 20;
// Минимальная цена - сотая часть опорной.
const MIN_PRICE_SHARE = 1 / 100;

// День открытия «Арены»: с него шумиха весит меньше.
const ARENA_OPEN_DAY = dateToDay(ARENA_OPEN_DATE);
// Чат-момент: с него открыт канал подписок.
/** День открытия канала подписок (чат-момент). */
export const CHAT_MOMENT_DAY = dateToDay(CHAT_MOMENT_DATE);

// Модель на рынке до расчёта долей (одна запись на модель, участвует в сегментах своего канала).
interface Candidate {
  key: string;
  ref: ModelRef;
  owner: HypeOwner;
  name: string;
  apiPrice: number; // $ за 1 млн токенов
  subsPrice: number; // $ в месяц
  elo: number;
  context: number;
  tier: Tier;
  exposed: boolean;
  codeLevel: number | null;
  multimodal: boolean; // модель игрока обучена с «Мультимодальностью»
  onApi: boolean;
  onSubs: boolean;
}

// ---------- Кривые ----------

/** T(t): lerpByDate(DEMAND_TOKENS, log) × модификатор demand. */
export function demandTokens(s: GameState): number {
  return lerpByDate(DEMAND_TOKENS, s.day, true) * modValue(s, 'demand').mult;
}

/** Доля разработчиков в спросе API (линейно по DEV_SHARE_OF_API); остальное - корпоративные клиенты. */
export function devShareOfApi(day: number): number {
  return lerpByDate(DEV_SHARE_OF_API, day, false);
}

/** Платёжеспособных пользователей чата: lerpByDate(SUBS_USERS, log) × модификатор subsDemand. */
export function subsUsers(s: GameState): number {
  return lerpByDate(SUBS_USERS, s.day, true) * modValue(s, 'subsDemand').mult;
}

/** Канал подписок открыт с чат-момента (ChatGTP, 30.11.2022). */
export function subsOpen(day: number): boolean {
  return day >= CHAT_MOMENT_DAY;
}

/**
 * Спрос сегмента: разработчики - f × T, корпоративные - (1 − f) × T (токены в день), обычные - пользователи чата.
 * До чат-момента обычных пользователей нет (0): чат-продуктов ещё не существует, и вес сегмента в общих долях равен нулю.
 */
export function segmentDemand(s: GameState, seg: SegmentId): number {
  if (seg === 'consumers') return subsOpen(s.day) ? subsUsers(s) : 0;
  const t = demandTokens(s);
  const f = devShareOfApi(s.day);
  return seg === 'developers' ? f * t : (1 - f) * t;
}

/** Опорная цена $ за 1М токенов (интерполяция в логарифме). */
export function refPrice(day: number): number {
  return lerpByDate(REF_PRICE, day, true);
}

/** Минимальная цена $ за 1 млн токенов: опорная / 100, до тысячных (столько знаков показывает интерфейс). */
export function minPrice(day: number): number {
  return Math.round(refPrice(day) * MIN_PRICE_SHARE * 1000) / 1000;
}

/** Отношение цены к опорной в пределах [lo; hi]; битая цена (NaN, ноль, минус) считается нижней границей. */
function clampRatio(price: number, ref: number, lo: number, hi: number): number {
  const ratio = price / ref;
  if (ratio > hi) return hi;
  return ratio >= lo ? ratio : lo;
}

/** Обычный контекст на рынке в этот день (интерполяция в логарифме). */
export function refContext(day: number): number {
  return lerpByDate(CONTEXT_REF, day, true);
}

/** ln(контекст / обычный контекст), отношение в пределах [1/64; 8]; нулевой контекст - нижняя граница. */
export function contextLogRatio(context: number, day: number): number {
  const ratio = context > 0 ? context / refContext(day) : CONTEXT_RATIO_MIN;
  return Math.log(Math.min(CONTEXT_RATIO_MAX, Math.max(CONTEXT_RATIO_MIN, ratio)));
}

/** Прибавка к полезности за контекст по прежней формуле: CONTEXT_MARKET_K × ln(контекст / обычный). */
export function contextUtility(context: number, day: number): number {
  return CONTEXT_MARKET_K * contextLogRatio(context, day);
}

/** Обслуживание: токенов в день на один H100e для модели размера paramsB (2 FLOP на параметр и токен). */
export function servingTokensPerH100eDay(paramsB: number): number {
  return INF_FLOP_PER_H100E_DAY / (2 * paramsB * 1e9);
}

/**
 * Множитель токенов на один H100e для модели игрока: × MOE_SERVING_MULT, если модель обучена со «Смесью экспертов»,
 * и ÷ QUANT_SERVING_COST после «Квантизации» (действует сразу на все модели).
 */
export function servingMult(s: GameState, m: { techs?: readonly TechId[] }): number {
  const moe = m.techs?.includes('moe') ? MOE_SERVING_MULT : 1;
  return s.research.done.includes('quant') ? moe / QUANT_SERVING_COST : moe;
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

/** Бренд в сегменте: общий бренд плюс модификатор segBrand с target `${owner}:${seg}` (ход «бесплатный чат»). */
export function segBrand(s: GameState, owner: HypeOwner, seg: SegmentId): number {
  return labBrand(s, owner) + modValue(s, 'segBrand', `${owner}:${seg}`).add;
}

/** Множитель шумихи в качестве: HYPE_K_BEFORE_ARENA до открытия «Арены», HYPE_K_AFTER_ARENA после. */
export function hypeK(day: number): number {
  return day >= ARENA_OPEN_DAY ? HYPE_K_AFTER_ARENA : HYPE_K_BEFORE_ARENA;
}

/** Q = elo + hypeMult × k_h × hype[owner]; k_h зависит от даты открытия «Арены», hypeMult - множитель сегмента. */
export function perceivedQuality(s: GameState, owner: HypeOwner, elo: number, hypeMult = 1): number {
  return elo + hypeMult * hypeK(s.day) * (s.hype[owner] ?? 0);
}

// ---------- Снимок ----------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Все модели, которые могут быть на рынке сегодня: модели игрока в продаже и соперники обоих каналов (по одной записи). */
function candidates(s: GameState): Candidate[] {
  const out: Candidate[] = [];
  const open = subsOpen(s.day);
  for (const m of s.models) {
    if (m.releasedDay === null) continue;
    const onSubs = open && m.onSubs;
    if (!m.onApi && !onSubs) continue;
    out.push({
      key: `player:${m.id}`,
      ref: { kind: 'player', id: m.id },
      owner: 'player',
      name: m.name,
      apiPrice: m.price,
      subsPrice: m.subsPrice,
      elo: m.arenaElo,
      context: m.plan.context,
      tier: m.plan.tier,
      exposed: m.exposed,
      codeLevel: codeLevel(s, { kind: 'player', id: m.id }),
      multimodal: m.techs?.includes('multimodal') ?? false,
      onApi: m.onApi,
      onSubs,
    });
  }
  // Соперники: цена, Эло и контекст - с поправками ходов (rivalPriceIn / rivalEloIn / rivalContextIn).
  const byId = new Map<string, Candidate>();
  for (const channel of ['api', 'subs'] as const) {
    if (channel === 'subs' && !open) continue;
    for (const def of marketRivals(s, channel)) {
      let c = byId.get(def.id);
      if (!c) {
        c = {
          key: `rival:${def.id}`,
          ref: { kind: 'rival', id: def.id },
          owner: def.lab,
          name: def.gameName,
          apiPrice: rivalPriceIn(s, def),
          subsPrice: rivalSubsPrice(def),
          elo: rivalEloIn(s, def),
          context: rivalContextIn(s, def),
          tier: rivalTier(def),
          exposed: false,
          codeLevel: codeLevel(s, { kind: 'rival', id: def.id }),
          multimodal: false,
          onApi: false,
          onSubs: false,
        };
        byId.set(def.id, c);
        out.push(c);
      }
      if (channel === 'api') c.onApi = true;
      else c.onSubs = true;
    }
  }
  return out;
}

/** Доли сегмента по логиту (design 2.3); total - спрос сегмента; weight заполняется позже. */
function segmentSnapshot(s: GameState, seg: SegmentId, cands: Candidate[], total: number): SegmentSnapshot {
  const def = SEGMENT_DEF[seg];
  const channel = def.channel;
  const list = cands.filter((c) => (channel === 'api' ? c.onApi : c.onSubs));
  const pRef = refPrice(s.day);
  const capYear = byYear(CAP_LEVEL, yearOf(s.day));
  const u0 = (refQuality(s.day) - 1000) / 100 + def.u0Offset;

  const brands = new Map<HypeOwner, number>();
  const quals = list.map((c) => perceivedQuality(s, c.owner, c.elo, def.hypeMult));
  const utils = list.map((c, i) => {
    let brand = brands.get(c.owner);
    if (brand === undefined) {
      brand = segBrand(s, c.owner, seg);
      brands.set(c.owner, brand);
    }
    const priceTerm =
      channel === 'api'
        ? Math.log(clampRatio(c.apiPrice, pRef, PRICE_RATIO_MIN, PRICE_RATIO_MAX))
        : Math.log(clampRatio(c.subsPrice, SUBS_REF_PRICE, SUBS_PRICE_RATIO_MIN, SUBS_PRICE_RATIO_MAX));
    const codeTerm = c.codeLevel === null ? 0 : clamp(c.codeLevel - capYear, -CODE_DIFF_CAP, CODE_DIFF_CAP) / CODE_UTILITY_SCALE;
    const u =
      (def.wQ * (quals[i] - 1000)) / 100 +
      def.wBrand * brand -
      def.wPrice * priceTerm +
      def.wCtx * contextLogRatio(c.context, s.day) +
      def.wCode * codeTerm +
      (def.tier[c.tier] ?? 0) +
      (seg === 'consumers' && c.multimodal ? MULTIMODAL_CONSUMER_UTILITY : 0) -
      (c.exposed ? def.exposedPenalty : 0);
    // Нечисловая полезность (например, из-за битого Эло) даёт почти нулевую долю, а не портит весь расчёт.
    return Number.isFinite(u) ? u : -1e9;
  });

  // Устойчивый softmax: вычитаем максимум.
  const maxU = Math.max(u0, ...utils);
  const w0 = Math.exp(u0 - maxU);
  const ws = utils.map((u) => Math.exp(u - maxU));
  const sum = ws.reduce((a, b) => a + b, w0);
  const perUnit = channel === 'subs' ? TOKENS_PER_USER_DAY : 1;

  const entries: MarketEntry[] = list.map((c, i) => {
    const share = ws[i] / sum;
    const demand = share * total;
    return {
      key: c.key,
      ref: c.ref,
      owner: c.owner,
      name: c.name,
      price: channel === 'api' ? c.apiPrice : c.subsPrice,
      elo: c.elo,
      context: c.context,
      tier: c.tier,
      codeLevel: c.codeLevel,
      quality: quals[i],
      utility: utils[i],
      share,
      demand,
      tokens: demand * perUnit,
    };
  });
  entries.sort((a, b) => b.share - a.share);
  return { id: seg, channel, entries, noneShare: w0 / sum, total, weight: 0 };
}

/** Потенциальная выручка сегмента в день по опорной цене (вес сегмента в общих долях). */
function segmentRevenue(seg: SegmentSnapshot, pRef: number): number {
  return seg.channel === 'api' ? (seg.total * pRef) / 1e6 : (seg.total * SUBS_REF_PRICE) / 30;
}

/** Чистый расчёт долей по трём сегментам (без изменения состояния). */
export function marketSnapshot(s: GameState): MarketSnapshot {
  const cands = candidates(s);
  const segments = {} as Record<SegmentId, SegmentSnapshot>;
  for (const seg of SEGMENT_IDS) segments[seg] = segmentSnapshot(s, seg, cands, segmentDemand(s, seg));
  const pRef = refPrice(s.day);
  const revenues = SEGMENT_IDS.map((seg) => segmentRevenue(segments[seg], pRef));
  const sum = revenues.reduce((a, b) => a + b, 0);
  SEGMENT_IDS.forEach((seg, i) => {
    segments[seg].weight = sum > 0 ? revenues[i] / sum : 1 / SEGMENT_IDS.length;
  });
  return { segments, totalTokens: demandTokens(s), totalSubs: segmentDemand(s, 'consumers') };
}

/** H100e, нужные для обслуживания спроса на модели игрока: по каналам (api - корпоративные и разработчики, subs - чат). */
export function inferenceNeed(s: GameState, snap: MarketSnapshot): { api: number; subs: number } {
  const need = { api: 0, subs: 0 };
  for (const seg of SEGMENT_IDS) {
    const segSnap = snap.segments[seg];
    for (const e of segSnap.entries) {
      if (e.ref.kind !== 'player') continue;
      const id = e.ref.id;
      const m = s.models.find((x) => x.id === id);
      if (!m || !(m.plan.paramsB > 0)) continue;
      need[segSnap.channel] += e.tokens / (servingTokensPerH100eDay(m.plan.paramsB) * servingMult(s, m));
    }
  }
  return need;
}

/**
 * Доли сегмента после ограничения мощностью: модели игрока получают share × served, а потерянный спрос уходит
 * соперникам и внешнему варианту пропорционально их весам (сумма по-прежнему 1).
 */
export function servedShares(seg: SegmentSnapshot, served: number): ServedShares {
  const k = Number.isFinite(served) ? Math.min(1, Math.max(0, served)) : 1;
  let playerShare = 0;
  let otherShare = seg.noneShare;
  for (const e of seg.entries) {
    if (e.ref.kind === 'player') playerShare += e.share;
    else otherShare += e.share;
  }
  const lost = playerShare * (1 - k);
  // Ни соперников, ни внешнего варианта (их веса ушли в ноль): потерянное остаётся внешнему варианту.
  const gain = otherShare > 0 ? 1 + lost / otherShare : 1;
  const none = otherShare > 0 ? seg.noneShare * gain : seg.noneShare + lost;
  const shares: Record<string, number> = { none };
  const labShares = { none } as Record<HypeOwner | 'none', number>;
  for (const o of HYPE_OWNERS) labShares[o] = 0;
  for (const e of seg.entries) {
    const share = e.ref.kind === 'player' ? e.share * k : e.share * gain;
    shares[e.key] = share;
    labShares[e.owner] += share;
  }
  return { shares, labShares };
}

/** Общие доли: взвешенная по весам сегментов сумма долей (модели нет в сегменте - 0); сумма по-прежнему 1. */
export function combineShares(snap: MarketSnapshot, served: Record<SegmentId, ServedShares>): ServedShares {
  const shares: Record<string, number> = {};
  const labShares = {} as Record<HypeOwner | 'none', number>;
  for (const o of [...HYPE_OWNERS, 'none'] as const) labShares[o] = 0;
  for (const seg of SEGMENT_IDS) {
    const w = snap.segments[seg].weight;
    for (const [key, v] of Object.entries(served[seg].shares)) shares[key] = (shares[key] ?? 0) + w * v;
    for (const o of [...HYPE_OWNERS, 'none'] as const) labShares[o] += w * (served[seg].labShares[o] ?? 0);
  }
  return { shares, labShares };
}

/** Продажи модели игрока за вчера по s.market (доли по сегментам уже после ограничения мощностью). */
export function playerSales(s: GameState, modelId: string): PlayerSales {
  const m = s.models.find((x) => x.id === modelId);
  const out: PlayerSales = { apiTokens: 0, subsUsers: 0, apiRevenueDay: 0, subsRevenueDay: 0 };
  if (!m) return out;
  const key = `player:${modelId}`;
  for (const seg of SEGMENT_IDS) {
    const st = s.market.segments[seg];
    if (!st) continue;
    const units = (st.shares[key] ?? 0) * st.total;
    if (SEGMENT_DEF[seg].channel === 'api') out.apiTokens += units;
    else out.subsUsers += units;
  }
  const price = Number.isFinite(m.price) && m.price > 0 ? m.price : 0;
  const subsPrice = Number.isFinite(m.subsPrice) && m.subsPrice > 0 ? m.subsPrice : 0;
  out.apiRevenueDay = (out.apiTokens * price) / 1e6;
  out.subsRevenueDay = (out.subsUsers * subsPrice) / 30;
  return out;
}

/**
 * Ежедневно: снимок по сегментам, ограничение мощностью по каналам (pool api / pool subs), выручка earn('api') и
 * earn('subs'), падение шумихи при нехватке (взвешенно по потенциальной выручке), запись s.market целиком.
 * Доли в s.market - после ограничения мощностью: необслуженный спрос игрока достаётся соперникам.
 */
export function dayStep(s: GameState): void {
  const snap = marketSnapshot(s);
  const need = inferenceNeed(s, snap);
  // Какую часть спроса игрока удалось обслужить по каждому каналу.
  const servedApi = need.api > 0 ? Math.min(1, pool(s, 'api') / need.api) : 1;
  const servedSubs = need.subs > 0 ? Math.min(1, pool(s, 'subs') / need.subs) : 1;
  const lostApi = need.api > 0 ? 1 - servedApi : 0;
  const lostSubs = need.subs > 0 ? 1 - servedSubs : 0;

  // Продажи в команде: выручка с тех же клиентов выше (лучше условия, меньше ушедших).
  const salesMult = 1 + staffEffect(s, 'sales');
  let revenueApi = 0;
  let revenueSubs = 0;
  let playerTokens = 0;
  let playerSubs = 0;
  let potentialApi = 0; // потенциальная выручка игрока в день, если обслужить всё
  let potentialSubs = 0;
  const served = {} as Record<SegmentId, ServedShares>;
  const segments = {} as Record<SegmentId, SegmentShares>;
  for (const seg of SEGMENT_IDS) {
    const segSnap = snap.segments[seg];
    const k = segSnap.channel === 'api' ? servedApi : servedSubs;
    for (const e of segSnap.entries) {
      if (e.ref.kind !== 'player') continue;
      const model = s.models.find((m) => m.id === e.ref.id);
      if (!model) continue;
      if (segSnap.channel === 'api') {
        const tokens = e.tokens * k;
        playerTokens += tokens;
        // Битая цена (NaN, минус) не должна съедать выручку других моделей.
        const price = Number.isFinite(model.price) && model.price > 0 ? model.price : 0;
        const earned = ((tokens * price) / 1e6) * salesMult;
        potentialApi += ((e.tokens * price) / 1e6) * salesMult;
        revenueApi += earned;
        model.earned += earned;
      } else {
        const users = e.demand * k;
        playerSubs += users;
        const price = Number.isFinite(model.subsPrice) && model.subsPrice > 0 ? model.subsPrice : 0;
        const earned = ((users * price) / 30) * salesMult;
        potentialSubs += ((e.demand * price) / 30) * salesMult;
        revenueSubs += earned;
        model.earned += earned;
        model.earnedSubs += earned;
      }
    }
    served[seg] = servedShares(segSnap, k);
    segments[seg] = { ...served[seg], total: segSnap.total };
  }
  earn(s, 'api', revenueApi);
  earn(s, 'subs', revenueSubs);

  const potential = potentialApi + potentialSubs;
  const lostFraction = potential > 0 ? (potentialApi * lostApi + potentialSubs * lostSubs) / potential : 0;
  if (potential > 0) s.hype.player = Math.max(0, s.hype.player - HYPE_LOST_DEMAND_K * lostFraction);

  warnLostDemand(s, need, potentialApi + potentialSubs, lostFraction);

  const { shares, labShares } = combineShares(snap, served);
  s.market = {
    shares,
    labShares,
    playerTokens,
    lostFraction,
    totalTokens: snap.totalTokens,
    playerSubs,
    totalSubs: snap.totalSubs,
    lostApi,
    lostSubs,
    segments,
  };
}

/** Флаг: письмо «клиентам не хватает мощности» отправлено; снимается, когда потери падают ниже LOST_CLEAR. */
export const LOST_DEMAND_FLAG = 'lostDemandWarned';
const LOST_WARN = 0.3;
const LOST_CLEAR = 0.1;

/**
 * Важное письмо (с паузой), когда клиентам API и подписок не хватает мощности и теряется больше трети спроса:
 * плейтест 16.10 - доля рынка упала с 40,8 % до 2,1 % без единого предупреждения. Один раз, пока потери не спадут.
 */
function warnLostDemand(s: GameState, need: { api: number; subs: number }, potential: number, lost: number): void {
  if (lost < LOST_CLEAR) {
    delete s.flags[LOST_DEMAND_FLAG];
    return;
  }
  // Мелкие суммы не стоят паузы: меньше $1 тыс. в день потенциальной выручки.
  if (lost < LOST_WARN || s.flags[LOST_DEMAND_FLAG] || potential < 1_000) return;
  s.flags[LOST_DEMAND_FLAG] = true;
  const shortApi = Math.max(0, need.api - pool(s, 'api'));
  const shortSubs = Math.max(0, need.subs - pool(s, 'subs'));
  const h = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
  const parts = [shortApi > 0 ? `в доле «API» - ещё ${h(shortApi)} H100e` : '', shortSubs > 0 ? `в доле «Подписки» - ещё ${h(shortSubs)} H100e` : '']
    .filter(Boolean)
    .join(', ');
  addMail(s, {
    kind: 'finance',
    important: true,
    title: `Клиентам не хватает мощности: теряется ${Math.round(lost * 100)} % спроса`,
    body:
      `Запросы клиентов не успевают обработать, выручка и доля рынка уходят соперникам. Нужно ${parts}. ` +
      'В «Мощностях» сдвиньте границу доли или нажмите «Как нужно»; можно и арендовать ещё карт.',
  });
}
