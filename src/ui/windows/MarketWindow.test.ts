// Вкладка «Рынок»: карточки сегментов и таблица моделей собираются из снимка рынка и записанных долей s.market.segments.
// Вкладка «Лаборатории»: модели, которые соперник только показал (announcedOnly), не считаются выпущенными;
// день выхода - с поправками ходов соперников; у соперников есть характер, настрой и последний ход;
// блок «Последние ходы» показывает не больше RECENT_MOVES строк, новые сверху.

import { describe, expect, it } from 'vitest';
import { personalityOf } from '../../data/labPersonalities';
import { RIVAL_MODELS } from '../../data/rivalModels';
import { RIVAL_REACTIVE } from '../../data/rivalReactive';
import { dayStep, marketSnapshot } from '../../sim/market';
import { emptyRivalry, labStance, type HistoryRow } from '../../sim/rivalry';
import { createInitialState } from '../../sim/state';
import { dateToDay } from '../../sim/time';
import type { GameState, LabId, PlayerModel } from '../../sim/types';
import {
  demandLabel,
  labRows,
  marketRows,
  RECENT_MOVES,
  recentMoves,
  segmentViews,
  SUBS_CLOSED,
  usersLabel,
} from './MarketWindow';

const byId = (id: string) => RIVAL_MODELS.find((m) => m.id === id)!;

/** Состояние на дату с пустым состоянием соперников (как game() в sim/rivalry.test.ts). */
function stateAt(date: string, released: string[] = []): GameState {
  const s = createInitialState('Тест', 1);
  s.rivalry = emptyRivalry();
  s.day = dateToDay(date);
  s.rivalsReleased = released;
  return s;
}

const row = (day: number, lab: LabId, text: string): HistoryRow => ({ day, lab, move: 'priceCut', text });

describe('labRows', () => {
  it('только показанная модель не попадает ни в счётчик, ни в «последнюю модель», ни в дату первой', () => {
    const gtp3 = byId('gtp-3');
    const paln = byId('paln');
    expect(gtp3.announcedOnly).toBeFalsy();
    expect(paln.announcedOnly).toBe(true);

    const rows = labRows(stateAt('2022-06-01', [gtp3.id, paln.id]));
    const openbrain = rows.find((r) => r.owner === gtp3.lab)!;
    const gogle = rows.find((r) => r.owner === paln.lab)!;

    expect(openbrain.count).toBe(1);
    expect(openbrain.lastName).toBe(gtp3.gameName);
    expect(openbrain.since).toBe(dateToDay(gtp3.released));

    expect(gogle.count).toBe(0);
    expect(gogle.lastName).toBeNull();
    expect(gogle.since).toBeNull();
  });

  it('выпущенная модель той же лаборатории считается, показанная рядом с ней - нет', () => {
    const paln = byId('paln');
    const released = RIVAL_MODELS.find((m) => m.lab === paln.lab && !m.announcedOnly)!;

    const gogle = labRows(stateAt('2024-01-01', [paln.id, released.id])).find((r) => r.owner === paln.lab)!;
    expect(gogle.count).toBe(1);
    expect(gogle.lastName).toBe(released.gameName);
    expect(gogle.since).toBe(dateToDay(released.released));
  });

  it('дата первой модели учитывает сдвиг дня выхода ходом соперника (rivalDayIn)', () => {
    const gtp3 = byId('gtp-3');
    const s = stateAt('2022-06-01', [gtp3.id]);
    s.rivalry.overrides[gtp3.id] = { dayShift: -20 };
    const openbrain = labRows(s).find((r) => r.owner === gtp3.lab)!;
    expect(openbrain.since).toBe(dateToDay(gtp3.released) - 20);
  });

  it('ответная модель (шаблон) считается выпущенной со своим днём выхода', () => {
    const t = RIVAL_REACTIVE.find((x) => x.lab === 'zhipo')!;
    const s = stateAt('2024-01-01', [t.id]);
    const day = dateToDay('2023-10-05');
    s.rivalry.extra[t.id] = day;
    const zhipo = labRows(s).find((r) => r.owner === 'zhipo')!;
    expect(zhipo.count).toBe(1);
    expect(zhipo.lastName).toBe(t.gameName);
    expect(zhipo.since).toBe(day);
  });

  it('у соперников есть характер и настрой, у вашей лаборатории - нет', () => {
    const s = stateAt('2022-06-01', ['gtp-3']);
    const rows = labRows(s);
    const me = rows.find((r) => r.owner === 'player')!;
    expect(me.character).toBeNull();
    expect(me.stance).toBeNull();
    expect(me.lastMove).toBeNull();

    for (const r of rows) {
      if (r.owner === 'player') continue;
      const p = personalityOf(r.owner);
      expect(r.character).toEqual({ archetype: p.archetype, description: p.description });
      expect(r.stance).toEqual(labStance(s, r.owner));
      expect(r.stance!.label.length).toBeGreaterThan(0);
      expect(r.stance!.hint.length).toBeGreaterThan(0);
    }
  });

  it('последний ход - последняя строка истории этой лаборатории, а не чужая', () => {
    const s = stateAt('2023-06-01', ['gtp-3']);
    const d = dateToDay('2023-03-01');
    s.rivalry.history = [row(d, 'openbrain', 'первый'), row(d + 10, 'openbrain', 'второй'), row(d + 20, 'gogle', 'чужой')];
    const rows = labRows(s);
    expect(rows.find((r) => r.owner === 'openbrain')!.lastMove).toEqual(row(d + 10, 'openbrain', 'второй'));
    expect(rows.find((r) => r.owner === 'gogle')!.lastMove).toEqual(row(d + 20, 'gogle', 'чужой'));
    expect(rows.find((r) => r.owner === 'zhipo')!.lastMove).toBeNull();
  });
});

