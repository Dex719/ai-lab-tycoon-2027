import { describe, expect, it } from 'vitest';
import { LAB_PERSONALITIES, personalityOf } from '../data/labPersonalities';
import { RIVAL_MODELS } from '../data/rivalModels';
import { reactiveNameProblems, RIVAL_REACTIVE } from '../data/rivalReactive';
import { addMail, modValue } from './events';
import { minPrice, refPrice } from './market';
import { rivalDay, rivalDef, rivalPrice, rivalTier } from './rivals';
import {
  applyDifficultyModifiers,
  availableMoves,
  computeLever,
  DIFFICULTY,
  DIFFICULTY_IDS,
  emptyRivalry,
  executeMove,
  exposureMultIn,
  labBestEloIn,
  labStance,
  lastMove,
  MOVE_IDS,
  playerDominates,
  reactiveDefs,
  rivalContextIn,
  rivalDayIn,
  rivalEloIn,
  rivalPriceIn,
  rivalryDay,
  RIVALRY_EVENTS,
  rivalryMonth,
  STORY_LOCKED,
  threatOf,
  triggerHolds,
} from './rivalry';
import type { Difficulty, HistoryRow, MoveId, PendingMove, RivalryGame } from './rivalry';
import { createInitialState } from './state';
import { dateToDay, END_DAY, isMonthStart, yearOf } from './time';
import { LAB_IDS, SEGMENT_IDS } from './types';
import type { BenchmarkId, HypeOwner, LabId, Mail, PlayerModel, SegmentId } from './types';

// ---------- Помощники: состояния собираются вручную, без тика ----------

/** Модели каталога с датой ≤ сегодня считаются вышедшими (без писем и шумихи). */
function releaseCatalog(s: RivalryGame): void {
  const done = new Set(s.rivalsReleased);
  for (const def of RIVAL_MODELS) {
    if (!done.has(def.id) && rivalDay(def) <= s.day) s.rivalsReleased.push(def.id);
  }
}

function game(date: string, difficulty: Difficulty = 'normal', seed = 1): RivalryGame {
  const s = createInitialState('Тест', seed) as RivalryGame;
  s.difficulty = difficulty;
  s.rivalry = emptyRivalry();
  s.day = dateToDay(date);
  releaseCatalog(s);
  return s;
}

function addModel(
  s: RivalryGame,
  o: { elo: number; price: number; context?: number; onApi?: boolean; overfit?: Partial<Record<BenchmarkId, number>> },
): PlayerModel {
  const id = `p${s.nextModelNum++}`;
  const m: PlayerModel = {
    id,
    name: `Модель ${id}`,
    plan: {
      name: `Модель ${id}`,
      paramsB: 10,
      tokensB: 200,
      mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: o.overfit ? 0.2 : 0,
      benchTargets: o.overfit ? (Object.keys(o.overfit) as BenchmarkId[]) : [],
      rlhf: true,
      context: o.context ?? 8192, tier: 'light',
    },
    arch: 'transformer',
    algoLevel: 3,
    trainedDay: s.day - 10,
    releasedDay: s.day - 5,
    caps: { language: 70, code: 70, reasoning: 70 },
    overfit: o.overfit ?? {},
    rlhf: true,
    arenaElo: o.elo,
    price: o.price,
    onApi: o.onApi ?? true,
    exposed: false,
    earned: 0, onSubs: false, subsPrice: 20, review: 'none', reviewEndDay: null, earnedSubs: 0,
  };
  s.models.push(m);
  return m;
}

/** Доли лабораторий: общие и, если не задано иначе, те же в каждом сегменте (segShare читает s.market.segments). */
function setShares(s: RivalryGame, player: number, labs: Partial<Record<LabId, number>> = {}, segments = true): void {
  const shares = { player, none: 0 } as Record<HypeOwner | 'none', number>;
  let sum = player;
  for (const lab of LAB_IDS) {
    const v = labs[lab] ?? 0.08;
    shares[lab] = v;
    sum += v;
  }
  shares.none = Math.max(0, 1 - sum);
  s.market.labShares = shares;
  if (segments) for (const seg of SEGMENT_IDS) s.market.segments[seg].labShares = { ...shares };
}

/** Доля игрока в одном сегменте (остальные сегменты не трогаются). */
function setSegShare(s: RivalryGame, seg: SegmentId, player: number): void {
  s.market.segments[seg].labShares = { ...s.market.segments[seg].labShares, player, none: Math.max(0, 1 - player) };
}

function pend(lab: LabId, move: MoveId, modelId?: string): PendingMove {
  return { id: `${lab}:${move}:0`, lab, move, fireDay: 0, modelId };
}

/** Игрок отвечает на все письма с выбором первым вариантом (без эффекта: события регистрируются при интеграции). */
function answerChoices(s: RivalryGame): void {
  for (const m of s.mail) if (m.choices && m.chosen === undefined) m.chosen = 0;
}

function maxRivalElo(s: RivalryGame): number {
  return LAB_IDS.reduce((best, lab) => Math.max(best, labBestEloIn(s, lab)), 0);
}

function priceModifiers(s: RivalryGame, lab: LabId) {
  return s.modifiers.filter((m) => m.id === `rivalprice-${lab}`);
}

function applyChoiceOf(s: RivalryGame, eventId: string, idx: number): void {
  const def = RIVALRY_EVENTS.find((e) => e.id === eventId);
  if (!def?.choices) throw new Error(`Нет события ${eventId}`);
  def.choices[idx].apply(s);
}

// Длинные тире (U+2013, U+2014) в текстах для игрока запрещены; сами символы собраны из кодов, чтобы не попасть в исходник.
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

interface Run {
  s: RivalryGame;
  moves: HistoryRow[];
}

/**
 * Долгий прогон без тика: каждый день - выходы каталога, rivalryDay, ответы на письма; в конце месяца игрок
 * остаётся сильным (Эло выше всех на 15, цена 0,6 опорной) и вызывается rivalryMonth. Модификаторы истекают как в тике.
 */
function simulate(difficulty: Difficulty, seed: number, until = END_DAY, from = '2020-12-31'): Run {
  const s = game(from, difficulty, seed);
  const m = addModel(s, { elo: 1000, price: 10, context: 32768 });
  setShares(s, 0.35);
  return continueRun(s, m.id, until);
}

function continueRun(s: RivalryGame, modelId: string, until: number): Run {
  const m = s.models.find((x) => x.id === modelId) as PlayerModel;
  const seen = new Map<string, HistoryRow>();
  const cap = DIFFICULTY[s.difficulty].cap;
  const note = (): void => {
    for (const h of s.rivalry.history) seen.set(`${h.day}:${h.lab}:${h.move}`, h);
  };
  note();
  for (let d = s.day + 1; d <= until; d++) {
    s.day = d;
    releaseCatalog(s);
    rivalryDay(s);
    answerChoices(s);
    note();
    if (isMonthStart(d + 1)) {
      m.arenaElo = maxRivalElo(s) + 15;
      m.price = 0.6 * refPrice(d);
      rivalryMonth(s);
      expect(s.rivalry.pending.length + s.rivalry.active.length).toBeLessThanOrEqual(cap);
      s.modifiers = s.modifiers.filter((x) => x.untilDay >= d);
    }
  }
  const moves = [...seen.values()].sort((a, b) => a.day - b.day || a.lab.localeCompare(b.lab));
  return { s, moves };
}

function perYear(moves: HistoryRow[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const h of moves) out[yearOf(h.day)] = (out[yearOf(h.day)] ?? 0) + 1;
  return out;
}

