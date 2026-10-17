// Тесты рынка (FR-8, design market-v2 раздел 2): кривые спроса, доли по сегментам, обслуживание по каналам,
// выручка API и подписок, общие доли.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseModel, setModelPrice } from './actions';
import {
  CAP_LEVEL,
  HYPE_K_AFTER_ARENA,
  HYPE_K_BEFORE_ARENA,
  HYPE_OWNERS,
  MOE_SERVING_MULT,
  MULTIMODAL_CONSUMER_UTILITY,
  QUANT_SERVING_COST,
  SEGMENT_DEF,
  SUBS_REF_PRICE,
  TOKENS_PER_USER_DAY,
} from './constants';
import { addModifier, FOREVER } from './events';
import {
  combineShares,
  contextLogRatio,
  contextUtility,
  demandTokens,
  dayStep,
  devShareOfApi,
  hypeK,
  inferenceNeed,
  labBrand,
  marketSnapshot,
  minPrice,
  perceivedQuality,
  playerSales,
  refContext,
  refPrice,
  refQuality,
  segBrand,
  segmentDemand,
  servedShares,
  servingMult,
  SHARE_TAU_DAYS,
  stepHeld,
  servingTokensPerH100eDay,
  subsOpen,
  subsUsers,
} from './market';
import type { MarketSnapshot } from './market';
import { deserialize, serialize } from './save';
import { addRivalModifier, emptyRivalry } from './rivalry';
import type { RivalryGame } from './rivalry';
import { createInitialState } from './state';
import { byYear, END_DAY, dateToDay, yearOf } from './time';
import { SEGMENT_IDS } from './types';
import type { GameState, PlayerModel, RivalModelDef, SegmentId } from './types';

// Соперники и мощность подменяем: нужны только список моделей на рынке (по каналам) и доли «API» и «Подписки».
const rivalState = vi.hoisted(() => ({ list: [] as RivalModelDef[] }));

// Подменяем только нужные функции, остальное берём настоящее: когда соседние модули будут готовы, тест не сломается.
vi.mock('./rivals', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./rivals')>();
  return {
    ...orig,
    marketRivals: (_s: GameState, channel: 'api' | 'subs' = 'api') =>
      rivalState.list.filter((d) => (channel === 'subs' ? orig.rivalOnSubs(d) : orig.rivalOnApi(d))),
    rivalPrice: (def: RivalModelDef) => ((def.priceIn ?? 0) * 3 + (def.priceOut ?? 0)) / 4,
  };
});

vi.mock('./compute', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./compute')>()),
  pool: (s: GameState, kind: keyof GameState['compute']['alloc']) => s.compute.rented.h100 * s.compute.alloc[kind],
}));

const MID_2024 = dateToDay('2024-06-01');
const BEFORE_ARENA = dateToDay('2023-01-01');
const CHAT_DAY = dateToDay('2022-11-30');

/** Состояние с полями соперников (до интеграции createInitialState их не задаёт). */
function makeState(day = MID_2024): RivalryGame {
  const s = createInitialState('Тест', 1) as RivalryGame;
  if (!s.rivalry) s.rivalry = emptyRivalry();
  if (!s.difficulty) s.difficulty = 'normal';
  s.day = day;
  return s;
}

function player(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Мой-1',
    plan: {
      name: 'Мой-1',
      paramsB: 70,
      tokensB: 1400,
      mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0,
      benchTargets: [],
      rlhf: false,
      context: 512,
      tier: 'mid',
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 0,
    releasedDay: 0,
    caps: { language: 60, code: 60, reasoning: 60 },
    overfit: {},
    rlhf: false,
    arenaElo: 1150,
    price: 3,
    onApi: true,
    exposed: false,
    earned: 0,
    onSubs: false,
    subsPrice: 20,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
    ...over,
  };
}

/** Соперник с API и чатом: без размера, цена $3 при опорной $3 на 01.01.2024 - средний уровень (без прибавок за уровень). */
function rival(over: Partial<RivalModelDef> = {}): RivalModelDef {
  return {
    id: 'r1',
    lab: 'openbrain',
    gameName: 'GTP-X',
    realName: 'GPT-X',
    released: '2024-01-01',
    api: true,
    openWeights: false,
    chat: true,
    paramsB: null,
    priceIn: 3,
    priceOut: 3,
    scores: {},
    arenaElo: 1150,
    arenaEstimated: false,
    contaminated: false,
    context: 512,
    ...over,
  };
}

/** Выдать игроку ровно столько мощности под канал, сколько нужно × k (остальные доли - ноль). */
function giveInference(s: GameState, k: number, channel: 'api' | 'subs' = 'api'): number {
  const need = inferenceNeed(s, marketSnapshot(s))[channel];
  s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: channel === 'api' ? 1 : 0, subs: channel === 'subs' ? 1 : 0 };
  s.compute.rented.h100 = need * k;
  return need;
}

/** Запись модели в сегменте снимка (или undefined). */
function entryOf(snap: MarketSnapshot, seg: SegmentId, key: string) {
  return snap.segments[seg].entries.find((e) => e.key === key);
}

/** Спрос игрока в токенах API (по обоим сегментам API) и выручка API в день при полном обслуживании. */
function playerApi(snap: MarketSnapshot): { tokens: number; revenue: number } {
  let tokens = 0;
  let revenue = 0;
  for (const seg of ['enterprise', 'developers'] as const) {
    for (const e of snap.segments[seg].entries) {
      if (e.ref.kind !== 'player') continue;
      tokens += e.tokens;
      revenue += (e.tokens * e.price) / 1e6;
    }
  }
  return { tokens, revenue };
}

const sumOf = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);

beforeEach(() => {
  rivalState.list = [];
});