describe('recentMoves', () => {
  it('без ходов - пусто', () => {
    expect(recentMoves(stateAt('2022-06-01'))).toEqual([]);
  });

  it(`не больше ${RECENT_MOVES} последних строк, новые сверху`, () => {
    const s = stateAt('2024-01-01');
    const d = dateToDay('2023-01-01');
    s.rivalry.history = Array.from({ length: RECENT_MOVES + 3 }, (_, i) => row(d + i, 'openbrain', `ход ${i}`));
    const out = recentMoves(s);
    expect(out).toHaveLength(RECENT_MOVES);
    expect(out[0].text).toBe(`ход ${RECENT_MOVES + 2}`);
    expect(out[RECENT_MOVES - 1].text).toBe('ход 3');
    // Исходная история не меняется.
    expect(s.rivalry.history[0].text).toBe('ход 0');
  });
});

// ---------- Рынок: сегменты и таблица моделей ----------

/** Состояние на дату с выпущенными моделями соперников и записанным рынком (один шаг dayStep). */
function marketState(date: string, released: string[]): GameState {
  const s = stateAt(date, released);
  dayStep(s);
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

const CHAT_ERA = ['gtp-3', 'tixt-davanci-003', 'chatgtp', 'gtp-3-5-turbu', 'gtp-4'];

describe('segmentViews', () => {
  it('до чат-момента карточка обычных закрыта, API-сегменты открыты и непусты', () => {
    const s = marketState('2022-06-01', ['gtp-3']);
    const views = segmentViews(s, marketSnapshot(s));
    expect(views.map((v) => v.id)).toEqual(['consumers', 'enterprise', 'developers']);

    const consumers = views[0];
    expect(consumers.open).toBe(false);
    expect(consumers.demand).toBe(0);
    expect(consumers.rows).toEqual([]);
    expect(consumers.leader).toBeNull();
    expect(consumers.noneShare).toBe(1);
    expect(SUBS_CLOSED).toBe('Подписки появятся позже.');

    for (const v of views.slice(1)) {
      expect(v.open).toBe(true);
      expect(v.channel).toBe('api');
      expect(v.demand).toBeGreaterThan(0);
      expect(v.rows.map((r) => r.key)).toContain('rival:gtp-3');
      expect(v.leader?.owner).toBe('openbrain');
    }
  });

  it('после чат-момента у обычных есть модели, канал - подписка, лидер - OpenBrain', () => {
    const s = marketState('2023-06-01', CHAT_ERA);
    const consumers = segmentViews(s, marketSnapshot(s))[0];
    expect(consumers.open).toBe(true);
    expect(consumers.channel).toBe('subs');
    expect(consumers.demand).toBeGreaterThan(0);
    expect(consumers.rows.map((r) => r.key)).toContain('rival:chatgtp');
    expect(consumers.leader?.owner).toBe('openbrain');
    expect(consumers.values.length).toBeGreaterThan(0);
  });

  it('доли берутся из записанного s.market.segments, строки отсортированы по доле, сумма с «вне рынка» не больше единицы', () => {
    const s = marketState('2023-06-01', CHAT_ERA);
    s.market.segments.consumers.shares['rival:chatgtp'] = 0.123;
    const consumers = segmentViews(s, marketSnapshot(s))[0];
    expect(consumers.rows.find((r) => r.key === 'rival:chatgtp')!.share).toBe(0.123);
    const shares = consumers.rows.map((r) => r.share);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);

    const fresh = marketState('2023-06-01', CHAT_ERA);
    const dev = segmentViews(fresh, marketSnapshot(fresh))[2];
    const total = dev.rows.reduce((sum, r) => sum + r.share, 0) + dev.noneShare;
    expect(dev.rows.length).toBeLessThanOrEqual(4);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
    expect(total).toBeGreaterThan(0.5);
  });

  it('пока доли не записаны (первый день игры), берутся доли снимка, их сумма с «вне рынка» - единица', () => {
    const s = stateAt('2023-06-01', ['gtp-3', 'gtp-3-5-turbu']);
    const snap = marketSnapshot(s);
    const dev = segmentViews(s, snap)[2];
    expect(dev.rows.length).toBe(snap.segments.developers.entries.length);
    expect(dev.rows.reduce((sum, r) => sum + r.share, 0) + dev.noneShare).toBeCloseTo(1, 9);
  });

  it('ваша модель попадает в карточку; доля игрока - из записанных долей сегмента', () => {
    const s = stateAt('2023-06-01', CHAT_ERA);
    s.models = [player({ arenaElo: 700, price: 40 })];
    s.compute.rented.h100 = 1000;
    s.compute.alloc = { training: 0, contracts: 0, experiments: 0, api: 1, subs: 0 };
    dayStep(s);
    const dev = segmentViews(s, marketSnapshot(s))[2];
    expect(dev.rows.some((r) => r.owner === 'player')).toBe(true);
    expect(dev.playerShare).toBe(s.market.segments.developers.labShares.player);
  });
});

