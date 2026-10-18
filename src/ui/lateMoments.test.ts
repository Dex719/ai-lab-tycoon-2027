import { describe, expect, it } from 'vitest';
import { RIVAL_MODELS } from '../data/catalog';
import { newGame } from '../sim/actions';
import { runBot } from '../sim/bots';
import { emptyDuel } from '../sim/duel';
import { FINALE_START } from '../sim/finale';
import { emptyLate } from '../sim/lateState';
import { arenaStanding, type ArenaStanding } from '../sim/leaderboard';
import type { LabId } from '../sim/types';
import { lateMoments } from './lateMoments';

const BAD = /[—–★✓▲▼]/;

function stand(over: Partial<ArenaStanding>): ArenaStanding {
  return { metric: { kind: 'arena' }, rank: 1, total: 8, modelId: 'p1', modelName: 'Нейро-3', value: 1300, above: null, below: null, ahead: [], behind: [], ...over };
}

describe('газетные моменты новых систем', () => {
  it('новая и законченная партия: не падают, у законченной партии моментов нет', () => {
    const fresh = newGame('Тест', 1);
    expect(lateMoments(fresh, null)).toEqual([]);
    const { state } = runBot('strong', 2, 4000, 'normal');
    expect(() => lateMoments(state, arenaStanding(state))).not.toThrow();
    expect(lateMoments(state, arenaStanding(state))).toEqual([]);
  });

  it('покупка стартапа: название, цена и кому он достался бы', () => {
    const s = newGame('Нейрон', 1);
    s.late = emptyLate();
    s.late.startups.push({ id: 'kodeium', status: 'rival', day: 1, lab: 'openbrain' });
    expect(lateMoments(s, null)).toEqual([]);
    s.late.startups.push({ id: 'mozaic', status: 'bought', day: 2 });
    const [m] = lateMoments(s, null);
    expect(m.id).toBe('startup');
    expect(m.headline).toBe('«Нейрон» купила MozaicML');
    expect(m.sub).toContain('$130 млн');
    expect(m.body).toContain('Alibabo');
    expect(`${m.headline} ${m.sub} ${m.body}`).not.toMatch(BAD);
  });

  it('главный соперник обойдён: только свежий обгон и только если все его модели ниже', () => {
    const s = newGame('Нейрон', 1);
    s.day = 900;
    s.duel = emptyDuel();
    s.duel.main = 'gogle';
    s.duel.mainSince = 800;
    s.duel.labs.gogle = { passedYou: 2, youPassed: 3, moves: 4, lastDay: 897, letters: 1 };
    const behind = [{ id: 'g1', name: 'Gemeni 1.0', lab: 'gogle' as LabId, value: 1250, gap: 50 }];
    const st = stand({ behind });
    const [m] = lateMoments(s, st);
    expect(m.id).toBe('main-rival');
    expect(m.sub).toBe('Модель «Нейро-3» выше Gemeni 1.0 на «Арене».');
    expect(m.body).toContain('«Нейрон» - 3, Gogle DeepMynd - 2');
    expect(`${m.headline} ${m.sub} ${m.body}`).not.toMatch(BAD);
    // Другая модель главного соперника всё ещё выше - момента нет.
    expect(lateMoments(s, stand({ behind, ahead: [{ ...behind[0], id: 'g2' }] }))).toEqual([]);
    // Обгон был давно - момента нет.
    s.day = 920;
    expect(lateMoments(s, st)).toEqual([]);
  });

  it('переезд: заметка о новом этапе лаборатории, с числами без длинного тире', () => {
    const s = newGame('Нейрон', 1);
    const base = s.finance.history[0];
    s.finance.history = [{ ...(base ?? {}), year: 2020, month: 3, income: { api: 0, subs: 0, contracts: 6e6 } } as (typeof s.finance.history)[number]];
    const [m] = lateMoments(s, null);
    expect(m.id).toBe('stage-2');
    expect(m.headline).toBe('«Нейрон» заняла этаж в бизнес-центре');
    expect(m.sub).toBe('Лучший месяц лаборатории - $6 млн выручки.');
    expect(m.body).toBe('На новом месте 10 рабочих мест и серверная на 4 стойки.');
    expect(`${m.headline} ${m.sub} ${m.body}`).not.toMatch(BAD);
  });

  it('рывок отбит: рывок состоялся, лаборатория осталась первой на «Арене»', () => {
    const s = newGame('Нейрон', 1);
    s.day = FINALE_START + 20;
    const rival = RIVAL_MODELS.find((m) => m.lab === 'antropik')!;
    s.late = emptyLate();
    s.late.finale.pushes.push({ lab: 'antropik', modelId: rival.id, kind: 'update', announceDay: FINALE_START, fireDay: s.day - 3, base: 1280, target: 1310, playerElo: 1305, fired: true });
    expect(lateMoments(s, stand({ rank: 2 }))).toEqual([]);
    const [m] = lateMoments(s, stand({ value: 9000 }));
    expect(m.id).toBe('push-held');
    expect(m.sub).toMatch(/^Antropik обновила /);
    expect(m.body).toContain('Других объявленных рывков нет.');
    expect(`${m.headline} ${m.sub} ${m.body}`).not.toMatch(BAD);
  });
});