describe('кривые спроса, цены и качества', () => {
  it('спрос проходит через опорные точки', () => {
    const anchors: [string, number][] = [
      ['2017-01-01', 1e8],
      ['2019-01-01', 4e8],
      ['2020-06-11', 2.8e9],
      ['2022-11-30', 2e10],
      ['2023-06-01', 3e11],
      ['2024-12-31', 3e12],
    ];
    for (const [date, value] of anchors) {
      expect(demandTokens(makeState(dateToDay(date))) / value).toBeCloseTo(1, 6);
    }
  });

  it('спрос растёт в логарифме между точками', () => {
    // 2019-01-01 = день 730, середина между началом 2017 и началом 2019 - день 365
    const mid = demandTokens(makeState(365));
    expect(mid / Math.sqrt(1e8 * 4e8)).toBeCloseTo(1, 6);
  });

  it('спрос не убывает со временем', () => {
    const s = makeState(0);
    let prev = 0;
    for (let d = 0; d <= END_DAY; d++) {
      s.day = d;
      const t = demandTokens(s);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
    expect(prev).toBeGreaterThan(1e12);
  });

  it('модификатор demand умножает спрос API, но не подписки; subsDemand - наоборот', () => {
    const s = makeState();
    const base = demandTokens(s);
    const users = subsUsers(s);
    addModifier(s, { id: 'boom', kind: 'demand', mult: 2, untilDay: FOREVER });
    expect(demandTokens(s) / base).toBeCloseTo(2, 9);
    expect(subsUsers(s)).toBeCloseTo(users, 6);
    addModifier(s, { id: 'chat', kind: 'subsDemand', mult: 1.15, untilDay: FOREVER });
    expect(subsUsers(s) / users).toBeCloseTo(1.15, 9);
    expect(demandTokens(s) / base).toBeCloseTo(2, 9);
  });

  it('истёкший модификатор demand не действует', () => {
    const s = makeState();
    const base = demandTokens(s);
    addModifier(s, { id: 'old', kind: 'demand', mult: 3, untilDay: s.day - 1 });
    expect(demandTokens(s)).toBe(base);
  });

  it('доля разработчиков в API: опорные точки, линейно между ними', () => {
    expect(devShareOfApi(dateToDay('2017-01-01'))).toBeCloseTo(0.8, 9);
    expect(devShareOfApi(dateToDay('2020-06-11'))).toBeCloseTo(0.7, 9);
    expect(devShareOfApi(dateToDay('2022-11-30'))).toBeCloseTo(0.6, 9);
    expect(devShareOfApi(dateToDay('2024-12-31'))).toBeCloseTo(0.45, 9);
    const a = dateToDay('2022-11-30');
    const b = dateToDay('2024-12-31');
    expect(devShareOfApi(Math.round((a + b) / 2))).toBeCloseTo(0.525, 2);
  });

  it('пользователи чата: опорные точки (0,75 от design), скачок с ChatGTP, рост в логарифме', () => {
    const anchors: [string, number][] = [
      ['2017-01-01', 7.5e2],
      ['2020-06-11', 1.5e4],
      ['2022-11-29', 7.5e4],
      ['2022-11-30', 3.75e5],
      ['2023-06-01', 2.25e6],
      ['2024-01-01', 5.25e6],
      ['2024-12-31', 1.125e7],
    ];
    for (const [date, value] of anchors) expect(subsUsers(makeState(dateToDay(date))) / value).toBeCloseTo(1, 6);
    const a = dateToDay('2024-01-01');
    const b = dateToDay('2024-12-31');
    expect(subsUsers(makeState(Math.round((a + b) / 2))) / Math.sqrt(5.25e6 * 1.125e7)).toBeCloseTo(1, 2);
  });

  it('subsOpen: канал подписок открыт с 30.11.2022', () => {
    expect(subsOpen(CHAT_DAY - 1)).toBe(false);
    expect(subsOpen(CHAT_DAY)).toBe(true);
    expect(subsOpen(END_DAY)).toBe(true);
  });

  it('спрос сегментов: разработчики f × T, корпоративные (1 − f) × T, обычные - пользователи только после чат-момента', () => {
    const s = makeState();
    const t = demandTokens(s);
    const f = devShareOfApi(s.day);
    expect(segmentDemand(s, 'developers')).toBeCloseTo(f * t, 0);
    expect(segmentDemand(s, 'enterprise')).toBeCloseTo((1 - f) * t, 0);
    expect(segmentDemand(s, 'consumers')).toBeCloseTo(subsUsers(s), 6);
    const early = makeState(CHAT_DAY - 1);
    expect(segmentDemand(early, 'consumers')).toBe(0);
    expect(subsUsers(early)).toBeGreaterThan(0);
    expect(marketSnapshot(early).totalSubs).toBe(0);
  });

  it('опорная цена: точки и убывание', () => {
    const anchors: [string, number][] = [
      ['2017-01-01', 100],
      ['2020-01-01', 60],
      ['2022-01-01', 20],
      ['2023-01-01', 10],
      ['2024-01-01', 3],
    ];
    for (const [date, value] of anchors) expect(refPrice(dateToDay(date))).toBeCloseTo(value, 6);
    let prev = Infinity;
    for (let d = 0; d <= END_DAY; d++) {
      const p = refPrice(d);
      expect(p).toBeLessThanOrEqual(prev);
      expect(p).toBeGreaterThan(0);
      prev = p;
    }
  });

  it('между точками цена идёт в логарифме, качество - по прямой', () => {
    // цена: 01.01.2020 - 60, 01.01.2022 - 20
    const p0 = dateToDay('2020-01-01');
    const p1 = dateToDay('2022-01-01');
    const pDay = Math.round((p0 + p1) / 2);
    const pt = (pDay - p0) / (p1 - p0);
    expect(refPrice(pDay) / (60 * (20 / 60) ** pt)).toBeCloseTo(1, 9);
    expect(refPrice(pDay)).toBeLessThan(40); // по прямой было бы около 40

    // качество: 01.01.2020 - 950, 29.11.2022 - 1010 (накануне ChatGTP)
    const q0 = dateToDay('2020-01-01');
    const q1 = dateToDay('2022-11-29');
    const qDay = Math.round((q0 + q1) / 2);
    const qt = (qDay - q0) / (q1 - q0);
    expect(refQuality(qDay)).toBeCloseTo(950 + 60 * qt, 9);
  });

  it('опорное качество: точки, скачок с выходом ChatGTP и рост', () => {
    const anchors: [string, number][] = [
      ['2017-01-01', 900],
      ['2020-01-01', 950],
      ['2022-11-29', 1010],
      ['2022-11-30', 1080],
      ['2024-01-01', 1150],
    ];
    for (const [date, value] of anchors) expect(refQuality(dateToDay(date))).toBeCloseTo(value, 6);
    let prev = 0;
    for (let d = 0; d <= END_DAY; d++) {
      const q = refQuality(d);
      expect(q).toBeGreaterThanOrEqual(prev);
      prev = q;
    }
  });

  it('потенциал рынка на 31.12.2024: подписки / API в пределах 1…1,6', () => {
    const s = makeState(END_DAY);
    const api = (demandTokens(s) * refPrice(s.day)) / 1e6;
    const subs = (subsUsers(s) * SUBS_REF_PRICE) / 30;
    expect(subs / api).toBeGreaterThanOrEqual(1);
    expect(subs / api).toBeLessThanOrEqual(1.6);
    const snap = marketSnapshot(s);
    expect(snap.segments.consumers.weight).toBeCloseTo(subs / (subs + api), 9);
    expect(snap.segments.developers.weight + snap.segments.enterprise.weight).toBeCloseTo(api / (subs + api), 9);
  });
});

describe('бренд и воспринимаемое качество', () => {
  it('бренд игрока зависит от репутации', () => {
    const s = makeState();
    s.reputation = 50;
    expect(labBrand(s, 'player')).toBeCloseTo(0, 9);
    s.reputation = 100;
    expect(labBrand(s, 'player')).toBeCloseTo(0.4, 9);
    s.reputation = 20;
    expect(labBrand(s, 'player')).toBeCloseTo(-0.24, 9);
  });

  it('бренд лаборатории: база из каталога плюс модификатор', () => {
    const s = makeState();
    expect(labBrand(s, 'openbrain')).toBeCloseTo(0.5, 9);
    expect(labBrand(s, 'zhipo')).toBeCloseTo(-0.7, 9);
    addModifier(s, { id: 'chat', kind: 'labBrand', target: 'openbrain', add: 0.5, untilDay: FOREVER });
    expect(labBrand(s, 'openbrain')).toBeCloseTo(1.0, 9);
    expect(labBrand(s, 'gogle')).toBeCloseTo(0.3, 9);
  });

  it('модификатор бренда без цели действует на все лаборатории', () => {
    const s = makeState();
    addModifier(s, { id: 'all', kind: 'labBrand', add: -0.2, untilDay: FOREVER });
    expect(labBrand(s, 'antropik')).toBeCloseTo(-0.1, 9);
    expect(labBrand(s, 'deepcent')).toBeCloseTo(-0.7, 9);
  });

  it('бренд игрока не выходит за ±0,4, даже если репутация вне 0..100', () => {
    const s = makeState();
    s.reputation = 150;
    expect(labBrand(s, 'player')).toBeCloseTo(0.4, 9);
    s.reputation = -30;
    expect(labBrand(s, 'player')).toBeCloseTo(-0.4, 9);
  });

  it('истёкший модификатор бренда не действует', () => {
    const s = makeState();
    addModifier(s, { id: 'old', kind: 'labBrand', target: 'openbrain', add: 0.5, untilDay: s.day - 1 });
    expect(labBrand(s, 'openbrain')).toBeCloseTo(0.5, 9);
  });

  it('segBrand: модификатор segBrand действует только в своём сегменте и у своего владельца', () => {
    const s = makeState();
    addModifier(s, { id: 'free', kind: 'segBrand', target: 'gogle:consumers', add: 0.3, untilDay: FOREVER });
    expect(segBrand(s, 'gogle', 'consumers')).toBeCloseTo(0.6, 9);
    expect(segBrand(s, 'gogle', 'developers')).toBeCloseTo(0.3, 9);
    expect(segBrand(s, 'openbrain', 'consumers')).toBeCloseTo(0.5, 9);
    expect(labBrand(s, 'gogle')).toBeCloseTo(0.3, 9);
  });

  it('k шумихи: 1 до «Арены», 0,7 после; hypeMult множит шумиху внутри качества', () => {
    expect(HYPE_K_BEFORE_ARENA).toBe(1);
    expect(HYPE_K_AFTER_ARENA).toBe(0.7);
    expect(hypeK(dateToDay('2023-05-02'))).toBe(1);
    expect(hypeK(dateToDay('2023-05-03'))).toBe(0.7);
    const s = makeState(BEFORE_ARENA);
    s.hype.player = 10;
    expect(perceivedQuality(s, 'player', 1000)).toBeCloseTo(1010, 9);
    expect(perceivedQuality(s, 'player', 1000, 1.5)).toBeCloseTo(1015, 9);
    s.day = MID_2024;
    expect(perceivedQuality(s, 'player', 1000)).toBeCloseTo(1007, 9);
    expect(perceivedQuality(s, 'player', 1000, 0.7)).toBeCloseTo(1004.9, 9);
  });
});

describe('marketSnapshot: сегменты', () => {
  it('пустой рынок: всё уходит внешнему варианту в каждом сегменте, без NaN', () => {
    const s = makeState();
    const snap = marketSnapshot(s);
    for (const seg of SEGMENT_IDS) {
      expect(snap.segments[seg].entries).toEqual([]);
      expect(snap.segments[seg].noneShare).toBe(1);
      expect(snap.segments[seg].id).toBe(seg);
      expect(snap.segments[seg].channel).toBe(SEGMENT_DEF[seg].channel);
    }
    expect(Number.isFinite(snap.totalTokens)).toBe(true);
    expect(snap.totalTokens).toBeCloseTo(demandTokens(s), 3);
    expect(snap.totalSubs).toBeCloseTo(subsUsers(s), 3);
    expect(SEGMENT_IDS.reduce((a, seg) => a + snap.segments[seg].weight, 0)).toBeCloseTo(1, 12);
  });

  it('в каждом сегменте доли моделей и внешнего варианта дают 1; спрос в единицах сегмента', () => {
    const s = makeState();
    s.models.push(player({ onSubs: true }), player({ id: 'p2', name: 'Мой-2', price: 5, arenaElo: 1100 }));
    rivalState.list = [
      rival(),
      rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1', arenaElo: 1200, priceIn: 2, priceOut: 2 }),
      rival({ id: 'r3', lab: 'deepcent', gameName: 'ГС-3', arenaElo: 1180, priceIn: 0.5, priceOut: 0.5 }),
    ];
    const snap = marketSnapshot(s);
    for (const seg of SEGMENT_IDS) {
      const st = snap.segments[seg];
      const sum = st.entries.reduce((a, e) => a + e.share, 0) + st.noneShare;
      expect(sum, seg).toBeCloseTo(1, 12);
      const demand = st.entries.reduce((a, e) => a + e.demand, 0);
      expect(demand, seg).toBeCloseTo((1 - st.noneShare) * st.total, 0);
      for (const e of st.entries) {
        expect(e.share, `${seg}:${e.key}`).toBeGreaterThan(0);
        expect(Number.isFinite(e.utility)).toBe(true);
        expect(e.tokens).toBeCloseTo(e.demand * (st.channel === 'subs' ? TOKENS_PER_USER_DAY : 1), 6);
      }
    }
    // Каналы: p2 и все соперники - в API-сегментах; p1 (onSubs) и чаты соперников - у обычных.
    expect(snap.segments.developers.entries.map((e) => e.key).sort()).toEqual(['player:p1', 'player:p2', 'rival:r1', 'rival:r2', 'rival:r3']);
    expect(snap.segments.consumers.entries.map((e) => e.key).sort()).toEqual(['player:p1', 'rival:r1', 'rival:r2', 'rival:r3']);
    expect(entryOf(snap, 'consumers', 'player:p1')!.price).toBe(20);
    expect(entryOf(snap, 'developers', 'player:p1')!.price).toBe(3);
  });

  it('до 30.11.2022 сегмент обычных пуст даже при включённой подписке; после - заполнен', () => {
    const early = makeState(CHAT_DAY - 1);
    early.models.push(player({ onSubs: true }));
    rivalState.list = [rival({ released: '2022-06-01' })];
    const a = marketSnapshot(early);
    expect(a.segments.consumers.entries).toEqual([]);
    expect(a.segments.consumers.noneShare).toBe(1);
    expect(a.segments.consumers.total).toBe(0);
    expect(a.segments.consumers.weight).toBe(0);
    expect(a.segments.developers.entries.map((e) => e.key).sort()).toEqual(['player:p1', 'rival:r1']);
    const late = makeState(CHAT_DAY);
    late.models.push(player({ onSubs: true }));
    const b = marketSnapshot(late);
    expect(b.segments.consumers.entries.map((e) => e.key).sort()).toEqual(['player:p1', 'rival:r1']);
    expect(b.segments.consumers.total).toBeGreaterThan(0);
  });

  it('записи идут по убыванию доли', () => {
    const s = makeState();
    s.models.push(player());
    rivalState.list = [rival({ id: 'r2', arenaElo: 1300 }), rival({ id: 'r3', arenaElo: 1000 })];
    for (const seg of SEGMENT_IDS) {
      const shares = marketSnapshot(s).segments[seg].entries.map((e) => e.share);
      for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThanOrEqual(shares[i - 1]);
    }
  });

  it('в API-сегменты попадают только выпущенные модели игрока с onApi, в обычные - с onSubs', () => {
    const s = makeState();
    s.models.push(
      player({ id: 'p1' }),
      player({ id: 'p2', releasedDay: null, onSubs: true }),
      player({ id: 'p3', onApi: false }),
      player({ id: 'p4', onApi: false, onSubs: true }),
    );
    const snap = marketSnapshot(s);
    expect(snap.segments.developers.entries.map((e) => e.key)).toEqual(['player:p1']);
    expect(snap.segments.enterprise.entries.map((e) => e.key)).toEqual(['player:p1']);
    expect(snap.segments.consumers.entries.map((e) => e.key)).toEqual(['player:p4']);
  });

  it('запись соперника: ключ, лаборатория, название, цена API и цена подписки по уровню', () => {
    const s = makeState();
    rivalState.list = [rival({ id: 'gtp-4', lab: 'openbrain', gameName: 'GTP-4', priceIn: 10, priceOut: 30 })];
    const snap = marketSnapshot(s);
    const e = entryOf(snap, 'developers', 'rival:gtp-4')!;
    expect(e.ref).toEqual({ kind: 'rival', id: 'gtp-4' });
    expect(e.owner).toBe('openbrain');
    expect(e.name).toBe('GTP-4');
    expect(e.price).toBeCloseTo(15, 9);
    expect(e.tier).toBe('flagship'); // $15 при опорной $3 - в пять раз дороже
    expect(entryOf(snap, 'consumers', 'rival:gtp-4')!.price).toBe(20);
    expect(e.codeLevel).toBeNull(); // бенчмарков кода в этом состоянии нет
  });

  it('цена выше - доля ниже; разработчики чувствительнее к цене, чем корпоративные', () => {
    const shareAt = (price: number, seg: SegmentId): number => {
      const s = makeState();
      s.models.push(player({ price }));
      rivalState.list = [rival()];
      return entryOf(marketSnapshot(s), seg, 'player:p1')!.share;
    };
    for (const seg of ['developers', 'enterprise'] as const) {
      expect(shareAt(1, seg)).toBeGreaterThan(shareAt(3, seg));
      expect(shareAt(3, seg)).toBeGreaterThan(shareAt(10, seg));
    }
    const dropDev = shareAt(3, 'developers') / shareAt(6, 'developers');
    const dropEnt = shareAt(3, 'enterprise') / shareAt(6, 'enterprise');
    expect(dropDev).toBeGreaterThan(dropEnt);
  });

  it('Эло выше - доля выше во всех сегментах', () => {
    const shareAt = (elo: number, seg: SegmentId): number => {
      const s = makeState();
      s.models.push(player({ arenaElo: elo, onSubs: true }));
      rivalState.list = [rival()];
      return entryOf(marketSnapshot(s), seg, 'player:p1')!.share;
    };
    for (const seg of SEGMENT_IDS) {
      expect(shareAt(1250, seg)).toBeGreaterThan(shareAt(1150, seg));
      expect(shareAt(1150, seg)).toBeGreaterThan(shareAt(1050, seg));
    }
  });

  it('при равных Эло и цене лёгкая модель выигрывает у разработчиков, флагман - у корпоративных и обычных', () => {
    const s = makeState();
    const light = player({ id: 'p1', onSubs: true });
    light.plan = { ...light.plan, tier: 'light' };
    const flag = player({ id: 'p2', onSubs: true });
    flag.plan = { ...flag.plan, tier: 'flagship' };
    s.models.push(light, flag);
    const snap = marketSnapshot(s);
    expect(entryOf(snap, 'developers', 'player:p1')!.share).toBeGreaterThan(entryOf(snap, 'developers', 'player:p2')!.share);
    expect(entryOf(snap, 'enterprise', 'player:p2')!.share).toBeGreaterThan(entryOf(snap, 'enterprise', 'player:p1')!.share);
    expect(entryOf(snap, 'consumers', 'player:p2')!.share).toBeGreaterThan(entryOf(snap, 'consumers', 'player:p1')!.share);
    expect(entryOf(snap, 'developers', 'player:p1')!.tier).toBe('light');
  });

  it('подгонка под HumanEvol поднимает долю у разработчиков; разоблачение режет корпоративных сильнее всех', () => {
    const run = (over: Partial<PlayerModel>) => {
      const s = makeState();
      s.benchmarks.humaneval.introduced = true;
      s.models.push(player({ onSubs: true, ...over }));
      rivalState.list = [rival()];
      return marketSnapshot(s);
    };
    const plain = run({});
    const fitted = run({ overfit: { humaneval: 20 } });
    const exposedFit = run({ overfit: { humaneval: 20 }, exposed: true });
    const exposed = run({ exposed: true });
    expect(entryOf(fitted, 'developers', 'player:p1')!.codeLevel!).toBeGreaterThan(entryOf(plain, 'developers', 'player:p1')!.codeLevel!);
    expect(entryOf(fitted, 'developers', 'player:p1')!.share).toBeGreaterThan(entryOf(plain, 'developers', 'player:p1')!.share);
    // У разоблачённой модели показанный балл честный: уровень по коду как у модели без подгонки.
    expect(entryOf(exposedFit, 'developers', 'player:p1')!.codeLevel).toBeCloseTo(entryOf(plain, 'developers', 'player:p1')!.codeLevel!, 9);
    // Сам штраф разоблачения: корпоративные 0,8, разработчики 0,3, обычные 0,2.
    const cut = (seg: SegmentId) => entryOf(exposed, seg, 'player:p1')!.share / entryOf(plain, seg, 'player:p1')!.share;
    expect(cut('enterprise')).toBeLessThan(cut('developers'));
    expect(cut('developers')).toBeLessThan(cut('consumers'));
    expect(cut('consumers')).toBeLessThan(1);
    const uDrop = (seg: SegmentId) => entryOf(plain, seg, 'player:p1')!.utility - entryOf(exposed, seg, 'player:p1')!.utility;
    expect(uDrop('enterprise')).toBeCloseTo(SEGMENT_DEF.enterprise.exposedPenalty, 9);
    expect(uDrop('developers')).toBeCloseTo(SEGMENT_DEF.developers.exposedPenalty, 9);
  });

  it('шумиха поднимает долю и воспринимаемое качество; у обычных пользователей она весит в полтора раза больше', () => {
    const run = (hype: number) => {
      const s = makeState();
      s.hype.player = hype;
      s.models.push(player({ onSubs: true }));
      rivalState.list = [rival()];
      return marketSnapshot(s);
    };
    const cold = run(0);
    const hot = run(60);
    for (const seg of SEGMENT_IDS) expect(entryOf(hot, seg, 'player:p1')!.share).toBeGreaterThan(entryOf(cold, seg, 'player:p1')!.share);
    expect(entryOf(cold, 'developers', 'player:p1')!.quality).toBeCloseTo(1150, 9);
    expect(entryOf(hot, 'developers', 'player:p1')!.quality).toBeCloseTo(1150 + HYPE_K_AFTER_ARENA * 60, 9);
    expect(entryOf(hot, 'consumers', 'player:p1')!.quality).toBeCloseTo(1150 + 1.5 * HYPE_K_AFTER_ARENA * 60, 9);
    expect(entryOf(hot, 'enterprise', 'player:p1')!.quality).toBeCloseTo(1150 + 0.7 * HYPE_K_AFTER_ARENA * 60, 9);
  });

  it('до «Арены» шумиха весит сильнее (HYPE_K_BEFORE_ARENA)', () => {
    const s = makeState(BEFORE_ARENA);
    s.hype.player = 20;
    s.models.push(player());
    const [e] = marketSnapshot(s).segments.developers.entries;
    expect(e.quality).toBeCloseTo(1150 + HYPE_K_BEFORE_ARENA * 20, 9);
  });

  it('шумиха соперника отбирает долю у игрока', () => {
    const run = (rivalHype: number): number => {
      const s = makeState();
      s.hype.openbrain = rivalHype;
      s.models.push(player());
      rivalState.list = [rival()];
      return entryOf(marketSnapshot(s), 'developers', 'player:p1')!.share;
    };
    expect(run(80)).toBeLessThan(run(0));
  });

  it('бренд известной лаборатории даёт преимущество при равных моделях', () => {
    const s = makeState();
    rivalState.list = [rival({ id: 'a', lab: 'openbrain' }), rival({ id: 'b', lab: 'zhipo' })];
    const snap = marketSnapshot(s);
    for (const seg of SEGMENT_IDS) {
      expect(entryOf(snap, seg, 'rival:a')!.share, seg).toBeGreaterThan(entryOf(snap, seg, 'rival:b')!.share);
    }
  });

  it('слабые модели оставляют большую часть спроса внешнему варианту', () => {
    const s = makeState();
    s.models.push(player({ arenaElo: 700, onSubs: true }));
    const snap = marketSnapshot(s);
    for (const seg of SEGMENT_IDS) expect(snap.segments[seg].noneShare, seg).toBeGreaterThan(0.9);
  });

  it('устойчив к огромной разнице качества и нулевой цене', () => {
    const s = makeState();
    s.models.push(player({ arenaElo: 1e6, price: 0, subsPrice: 0, onSubs: true }));
    rivalState.list = [rival({ arenaElo: -1e6 })];
    const snap = marketSnapshot(s);
    for (const seg of SEGMENT_IDS) {
      const st = snap.segments[seg];
      const sum = st.entries.reduce((a, e) => a + e.share, 0) + st.noneShare;
      expect(sum).toBeCloseTo(1, 12);
      for (const e of st.entries) expect(Number.isFinite(e.share)).toBe(true);
      expect(Number.isFinite(st.noneShare)).toBe(true);
      expect(st.entries[0].owner).toBe('player');
    }
  });

  it('формула сегмента: U = wQ·(Q−1000)/100 + wBrand·бренд − wPrice·ln(цена/опорная) + wCtx·ln(контекст/обычный) + уровень; доля - softmax', () => {
    // 1 января 2024: P_ref = 3 $/1М, Q_ref = 1150
    const s = makeState(dateToDay('2024-01-01'));
    const ref = refContext(s.day);
    s.reputation = 50; // бренд игрока 0
    s.hype.openbrain = 10;
    s.hype.player = 20;
    const pl = player({ price: 3, arenaElo: 1150, onSubs: true, subsPrice: 10 });
    pl.plan.context = 8192;
    s.models.push(pl);
    rivalState.list = [rival({ priceIn: 6, priceOut: 6, arenaElo: 1250, context: 128000 })]; // openbrain, бренд 0,5; $6 - средний уровень
    const snap = marketSnapshot(s);
    const kh = 0.7; // после «Арены»

    const check = (seg: SegmentId, uPlayer: number, uRival: number, uNone: number) => {
      const sum = Math.exp(uNone) + Math.exp(uPlayer) + Math.exp(uRival);
      const st = snap.segments[seg];
      const p = entryOf(snap, seg, 'player:p1')!;
      const r = entryOf(snap, seg, 'rival:r1')!;
      expect(p.utility, seg).toBeCloseTo(uPlayer, 9);
      expect(r.utility, seg).toBeCloseTo(uRival, 9);
      expect(p.share, seg).toBeCloseTo(Math.exp(uPlayer) / sum, 9);
      expect(r.share, seg).toBeCloseTo(Math.exp(uRival) / sum, 9);
      expect(st.noneShare, seg).toBeCloseTo(Math.exp(uNone) / sum, 9);
      expect(p.demand, seg).toBeCloseTo((Math.exp(uPlayer) / sum) * st.total, 0);
    };

    const d = SEGMENT_DEF.developers;
    check(
      'developers',
      (d.wQ * (1150 + d.hypeMult * kh * 20 - 1000)) / 100 + 0 - d.wPrice * Math.log(3 / 3) + d.wCtx * Math.log(8192 / ref),
      (d.wQ * (1250 + d.hypeMult * kh * 10 - 1000)) / 100 + d.wBrand * 0.5 - d.wPrice * Math.log(6 / 3) + d.wCtx * Math.log(128000 / ref),
      (1150 - 1000) / 100 + d.u0Offset,
    );
    const e = SEGMENT_DEF.enterprise;
    check(
      'enterprise',
      (e.wQ * (1150 + e.hypeMult * kh * 20 - 1000)) / 100 - e.wPrice * Math.log(3 / 3) + e.wCtx * Math.log(8192 / ref),
      (e.wQ * (1250 + e.hypeMult * kh * 10 - 1000)) / 100 + e.wBrand * 0.5 - e.wPrice * Math.log(6 / 3) + e.wCtx * Math.log(128000 / ref),
      (1150 - 1000) / 100 + e.u0Offset,
    );
    const c = SEGMENT_DEF.consumers;
    check(
      'consumers',
      (c.wQ * (1150 + c.hypeMult * kh * 20 - 1000)) / 100 - c.wPrice * Math.log(10 / SUBS_REF_PRICE) + c.wCtx * Math.log(8192 / ref),
      (c.wQ * (1250 + c.hypeMult * kh * 10 - 1000)) / 100 + c.wBrand * 0.5 - c.wPrice * Math.log(20 / SUBS_REF_PRICE) + c.wCtx * Math.log(128000 / ref),
      (1150 - 1000) / 100 + c.u0Offset,
    );
    expect(entryOf(snap, 'consumers', 'player:p1')!.quality).toBeCloseTo(1150 + 1.5 * kh * 20, 9);
    expect(entryOf(snap, 'developers', 'rival:r1')!.quality).toBeCloseTo(1257, 9);

    // Спрос API между 01.06.2023 (3e11) и 31.12.2024 (3e12) растёт ровно в логарифме: 3e11 × 10^t; сегменты делят его по f.
    const t = (s.day - dateToDay('2023-06-01')) / (dateToDay('2024-12-31') - dateToDay('2023-06-01'));
    expect(snap.totalTokens / (3e11 * 10 ** t)).toBeCloseTo(1, 9);
    expect(snap.segments.developers.total / snap.totalTokens).toBeCloseTo(devShareOfApi(s.day), 9);
    expect(snap.segments.enterprise.total / snap.totalTokens).toBeCloseTo(1 - devShareOfApi(s.day), 9);
    expect(snap.segments.consumers.total).toBeCloseTo(subsUsers(s), 6);
  });

  it('уровень по коду: +10 над уровнем года даёт разработчикам +0,6 полезности, разница зажата в ±20', () => {
    const s = makeState();
    for (const b of ['humaneval', 'swebench'] as const) s.benchmarks[b].introduced = true;
    s.models.push(player({ id: 'p1', caps: { language: 60, code: 60, reasoning: 60 } }), player({ id: 'p2', caps: { language: 60, code: 60, reasoning: 60 } }));
    const base = marketSnapshot(s);
    const a = entryOf(base, 'developers', 'player:p1')!;
    const b = entryOf(base, 'developers', 'player:p2')!;
    expect(a.utility).toBeCloseTo(b.utility, 9);
    const year = byYear(CAP_LEVEL, yearOf(s.day));
    expect(a.codeLevel).not.toBeNull();
    // Полезность содержит wCode × clamp(уровень − уровень года, ±20) / 10.
    const expected = SEGMENT_DEF.developers.wCode * (Math.max(-20, Math.min(20, a.codeLevel! - year)) / 10);
    const noCode = makeState();
    noCode.models.push(player({ id: 'p1', caps: { language: 60, code: 60, reasoning: 60 } }));
    const u0 = entryOf(marketSnapshot(noCode), 'developers', 'player:p1')!.utility;
    expect(a.utility - u0).toBeCloseTo(expected, 9);
    expect(entryOf(marketSnapshot(noCode), 'developers', 'player:p1')!.codeLevel).toBeNull();
  });

  it('бренд игрока из репутации входит в полезность с весом сегмента', () => {
    const utilityAt = (rep: number, seg: SegmentId): number => {
      const s = makeState();
      s.reputation = rep;
      s.models.push(player({ onSubs: true }));
      return entryOf(marketSnapshot(s), seg, 'player:p1')!.utility;
    };
    expect(utilityAt(100, 'developers') - utilityAt(50, 'developers')).toBeCloseTo(SEGMENT_DEF.developers.wBrand * 0.4, 9);
    expect(utilityAt(50, 'enterprise') - utilityAt(0, 'enterprise')).toBeCloseTo(SEGMENT_DEF.enterprise.wBrand * 0.4, 9);
    expect(utilityAt(100, 'consumers') - utilityAt(50, 'consumers')).toBeCloseTo(SEGMENT_DEF.consumers.wBrand * 0.4, 9);
  });

  it('шумиха весит сильнее до открытия «Арены» (по полезности): k = 1, после - 0,7', () => {
    const gain = (day: number): number => {
      const utility = (hype: number): number => {
        const s = makeState(day);
        s.hype.player = hype;
        s.models.push(player());
        return marketSnapshot(s).segments.developers.entries[0].utility;
      };
      return utility(30) - utility(0);
    };
    const w = SEGMENT_DEF.developers.wQ * SEGMENT_DEF.developers.hypeMult;
    expect(gain(dateToDay('2023-05-02'))).toBeCloseTo((w * 1 * 30) / 100, 9);
    expect(gain(dateToDay('2023-05-03'))).toBeCloseTo((w * 0.7 * 30) / 100, 9);
  });

  it('модификатор бренда сдвигает долю лаборатории; segBrand - только в своём сегменте', () => {
    const snapOf = (kind: 'labBrand' | 'segBrand', add: number) => {
      const s = makeState();
      if (add !== 0) addModifier(s, { id: 'b', kind, target: kind === 'labBrand' ? 'openbrain' : 'openbrain:consumers', add, untilDay: FOREVER });
      rivalState.list = [rival(), rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1' })];
      return marketSnapshot(s);
    };
    const base = snapOf('labBrand', 0);
    expect(entryOf(snapOf('labBrand', 0.5), 'developers', 'rival:r1')!.share).toBeGreaterThan(entryOf(base, 'developers', 'rival:r1')!.share);
    expect(entryOf(snapOf('labBrand', -0.5), 'developers', 'rival:r1')!.share).toBeLessThan(entryOf(base, 'developers', 'rival:r1')!.share);
    const seg = snapOf('segBrand', 0.3);
    expect(entryOf(seg, 'consumers', 'rival:r1')!.share).toBeGreaterThan(entryOf(base, 'consumers', 'rival:r1')!.share);
    expect(entryOf(seg, 'developers', 'rival:r1')!.share).toBeCloseTo(entryOf(base, 'developers', 'rival:r1')!.share, 12);
    expect(entryOf(seg, 'enterprise', 'rival:r1')!.share).toBeCloseTo(entryOf(base, 'enterprise', 'rival:r1')!.share, 12);
  });

  it('не меняет состояние', () => {
    const s = makeState();
    s.models.push(player({ onSubs: true }));
    rivalState.list = [rival()];
    const before = JSON.stringify(s);
    marketSnapshot(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('обслуживание', () => {
  it('servingTokensPerH100eDay: 175 млрд - 36,6 млн токенов в день на H100e, 1,8 трлн - 3,6 млн', () => {
    expect(servingTokensPerH100eDay(175) / 3.66e7).toBeCloseTo(1, 2);
    expect(servingTokensPerH100eDay(1800) / 3.56e6).toBeCloseTo(1, 2);
    expect(servingTokensPerH100eDay(175)).toBeCloseTo((989e12 * 0.15 * 86400) / (2 * 175e9), 0);
  });

  it('inferenceNeed считает H100e по токенам и размеру модели игрока, по каналам', () => {
    const s = makeState();
    s.models.push(player({ plan: { ...player().plan, paramsB: 70 }, onSubs: true }));
    rivalState.list = [rival()];
    const snap = marketSnapshot(s);
    const { tokens } = playerApi(snap);
    const users = entryOf(snap, 'consumers', 'player:p1')!.demand;
    const serving = (989e12 * 0.15 * 86400) / (2 * 70e9);
    const need = inferenceNeed(s, snap);
    expect(need.api).toBeCloseTo(tokens / serving, 6);
    expect(need.subs).toBeCloseTo((users * TOKENS_PER_USER_DAY) / serving, 6);
    expect(need.api).toBeGreaterThan(0);
    expect(need.subs).toBeGreaterThan(0);
  });

  it('суммирует по всем моделям игрока, у каждой свой размер', () => {
    const s = makeState();
    s.models.push(
      player({ id: 'p1', plan: { ...player().plan, paramsB: 7 } }),
      player({ id: 'p2', arenaElo: 1100, plan: { ...player().plan, paramsB: 175 } }),
    );
    rivalState.list = [rival()];
    const snap = marketSnapshot(s);
    const tokensOf = (key: string) => ['enterprise', 'developers'].reduce((a, seg) => a + (entryOf(snap, seg as SegmentId, key)?.tokens ?? 0), 0);
    const t1 = tokensOf('player:p1');
    const t2 = tokensOf('player:p2');
    const expected = (t1 * 2 * 7e9 + t2 * 2 * 175e9) / (989e12 * 0.15 * 86400);
    expect(inferenceNeed(s, snap).api).toBeCloseTo(expected, 6);
    expect(inferenceNeed(s, snap).subs).toBe(0);
    // больше модель при тех же токенах - больше мощности
    expect(inferenceNeed(s, snap).api).toBeGreaterThan((t1 * 2 * 7e9 + t2 * 2 * 7e9) / (989e12 * 0.15 * 86400));
  });

  it('модели соперников не требуют мощности игрока; пустой рынок - нули', () => {
    const s = makeState();
    rivalState.list = [rival()];
    expect(inferenceNeed(s, marketSnapshot(s))).toEqual({ api: 0, subs: 0 });
    rivalState.list = [];
    expect(inferenceNeed(s, marketSnapshot(s))).toEqual({ api: 0, subs: 0 });
  });
});

describe('dayStep', () => {
  function withPlayer(over: Partial<PlayerModel> = {}): GameState {
    const s = makeState();
    s.models.push(player(over));
    rivalState.list = [rival(), rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1', arenaElo: 1120 })];
    return s;
  }

  it('при хватке мощности обслуживает весь спрос API и платит по цене', () => {
    const s = withPlayer();
    s.hype.player = 40;
    giveInference(s, 2);
    const snap = marketSnapshot(s);
    const { tokens, revenue } = playerApi(snap);
    const cash0 = s.cash;
    dayStep(s);
    expect(revenue).toBeGreaterThan(0);
    expect(s.cash - cash0).toBeCloseTo(revenue, 6);
    expect(s.finance.month.income.api).toBeCloseTo(revenue, 6);
    expect(s.finance.month.income.subs).toBe(0);
    expect(s.market.playerTokens).toBeCloseTo(tokens, 0);
    expect(s.market.playerSubs).toBe(0);
    expect(s.market.lostFraction).toBe(0);
    expect(s.market.lostApi).toBe(0);
    expect(s.market.lostSubs).toBe(0);
    expect(s.market.totalTokens).toBeCloseTo(snap.totalTokens, 0);
    expect(s.market.totalSubs).toBeCloseTo(snap.totalSubs, 0);
    expect(s.hype.player).toBe(40);
    expect(s.models[0].earned).toBeCloseTo(revenue, 6);
    expect(s.models[0].earnedSubs).toBe(0);
  });

  it('нехватка мощности API режет выручку пропорционально и роняет шумиху', () => {
    const full = withPlayer();
    full.hype.player = 40;
    giveInference(full, 2);
    const c0 = full.cash;
    dayStep(full);
    const revFull = full.cash - c0;

    const half = withPlayer();
    half.hype.player = 40;
    giveInference(half, 0.5);
    const h0 = half.cash;
    dayStep(half);
    const revHalf = half.cash - h0;

    expect(revFull).toBeGreaterThan(0);
    expect(revHalf / revFull).toBeCloseTo(0.5, 9);
    expect(half.market.lostFraction).toBeCloseTo(0.5, 9);
    expect(half.market.lostApi).toBeCloseTo(0.5, 9);
    expect(half.market.playerTokens / full.market.playerTokens).toBeCloseTo(0.5, 9);
    expect(half.hype.player).toBeCloseTo(40 - 0.3 * 0.5, 9);
    // доли в s.market - после ограничения мощностью: у игрока половина спроса, потерянное ушло соперникам
    expect(half.market.shares['player:p1']).toBeCloseTo(full.market.shares['player:p1'] * 0.5, 12);
    expect(half.market.labShares.player).toBeCloseTo(full.market.labShares.player * 0.5, 12);
    expect(half.market.shares['rival:r1']).toBeGreaterThan(full.market.shares['rival:r1']);
    expect(half.market.shares['rival:r2']).toBeGreaterThan(full.market.shares['rival:r2']);
    expect(sumOf(half.market.shares)).toBeCloseTo(1, 12);
    for (const seg of ['developers', 'enterprise'] as const) {
      expect(half.market.segments[seg].shares['player:p1']).toBeCloseTo(full.market.segments[seg].shares['player:p1'] * 0.5, 12);
    }
  });

  it('пишет обслуженные доли по сегментам: при мощности 40 % доля игрока - 40 % его спроса, спрос для «нужно» не меняется', () => {
    const s = withPlayer();
    const need = giveInference(s, 0.4);
    const snap = marketSnapshot(s);
    dayStep(s);
    for (const seg of ['developers', 'enterprise'] as const) {
      const demand = entryOf(snap, seg, 'player:p1')!.share;
      expect(s.market.segments[seg].shares['player:p1'], seg).toBeCloseTo(demand * 0.4, 9);
      expect(s.market.segments[seg].labShares.player, seg).toBeCloseTo(demand * 0.4, 9);
      expect(s.market.segments[seg].total, seg).toBeCloseTo(snap.segments[seg].total, 0);
      expect(sumOf(s.market.segments[seg].shares), seg).toBeCloseTo(1, 12);
      expect(sumOf(s.market.segments[seg].labShares), seg).toBeCloseTo(1, 12);
    }
    expect(s.market.lostFraction).toBeCloseTo(0.6, 9);
    // обслуженные токены = Σ по сегментам обслуженная доля × спрос сегмента
    const served = ['developers', 'enterprise'].reduce((a, seg) => {
      const st = s.market.segments[seg as SegmentId];
      return a + st.shares['player:p1'] * st.total;
    }, 0);
    expect(s.market.playerTokens).toBeCloseTo(served, 0);
    expect(sumOf(s.market.shares)).toBeCloseTo(1, 12);
    expect(sumOf(s.market.labShares)).toBeCloseTo(1, 12);
    expect(inferenceNeed(s, marketSnapshot(s)).api).toBeCloseTo(need, 6);
  });

  it('нехватка мощности делит все модели игрока поровну: у каждой та же доля обслуженного', () => {
    const s = makeState();
    s.models.push(
      player({ id: 'p1', price: 2, plan: { ...player().plan, paramsB: 7 } }),
      player({ id: 'p2', name: 'Мой-2', price: 9, arenaElo: 1180, plan: { ...player().plan, paramsB: 175 } }),
    );
    rivalState.list = [rival()];
    s.hype.player = 10;
    giveInference(s, 0.4);
    const snap = marketSnapshot(s);
    const cash0 = s.cash;
    dayStep(s);

    const f = 0.4;
    const { tokens, revenue } = playerApi(snap);
    expect(s.market.lostFraction).toBeCloseTo(1 - f, 9);
    expect(s.market.playerTokens / tokens).toBeCloseTo(f, 9);
    // выручка считается по цене каждой модели, а не по средней
    expect(s.cash - cash0).toBeCloseTo(f * revenue, 6);
    expect(s.hype.player).toBeCloseTo(10 - 0.3 * (1 - f), 9);
  });

  it('без мощности под API: выручки нет, спрос потерян целиком, шумиха не уходит в минус', () => {
    const s = withPlayer();
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, api: 0, subs: 0 };
    s.compute.rented.h100 = 100;
    s.hype.player = 0.1;
    const cash0 = s.cash;
    dayStep(s);
    expect(s.cash).toBe(cash0);
    expect(s.market.lostFraction).toBeCloseTo(1, 12);
    expect(s.market.lostApi).toBe(1);
    expect(s.market.playerTokens).toBe(0);
    expect(s.hype.player).toBe(0);
  });

  it('шумиха падает на 0,3 × потерянная доля в день', () => {
    const s = withPlayer();
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, api: 0, subs: 0 };
    s.hype.player = 50;
    dayStep(s);
    expect(s.hype.player).toBeCloseTo(49.7, 9);
  });

  it('нет моделей игрока на рынке - нет потерь и штрафа к шумихе', () => {
    const s = makeState();
    rivalState.list = [rival()];
    s.hype.player = 30;
    const cash0 = s.cash;
    dayStep(s);
    expect(s.cash).toBe(cash0);
    expect(s.market.lostFraction).toBe(0);
    expect(s.market.playerTokens).toBe(0);
    expect(s.market.playerSubs).toBe(0);
    expect(s.hype.player).toBe(30);
  });

  it('пишет общие доли по моделям и лабораториям, в сумме 1; общие доли - взвешенная сумма сегментов', () => {
    const s = withPlayer();
    giveInference(s, 2);
    const snap = marketSnapshot(s);
    dayStep(s);
    const m = s.market;
    expect(Object.keys(m.shares).sort()).toEqual(['none', 'player:p1', 'rival:r1', 'rival:r2']);
    expect(sumOf(m.shares)).toBeCloseTo(1, 12);
    expect(sumOf(m.labShares)).toBeCloseTo(1, 12);
    expect(m.labShares.none).toBeCloseTo(m.shares.none, 12);
    expect(m.labShares.player).toBeCloseTo(m.shares['player:p1'], 12);
    expect(m.labShares.openbrain).toBeCloseTo(m.shares['rival:r1'], 12);
    expect(m.labShares.gogle).toBeCloseTo(m.shares['rival:r2'], 12);
    // лаборатории без моделей на рынке - ноль, но ключ есть
    for (const o of HYPE_OWNERS) expect(m.labShares[o]).toBeGreaterThanOrEqual(0);
    expect(m.labShares.zhipo).toBe(0);
    expect(m.labShares.deepcent).toBe(0);
    // Взвешенная сумма: игрок только в API-сегментах, соперники - во всех трёх.
    let player1 = 0;
    let r1 = 0;
    for (const seg of SEGMENT_IDS) {
      player1 += snap.segments[seg].weight * (m.segments[seg].shares['player:p1'] ?? 0);
      r1 += snap.segments[seg].weight * (m.segments[seg].shares['rival:r1'] ?? 0);
    }
    expect(m.shares['player:p1']).toBeCloseTo(player1, 12);
    expect(m.shares['rival:r1']).toBeCloseTo(r1, 12);
    expect(m.segments.consumers.shares['player:p1']).toBeUndefined();
  });

  it('combineShares: взвешенная сумма долей по весам сегментов, сумма 1', () => {
    const s = withPlayer({ onSubs: true });
    const snap = marketSnapshot(s);
    const served = {} as Record<SegmentId, ReturnType<typeof servedShares>>;
    for (const seg of SEGMENT_IDS) served[seg] = servedShares(snap.segments[seg], seg === 'consumers' ? 0.5 : 1);
    const all = combineShares(snap, served);
    expect(sumOf(all.shares)).toBeCloseTo(1, 12);
    expect(sumOf(all.labShares)).toBeCloseTo(1, 12);
    const expected = SEGMENT_IDS.reduce((a, seg) => a + snap.segments[seg].weight * served[seg].shares['player:p1'], 0);
    expect(all.shares['player:p1']).toBeCloseTo(expected, 12);
    expect(all.labShares.player).toBeCloseTo(expected, 12);
  });

  it('доли лаборатории суммируются по её моделям', () => {
    const s = makeState();
    rivalState.list = [rival({ id: 'a', lab: 'openbrain' }), rival({ id: 'b', lab: 'openbrain', arenaElo: 1100 })];
    dayStep(s);
    expect(s.market.labShares.openbrain).toBeCloseTo(s.market.shares['rival:a'] + s.market.shares['rival:b'], 12);
  });

  it('пустой рынок: ни NaN, ни выручки; сегменты пусты', () => {
    const s = makeState();
    const cash0 = s.cash;
    dayStep(s);
    expect(s.cash).toBe(cash0);
    expect(Object.keys(s.market.shares)).toEqual(['none']);
    expect(s.market.shares.none).toBeCloseTo(1, 12);
    expect(s.market.labShares.none).toBeCloseTo(1, 12);
    for (const o of HYPE_OWNERS) expect(s.market.labShares[o]).toBe(0);
    expect(s.market.playerTokens).toBe(0);
    expect(s.market.lostFraction).toBe(0);
    expect(Number.isFinite(s.market.totalTokens)).toBe(true);
    expect(s.hype.player).toBe(0);
    for (const seg of SEGMENT_IDS) {
      expect(s.market.segments[seg].shares).toEqual({ none: 1 });
      expect(s.market.segments[seg].labShares.none).toBe(1);
    }
  });

  it('детерминирован: два прогона с одинаковым состоянием дают одно и то же', () => {
    const a = withPlayer({ onSubs: true });
    giveInference(a, 0.7);
    const b = withPlayer({ onSubs: true });
    giveInference(b, 0.7);
    dayStep(a);
    dayStep(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('каждый день состояние рынка пишется заново, старые записи не копятся', () => {
    const s = withPlayer();
    giveInference(s, 2);
    dayStep(s);
    const first = JSON.parse(JSON.stringify(s.market)) as GameState['market'];
    dayStep(s);
    // Цели не изменились: доли стоят на месте (до ошибок округления нормировки инерции).
    const close = (a: Record<string, number>, b: Record<string, number>) => {
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      for (const k of Object.keys(b)) expect(a[k]).toBeCloseTo(b[k], 12);
    };
    close(s.market.shares, first.shares);
    close(s.market.labShares, first.labShares);
    for (const seg of Object.keys(first.segments) as (keyof GameState['market']['segments'])[]) {
      close(s.market.segments[seg].shares, first.segments[seg].shares);
      expect(s.market.segments[seg].total).toBe(first.segments[seg].total);
    }

    // модель сняли с API, а соперник пропал с рынка - в записи их больше нет
    s.models[0].onApi = false;
    rivalState.list = [rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1' })];
    dayStep(s);
    expect(Object.keys(s.market.shares).sort()).toEqual(['none', 'rival:r2']);
    expect(s.market.labShares.player).toBe(0);
    expect(s.market.labShares.openbrain).toBe(0);
    expect(s.market.playerTokens).toBe(0);
    expect(s.market.lostFraction).toBe(0);
    expect(sumOf(s.market.labShares)).toBeCloseTo(1, 12);
  });

  it('снятая с API модель не приносит выручки', () => {
    const s = withPlayer();
    giveInference(s, 2);
    s.models[0].onApi = false;
    const cash0 = s.cash;
    dayStep(s);
    expect(s.cash).toBe(cash0);
    expect(s.market.shares['player:p1']).toBeUndefined();
  });
});

describe('подписки в dayStep', () => {
  function withSubs(): GameState {
    const s = makeState();
    s.models.push(player({ onSubs: true }));
    rivalState.list = [rival(), rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1', arenaElo: 1120 })];
    return s;
  }

  it('доля «API» = 0: выручки API нет, подписки обслуживаются и платят users × цена / 30', () => {
    const s = withSubs();
    const need = inferenceNeed(s, marketSnapshot(s));
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 0, subs: 1 };
    s.compute.rented.h100 = need.subs * 2;
    const users = entryOf(marketSnapshot(s), 'consumers', 'player:p1')!.demand;
    const cash0 = s.cash;
    dayStep(s);
    const subsRevenue = (users * 20) / 30;
    expect(subsRevenue).toBeGreaterThan(0);
    expect(s.cash - cash0).toBeCloseTo(subsRevenue, 6);
    expect(s.finance.month.income.subs).toBeCloseTo(subsRevenue, 6);
    expect(s.finance.month.income.api).toBe(0);
    expect(s.market.playerSubs).toBeCloseTo(users, 6);
    expect(s.market.playerTokens).toBe(0);
    expect(s.market.lostApi).toBe(1);
    expect(s.market.lostSubs).toBe(0);
    expect(s.models[0].earned).toBeCloseTo(subsRevenue, 6);
    expect(s.models[0].earnedSubs).toBeCloseTo(subsRevenue, 6);
    // Потеря взвешена по потенциальной выручке: потерян только API.
    const api = playerApi(marketSnapshot(s)).revenue;
    expect(s.market.lostFraction).toBeCloseTo(api / (api + subsRevenue), 9);
  });

  it('доля «Подписки» вдвое меньше нужного: выручка подписок вдвое, API обслужен целиком', () => {
    const s = withSubs();
    const need = inferenceNeed(s, marketSnapshot(s));
    // Карт хватает на API с запасом, а доля «Подписки» закрывает ровно половину нужного.
    const h100 = 2 * need.api + need.subs;
    const subsAlloc = (0.5 * need.subs) / h100;
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1 - subsAlloc, subs: subsAlloc };
    s.compute.rented.h100 = h100;
    const snap = marketSnapshot(s);
    const users = entryOf(snap, 'consumers', 'player:p1')!.demand;
    const api = playerApi(snap).revenue;
    dayStep(s);
    expect(s.market.lostSubs).toBeCloseTo(0.5, 9);
    expect(s.market.lostApi).toBe(0);
    expect(s.market.playerSubs).toBeCloseTo(users * 0.5, 6);
    expect(s.finance.month.income.subs).toBeCloseTo((users * 0.5 * 20) / 30, 6);
    expect(s.finance.month.income.api).toBeCloseTo(api, 6);
    expect(s.market.segments.consumers.shares['player:p1']).toBeCloseTo(entryOf(snap, 'consumers', 'player:p1')!.share * 0.5, 12);
    expect(s.market.segments.developers.shares['player:p1']).toBeCloseTo(entryOf(snap, 'developers', 'player:p1')!.share, 12);
    const full = (users * 20) / 30;
    expect(s.market.lostFraction).toBeCloseTo((full * 0.5) / (api + full), 9);
  });

  it('до чат-момента подписка не продаётся: выручки подписок нет', () => {
    const s = makeState(CHAT_DAY - 1);
    s.models.push(player({ onSubs: true }));
    rivalState.list = [rival({ released: '2022-06-01' })];
    giveInference(s, 2);
    s.compute.alloc.subs = 0.5;
    dayStep(s);
    expect(s.finance.month.income.subs).toBe(0);
    expect(s.market.playerSubs).toBe(0);
    expect(s.market.totalSubs).toBe(0);
    expect(s.market.segments.consumers.shares).toEqual({ none: 1 });
    expect(s.finance.month.income.api).toBeGreaterThan(0);
  });

  it('playerSales: токены API, подписчики и выручка в день из s.market', () => {
    const s = withSubs();
    const need = inferenceNeed(s, marketSnapshot(s));
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 0.5, subs: 0.5 };
    s.compute.rented.h100 = Math.max(need.api, need.subs) * 4;
    dayStep(s);
    const sales = playerSales(s, 'p1');
    expect(sales.apiTokens).toBeCloseTo(s.market.playerTokens, 0);
    expect(sales.subsUsers).toBeCloseTo(s.market.playerSubs, 6);
    expect(sales.apiRevenueDay).toBeCloseTo(s.finance.month.income.api, 6);
    expect(sales.subsRevenueDay).toBeCloseTo(s.finance.month.income.subs, 6);
    expect(sales.apiRevenueDay + sales.subsRevenueDay).toBeCloseTo(s.models[0].earned, 6);
    expect(playerSales(s, 'нет')).toEqual({ apiTokens: 0, subsUsers: 0, apiRevenueDay: 0, subsRevenueDay: 0 });
  });

  it('цена подписки: дешевле опорной / 4 доля не растёт; −0,8·ln(цена/20), дороже × 4 - ещё −2·ln(цена/80)', () => {
    const utilityAt = (subsPrice: number): number => {
      const s = makeState();
      s.models.push(player({ onSubs: true, subsPrice }));
      return marketSnapshot(s).segments.consumers.entries[0].utility;
    };
    expect(utilityAt(10) - utilityAt(20)).toBeCloseTo(0.8 * Math.log(2), 9);
    expect(utilityAt(5) - utilityAt(20)).toBeCloseTo(0.8 * Math.log(4), 9);
    expect(utilityAt(1) - utilityAt(5)).toBeCloseTo(0, 9);
    expect(utilityAt(80) - utilityAt(20)).toBeCloseTo(-0.8 * Math.log(4), 9);
    expect(utilityAt(200) - utilityAt(80)).toBeCloseTo(-2 * Math.log(200 / 80), 9);
  });

  it('подписка дороже × 4 опорной приносит меньше, чем по $80', () => {
    const revenueAt = (subsPrice: number): number => {
      const s = makeState();
      s.models.push(player({ onSubs: true, subsPrice }));
      rivalState.list = [rival()];
      return entryOf(marketSnapshot(s), 'consumers', 'player:p1')!.share * subsPrice;
    };
    expect(revenueAt(200)).toBeLessThan(revenueAt(80));
  });
});

describe('servedShares: доли после ограничения мощностью', () => {
  function snapWith() {
    const s = makeState();
    s.models.push(player(), player({ id: 'p2', name: 'Мой-2', price: 5, arenaElo: 1100 }));
    rivalState.list = [rival(), rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1', arenaElo: 1200, priceIn: 2, priceOut: 2 })];
    const seg = marketSnapshot(s).segments.developers;
    const at = (key: string) => seg.entries.find((e) => e.key === key)!;
    return { s, seg, p1: at('player:p1'), p2: at('player:p2'), r1: at('rival:r1'), r2: at('rival:r2') };
  }

  it('полная мощность: доли совпадают со спросом', () => {
    const { seg, p1, p2 } = snapWith();
    const { shares, labShares } = servedShares(seg, 1);
    for (const e of seg.entries) expect(shares[e.key]).toBeCloseTo(e.share, 12);
    expect(shares.none).toBeCloseTo(seg.noneShare, 12);
    expect(labShares.player).toBeCloseTo(p1.share + p2.share, 12);
  });

  it('половина мощности: у моделей игрока половина спроса, остальным - пропорционально весам, сумма 1', () => {
    const { seg, p1, p2, r1, r2 } = snapWith();
    const { shares, labShares } = servedShares(seg, 0.5);
    expect(shares['player:p1']).toBeCloseTo(p1.share * 0.5, 12);
    expect(shares['player:p2']).toBeCloseTo(p2.share * 0.5, 12);
    const lost = (p1.share + p2.share) * 0.5;
    const gain = 1 + lost / (r1.share + r2.share + seg.noneShare);
    expect(shares['rival:r1']).toBeCloseTo(r1.share * gain, 12);
    expect(shares['rival:r2']).toBeCloseTo(r2.share * gain, 12);
    expect(shares.none).toBeCloseTo(seg.noneShare * gain, 12);
    // отношения между соперниками и внешним вариантом не меняются
    expect(shares['rival:r1'] / shares['rival:r2']).toBeCloseTo(r1.share / r2.share, 9);
    expect(shares.none / shares['rival:r1']).toBeCloseTo(seg.noneShare / r1.share, 9);
    expect(sumOf(shares)).toBeCloseTo(1, 12);
    expect(sumOf(labShares)).toBeCloseTo(1, 12);
    expect(labShares.player).toBeCloseTo((p1.share + p2.share) * 0.5, 12);
    expect(labShares.openbrain).toBeCloseTo(shares['rival:r1'], 12);
    expect(labShares.gogle).toBeCloseTo(shares['rival:r2'], 12);
    expect(labShares.zhipo).toBe(0);
  });

  it('без мощности доля игрока 0, весь его спрос у соперников и внешнего варианта', () => {
    const { seg } = snapWith();
    const { shares, labShares } = servedShares(seg, 0);
    expect(shares['player:p1']).toBe(0);
    expect(shares['player:p2']).toBe(0);
    expect(labShares.player).toBe(0);
    expect(sumOf(shares)).toBeCloseTo(1, 12);
  });

  it('served вне [0; 1] или NaN не ломает доли', () => {
    const { seg, p1 } = snapWith();
    expect(servedShares(seg, 2).shares['player:p1']).toBeCloseTo(p1.share, 12);
    expect(servedShares(seg, NaN).shares['player:p1']).toBeCloseTo(p1.share, 12);
    expect(servedShares(seg, -1).shares['player:p1']).toBe(0);
  });

  it('снимок не меняется', () => {
    const { seg } = snapWith();
    const before = JSON.stringify(seg);
    servedShares(seg, 0.3);
    expect(JSON.stringify(seg)).toBe(before);
  });

  it('некуда уходить (веса соперников и внешнего варианта - ноль): потерянное остаётся внешнему варианту, без NaN', () => {
    const s = makeState();
    s.models.push(player({ arenaElo: 1e6 }));
    rivalState.list = [rival({ arenaElo: -1e6 })];
    const seg = marketSnapshot(s).segments.developers;
    expect(seg.noneShare).toBe(0);
    const { shares, labShares } = servedShares(seg, 0.25);
    expect(shares['player:p1']).toBeCloseTo(0.25, 12);
    expect(shares.none).toBeCloseTo(0.75, 12);
    expect(labShares.none).toBeCloseTo(0.75, 12);
    for (const v of Object.values(shares)) expect(Number.isFinite(v)).toBe(true);
    expect(sumOf(shares)).toBeCloseTo(1, 12);
  });
});

describe('границы цены', () => {
  // 1 января 2024: P_ref = 3 $/1М
  const DAY_2024 = dateToDay('2024-01-01');
  const shareAt = (price: number): number => {
    const s = makeState(DAY_2024);
    s.models.push(player({ price }));
    rivalState.list = [rival()];
    return entryOf(marketSnapshot(s), 'developers', 'player:p1')!.share;
  };
  const utilityAt = (price: number, seg: SegmentId = 'developers'): number => {
    const s = makeState(DAY_2024);
    s.models.push(player({ price }));
    return marketSnapshot(s).segments[seg].entries[0].utility;
  };

  it('дешевле P_ref/20 доля не растёт: $0,01 даёт столько же, сколько $0,15', () => {
    const floor = shareAt(3 / 20);
    expect(shareAt(0.01)).toBeCloseTo(floor, 12);
    expect(shareAt(0.1)).toBeCloseTo(floor, 12);
    expect(shareAt(0.2)).toBeLessThan(floor);
    expect(floor).toBeLessThan(0.99);
  });

  it('дороже 20·P_ref доля игрока падает круче, и завышение цены уменьшает выручку', () => {
    const cap = shareAt(60);
    expect(shareAt(50)).toBeGreaterThan(cap);
    expect(shareAt(1000)).toBeLessThan(cap);
    expect(shareAt(10_000)).toBeLessThan(shareAt(1000));
    for (const seg of ['developers', 'enterprise'] as const) {
      const revenue = (price: number): number => {
        const s = makeState(DAY_2024);
        s.models.push(player({ price }));
        rivalState.list = [rival()];
        return entryOf(marketSnapshot(s), seg, 'player:p1')!.share * price;
      };
      expect(revenue(1000)).toBeLessThan(revenue(60));
      expect(revenue(10_000)).toBeLessThan(revenue(1000));
    }
  });

  it('цены соперников выше 20·P_ref по-прежнему зажаты', () => {
    const rivalShareAt = (price: number): number => {
      const s = makeState(DAY_2024);
      s.models.push(player());
      rivalState.list = [rival({ priceIn: price, priceOut: price })];
      return marketSnapshot(s).segments.developers.entries.find((e) => e.owner !== 'player')!.share;
    };
    expect(rivalShareAt(1000)).toBeCloseTo(rivalShareAt(60), 12);
  });

  it('полезность: −wPrice·ln(clamp(цена/P_ref, 1/20, 20)); разработчики 1,6, корпоративные 0,6', () => {
    expect(utilityAt(6) - utilityAt(3)).toBeCloseTo(-1.6 * Math.log(2), 9);
    expect(utilityAt(0.01) - utilityAt(3)).toBeCloseTo(1.6 * Math.log(20), 9);
    expect(utilityAt(60) - utilityAt(3)).toBeCloseTo(-1.6 * Math.log(20), 9);
    // Выше границы у игрока ещё −2·ln(цена / 20·P_ref).
    expect(utilityAt(1000) - utilityAt(60)).toBeCloseTo(-2 * Math.log(1000 / 60), 9);
    expect(utilityAt(0) - utilityAt(3)).toBeCloseTo(1.6 * Math.log(20), 9);
    expect(utilityAt(6, 'enterprise') - utilityAt(3, 'enterprise')).toBeCloseTo(-0.6 * Math.log(2), 9);
  });

  it('minPrice = опорная / 100, до тысячных', () => {
    expect(minPrice(dateToDay('2017-01-01'))).toBeCloseTo(1, 9);
    expect(minPrice(dateToDay('2020-01-01'))).toBeCloseTo(0.6, 9);
    expect(minPrice(DAY_2024)).toBeCloseTo(0.03, 9);
    expect(minPrice(dateToDay('2024-12-31'))).toBeCloseTo(0.025, 9);
    for (let d = 0; d <= END_DAY; d += 7) {
      const v = minPrice(d);
      expect(v).toBeGreaterThan(0);
      expect(Math.abs(v - refPrice(d) / 100)).toBeLessThanOrEqual(0.0005 + 1e-12);
    }
  });
});

describe('действия: цена в границах', () => {
  it('выпуск и смена цены ниже minPrice отклоняются с подсказкой', () => {
    const s = makeState(dateToDay('2024-01-01')); // минимальная цена $0,03
    s.models.push(player({ releasedDay: null, onApi: false }));
    expect(releaseModel(s, 'p1', 0.01)).toEqual({ ok: false, error: 'Цена не может быть ниже $0,03 за 1 млн токенов.' });
    expect(s.models[0].releasedDay).toBeNull();
    expect(releaseModel(s, 'p1', 0.03).ok).toBe(true);
    expect(s.models[0].price).toBe(0.03);
    const r = setModelPrice(s, 'p1', 0.029);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Цена не может быть ниже $0,03 за 1 млн токенов.');
    expect(s.models[0].price).toBe(0.03);
    expect(setModelPrice(s, 'p1', 2.5).ok).toBe(true);
    expect(s.models[0].price).toBe(2.5);
  });

  it('в 2017 году минимальная цена $1', () => {
    const s = makeState(dateToDay('2017-01-01'));
    s.models.push(player({ releasedDay: null, onApi: false }));
    expect(releaseModel(s, 'p1', 0.5)).toEqual({ ok: false, error: 'Цена не может быть ниже $1 за 1 млн токенов.' });
    expect(releaseModel(s, 'p1', 1).ok).toBe(true);
  });

  it('выше $10 000 и нечисловая цена отклоняются', () => {
    const s = makeState();
    s.models.push(player());
    expect(setModelPrice(s, 'p1', 10_001)).toEqual({
      ok: false,
      error: 'Цена не может быть выше $10 000 за 1 млн токенов.',
    });
    expect(setModelPrice(s, 'p1', 10_000).ok).toBe(true);
    expect(setModelPrice(s, 'p1', NaN).ok).toBe(false);
    expect(setModelPrice(s, 'p1', Infinity).ok).toBe(false);
    expect(setModelPrice(s, 'p1', -1).ok).toBe(false);
    expect(s.models[0].price).toBe(10_000);
  });
});

describe('контекст на рынке', () => {
  it('обычный контекст растёт по истории', () => {
    expect(refContext(dateToDay('2017-01-01'))).toBeCloseTo(512, 6);
    expect(refContext(dateToDay('2020-06-11'))).toBeCloseTo(2048, 6);
    expect(refContext(dateToDay('2024-06-01'))).toBeCloseTo(128000, 6);
  });

  it('прибавка к полезности: 0 при обычном контексте, ограничена с двух сторон', () => {
    const day = dateToDay('2024-06-01');
    expect(contextUtility(128000, day)).toBeCloseTo(0, 10);
    expect(contextUtility(1_000_000, day)).toBeCloseTo(0.25 * Math.log(1_000_000 / 128000), 10);
    expect(contextUtility(10_000_000, day)).toBeCloseTo(0.25 * Math.log(8), 10);
    expect(contextUtility(512, day)).toBeCloseTo(0.25 * Math.log(1 / 64), 10);
    expect(contextLogRatio(512, day)).toBeCloseTo(Math.log(1 / 64), 10);
    expect(contextLogRatio(0, day)).toBeCloseTo(Math.log(1 / 64), 10);
  });

  it('при прочих равных модель с длинным контекстом получает большую долю', () => {
    const s = makeState(dateToDay('2024-01-01'));
    s.reputation = 50;
    const short = player({ id: 'p1', price: 3, arenaElo: 1150 });
    const long = player({ id: 'p2', price: 3, arenaElo: 1150 });
    short.plan = { ...short.plan, context: 2048 };
    long.plan = { ...long.plan, context: 128000 };
    s.models.push(short, long);
    rivalState.list = [];
    const seg = marketSnapshot(s).segments.developers;
    const a = seg.entries.find((e) => e.key === 'player:p1')!;
    const b = seg.entries.find((e) => e.key === 'player:p2')!;
    expect(b.share).toBeGreaterThan(a.share * 2);
  });

  it('выручка копится в модели', () => {
    const s = makeState(dateToDay('2024-01-01'));
    s.models.push(player({ price: 3, arenaElo: 1150 }));
    s.compute.rented.h100 = 1e9;
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1, subs: 0 };
    rivalState.list = [];
    dayStep(s);
    expect(s.models[0].earned).toBeGreaterThan(0);
  });
});

describe('поправки ходов соперников в снимке', () => {
  it('модификатор rivalPrice снижает цену моделей лаборатории, но не ниже границы; доля растёт', () => {
    const s = makeState();
    rivalState.list = [rival(), rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1' })];
    const before = entryOf(marketSnapshot(s), 'developers', 'rival:r1')!;
    addRivalModifier(s, { id: 'rivalprice-openbrain', kind: 'rivalPrice', target: 'openbrain', mult: 0.5, add: 0.3, untilDay: FOREVER });
    const snap = marketSnapshot(s);
    const r1 = entryOf(snap, 'developers', 'rival:r1')!;
    const r2 = entryOf(snap, 'developers', 'rival:r2')!;
    const floor = Math.max(minPrice(s.day), 0.3 * refPrice(s.day));
    expect(r1.price).toBeCloseTo(Math.max(minPrice(s.day), Math.max(3 * 0.5, Math.min(3, floor))), 9);
    expect(r1.price).toBeLessThan(3);
    expect(r2.price).toBeCloseTo(3, 9); // другая лаборатория
    expect(r1.share).toBeGreaterThan(before.share);
    // Цена подписки от хода не зависит.
    expect(entryOf(snap, 'consumers', 'rival:r1')!.price).toBe(20);
  });

  it('истёкший модификатор rivalPrice не действует', () => {
    const s = makeState();
    rivalState.list = [rival()];
    addRivalModifier(s, { id: 'old', kind: 'rivalPrice', target: 'openbrain', mult: 0.5, add: 0.3, untilDay: s.day - 1 });
    expect(marketSnapshot(s).segments.developers.entries[0].price).toBeCloseTo(3, 9);
  });

  it('поправки eloAdd и context входят в Эло, качество и контекст записи', () => {
    const s = makeState();
    rivalState.list = [rival()];
    s.rivalry.overrides.r1 = { eloAdd: 50, context: 128000 };
    const [e] = marketSnapshot(s).segments.developers.entries;
    expect(e.elo).toBe(1200);
    expect(e.quality).toBeCloseTo(1200, 9);
    expect(e.context).toBe(128000);
    expect(e.utility).toBeGreaterThan(0);
  });

  it('цена ответной модели (overrides.price) падает вместе с рынком от дня выхода (extra)', () => {
    const s = makeState();
    rivalState.list = [rival()];
    s.rivalry.extra.r1 = s.day - 100;
    s.rivalry.overrides.r1 = { price: 1 };
    const [e] = marketSnapshot(s).segments.developers.entries;
    expect(e.price).toBeCloseTo(refPrice(s.day) / refPrice(s.day - 100), 9);
    expect(e.price).toBeLessThan(1);
  });
});

describe('технологии на рынке', () => {
  it('«Смесь экспертов» (снимок модели) и «Квантизация» (сразу) уменьшают мощность на обслуживание', () => {
    const s = makeState();
    rivalState.list = [rival()];
    s.models.push(player({ onSubs: true }));
    const base = inferenceNeed(s, marketSnapshot(s));
    expect(servingMult(s, s.models[0])).toBe(1);
    s.models[0].techs = ['moe'];
    const moe = inferenceNeed(s, marketSnapshot(s));
    expect(moe.api).toBeCloseTo(base.api / MOE_SERVING_MULT, 6);
    expect(moe.subs).toBeCloseTo(base.subs / MOE_SERVING_MULT, 6);
    s.models[0].techs = [];
    s.research.done.push('quant');
    const quant = inferenceNeed(s, marketSnapshot(s));
    expect(quant.api).toBeCloseTo(base.api * QUANT_SERVING_COST, 6);
    s.models[0].techs = ['moe'];
    expect(servingMult(s, s.models[0])).toBeCloseTo(MOE_SERVING_MULT / QUANT_SERVING_COST, 9);
  });

  it('«Мультимодальность» поднимает полезность модели только у обычных пользователей', () => {
    const s = makeState();
    rivalState.list = [rival()];
    s.models.push(player({ onSubs: true }));
    const before = marketSnapshot(s);
    s.models[0].techs = ['multimodal'];
    const after = marketSnapshot(s);
    const u = (snap: MarketSnapshot, seg: SegmentId) => entryOf(snap, seg, 'player:p1')!.utility;
    expect(u(after, 'consumers') - u(before, 'consumers')).toBeCloseTo(MULTIMODAL_CONSUMER_UTILITY, 9);
    expect(u(after, 'enterprise')).toBe(u(before, 'enterprise'));
    expect(u(after, 'developers')).toBe(u(before, 'developers'));
    expect(entryOf(after, 'consumers', 'player:p1')!.share).toBeGreaterThan(entryOf(before, 'consumers', 'player:p1')!.share);
  });
});

describe('инерция доли рынка', () => {
  function twoRivals(): GameState {
    const s = makeState();
    rivalState.list = [rival(), rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1', arenaElo: 1120 })];
    return s;
  }
  const key = 'player:p1';
  const segShare = (s: GameState) => s.market.segments.developers.shares[key] ?? 0;

  it('шаг: за τ дней разрыв закрывается на 63 %, сумма долей остаётся 1', () => {
    let held: Record<string, number> = { none: 0.5, a: 0.5, b: 0 };
    const target = { none: 0.2, a: 0.2, b: 0.6 };
    for (let d = 0; d < SHARE_TAU_DAYS; d++) held = stepHeld(target, held);
    expect(held.b).toBeCloseTo(0.6 * (1 - Math.exp(-1)), 2);
    expect(held.none + held.a + held.b).toBeCloseTo(1, 12);
  });

  it('новая модель игрока набирает долю постепенно, а не в первый день', () => {
    const s = twoRivals();
    for (let i = 0; i < 3; i++) dayStep(s); // рынок без игрока устоялся
    s.models.push(player({ arenaElo: 1300 }));
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1, subs: 0 };
    s.compute.rented.h100 = 1e9; // мощности с запасом: доля не упирается в обслуживание
    const target = marketSnapshot(s, 'target').segments.developers.entries.find((e) => e.key === key)!.share;
    dayStep(s);
    const day1 = segShare(s);
    expect(day1).toBeGreaterThan(0);
    expect(day1).toBeLessThan(target * 0.1);
    for (let d = 1; d < SHARE_TAU_DAYS; d++) dayStep(s);
    expect(segShare(s)).toBeGreaterThan(target * 0.55);
    expect(segShare(s)).toBeLessThan(target * 0.7);
    // Текущий снимок отдаёт удержанную долю, а целевая - отдельно.
    const cur = marketSnapshot(s).segments.developers.entries.find((e) => e.key === key)!;
    expect(cur.share).toBeCloseTo(segShare(s), 6);
    expect(cur.target).toBeCloseTo(target, 6);
  });

  it('подорожание своей модели: доля сразу падает до целевой, и цена ×100 не даёт выручки больше, чем было', () => {
    const s = twoRivals();
    s.models.push(player({ arenaElo: 1300 }));
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1, subs: 0 };
    s.compute.rented.h100 = 1e9;
    for (let d = 0; d < 120; d++) dayStep(s); // доля устоялась
    const before = s.finance.month.income.api;
    dayStep(s);
    const normalDay = s.finance.month.income.api - before;
    s.models[0].price *= 100;
    const mid = s.finance.month.income.api;
    dayStep(s);
    const target = marketSnapshot(s, 'target').segments.developers.entries.find((e) => e.key === key)!.share;
    expect(segShare(s)).toBeCloseTo(target, 6);
    expect(s.finance.month.income.api - mid).toBeLessThan(normalDay);
    expect(s.market.heldPrice?.['api:p1']).toBe(s.models[0].price);
  });

  it('подешевление своей модели: доля растёт постепенно, как раньше', () => {
    const s = twoRivals();
    s.models.push(player({ arenaElo: 1300 }));
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1, subs: 0 };
    s.compute.rented.h100 = 1e9;
    for (let d = 0; d < 120; d++) dayStep(s);
    const was = segShare(s);
    s.models[0].price /= 4;
    dayStep(s);
    const target = marketSnapshot(s, 'target').segments.developers.entries.find((e) => e.key === key)!.share;
    expect(segShare(s)).toBeGreaterThan(was);
    expect(segShare(s)).toBeLessThan(was + (target - was) * 0.1);
  });

  it('соперник подчиняется тому же правилу: новая модель соперника тоже растёт постепенно', () => {
    const s = twoRivals();
    for (let i = 0; i < 3; i++) dayStep(s);
    rivalState.list = [...rivalState.list, rival({ id: 'r3', lab: 'antropik', gameName: 'Клод', arenaElo: 1300 })];
    const target = marketSnapshot(s, 'target').segments.developers.entries.find((e) => e.key === 'rival:r3')!.share;
    dayStep(s);
    expect(s.market.segments.developers.shares['rival:r3']).toBeLessThan(target * 0.1);
  });

  it('модель, снятая с продажи, теряет клиентов сразу', () => {
    const s = twoRivals();
    s.models.push(player());
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1, subs: 0 };
    s.compute.rented.h100 = 1e9;
    for (let i = 0; i < 10; i++) dayStep(s);
    expect(segShare(s)).toBeGreaterThan(0);
    s.models[0].onApi = false;
    dayStep(s);
    expect(segShare(s)).toBe(0);
    expect(Object.values(s.market.held!.developers).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('старое сохранение без инерции: первый день берёт целевые доли, дальше инерция работает', () => {
    const s = twoRivals();
    s.models.push(player());
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1, subs: 0 };
    s.compute.rented.h100 = 1e9;
    dayStep(s);
    const o = JSON.parse(serialize(s)) as { market: Record<string, unknown> };
    delete o.market.held;
    const r = deserialize(JSON.stringify(o));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const old = r.state;
    expect(old.market.held).toBeUndefined();
    const target = marketSnapshot(old, 'target').segments.developers.entries.find((e) => e.key === key)!.share;
    expect(marketSnapshot(old).segments.developers.entries.find((e) => e.key === key)!.share).toBeCloseTo(target, 12);
    dayStep(old);
    expect(old.market.held).toBeDefined();
  });
});