describe('marketRows', () => {
  it('чат без API (ChatGTP) - только в подписке; модель с API и чатом - в обоих каналах', () => {
    const s = marketState('2023-06-01', CHAT_ERA);
    const rows = marketRows(s, marketSnapshot(s));
    const chat = rows.find((r) => r.key === 'rival:chatgtp')!;
    expect(chat.apiPrice).toBeNull();
    expect(chat.apiTokens).toBeNull();
    expect(chat.subsPrice).toBeGreaterThan(0);
    expect(chat.subsUsers).toBeGreaterThan(0);
    expect(chat.seg.consumers).not.toBeNull();
    expect(chat.seg.enterprise).toBeNull();
    expect(chat.seg.developers).toBeNull();

    const turbo = rows.find((r) => r.key === 'rival:gtp-3-5-turbu')!;
    expect(turbo.apiPrice).toBeGreaterThan(0);
    expect(turbo.subsPrice).toBeGreaterThan(0);
    expect(turbo.seg.consumers).not.toBeNull();
    expect(turbo.seg.enterprise).not.toBeNull();
    expect(turbo.seg.developers).not.toBeNull();
  });

  it('до чат-момента ни у кого нет цены подписки, модель игрока с подпиской продаётся только по API', () => {
    const s = stateAt('2022-06-01', ['gtp-3']);
    s.models = [player({ onSubs: true })];
    dayStep(s);
    const rows = marketRows(s, marketSnapshot(s));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.subsPrice).toBeNull();
      expect(r.seg.consumers).toBeNull();
    }
    expect(rows.find((r) => r.owner === 'player')?.apiPrice).toBe(3);
  });

  it('строки отсортированы по общей доле; общая доля берётся из s.market.shares', () => {
    const s = marketState('2023-06-01', CHAT_ERA);
    const rows = marketRows(s, marketSnapshot(s));
    const shares = rows.map((r) => r.share);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
    for (const r of rows) expect(r.share).toBe(s.market.shares[r.key] ?? 0);
  });

  it('без записанных долей общая доля - взвешенная сумма долей сегментов', () => {
    const s = stateAt('2023-06-01', CHAT_ERA);
    const snap = marketSnapshot(s);
    const turbo = marketRows(s, snap).find((r) => r.key === 'rival:gtp-3-5-turbu')!;
    let expected = 0;
    for (const id of ['consumers', 'enterprise', 'developers'] as const) {
      expected += snap.segments[id].weight * (turbo.seg[id] ?? 0);
    }
    expect(turbo.share).toBeCloseTo(expected, 12);
  });
});

describe('usersLabel и demandLabel', () => {
  it('склоняет малые числа пользователей и сокращает большие', () => {
    expect(usersLabel(1)).toBe('1 пользователь');
    expect(usersLabel(3)).toBe('3 пользователя');
    expect(usersLabel(5)).toBe('5 пользователей');
    expect(usersLabel(1.2e6)).toBe('1,2 млн пользователей');
    expect(usersLabel(Number.NaN)).toBe('-');
  });

  it('спрос подписки - в пользователях, спрос API - в токенах в день', () => {
    expect(demandLabel('subs', 7e6)).toBe('7 млн пользователей');
    expect(demandLabel('api', 1.2e9)).toBe('1,2 млрд токенов в день');
  });
});
