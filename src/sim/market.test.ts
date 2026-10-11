import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HYPE_OWNERS } from './constants';
import { addModifier, FOREVER } from './events';
import {
  contextUtility,
  demandTokens,
  dayStep,
  hypeK,
  inferenceNeed,
  labBrand,
  marketSnapshot,
  perceivedQuality,
  refContext,
  refPrice,
  refQuality,
} from './market';
import { createInitialState } from './state';
import { END_DAY, dateToDay } from './time';
import type { GameState, PlayerModel, RivalModelDef } from './types';

// Соперники и мощность подменяем: нужны только список моделей на рынке и доля «Клиенты».
const rivalState = vi.hoisted(() => ({ list: [] as RivalModelDef[] }));

// Подменяем только нужные функции, остальное берём настоящее: когда соседние модули будут готовы, тест не сломается.
vi.mock('./rivals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rivals')>()),
  marketRivals: () => rivalState.list,
  rivalPrice: (def: RivalModelDef) => ((def.priceIn ?? 0) * 3 + (def.priceOut ?? 0)) / 4,
}));

vi.mock('./compute', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./compute')>()),
  pool: (s: GameState, kind: keyof GameState['compute']['alloc']) => s.compute.rented.h100 * s.compute.alloc[kind],
}));

const MID_2024 = dateToDay('2024-06-01');
const BEFORE_ARENA = dateToDay('2023-01-01');

function makeState(day = MID_2024): GameState {
  const s = createInitialState('Тест', 1);
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
    ...over,
  };
}

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
    paramsB: 100,
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

/** Выдать игроку ровно столько мощности под инференс, сколько нужно × k. */
function giveInference(s: GameState, k: number): number {
  const need = inferenceNeed(s, marketSnapshot(s));
  s.compute.alloc = { training: 0, contracts: 0, experiments: 0, inference: 1 };
  s.compute.rented.h100 = need * k;
  return need;
}

beforeEach(() => {
  rivalState.list = [];
});