// ---------- Данные ----------

describe('характеры лабораторий', () => {
  it('у каждой лаборатории ровно один характер с названием и подсказкой', () => {
    expect(LAB_PERSONALITIES).toHaveLength(LAB_IDS.length);
    for (const lab of LAB_IDS) {
      const p = personalityOf(lab);
      expect(p.lab).toBe(lab);
      expect(p.archetype.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(LONG_DASH.test(p.description), lab).toBe(false);
      expect(p.gain).toBeGreaterThan(0);
    }
  });

  it('запрещённые ходы не имеют веса, остальные веса положительны', () => {
    for (const p of LAB_PERSONALITIES) {
      for (const move of p.never) expect(p.weights[move], `${p.lab}:${move}`).toBeUndefined();
      for (const [move, w] of Object.entries(p.weights)) {
        expect(MOVE_IDS.includes(move as MoveId), `${p.lab}:${move}`).toBe(true);
        expect(w, `${p.lab}:${move}`).toBeGreaterThan(0);
      }
    }
    expect(personalityOf('antropik').weights.priceCut).toBeUndefined();
    expect(personalityOf('deepcent').weights.cheapShock).toBe(3);
    expect(personalityOf('gogle').delayMult).toBe(1.5);
    expect(personalityOf('zhipo').gates.minPlayerShare).toBe(0.1);
    expect(personalityOf('deepcent').gates.activeFrom).toBe('2023-11-02');
  });

  it('списки лабораторий по ходам из таблицы ходов: ценовая война, бесплатный чат, проверка, переманивание', () => {
    const labsWith = (move: MoveId): LabId[] => LAB_PERSONALITIES.filter((p) => (p.weights[move] ?? 0) > 0).map((p) => p.lab);
    expect(labsWith('priceWar').sort()).toEqual(['alibabo', 'deepcent', 'gogle', 'zhipo']);
    expect(labsWith('freeTier').sort()).toEqual(['gogle', 'moonshoot', 'openbrain', 'zhipo']);
    expect(labsWith('audit').sort()).toEqual(['antropik', 'gogle']);
    expect(labsWith('poach').sort()).toEqual(['antropik', 'gogle', 'openbrain']);
    expect(labsWith('context').sort()).toEqual(['antropik', 'gogle', 'moonshoot']);
    expect(labsWith('openWeights').sort()).toEqual(['alibabo', 'deepcent', 'zhipo']);
    for (const lab of ['antropik', 'moonshoot'] as LabId[]) {
      for (const move of ['priceCut', 'priceWar', 'cheapShock'] as MoveId[]) expect(personalityOf(lab).never, `${lab}:${move}`).toContain(move);
    }
  });

  it('OpenBrain снижает цены только с ноября 2023 года и только если её доля упала на 5 п.п. от максимума', () => {
    const early = game('2023-09-30');
    addModel(early, { elo: 1300, price: 1 });
    setShares(early, 0.4, { openbrain: 0.2 });
    early.rivalry.shareHigh.openbrain = 0.3;
    expect(triggerHolds(early, 'openbrain', 'priceCut')).toBe(true); // условие хода выполнено, но дата не наступила
    expect(availableMoves(early, 'openbrain')).not.toContain('priceCut');

    const late = game('2024-03-31');
    addModel(late, { elo: 1300, price: 1 });
    setShares(late, 0.4, { openbrain: 0.2 });
    late.rivalry.shareHigh.openbrain = 0.22; // упала на 2 п.п.: мало
    expect(availableMoves(late, 'openbrain')).not.toContain('priceCut');
    late.rivalry.shareHigh.openbrain = 0.3; // упала на 10 п.п.
    expect(availableMoves(late, 'openbrain')).toContain('priceCut');
    expect(availableMoves(late, 'antropik')).not.toContain('priceCut');
  });
});

describe('шаблоны ответных моделей', () => {
  it('id вида mv-<lab>-<n>, названия и id не совпадают с каталогом, базовые модели существуют', () => {
    expect(reactiveNameProblems()).toEqual([]);
    expect(reactiveDefs().size).toBe(RIVAL_REACTIVE.length);
    for (const t of RIVAL_REACTIVE) {
      const def = reactiveDefs().get(t.id);
      expect(def?.lab).toBe(t.lab);
      expect(def?.api).toBe(!t.openWeights);
    }
  });

  it('у каждой лаборатории, которая делает дешёвый шок или открывает веса, есть подходящий шаблон', () => {
    for (const p of LAB_PERSONALITIES) {
      if (p.weights.cheapShock) expect(RIVAL_REACTIVE.some((t) => t.lab === p.lab && !t.openWeights && t.context === undefined), p.lab).toBe(true);
      if (p.weights.openWeights) expect(RIVAL_REACTIVE.some((t) => t.lab === p.lab && t.openWeights), p.lab).toBe(true);
      if (p.weights.context) expect(RIVAL_REACTIVE.some((t) => t.lab === p.lab && t.context !== undefined), p.lab).toBe(true);
    }
  });
});

describe('сложность', () => {
  it('три уровня с описаниями без длинных тире; Обычная без числовых множителей', () => {
    expect(DIFFICULTY_IDS).toEqual(['easy', 'normal', 'hard']);
    for (const d of DIFFICULTY_IDS) {
      expect(LONG_DASH.test(DIFFICULTY[d].description), d).toBe(false);
      expect(DIFFICULTY[d].name.length).toBeGreaterThan(0);
    }
    expect(DIFFICULTY.normal.rentPrice).toBe(1);
    expect(DIFFICULTY.normal.exposure).toBe(1);
    expect(DIFFICULTY.easy.cap).toBeLessThan(DIFFICULTY.normal.cap);
    expect(DIFFICULTY.normal.cap).toBeLessThan(DIFFICULTY.hard.cap);
  });

  it('модификаторы сложности: только на Лёгкой и Сложной', () => {
    const normal = game('2017-01-01', 'normal');
    applyDifficultyModifiers(normal);
    expect(normal.modifiers).toHaveLength(0);
    const hard = game('2017-01-01', 'hard');
    applyDifficultyModifiers(hard);
    expect(modValue(hard, 'rentPrice').mult).toBeCloseTo(1.6); // было 1,1: сильный бот побеждал на Сложной на всех зёрнах 1-5
    expect(exposureMultIn(hard, 'p1')).toBeCloseTo(1.3);
    const easy = game('2017-01-01', 'easy');
    applyDifficultyModifiers(easy);
    expect(modValue(easy, 'rentPrice').mult).toBeCloseTo(0.8); // было 0,9
    expect(exposureMultIn(easy, 'p1')).toBeCloseTo(0.7);
  });
});

// ---------- Спячка и накал ----------

describe('спячка', () => {
  it('до 2021 года накал не растёт и генератор случайных чисел не трогается', () => {
    const s = game('2020-06-30');
    addModel(s, { elo: 1200, price: 1 });
    setShares(s, 0.4);
    const rng = s.rng;
    rivalryMonth(s);
    rivalryDay(s);
    for (const lab of LAB_IDS) expect(s.rivalry.heat[lab]).toBe(0);
    expect(s.rng).toBe(rng);
    expect(s.rivalry.pending).toHaveLength(0);
    expect(s.mail).toHaveLength(0);
  });

  it('до первой модели игрока соперники спят', () => {
    const s = game('2022-06-30');
    setShares(s, 0);
    const rng = s.rng;
    for (let i = 0; i < 6; i++) rivalryMonth(s);
    for (const lab of LAB_IDS) expect(s.rivalry.heat[lab]).toBe(0);
    expect(s.rng).toBe(rng);
    expect(s.rivalry.pending).toHaveLength(0);
  });

  it('лаборатория без модели на рынке спит, а DeepCent - до 2 ноября 2023 года', () => {
    const s = game('2023-09-30');
    addModel(s, { elo: 1300, price: 1 });
    setShares(s, 0.4);
    rivalryMonth(s);
    expect(s.rivalry.heat.deepcent).toBe(0); // первая модель - 2 ноября 2023
    expect(s.rivalry.heat.openbrain).toBeGreaterThan(0);
    expect(s.rivalry.heat.antropik).toBeGreaterThan(0); // Clade 1 вышла в марте 2023
  });

  it('Zhipo замечает игрока только с долей от 10 %', () => {
    const s = game('2024-03-31');
    addModel(s, { elo: 1300, price: 1 });
    setShares(s, 0.08);
    rivalryMonth(s);
    expect(s.rivalry.heat.zhipo).toBe(0);
    setShares(s, 0.2);
    rivalryMonth(s);
    expect(s.rivalry.heat.zhipo).toBeGreaterThan(0);
  });

  it('модель, снятая с продажи по API, соперников не будит', () => {
    const s = game('2023-09-30');
    addModel(s, { elo: 1300, price: 1, onApi: false });
    setShares(s, 0.4);
    const rng = s.rng;
    rivalryMonth(s);
    for (const lab of LAB_IDS) expect(s.rivalry.heat[lab]).toBe(0);
    expect(s.rng).toBe(rng);
    expect(labStance(s, 'openbrain').hint).toBe('ждёт вашего выхода на рынок');
  });

  it('пока ждёт ответа письмо с выбором, накал не меняется и розыгрышей нет', () => {
    const s = game('2023-09-30', 'hard');
    addModel(s, { elo: 1300, price: 1 });
    setShares(s, 0.4);
    s.rivalry.heat.openbrain = 30;
    addMail(s, { kind: 'event', title: 'Выбор', body: 'Ждёт ответа.', eventId: 'x', choices: [{ label: 'Да', hint: '' }] });
    const rng = s.rng;
    rivalryMonth(s);
    expect(s.rivalry.heat.openbrain).toBe(30);
    expect(s.rng).toBe(rng);
    expect(s.rivalry.pending).toHaveLength(0);
    s.mail[0].chosen = 0;
    rivalryMonth(s);
    expect(s.rivalry.heat.openbrain).not.toBe(30);
  });
});

describe('угроза и накал', () => {
  it('сильный и дешёвый игрок - угроза около 1, слабый - 0', () => {
    const s = game('2023-09-30');
    addModel(s, { elo: 1300, price: 1 });
    setShares(s, 0.4);
    const t = threatOf(s, 'openbrain');
    expect(t.total).toBeGreaterThan(0.9);
    expect(t.hint.length).toBeGreaterThan(0);
    const weak = game('2023-09-30');
    addModel(weak, { elo: 900, price: 100 });
    setShares(weak, 0.01, { openbrain: 0.5 });
    expect(threatOf(weak, 'openbrain').total).toBe(0);
    expect(threatOf(weak, 'openbrain').hint).toBe('угрозы не видит');
  });

  it('накал растёт при угрозе (× gain × сложность) и не растёт без неё', () => {
    const s = game('2023-09-30');
    addModel(s, { elo: 1300, price: 1 });
    setShares(s, 0.4);
    rivalryMonth(s);
    const heat = s.rivalry.heat.openbrain;
    expect(heat).toBeGreaterThan(20);
    expect(heat).toBeLessThanOrEqual(30 * 1.2 - 8 + 1e-9);
    const hard = game('2023-09-30', 'hard');
    addModel(hard, { elo: 1300, price: 1 });
    setShares(hard, 0.4);
    rivalryMonth(hard);
    // На Сложной порог 35 достигается за месяц: ход запланирован и 40 накала потрачено.
    const scheduled = hard.rivalry.pending.some((p) => p.lab === 'openbrain');
    expect(hard.rivalry.heat.openbrain + (scheduled ? 40 : 0)).toBeGreaterThan(heat);
    expect(scheduled).toBe(true);
    expect(hard.rivalry.cooldownUntil.openbrain).toBe(hard.day + 180);
    const weak = game('2023-09-30');
    addModel(weak, { elo: 900, price: 100 });
    setShares(weak, 0.01, { openbrain: 0.5 });
    rivalryMonth(weak);
    expect(weak.rivalry.heat.openbrain).toBe(0);
  });

  it('рычаг: цена, Эло или контекст; на Лёгкой рычаг не считается', () => {
    const s = game('2023-09-30');
    addModel(s, { elo: 900, price: 0.2 });
    expect(computeLever(s)).toBe('price');
    const e = game('2023-09-30');
    addModel(e, { elo: maxRivalElo(e) + 50, price: 100 });
    expect(computeLever(e)).toBe('elo');
    const c = game('2023-09-30');
    addModel(c, { elo: 900, price: 100, context: 1000000 });
    expect(computeLever(c)).toBe('context');
    const n = game('2023-09-30');
    addModel(n, { elo: 900, price: 100 });
    expect(computeLever(n)).toBeNull();
    const easy = game('2023-09-30', 'easy');
    addModel(easy, { elo: 1300, price: 0.2 });
    setShares(easy, 0.4);
    rivalryMonth(easy);
    expect(easy.rivalry.lever).toBeNull();
  });
});

// ---------- Ценовые ходы ----------

describe('ценовые ходы', () => {
  it('rivalprice-<lab> не накапливается: война заменяет снижение; цены не ниже границы и minPrice', () => {
    const s = game('2023-09-01');
    addModel(s, { elo: 1300, price: 1 });
    setShares(s, 0.4);
    const gtp4 = rivalDef('gtp-4');
    const base = rivalPrice(gtp4, s.day);
    expect(rivalPriceIn(s, gtp4)).toBeCloseTo(base);

    expect(executeMove(s, pend('openbrain', 'priceCut'))).not.toBeNull();
    expect(priceModifiers(s, 'openbrain')).toHaveLength(1);
    expect(priceModifiers(s, 'openbrain')[0].mult).toBeCloseTo(0.7);
    expect(rivalPriceIn(s, gtp4)).toBeCloseTo(base * 0.7);
    expect(s.modifiers.some((m) => m.kind === 'demand' && m.id === 'rival-demand-openbrain-priceCut')).toBe(true);
    expect(s.rivalry.active).toEqual([{ lab: 'openbrain', move: 'priceCut', untilDay: s.day + 120 }]);

    expect(executeMove(s, pend('openbrain', 'priceWar'))).not.toBeNull();
    expect(priceModifiers(s, 'openbrain')).toHaveLength(1);
    expect(priceModifiers(s, 'openbrain')[0].mult).toBeCloseTo(0.5);
    expect(s.rivalry.active.map((a) => a.move)).toEqual(['priceWar']);

    const floor = Math.max(minPrice(s.day), 0.3 * refPrice(s.day));
    for (const id of s.rivalsReleased) {
      const def = rivalDef(id);
      if (def.lab !== 'openbrain' || !def.api) continue;
      const price = rivalPriceIn(s, def);
      const catalog = rivalPrice(def, s.day);
      expect(price, id).toBeGreaterThanOrEqual(minPrice(s.day));
      expect(price, id).toBeGreaterThanOrEqual(Math.min(catalog, floor) - 1e-9);
      expect(price, id).toBeLessThanOrEqual(catalog + 1e-9);
    }
    // GTP-4 дорогая: ровно вдвое дешевле. GTP-3.5 Turbu уже ниже границы: цена не меняется.
    expect(rivalPriceIn(s, gtp4)).toBeCloseTo(base * 0.5);
    const turbu = rivalDef('gtp-3-5-turbu');
    expect(rivalPrice(turbu, s.day)).toBeLessThan(floor);
    expect(rivalPriceIn(s, turbu)).toBeCloseTo(rivalPrice(turbu, s.day));
    expect(s.mail.map((m) => m.title)).toEqual(['OpenBrain снизила цены на API', 'OpenBrain: цены ещё ниже']);
  });

  it('Сложная ценовая война держит границу 0,2 опорной цены, Gogle режет сильнее', () => {
    const s = game('2024-03-01', 'hard');
    addModel(s, { elo: 1400, price: 0.5 });
    setShares(s, 0.4);
    expect(executeMove(s, pend('gogle', 'priceCut'))).not.toBeNull();
    expect(priceModifiers(s, 'gogle')[0].mult).toBeCloseTo(1 - 0.3 * 1.3 * 1.2);
    expect(executeMove(s, pend('gogle', 'priceWar'))).not.toBeNull();
    expect(priceModifiers(s, 'gogle')[0].add).toBeCloseTo(0.2);
    const pro = rivalDef('gemeni-1-5-pro');
    const floor = Math.max(minPrice(s.day), 0.2 * refPrice(s.day));
    expect(rivalPriceIn(s, pro)).toBeGreaterThanOrEqual(Math.min(rivalPrice(pro, s.day), floor) - 1e-9);
  });

  it('память: ответ ценой в течение 30 дней и оценка «сработало» через 60 дней', () => {
    const s = game('2023-09-01');
    const m = addModel(s, { elo: 1300, price: 2 });
    setShares(s, 0.4);
    s.rivalry.pending.push({ ...pend('openbrain', 'priceCut'), fireDay: s.day });
    rivalryDay(s);
    const mem = s.rivalry.memory.openbrain;
    expect(mem.lastMove).toBe('priceCut');
    expect(mem.priceBefore).toBe(2);
    expect(mem.shareBefore).toBeCloseTo(0.4);
    expect(mem.worked).toBeNull();
    expect(s.rivalry.history).toHaveLength(1);
    expect(lastMove(s, 'openbrain')?.move).toBe('priceCut');
    s.day += 10;
    m.price = 1.5;
    rivalryDay(s);
    expect(mem.priceMatched).toBe(true);
    s.day += 60;
    setShares(s, 0.3);
    rivalryDay(s);
    expect(mem.worked).toBe(true);
  });

  it('слухи не подтвердились: несостоявшийся ход не попадает в историю и память', () => {
    const s = game('2022-03-01');
    addModel(s, { elo: 1000, price: 1 });
    setShares(s, 0.3);
    s.rivalry.pending.push({ ...pend('deepcent', 'priceCut'), fireDay: s.day }); // у DeepCent нет моделей
    rivalryDay(s);
    expect(s.rivalry.history).toHaveLength(0);
    expect(s.rivalry.memory.deepcent.lastMove).toBeNull();
    expect(s.mail[0].title).toBe('Слухи о DeepCent не подтвердились');
  });

  it('ценовая война планируется во время перерыва лаборатории, если игрок ответил ценой на её снижение', () => {
    const warState = (priceMatched: boolean): RivalryGame => {
      const s = game('2024-07-01', 'hard'); // у DeepCent уже есть модели с API (DeepSeak-V2)
      addModel(s, { elo: 1400, price: 0.5 });
      setShares(s, 0.4);
      expect(executeMove(s, pend('deepcent', 'priceCut'))).not.toBeNull();
      s.rivalry.memory.deepcent = { lastMove: 'priceCut', firedDay: s.day, shareBefore: 0.4, priceBefore: 0.6, worked: null, priceMatched };
      // Остальные лаборатории в перерыве без собственного снижения цен: ходить может только DeepCent.
      for (const lab of LAB_IDS) s.rivalry.cooldownUntil[lab] = s.day + 100;
      s.rivalry.heat.deepcent = 100;
      s.mail = [];
      return s;
    };
    const s = warState(true);
    rivalryMonth(s);
    expect(s.rivalry.pending.map((p) => `${p.lab}:${p.move}`)).toEqual(['deepcent:priceWar']);
    expect(s.rivalry.pending[0].fireDay).toBe(s.day + 7); // Сложная: ценовые ходы через 7 дней
    expect(s.mail.map((m) => m.title)).toEqual(['Слухи: DeepCent ответит на ваши цены']);
    expect(s.rivalry.heat.deepcent).toBe(60);
    const quiet = warState(false);
    rivalryMonth(quiet);
    expect(quiet.rivalry.pending).toHaveLength(0);
  });
});

describe('лимит спроса', () => {
  it('суммарный множитель спроса API от ходов не выше 1,15; бесплатный чат спрос API не трогает', () => {
    const s = game('2024-07-01');
    addModel(s, { elo: 1300, price: 5 });
    setShares(s, 0.3);
    expect(triggerHolds(s, 'deepcent', 'cheapShock')).toBe(true);
    expect(executeMove(s, pend('gogle', 'freeTier'))).not.toBeNull();
    expect(executeMove(s, pend('gogle', 'priceCut'))).not.toBeNull();
    const ids = s.modifiers.filter((m) => m.kind === 'demand').map((m) => m.id).sort();
    expect(ids).toEqual(['rival-demand-gogle-priceCut']);
    expect(modValue(s, 'demand').mult).toBeCloseTo(1.05);
    // Ещё +10 % дали бы 1,155: дешёвая модель не планируется; бесплатный чат лимитом спроса API не ограничен.
    expect(triggerHolds(s, 'deepcent', 'cheapShock')).toBe(false); // 1,05 × 1,10 = 1,155
    expect(triggerHolds(s, 'openbrain', 'freeTier')).toBe(true);
    s.modifiers = s.modifiers.filter((m) => m.id !== 'rival-demand-gogle-priceCut');
    expect(triggerHolds(s, 'deepcent', 'cheapShock')).toBe(true);
  });
});

describe('условия ходов по сегментам (design market-v2, 5.2)', () => {
  it('дешёвая модель смотрит на долю игрока среди разработчиков, а не на общую', () => {
    const s = game('2024-07-01');
    addModel(s, { elo: 1300, price: 5 });
    setShares(s, 0.3, {}, false); // общая доля высокая, по сегментам - нули
    expect(triggerHolds(s, 'deepcent', 'cheapShock')).toBe(false);
    setSegShare(s, 'developers', 0.2);
    expect(triggerHolds(s, 'deepcent', 'cheapShock')).toBe(true);
    setSegShare(s, 'developers', 0.05);
    setSegShare(s, 'enterprise', 0.5);
    expect(triggerHolds(s, 'deepcent', 'cheapShock')).toBe(false);
  });

  it('бесплатный чат смотрит на долю игрока среди обычных пользователей', () => {
    const s = game('2024-07-01');
    addModel(s, { elo: 1300, price: 5 });
    setShares(s, 0.3, {}, false);
    expect(triggerHolds(s, 'gogle', 'freeTier')).toBe(false);
    setSegShare(s, 'consumers', 0.12);
    expect(triggerHolds(s, 'gogle', 'freeTier')).toBe(true);
    setSegShare(s, 'consumers', 0.11);
    setSegShare(s, 'developers', 0.9);
    expect(triggerHolds(s, 'gogle', 'freeTier')).toBe(false);
  });

  it('уровни ответных моделей: дешёвая - лёгкая, открытые веса - средняя, длинный контекст - уровень базовой', () => {
    const defs = reactiveDefs();
    expect(defs.get('mv-deepcent-1')!.tier).toBe('light');
    expect(defs.get('mv-zhipo-1')!.tier).toBe('mid');
    expect(defs.get('mv-antropik-1')!.tier).toBe(rivalTier(rivalDef('clade-instant-1')));
    expect(defs.get('mv-gogle-1')!.tier).toBe(rivalTier(rivalDef('paln-2')));
    for (const def of defs.values()) expect(rivalTier(def), def.id).toBe(def.tier);
  });
});

// ---------- Ускорение флагмана ----------

describe('ускорение флагмана', () => {
  it('Обычная: сдвиг 30 дней и +10 Эло; прибавка на лабораторию не больше 20', () => {
    const s = game('2023-09-01');
    addModel(s, { elo: 1300, price: 1 });
    const turbo = rivalDef('gtp-4-turbu');
    expect(executeMove(s, pend('openbrain', 'flagship', 'gtp-4-turbu'))).not.toBeNull();
    expect(s.rivalry.overrides['gtp-4-turbu']).toEqual({ dayShift: -30, eloAdd: 10 });
    expect(rivalDayIn(s, turbo)).toBe(rivalDay(turbo) - 30);
    expect(rivalEloIn(s, turbo)).toBe(turbo.arenaElo + 10);
    expect(s.mail[0].title).toBe('OpenBrain ускорила выпуск GTP-4 Turbu');
    // Повторно ту же модель не ускорить.
    expect(executeMove(s, pend('openbrain', 'flagship', 'gtp-4-turbu'))).toBeNull();

    let totalAdd = 10;
    let totalShift = 30;
    for (const date of ['2024-03-01', '2024-05-15', '2024-07-10']) {
      s.day = dateToDay(date);
      releaseCatalog(s);
      executeMove(s, pend('openbrain', 'flagship'));
      totalAdd = 0;
      totalShift = 0;
      for (const [id, o] of Object.entries(s.rivalry.overrides)) {
        expect(rivalDef(id).lab).toBe('openbrain');
        expect(o.eloAdd ?? 0).toBeLessThanOrEqual(10);
        expect(-(o.dayShift ?? 0)).toBeLessThanOrEqual(30);
        totalAdd += o.eloAdd ?? 0;
        totalShift += -(o.dayShift ?? 0);
      }
    }
    expect(Object.keys(s.rivalry.overrides).length).toBeGreaterThanOrEqual(2);
    expect(totalAdd).toBeLessThanOrEqual(20);
    expect(totalShift).toBeLessThanOrEqual(90);
  });

  it('Сложная: не больше 60 дней и +20 на модель, +40 на лабораторию, 90 дней суммарно', () => {
    const s = game('2023-09-01', 'hard');
    addModel(s, { elo: 1300, price: 1 });
    for (const date of ['2023-09-01', '2024-03-01', '2024-05-15', '2024-07-10']) {
      s.day = dateToDay(date);
      releaseCatalog(s);
      executeMove(s, pend('openbrain', 'flagship'));
    }
    let totalAdd = 0;
    let totalShift = 0;
    for (const [id, o] of Object.entries(s.rivalry.overrides)) {
      expect(STORY_LOCKED.has(id)).toBe(false);
      expect(o.eloAdd ?? 0).toBeLessThanOrEqual(20);
      expect(-(o.dayShift ?? 0)).toBeLessThanOrEqual(60);
      totalAdd += o.eloAdd ?? 0;
      totalShift += -(o.dayShift ?? 0);
    }
    expect(Object.keys(s.rivalry.overrides).length).toBeGreaterThanOrEqual(3);
    expect(totalAdd).toBeLessThanOrEqual(40);
    expect(totalShift).toBeLessThanOrEqual(90);
    expect(s.rivalry.overrides['gtp-4-turbu']).toEqual({ dayShift: -39, eloAdd: 13 });
  });

  it('сюжетные модели не сдвигаются, Лёгкая не ускоряет, в последние 90 дней игры прибавки Эло нет', () => {
    const s = game('2023-01-10');
    addModel(s, { elo: 1300, price: 1 });
    expect(executeMove(s, pend('openbrain', 'flagship', 'gtp-4'))).toBeNull();
    expect(executeMove(s, pend('openbrain', 'flagship'))).toBeNull(); // ближайшая незаблокированная модель вне окна
    expect(s.rivalry.overrides).toEqual({});
    const late = game('2024-07-10');
    addModel(late, { elo: 1400, price: 1 });
    expect(executeMove(late, pend('openbrain', 'flagship', 'q1-previow'))).toBeNull();
    expect(late.rivalry.overrides['q1-previow']).toBeUndefined();

    const easy = game('2023-09-01', 'easy');
    addModel(easy, { elo: 1300, price: 1 });
    expect(executeMove(easy, pend('openbrain', 'flagship', 'gtp-4-turbu'))).toBeNull();
    expect(easy.rivalry.overrides).toEqual({});

    const end = game('2024-09-20', 'hard');
    addModel(end, { elo: 1400, price: 1 });
    expect(executeMove(end, pend('gogle', 'flagship', 'gemeni-2-0-flesh'))).not.toBeNull();
    const o = end.rivalry.overrides['gemeni-2-0-flesh'];
    expect(o.eloAdd).toBeUndefined();
    expect(o.dayShift).toBe(-39);
  });

  it('модель не выходит раньше предыдущей модели лаборатории + 30 дней и не раньше завтра', () => {
    // Clade 3 Haiko (13.03.2024) после Clade 3 Opos/Sonet (04.03.2024): сдвиг невозможен, остаётся только Эло.
    const s = game('2024-01-05', 'hard');
    addModel(s, { elo: 1400, price: 1 });
    s.rivalsReleased.push('clade-3-opos', 'clade-3-sonet'); // считаем, что они уже вышли
    expect(executeMove(s, pend('antropik', 'flagship', 'clade-3-haiko'))).not.toBeNull();
    expect(s.rivalry.overrides['clade-3-haiko']).toEqual({ eloAdd: 13 }); // round(10 × 1,3), сдвига нет
  });

  it('условие: лучшая модель игрока в продаже по API не слабее лучшей модели лаборатории на рынке более чем на 10', () => {
    const s = game('2023-09-01');
    const m = addModel(s, { elo: 1300, price: 1, onApi: false });
    expect(triggerHolds(s, 'openbrain', 'flagship')).toBe(false); // модель не в продаже
    m.onApi = true;
    expect(triggerHolds(s, 'openbrain', 'flagship')).toBe(true); // GTP-4 Turbu через 66 дней
    m.arenaElo = labBestEloIn(s, 'openbrain') - 11;
    expect(triggerHolds(s, 'openbrain', 'flagship')).toBe(false);
    m.arenaElo = labBestEloIn(s, 'openbrain') - 10;
    expect(triggerHolds(s, 'openbrain', 'flagship')).toBe(true);
  });
});

// ---------- Ответные модели ----------

describe('ответные модели', () => {
  it('дешёвая модель: Эло не выше лучшей каталожной − 20, цена втрое ниже новейшей и не ниже minPrice', () => {
    const s = game('2024-07-01');
    addModel(s, { elo: 1300, price: 5 });
    setShares(s, 0.3);
    expect(executeMove(s, pend('deepcent', 'cheapShock'))).not.toBeNull();
    expect(s.rivalry.extra['mv-deepcent-1']).toBe(s.day);
    const def = reactiveDefs().get('mv-deepcent-1')!;
    expect(s.rivalsReleased).toContain('mv-deepcent-1');
    expect(rivalDayIn(s, def)).toBe(s.day);
    let catalogBest = 0;
    for (const m of RIVAL_MODELS) if (m.lab === 'deepcent' && rivalDay(m) <= s.day) catalogBest = Math.max(catalogBest, m.arenaElo);
    expect(rivalEloIn(s, def)).toBeLessThanOrEqual(catalogBest - 20);
    expect(rivalEloIn(s, def)).toBeLessThan(labBestEloIn(s, 'deepcent'));
    const newest = rivalDef('deepseak-coder-v2');
    expect(rivalPriceIn(s, def)).toBeCloseTo(Math.max(minPrice(s.day), rivalPrice(newest, s.day) * 0.3));
    expect(rivalPriceIn(s, def)).toBeGreaterThanOrEqual(minPrice(s.day));
    expect(rivalContextIn(s, def)).toBe(newest.context);
    expect(s.rivalry.extraCount.deepcent).toBe(1);
    expect(s.hype.deepcent).toBe(10);
    expect(s.mail[0].title).toBe('DeepCent выпустила DeepSeak LLM Lito: втрое дешевле');
  });

  it('лимит дополнительных моделей на лабораторию: 2 на Обычной, 3 на Сложной, 1 на Лёгкой', () => {
    const limits: [Difficulty, number][] = [
      ['easy', 1],
      ['normal', 2],
      ['hard', 3],
    ];
    for (const [difficulty, limit] of limits) {
      const s = game('2024-10-01', difficulty);
      addModel(s, { elo: 1300, price: 5 });
      setShares(s, 0.3);
      let done = 0;
      for (let i = 0; i < 5; i++) if (executeMove(s, pend('deepcent', 'cheapShock')) !== null) done++;
      expect(done, difficulty).toBe(limit);
      expect(s.rivalry.extraCount.deepcent, difficulty).toBe(limit);
      expect(Object.keys(s.rivalry.extra), difficulty).toHaveLength(limit);
    }
  });

  it('открытые веса: Эло = лучшее лаборатории − 50, бренд +0,1 на год, исследования игрока дешевле на 10 %', () => {
    const s = game('2024-03-01');
    addModel(s, { elo: 1300, price: 5 });
    setShares(s, 0.3);
    const best = labBestEloIn(s, 'alibabo');
    expect(executeMove(s, pend('alibabo', 'openWeights'))).not.toBeNull();
    const def = reactiveDefs().get('mv-alibabo-1')!;
    expect(def.openWeights).toBe(true);
    expect(def.api).toBe(false);
    expect(rivalEloIn(s, def)).toBeCloseTo(best - 50);
    expect(modValue(s, 'researchCost', 'rlhf').mult).toBeCloseTo(0.9);
    expect(modValue(s, 'labBrand', 'alibabo').add).toBeCloseTo(0.1);
    expect(s.rivalry.extraCount.alibabo).toBe(1);
    expect(s.mail[0].title).toBe('Alibabo открыла веса Qwin-14B Turbu');
  });

  it('длинный контекст: ближайшая модель каталога получает контекст ×4 (в пределах каталога) и выходит на 15 дней раньше', () => {
    const s = game('2023-10-01');
    addModel(s, { elo: 1300, price: 5, context: 1000000 });
    setShares(s, 0.3);
    const pro = rivalDef('gemeni-1-0-pro');
    expect(executeMove(s, pend('gogle', 'context', 'gemeni-1-0-pro'))).not.toBeNull();
    expect(s.rivalry.overrides['gemeni-1-0-pro']).toEqual({ context: pro.context * 4, dayShift: -15 });
    expect(rivalContextIn(s, pro)).toBe(pro.context * 4);
    expect(rivalDayIn(s, pro)).toBe(rivalDay(pro) - 15);
    expect(s.rivalry.extraCount.gogle).toBe(0);
  });

  it('длинный контекст без подходящей модели каталога: ответная модель «… 128K» на 10 Эло слабее базовой', () => {
    // После moonshoot-v1 (06.02.2024) у Moonshoot нет моделей с API в каталоге: остаётся только ответная модель.
    const s = game('2024-03-01');
    addModel(s, { elo: 1300, price: 5, context: 1000000 });
    setShares(s, 0.3);
    expect(executeMove(s, pend('moonshoot', 'context'))).not.toBeNull();
    const def = reactiveDefs().get('mv-moonshoot-1')!;
    expect(s.rivalry.extra['mv-moonshoot-1']).toBe(s.day);
    expect(rivalEloIn(s, def)).toBe(rivalDef('kimo-chat').arenaElo - 10);
    expect(rivalEloIn(s, def)).toBeLessThanOrEqual(labBestEloIn(s, 'moonshoot') - 20);
    expect(rivalContextIn(s, def)).toBe(128000);
    expect(s.rivalry.extraCount.moonshoot).toBe(1);
    expect(s.mail[0].title).toBe('Moonshoot ответила длинным контекстом');
  });

  it('в последние 90 дней игры дополнительных моделей нет', () => {
    const s = game('2024-11-01', 'hard');
    addModel(s, { elo: 1400, price: 5 });
    setShares(s, 0.3);
    expect(executeMove(s, pend('deepcent', 'cheapShock'))).toBeNull();
    expect(executeMove(s, pend('alibabo', 'openWeights'))).toBeNull();
    expect(s.rivalry.extra).toEqual({});
  });
});

// ---------- Письма с выбором ----------

describe('письма с выбором', () => {
  function auditState(): { s: RivalryGame; m: PlayerModel } {
    const s = game('2023-09-01');
    s.benchmarks.mmlu.introduced = true;
    const m = addModel(s, { elo: 1300, price: 1, overfit: { mmlu: 20 } });
    setShares(s, 0.3);
    return { s, m };
  }

  it('события: вариант 0 умеренный, вариант по умолчанию пассивный, тексты без длинных тире', () => {
    expect(RIVALRY_EVENTS.map((e) => e.id)).toEqual(['rival-hype', 'rival-audit', 'rival-poach', 'rival-poach-team']);
    for (const e of RIVALRY_EVENTS) {
      expect(e.repeatable).toBe(true);
      expect('check' in e.when && e.when.check(game('2023-01-01'))).toBe(false);
      expect(e.choices?.length).toBeGreaterThanOrEqual(2);
      expect(e.defaultChoice).toBe((e.choices?.length ?? 1) - 1);
      for (const c of e.choices ?? []) {
        expect(LONG_DASH.test(c.label), e.id).toBe(false);
        expect(LONG_DASH.test(c.hint), e.id).toBe(false);
      }
    }
  });

  it('проверка баллов: важное письмо с тремя вариантами; честные баллы разоблачают модель', () => {
    const { s, m } = auditState();
    expect(executeMove(s, pend('antropik', 'audit', m.id))).not.toBeNull();
    const mail = s.mail[0];
    expect(mail.title).toBe(`Antropik сомневается в баллах модели «${m.name}»`);
    expect(mail.kind).toBe('rival');
    expect(mail.important).toBe(true);
    expect(mail.eventId).toBe('rival-audit');
    expect(mail.choices).toHaveLength(3);
    expect(mail.replyByDay).toBe(s.day + 30);
    expect(mail.defaultChoice).toBe(2);
    expect(s.rivalry.choice).toEqual({ lab: 'antropik', modelId: m.id });
    expect(s.rivalry.active.map((a) => a.move)).toEqual(['audit']);
    expect(labStance(s, 'antropik').label).toBe('проверяет');
    const rep = s.reputation;
    applyChoiceOf(s, 'rival-audit', 0);
    expect(m.exposed).toBe(true);
    expect(s.reputation).toBe(rep - 5);
  });

  it('проверка баллов: «Снять с продажи» и «Отрицать» (штраф при позднем разоблачении)', () => {
    const a = auditState();
    executeMove(a.s, pend('gogle', 'audit', a.m.id));
    applyChoiceOf(a.s, 'rival-audit', 1);
    expect(a.m.onApi).toBe(false);

    const { s, m } = auditState();
    executeMove(s, pend('gogle', 'audit', m.id));
    applyChoiceOf(s, 'rival-audit', 2);
    expect(exposureMultIn(s, m.id)).toBeCloseTo(2);
    expect(exposureMultIn(s, 'other')).toBeCloseTo(1);
    expect(s.flags[`rivalDenied:${m.id}`]).toBe(true);
    const rep = s.reputation;
    s.day += 5;
    rivalryDay(s);
    expect(s.reputation).toBe(rep); // ещё не разоблачена
    m.exposed = true;
    rivalryDay(s);
    expect(s.reputation).toBe(rep - 20);
    expect(s.flags[`rivalDenied:${m.id}`]).toBeUndefined();
    expect(s.mail.at(-1)?.title).toContain('Отрицание обернулось против лаборатории');
  });

  it('чистую модель не проверяют', () => {
    const s = game('2023-09-01');
    const m = addModel(s, { elo: 1300, price: 1 });
    expect(executeMove(s, pend('antropik', 'audit', m.id))).toBeNull();
    expect(executeMove(s, pend('antropik', 'audit'))).toBeNull();
    expect(s.mail).toHaveLength(0);
  });

  it('реклама: шумиха лаборатории +20k, ответная кампания стоит денег и даёт +15 шумихи', () => {
    const s = game('2023-09-01');
    addModel(s, { elo: 1300, price: 1 });
    expect(executeMove(s, pend('openbrain', 'hype'))).not.toBeNull();
    expect(s.hype.openbrain).toBe(20);
    expect(s.mail[0].eventId).toBe('rival-hype');
    expect(s.mail[0].defaultChoice).toBe(1);
    expect(labStance(s, 'openbrain').label).toBe('кампания');
    const cash = s.cash;
    applyChoiceOf(s, 'rival-hype', 0);
    expect(s.cash).toBe(cash - 300_000 * 5);
    expect(s.hype.player).toBe(15);
    const hard = game('2023-09-01', 'hard');
    addModel(hard, { elo: 1300, price: 1 });
    executeMove(hard, pend('openbrain', 'hype'));
    expect(hard.hype.openbrain).toBe(26);
  });

  it('переманивание: «Отпустить» делает исследования дороже на 25 %', () => {
    const s = game('2023-09-01');
    addModel(s, { elo: 1300, price: 1 });
    expect(executeMove(s, pend('gogle', 'poach'))).not.toBeNull();
    expect(s.mail[0].eventId).toBe('rival-poach');
    applyChoiceOf(s, 'rival-poach', 1);
    expect(modValue(s, 'researchCost', 'algo').mult).toBeCloseTo(1.25);
    const cash = s.cash;
    applyChoiceOf(s, 'rival-poach', 0);
    expect(s.cash).toBe(cash - 3 * 100_000 * 5);
  });

  it('бесплатный чат: бренд растёт только у обычных пользователей, спрос - только на подписки', () => {
    const s = game('2023-09-01');
    addModel(s, { elo: 1300, price: 1 });
    expect(executeMove(s, pend('gogle', 'freeTier'))).not.toBeNull();
    expect(modValue(s, 'segBrand', 'gogle:consumers').add).toBeCloseTo(0.3);
    expect(modValue(s, 'segBrand', 'gogle:developers').add).toBe(0);
    expect(modValue(s, 'segBrand', 'openbrain:consumers').add).toBe(0);
    expect(modValue(s, 'labBrand', 'gogle').add).toBe(0);
    expect(modValue(s, 'subsDemand').mult).toBeCloseTo(1.15);
    expect(modValue(s, 'demand').mult).toBe(1);
    expect(s.modifiers.map((m) => m.id).sort()).toEqual(['rival-freetier-gogle', 'rival-subsdemand-gogle']);
    for (const m of s.modifiers) expect(m.untilDay).toBe(s.day + 180);
    expect(s.rivalry.active).toEqual([{ lab: 'gogle', move: 'freeTier', untilDay: s.day + 180 }]);
    const mail = s.mail[s.mail.length - 1];
    expect(mail.title).toBe('Gogle DeepMynd сделала чат бесплатным');
    expect(mail.body).toContain('у обычных пользователей сильнее в течение 180 дней, спрос на подписки вырос на 15 %');
    expect(mail.body).not.toMatch(LONG_DASH);
    // На Сложной бренд × 1,3.
    const hard = game('2023-09-01', 'hard');
    addModel(hard, { elo: 1300, price: 1 });
    executeMove(hard, pend('gogle', 'freeTier'));
    expect(modValue(hard, 'segBrand', 'gogle:consumers').add).toBeCloseTo(0.39);
  });
});

// ---------- Настрой ----------

describe('настрой лаборатории', () => {
  it('подписи по накалу, ожидающему и активному ходу', () => {
    const s = game('2023-09-30');
    addModel(s, { elo: 1300, price: 1 });
    setShares(s, 0.4);
    s.rivalry.heat.openbrain = 10;
    expect(labStance(s, 'openbrain').label).toBe('спокойна');
    s.rivalry.heat.openbrain = 30;
    expect(labStance(s, 'openbrain').label).toBe('присматривается');
    s.rivalry.heat.openbrain = 60;
    expect(labStance(s, 'openbrain')).toEqual({ label: 'догоняет', hint: threatOf(s, 'openbrain').hint });
    s.rivalry.pending.push({ ...pend('openbrain', 'hype'), fireDay: s.day + 30 });
    expect(labStance(s, 'openbrain').label).toBe('атакует');
    s.rivalry.pending = [];
    s.rivalry.active.push({ lab: 'openbrain', move: 'priceWar', untilDay: s.day + 90 });
    expect(labStance(s, 'openbrain').label).toBe('ценовая война');
    s.rivalry.active = [{ lab: 'openbrain', move: 'audit', untilDay: s.day + 30 }];
    expect(labStance(s, 'openbrain').label).toBe('проверяет');
    s.rivalry.active = [{ lab: 'openbrain', move: 'priceCut', untilDay: s.day + 120 }];
    expect(labStance(s, 'openbrain').label).toBe('догоняет');
    expect(labStance(s, 'deepcent')).toEqual({ label: 'спокойна', hint: 'ещё не вышла на рынок' });
    const empty = game('2023-09-30');
    expect(labStance(empty, 'openbrain').hint).toBe('ждёт вашего выхода на рынок');
  });

  it('подсказка называет главный сигнал угрозы', () => {
    const s = game('2023-09-30');
    addModel(s, { elo: 900, price: 0.2 });
    setShares(s, 0.01, { openbrain: 0.5 });
    expect(threatOf(s, 'openbrain').hint).toMatch(/^вы дешевле на \d+ %$/);
    const e = game('2023-09-30');
    addModel(e, { elo: maxRivalElo(e) + 100, price: 100 });
    setShares(e, 0.01, { openbrain: 0.5 });
    expect(threatOf(e, 'openbrain').hint).toMatch(/^ваше Эло выше на \d+$/);
  });
});

// ---------- Долгий прогон ----------

describe('долгий прогон 2021-2024', () => {
  const runs = new Map<string, Run>();
  const runOf = (difficulty: Difficulty, seed = 1): Run => {
    const key = `${difficulty}:${seed}`;
    let r = runs.get(key);
    if (!r) {
      r = simulate(difficulty, seed);
      runs.set(key, r);
    }
    return r;
  };

  it('ходы случаются, но не больше 8 за год на любой сложности; лимит одновременных ходов соблюдается', () => {
    for (const d of DIFFICULTY_IDS) {
      const { moves } = runOf(d);
      expect(moves.length, d).toBeGreaterThan(0);
      for (const [year, n] of Object.entries(perYear(moves))) expect(n, `${d} ${year}`).toBeLessThanOrEqual(8);
    }
    expect(runOf('normal').moves.length).toBeGreaterThanOrEqual(4);
  });

  it('сюжетные модели никогда не сдвигаются, лимиты Эло и дополнительных моделей соблюдаются', () => {
    for (const d of DIFFICULTY_IDS) {
      const { s } = runOf(d);
      const diff = DIFFICULTY[d];
      const perLab: Record<string, number> = {};
      for (const [id, o] of Object.entries(s.rivalry.overrides)) {
        expect(STORY_LOCKED.has(id), `${d} ${id}`).toBe(false);
        const def = RIVAL_MODELS.find((m) => m.id === id);
        if (!def) {
          // Ответная модель: eloAdd - разница с базовой моделью; важно лишь, что она слабее лучшей модели лаборатории.
          const extra = reactiveDefs().get(id)!;
          expect(s.rivalry.extra[id], `${d} ${id}`).toBeDefined();
          expect(rivalEloIn(s, extra), `${d} ${id}`).toBeLessThanOrEqual(labBestEloIn(s, extra.lab) - 20);
          expect(o.dayShift, `${d} ${id}`).toBeUndefined();
          continue;
        }
        expect(o.eloAdd ?? 0, `${d} ${id}`).toBeLessThanOrEqual(diff.eloAddCap);
        expect(-(o.dayShift ?? 0), `${d} ${id}`).toBeLessThanOrEqual(diff.dayShiftCap);
        if ((o.eloAdd ?? 0) > 0) perLab[def.lab] = (perLab[def.lab] ?? 0) + (o.eloAdd ?? 0);
      }
      for (const [lab, total] of Object.entries(perLab)) expect(total, `${d} ${lab}`).toBeLessThanOrEqual(diff.eloAddLabCap);
      for (const lab of LAB_IDS) expect(s.rivalry.extraCount[lab], `${d} ${lab}`).toBeLessThanOrEqual(diff.extraPerLab);
      for (const id of Object.keys(s.rivalry.extra)) expect(s.rivalsReleased, `${d} ${id}`).toContain(id);
      for (const lab of LAB_IDS) expect(priceModifiers(s, lab).length, `${d} ${lab}`).toBeLessThanOrEqual(1);
      expect(s.rivalry.history.length).toBeLessThanOrEqual(20);
    }
  });

  it('каждому ходу предшествует слух; тексты писем без длинных тире', () => {
    const { s, moves } = runOf('normal');
    const rumours = s.mail.filter((m: Mail) => m.title.startsWith('Слухи:'));
    expect(rumours.length).toBeGreaterThanOrEqual(moves.length);
    for (const m of s.mail) {
      expect(m.kind, m.title).toBe('rival');
      expect(LONG_DASH.test(m.title), m.title).toBe(false);
      expect(LONG_DASH.test(m.body), m.title).toBe(false);
    }
    for (const h of moves) {
      const rumour = s.mail.find((m) => m.title.startsWith('Слухи:') && m.title.includes(labName(h.lab)) && m.day < h.day);
      expect(rumour, `${h.lab} ${h.move}`).toBeDefined();
    }
  });

  it('детерминизм: один сид - одни ходы и одно состояние генератора', () => {
    const a = simulate('normal', 7);
    const b = simulate('normal', 7);
    expect(a.moves).toEqual(b.moves);
    expect(a.s.rng).toBe(b.s.rng);
    expect(a.s.rivalry).toEqual(b.s.rivalry);
  });

  it('сохранение в середине игры с ожидающим ходом: продолжение совпадает', () => {
    const mid = dateToDay('2023-10-31');
    const a = simulate('hard', 3, mid);
    if (a.s.rivalry.pending.length === 0) {
      // Нужен ожидающий ход: добавим его вручную, как если бы слух пришёл сегодня.
      a.s.rivalry.pending.push({ ...pend('openbrain', 'hype'), fireDay: mid + 14 });
    }
    const json = JSON.stringify(a.s);
    const copy = JSON.parse(json) as RivalryGame;
    const modelId = a.s.models[0].id;
    const ra = continueRun(a.s, modelId, END_DAY);
    const rb = continueRun(copy, modelId, END_DAY);
    expect(ra.moves).toEqual(rb.moves);
    expect(ra.s.rng).toBe(rb.s.rng);
    expect(JSON.stringify(ra.s.rivalry)).toBe(JSON.stringify(rb.s.rivalry));
  });

  it('Лёгкая реже Сложной', () => {
    expect(runOf('easy').moves.length).toBeLessThanOrEqual(runOf('hard').moves.length);
  });
});

function labName(lab: LabId): string {
  return { openbrain: 'OpenBrain', antropik: 'Antropik', gogle: 'Gogle DeepMynd', zhipo: 'Zhipo', moonshoot: 'Moonshoot', deepcent: 'DeepCent', alibabo: 'Alibabo' }[lab];
}

describe('ответ на господство игрока (2021-2022)', () => {
  /** Два закрытых месяца с долей игрока share. */
  function history(s: RivalryGame, share: number): void {
    for (const month of [6, 7]) {
      s.finance.history.push({ ...s.finance.month, year: 2022, month, cashEnd: 0, marketShare: share, tokensPerDay: 0, subscribers: 0 });
    }
  }

  it('господство - доля не ниже 70 % два месяца подряд', () => {
    const s = game('2022-08-01');
    history(s, 0.69);
    expect(playerDominates(s)).toBe(false);
    s.finance.history = [];
    history(s, 0.95);
    expect(playerDominates(s)).toBe(true);
  });

  it('OpenBrain, которая обычно не снижает цены до ноября 2023 года, отвечает снижением ниже цены игрока', () => {
    const s = game('2022-08-01');
    addModel(s, { elo: 1190, price: 11 });
    setShares(s, 0.95, { openbrain: 0.02 });
    expect(availableMoves(s, 'openbrain')).not.toContain('priceCut');
    history(s, 0.95);
    expect(availableMoves(s, 'openbrain')).toContain('priceCut');
    expect(executeMove(s, pend('openbrain', 'priceCut'))).toMatch(/^снизила цены на API на \d+ %$/);
    const newest = RIVAL_MODELS.filter((m) => m.lab === 'openbrain' && m.api && s.rivalsReleased.includes(m.id)).sort((a, b) => rivalDayIn(s, b) - rivalDayIn(s, a))[0];
    expect(rivalPriceIn(s, newest)).toBeLessThan(11);
  });
});
