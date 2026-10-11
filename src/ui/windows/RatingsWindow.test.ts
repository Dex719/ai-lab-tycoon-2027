// Таблицы рейтингов: строки только показанных моделей (announcedOnly) помечаются, столбец даты меняет заголовок,
// в «Арене» места считаются только среди моделей в продаже (через API).

import { describe, expect, it } from 'vitest';
import { RIVAL_MODELS } from '../../data/rivalModels';
import { leaderboard, marketArenaRank } from '../../sim/leaderboard';
import { createInitialState } from '../../sim/state';
import { dateToDay, END_DAY } from '../../sim/time';
import type { GameState, PlayerModel } from '../../sim/types';
import { arenaRows, dateHeader, expectedLeaderElo10, inSaleRow, isAnnouncedRow } from './RatingsWindow';

const byId = (id: string) => RIVAL_MODELS.find((m) => m.id === id)!;

function stateWith(ids: string[]) {
  const s = createInitialState('Тест', 1);
  s.day = dateToDay('2022-06-01');
  s.rivalsReleased = ids;
  return s;
}

/** Выпущенная модель игрока с заданным Эло; onApi - в продаже или снята. */
function playerModel(s: GameState, id: string, arenaElo: number, onApi: boolean): PlayerModel {
  const m: PlayerModel = {
    id,
    name: `Модель ${id}`,
    plan: { name: `Модель ${id}`, paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 }, benchShare: 0, benchTargets: [], rlhf: false, context: 2048 },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: s.day - 10,
    releasedDay: s.day - 5,
    caps: { language: 40, code: 30, reasoning: 30 },
    overfit: {},
    rlhf: false,
    arenaElo,
    price: 10,
    onApi,
    exposed: false,
    earned: 0,
  };
  s.models.push(m);
  return m;
}

describe('isAnnouncedRow', () => {
  it('строка показанной модели помечена, выпущенной - нет', () => {
    const rows = leaderboard(stateWith(['gtp-3', 'paln']));
    const paln = rows.find((r) => r.ref.kind === 'rival' && r.ref.id === 'paln')!;
    const gtp3 = rows.find((r) => r.ref.kind === 'rival' && r.ref.id === 'gtp-3')!;
    expect(byId('paln').announcedOnly).toBe(true);
    expect(isAnnouncedRow(paln)).toBe(true);
    expect(isAnnouncedRow(gtp3)).toBe(false);
  });
});

describe('dateHeader', () => {
  it('«Выпущена», пока в таблице только выпущенные модели', () => {
    expect(dateHeader(leaderboard(stateWith(['gtp-3'])))).toEqual({ label: 'Выпущена' });
    expect(dateHeader([])).toEqual({ label: 'Выпущена' });
  });

  it('«Дата» с подсказкой, если среди строк есть только показанная модель', () => {
    const h = dateHeader(leaderboard(stateWith(['gtp-3', 'paln'])));
    expect(h.label).toBe('Дата');
    expect(h.title).toContain('анонса');
  });
});

describe('inSaleRow', () => {
  it('в продаже - соперник с API, не только показанный; ваша модель - выпущенная и на API', () => {
    // gtp-3: API; t5x: только открытые веса; paln: только показана.
    expect(byId('gtp-3').api).toBe(true);
    expect(byId('t5x').api).toBe(false);
    expect(byId('t5x').openWeights).toBe(true);

    const s = stateWith(['gtp-3', 't5x', 'paln']);
    playerModel(s, 'p1', 850, true);
    playerModel(s, 'p2', 840, false);
    const rows = leaderboard(s);
    const find = (kind: 'player' | 'rival', id: string) => rows.find((r) => r.ref.kind === kind && r.ref.id === id)!;

    expect(inSaleRow(find('rival', 'gtp-3'))).toBe(true);
    expect(inSaleRow(find('rival', 't5x'))).toBe(false);
    expect(inSaleRow(find('rival', 'paln'))).toBe(false);
    expect(inSaleRow(find('player', 'p1'))).toBe(true);
    expect(inSaleRow(find('player', 'p2'))).toBe(false);
  });
});

describe('arenaRows', () => {
  it('строки по убыванию Эло; место есть только у моделей в продаже и совпадает с marketArenaRank', () => {
    const s = stateWith(['gtp-3', 't5x', 'paln']);
    playerModel(s, 'p1', 850, true);
    const ranked = arenaRows(s, leaderboard(s));

    const elos = ranked.map((x) => x.row.elo);
    expect(elos).toEqual(elos.slice().sort((a, b) => b - a));

    const get = (kind: 'player' | 'rival', id: string) => ranked.find((x) => x.row.ref.kind === kind && x.row.ref.id === id)!;
    // PaLN (900, только показана) выше всех по Эло, но места у неё нет.
    expect(ranked[0].row.ref).toEqual({ kind: 'rival', id: 'paln' });
    expect(get('rival', 'paln').inSale).toBe(false);
    expect(get('rival', 'paln').rank).toBeNull();
    expect(get('rival', 't5x').rank).toBeNull();

    expect(get('player', 'p1').rank).toBe(1);
    expect(get('rival', 'gtp-3').rank).toBe(2);
    for (const x of ranked) if (x.inSale) expect(x.rank).toBe(marketArenaRank(s, x.row.ref));
  });

  it('пустой список - пустые строки', () => {
    expect(arenaRows(stateWith([]), [])).toEqual([]);
  });
});

describe('expectedLeaderElo10', () => {
  it('лучший Эло соперников с API к концу игры, округлённый до десятков', () => {
    const s = stateWith(['gtp-3']);
    let best = 0;
    for (const m of RIVAL_MODELS) {
      if (m.api && !m.announcedOnly && dateToDay(m.released) <= END_DAY && m.arenaElo > best) best = m.arenaElo;
    }
    expect(best).toBeGreaterThan(0);
    expect(expectedLeaderElo10(s)).toBe(Math.round(best / 10) * 10);
  });
});