describe('кривые спроса, цены и качества', () => {
  it('спрос проходит через опорные точки', () => {
    const anchors: [string, number][] = [
      ['2017-01-01', 5e7],
      ['2019-01-01', 2e8],
      ['2020-06-11', 2e9],
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
    expect(mid / Math.sqrt(5e7 * 2e8)).toBeCloseTo(1, 6);
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

  it('модификатор demand умножает спрос', () => {
    const s = makeState();
    const base = demandTokens(s);
    addModifier(s, { id: 'boom', kind: 'demand', mult: 2, untilDay: FOREVER });
    expect(demandTokens(s) / base).toBeCloseTo(2, 9);
  });

  it('истёкший модификатор demand не действует', () => {
    const s = makeState();
    const base = demandTokens(s);
    addModifier(s, { id: 'old', kind: 'demand', mult: 3, untilDay: s.day - 1 });
    expect(demandTokens(s)).toBe(base);
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

    // качество: 01.01.2020 - 950, 01.01.2023 - 1050
    const q0 = dateToDay('2020-01-01');
    const q1 = dateToDay('2023-01-01');
    const qDay = Math.round((q0 + q1) / 2);
    const qt = (qDay - q0) / (q1 - q0);
    expect(refQuality(qDay)).toBeCloseTo(950 + 100 * qt, 9);
  });

  it('опорное качество: точки и рост', () => {
    const anchors: [string, number][] = [
      ['2017-01-01', 900],
      ['2020-01-01', 950],
      ['2023-01-01', 1050],
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
});

describe('бренд и воспринимаемое качество', () => {
  it('бренд игрока зависит от репутации', () => {
    const s = makeState();
    s.reputation = 50;
    expect(labBrand(s, 'player')).toBeCloseTo(0, 9);
    s.reputation = 100;
    expect(labBrand(s, 'player')).toBeCloseTo(0.6, 9);
    s.reputation = 20;
    expect(labBrand(s, 'player')).toBeCloseTo(-0.36, 9);
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

  it('бренд игрока не выходит за ±0,6, даже если репутация вне 0..100', () => {
    const s = makeState();
    s.reputation = 150;
    expect(labBrand(s, 'player')).toBeCloseTo(0.6, 9);
    s.reputation = -30;
    expect(labBrand(s, 'player')).toBeCloseTo(-0.6, 9);
  });

  it('истёкший модификатор бренда не действует', () => {
    const s = makeState();
    addModifier(s, { id: 'old', kind: 'labBrand', target: 'openbrain', add: 0.5, untilDay: s.day - 1 });
    expect(labBrand(s, 'openbrain')).toBeCloseTo(0.5, 9);
  });

  it('k шумихи: 3 до «Арены», 1,5 после', () => {
    expect(hypeK(dateToDay('2023-05-02'))).toBe(3);
    expect(hypeK(dateToDay('2023-05-03'))).toBe(1.5);
    const s = makeState(BEFORE_ARENA);
    s.hype.player = 10;
    expect(perceivedQuality(s, 'player', 1000)).toBeCloseTo(1030, 9);
    s.day = MID_2024;
    expect(perceivedQuality(s, 'player', 1000)).toBeCloseTo(1015, 9);
  });
});

describe('marketSnapshot', () => {
  it('пустой рынок: всё уходит внешнему варианту, без NaN', () => {
    const s = makeState();
    const snap = marketSnapshot(s);
    expect(snap.entries).toEqual([]);
    expect(snap.noneShare).toBe(1);
    expect(Number.isFinite(snap.totalTokens)).toBe(true);
    expect(snap.totalTokens).toBeCloseTo(demandTokens(s), 3);
  });

  it('доли моделей и внешнего варианта дают 1', () => {
    const s = makeState();
    s.models.push(player(), player({ id: 'p2', name: 'Мой-2', price: 5, arenaElo: 1100 }));
    rivalState.list = [
      rival(),
      rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1', arenaElo: 1200, priceIn: 2, priceOut: 2 }),
      rival({ id: 'r3', lab: 'deepcent', gameName: 'ГС-3', arenaElo: 1180, priceIn: 0.5, priceOut: 0.5 }),
    ];
    const snap = marketSnapshot(s);
    const sum = snap.entries.reduce((a, e) => a + e.share, 0) + snap.noneShare;
    expect(sum).toBeCloseTo(1, 12);
    const tokens = snap.entries.reduce((a, e) => a + e.tokens, 0);
    expect(tokens).toBeCloseTo((1 - snap.noneShare) * snap.totalTokens, 0);
    for (const e of snap.entries) {
      expect(e.share).toBeGreaterThan(0);
      expect(Number.isFinite(e.utility)).toBe(true);
    }
  });

  it('записи идут по убыванию доли', () => {
    const s = makeState();
    s.models.push(player());
    rivalState.list = [
      rival({ id: 'r2', arenaElo: 1300 }),
      rival({ id: 'r3', arenaElo: 1000 }),
    ];
    const shares = marketSnapshot(s).entries.map((e) => e.share);
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeLessThanOrEqual(shares[i - 1]);
  });

  it('в рынок попадают только выпущенные модели игрока на API', () => {
    const s = makeState();
    s.models.push(
      player({ id: 'p1' }),
      player({ id: 'p2', releasedDay: null }),
      player({ id: 'p3', onApi: false }),
    );
    const snap = marketSnapshot(s);
    expect(snap.entries.map((e) => e.key)).toEqual(['player:p1']);
  });

  it('запись соперника: ключ, лаборатория, название, цена', () => {
    const s = makeState();
    rivalState.list = [rival({ id: 'gtp-4', lab: 'openbrain', gameName: 'GTP-4', priceIn: 10, priceOut: 30 })];
    const [e] = marketSnapshot(s).entries;
    expect(e.key).toBe('rival:gtp-4');
    expect(e.ref).toEqual({ kind: 'rival', id: 'gtp-4' });
    expect(e.owner).toBe('openbrain');
    expect(e.name).toBe('GTP-4');
    expect(e.price).toBeCloseTo(15, 9);
  });

  it('цена выше - доля ниже', () => {
    const shareAt = (price: number): number => {
      const s = makeState();
      s.models.push(player({ price }));
      rivalState.list = [rival()];
      return marketSnapshot(s).entries.find((e) => e.owner === 'player')!.share;
    };
    const cheap = shareAt(1);
    const mid = shareAt(3);
    const dear = shareAt(10);
    expect(cheap).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(dear);
  });

  it('Эло выше - доля выше', () => {
    const shareAt = (elo: number): number => {
      const s = makeState();
      s.models.push(player({ arenaElo: elo }));
      rivalState.list = [rival()];
      return marketSnapshot(s).entries.find((e) => e.owner === 'player')!.share;
    };
    expect(shareAt(1250)).toBeGreaterThan(shareAt(1150));
    expect(shareAt(1150)).toBeGreaterThan(shareAt(1050));
  });

  it('шумиха поднимает долю и воспринимаемое качество', () => {
    const run = (hype: number) => {
      const s = makeState();
      s.hype.player = hype;
      s.models.push(player());
      rivalState.list = [rival()];
      return marketSnapshot(s).entries.find((e) => e.owner === 'player')!;
    };
    const cold = run(0);
    const hot = run(60);
    expect(hot.share).toBeGreaterThan(cold.share);
    expect(cold.quality).toBeCloseTo(1150, 9);
    expect(hot.quality).toBeCloseTo(1150 + 1.5 * 60, 9);
  });

  it('до «Арены» шумиха весит вдвое сильнее', () => {
    const s = makeState(BEFORE_ARENA);
    s.hype.player = 20;
    s.models.push(player());
    const [e] = marketSnapshot(s).entries;
    expect(e.quality).toBeCloseTo(1150 + 3 * 20, 9);
  });

  it('шумиха соперника отбирает долю у игрока', () => {
    const run = (rivalHype: number): number => {
      const s = makeState();
      s.hype.openbrain = rivalHype;
      s.models.push(player());
      rivalState.list = [rival()];
      return marketSnapshot(s).entries.find((e) => e.owner === 'player')!.share;
    };
    expect(run(80)).toBeLessThan(run(0));
  });

  it('бренд известной лаборатории даёт преимущество при равных моделях', () => {
    const s = makeState();
    rivalState.list = [
      rival({ id: 'a', lab: 'openbrain' }),
      rival({ id: 'b', lab: 'zhipo' }),
    ];
    const snap = marketSnapshot(s);
    const a = snap.entries.find((e) => e.key === 'rival:a')!;
    const b = snap.entries.find((e) => e.key === 'rival:b')!;
    expect(a.share).toBeGreaterThan(b.share);
  });

  it('слабые модели оставляют большую часть спроса внешнему варианту', () => {
    const s = makeState();
    s.models.push(player({ arenaElo: 700 }));
    const snap = marketSnapshot(s);
    expect(snap.noneShare).toBeGreaterThan(0.9);
  });

  it('устойчив к огромной разнице качества и нулевой цене', () => {
    const s = makeState();
    s.models.push(player({ arenaElo: 1e6, price: 0 }));
    rivalState.list = [rival({ arenaElo: -1e6 })];
    const snap = marketSnapshot(s);
    const sum = snap.entries.reduce((a, e) => a + e.share, 0) + snap.noneShare;
    expect(sum).toBeCloseTo(1, 12);
    for (const e of snap.entries) expect(Number.isFinite(e.share)).toBe(true);
    expect(Number.isFinite(snap.noneShare)).toBe(true);
    expect(snap.entries[0].owner).toBe('player');
  });

  it('формула: U = (Q−1000)/100 + бренд − 1,2·ln(цена/P_ref) + 0,25·ln(контекст/обычный), доля - softmax', () => {
    // 1 января 2024: P_ref = 3 $/1М, Q_ref = 1150, значит U_0 = 1,5
    const s = makeState(dateToDay('2024-01-01'));
    const ref = refContext(s.day);
    s.reputation = 50; // бренд игрока 0
    s.hype.openbrain = 10;
    s.hype.player = 20;
    const pl = player({ price: 3, arenaElo: 1150 });
    pl.plan.context = 8192;
    s.models.push(pl);
    rivalState.list = [rival({ priceIn: 6, priceOut: 6, arenaElo: 1250, context: 128000 })]; // openbrain, бренд 0,5
    const snap = marketSnapshot(s);

    const uNone = (1150 - 1000) / 100;
    const uPlayer = (1150 + 1.5 * 20 - 1000) / 100 + 0 - 1.2 * Math.log(3 / 3) + 0.25 * Math.log(8192 / ref);
    const uRival = (1250 + 1.5 * 10 - 1000) / 100 + 0.5 - 1.2 * Math.log(6 / 3) + 0.25 * Math.log(128000 / ref);
    const sum = Math.exp(uNone) + Math.exp(uPlayer) + Math.exp(uRival);

    const p = snap.entries.find((e) => e.owner === 'player')!;
    const r = snap.entries.find((e) => e.owner === 'openbrain')!;
    expect(p.quality).toBeCloseTo(1180, 9);
    expect(r.quality).toBeCloseTo(1265, 9);
    expect(p.utility).toBeCloseTo(uPlayer, 9);
    expect(r.utility).toBeCloseTo(uRival, 9);
    expect(p.share).toBeCloseTo(Math.exp(uPlayer) / sum, 9);
    expect(r.share).toBeCloseTo(Math.exp(uRival) / sum, 9);
    expect(snap.noneShare).toBeCloseTo(Math.exp(uNone) / sum, 9);
    expect(p.tokens).toBeCloseTo((Math.exp(uPlayer) / sum) * snap.totalTokens, -2);
    // спрос между 01.06.2023 (3e11) и 31.12.2024 (3e12) растёт ровно в логарифме: 3e11 × 10^t
    const t = (s.day - dateToDay('2023-06-01')) / (dateToDay('2024-12-31') - dateToDay('2023-06-01'));
    expect(snap.totalTokens / (3e11 * 10 ** t)).toBeCloseTo(1, 9);
  });

  it('бренд игрока из репутации входит в полезность', () => {
    const utilityAt = (rep: number): number => {
      const s = makeState();
      s.reputation = rep;
      s.models.push(player());
      return marketSnapshot(s).entries[0].utility;
    };
    expect(utilityAt(100) - utilityAt(50)).toBeCloseTo(0.6, 9);
    expect(utilityAt(50) - utilityAt(0)).toBeCloseTo(0.6, 9);
  });

  it('шумиха весит вдвое сильнее до открытия «Арены» (по полезности)', () => {
    const gain = (day: number): number => {
      const utility = (hype: number): number => {
        const s = makeState(day);
        s.hype.player = hype;
        s.models.push(player());
        return marketSnapshot(s).entries[0].utility;
      };
      return utility(30) - utility(0);
    };
    expect(gain(dateToDay('2023-05-02'))).toBeCloseTo((3 * 30) / 100, 9);
    expect(gain(dateToDay('2023-05-03'))).toBeCloseTo((1.5 * 30) / 100, 9);
  });

  it('модификатор бренда сдвигает долю лаборатории', () => {
    const shareOf = (add: number): number => {
      const s = makeState();
      if (add !== 0) addModifier(s, { id: 'b', kind: 'labBrand', target: 'openbrain', add, untilDay: FOREVER });
      rivalState.list = [rival()];
      return marketSnapshot(s).entries[0].share;
    };
    expect(shareOf(0.5)).toBeGreaterThan(shareOf(0));
    expect(shareOf(-0.5)).toBeLessThan(shareOf(0));
  });

  it('не меняет состояние', () => {
    const s = makeState();
    s.models.push(player());
    rivalState.list = [rival()];
    const before = JSON.stringify(s);
    marketSnapshot(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('inferenceNeed', () => {
  it('считает H100e по токенам и размеру модели игрока', () => {
    const s = makeState();
    s.models.push(player({ plan: { ...player().plan, paramsB: 70 } }));
    rivalState.list = [rival()];
    const snap = marketSnapshot(s);
    const e = snap.entries.find((x) => x.owner === 'player')!;
    const expected = (e.tokens * 2 * 70e9) / (989e12 * 0.15 * 86400);
    expect(inferenceNeed(s, snap)).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(0);
  });

  it('суммирует по всем моделям игрока, у каждой свой размер', () => {
    const s = makeState();
    s.models.push(
      player({ id: 'p1', plan: { ...player().plan, paramsB: 7 } }),
      player({ id: 'p2', arenaElo: 1100, plan: { ...player().plan, paramsB: 175 } }),
    );
    rivalState.list = [rival()];
    const snap = marketSnapshot(s);
    const t1 = snap.entries.find((x) => x.key === 'player:p1')!.tokens;
    const t2 = snap.entries.find((x) => x.key === 'player:p2')!.tokens;
    const expected = (t1 * 2 * 7e9 + t2 * 2 * 175e9) / (989e12 * 0.15 * 86400);
    expect(inferenceNeed(s, snap)).toBeCloseTo(expected, 6);
    // больше модель при тех же токенах - больше мощности
    expect(inferenceNeed(s, snap)).toBeGreaterThan((t1 * 2 * 7e9 + t2 * 2 * 7e9) / (989e12 * 0.15 * 86400));
  });

  it('модели соперников не требуют мощности игрока; пустой рынок - ноль', () => {
    const s = makeState();
    rivalState.list = [rival()];
    expect(inferenceNeed(s, marketSnapshot(s))).toBe(0);
    rivalState.list = [];
    expect(inferenceNeed(s, marketSnapshot(s))).toBe(0);
  });
});

describe('dayStep', () => {
  function withPlayer(): GameState {
    const s = makeState();
    s.models.push(player());
    rivalState.list = [rival(), rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1', arenaElo: 1120 })];
    return s;
  }

  it('при хватке мощности обслуживает весь спрос и платит по цене', () => {
    const s = withPlayer();
    s.hype.player = 40;
    giveInference(s, 2);
    const snap = marketSnapshot(s);
    const e = snap.entries.find((x) => x.owner === 'player')!;
    const cash0 = s.cash;
    dayStep(s);
    const expected = (e.tokens * e.price) / 1e6;
    expect(expected).toBeGreaterThan(0);
    expect(s.cash - cash0).toBeCloseTo(expected, 6);
    expect(s.finance.month.income.api).toBeCloseTo(expected, 6);
    expect(s.market.playerTokens).toBeCloseTo(e.tokens, 0);
    expect(s.market.lostFraction).toBe(0);
    expect(s.market.totalTokens).toBeCloseTo(snap.totalTokens, 0);
    expect(s.hype.player).toBe(40);
  });

  it('нехватка мощности режет выручку пропорционально и роняет шумиху', () => {
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
    expect(half.market.playerTokens / full.market.playerTokens).toBeCloseTo(0.5, 9);
    expect(half.hype.player).toBeCloseTo(40 - 0.3 * 0.5, 9);
    // доли - это спрос, они от мощности не зависят
    expect(half.market.shares['player:p1']).toBeCloseTo(full.market.shares['player:p1'], 12);
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
    const fullTokens = snap.entries.filter((e) => e.owner === 'player').reduce((a, e) => a + e.tokens, 0);
    const fullRevenue = snap.entries.filter((e) => e.owner === 'player').reduce((a, e) => a + (e.tokens * e.price) / 1e6, 0);
    expect(s.market.lostFraction).toBeCloseTo(1 - f, 9);
    expect(s.market.playerTokens / fullTokens).toBeCloseTo(f, 9);
    // выручка считается по цене каждой модели, а не по средней
    expect(s.cash - cash0).toBeCloseTo(f * fullRevenue, 6);
    expect(s.hype.player).toBeCloseTo(10 - 0.3 * (1 - f), 9);
  });

  it('без мощности под инференс: выручки нет, спрос потерян целиком, шумиха не уходит в минус', () => {
    const s = withPlayer();
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, inference: 0 };
    s.compute.rented.h100 = 100;
    s.hype.player = 0.1;
    const cash0 = s.cash;
    dayStep(s);
    expect(s.cash).toBe(cash0);
    expect(s.market.lostFraction).toBeCloseTo(1, 12);
    expect(s.market.playerTokens).toBe(0);
    expect(s.hype.player).toBe(0);
  });

  it('шумиха падает на 0,3 × потерянная доля в день', () => {
    const s = withPlayer();
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, inference: 0 };
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
    expect(s.hype.player).toBe(30);
  });

  it('пишет доли по моделям и лабораториям, в сумме 1', () => {
    const s = withPlayer();
    giveInference(s, 2);
    dayStep(s);
    const m = s.market;
    expect(Object.keys(m.shares).sort()).toEqual(['none', 'player:p1', 'rival:r1', 'rival:r2']);
    const sumShares = Object.values(m.shares).reduce((a, b) => a + b, 0);
    expect(sumShares).toBeCloseTo(1, 12);
    const sumLabs = Object.values(m.labShares).reduce((a, b) => a + b, 0);
    expect(sumLabs).toBeCloseTo(1, 12);
    expect(m.labShares.none).toBeCloseTo(m.shares.none, 12);
    expect(m.labShares.player).toBeCloseTo(m.shares['player:p1'], 12);
    expect(m.labShares.openbrain).toBeCloseTo(m.shares['rival:r1'], 12);
    expect(m.labShares.gogle).toBeCloseTo(m.shares['rival:r2'], 12);
    // лаборатории без моделей на рынке - ноль, но ключ есть
    for (const o of HYPE_OWNERS) expect(m.labShares[o]).toBeGreaterThanOrEqual(0);
    expect(m.labShares.zhipo).toBe(0);
    expect(m.labShares.deepcent).toBe(0);
  });

  it('доли лаборатории суммируются по её моделям', () => {
    const s = makeState();
    rivalState.list = [
      rival({ id: 'a', lab: 'openbrain' }),
      rival({ id: 'b', lab: 'openbrain', arenaElo: 1100 }),
    ];
    dayStep(s);
    expect(s.market.labShares.openbrain).toBeCloseTo(s.market.shares['rival:a'] + s.market.shares['rival:b'], 12);
  });

  it('пустой рынок: ни NaN, ни выручки', () => {
    const s = makeState();
    const cash0 = s.cash;
    dayStep(s);
    expect(s.cash).toBe(cash0);
    expect(s.market.shares).toEqual({ none: 1 });
    expect(s.market.labShares.none).toBe(1);
    for (const o of HYPE_OWNERS) expect(s.market.labShares[o]).toBe(0);
    expect(s.market.playerTokens).toBe(0);
    expect(s.market.lostFraction).toBe(0);
    expect(Number.isFinite(s.market.totalTokens)).toBe(true);
    expect(s.hype.player).toBe(0);
  });

  it('детерминирован: два прогона с одинаковым состоянием дают одно и то же', () => {
    const a = withPlayer();
    giveInference(a, 0.7);
    const b = withPlayer();
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
    expect(s.market.shares).toEqual(first.shares);
    expect(s.market.labShares).toEqual(first.labShares);

    // модель сняли с API, а соперник пропал с рынка - в записи их больше нет
    s.models[0].onApi = false;
    rivalState.list = [rival({ id: 'r2', lab: 'gogle', gameName: 'Гем-1' })];
    dayStep(s);
    expect(Object.keys(s.market.shares).sort()).toEqual(['none', 'rival:r2']);
    expect(s.market.labShares.player).toBe(0);
    expect(s.market.labShares.openbrain).toBe(0);
    expect(s.market.playerTokens).toBe(0);
    expect(s.market.lostFraction).toBe(0);
    expect(Object.values(s.market.labShares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
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
    const snap = marketSnapshot(s);
    const a = snap.entries.find((e) => e.key === 'player:p1')!;
    const b = snap.entries.find((e) => e.key === 'player:p2')!;
    expect(b.share).toBeGreaterThan(a.share * 2);
  });

  it('выручка копится в модели', () => {
    const s = makeState(dateToDay('2024-01-01'));
    s.models.push(player({ price: 3, arenaElo: 1150 }));
    s.compute.rented.h100 = 1e9;
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, inference: 1 };
    rivalState.list = [];
    dayStep(s);
    expect(s.models[0].earned).toBeGreaterThan(0);
  });
});
