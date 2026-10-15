import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/actions';
import { runBot } from '../sim/bots';
import { gpusPerMw } from '../sim/datacenters';
import { emptyDuel } from '../sim/duel';
import { emptyLate } from '../sim/lateState';
import { dateToDay } from '../sim/time';
import type { GameState } from '../sim/types';
import { ACH_GROUPS, ACHIEVEMENTS } from './achievementList';

const got = (s: GameState): string[] => ACHIEVEMENTS.filter((a) => a.check(s)).map((a) => a.id);

describe('достижения', () => {
  it('id не повторяются, у каждого есть название и условие', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) expect(a.title && a.how).toBeTruthy();
  });

  it('каждое достижение ровно в одном разделе окна', () => {
    const inGroups = ACH_GROUPS.flatMap((g) => g.ids);
    expect(new Set(inGroups).size).toBe(inGroups.length);
    expect([...inGroups].sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });

  it('тексты: только дефис, без юникод-значков', () => {
    for (const a of ACHIEVEMENTS) expect(`${a.title} ${a.how}`).not.toMatch(/[—–★✓▲▼]/);
  });

  it('новая партия - ни одного достижения; партия бота до конца - часть достижений получена', () => {
    const fresh = newGame('Тест', 1);
    expect(got(fresh)).toEqual([]);
    const { state } = runBot('reasonable', 2, 4000, 'normal');
    const ids = got(state);
    expect(ids).toContain('first-model');
    expect(ids).toContain('ten-models');
    expect(ids).toContain('tasks-10'); // бот выполняет десятки задач за партию
    expect(ids.length).toBeGreaterThan(5);
  });

  it('условия не падают на партии без поздней игры и досье (старое сохранение)', () => {
    const s = newGame('Тест', 3);
    delete s.late;
    delete s.duel;
    s.yearly.reviews = [];
    expect(() => got(s)).not.toThrow();
    const { state } = runBot('strong', 3, 4000, 'normal');
    delete state.late;
    delete state.duel;
    expect(() => got(state)).not.toThrow();
  });

  it('новые системы: задачи, риск, везение, соперник, сделки, финал, дата-центры', () => {
    const s = newGame('Тест', 4);
    s.day = dateToDay('2024-11-01');
    s.quests.done = 30;
    expect(got(s)).toEqual(expect.arrayContaining(['tasks-10', 'tasks-30']));

    // Везение: три «повезло» подряд, «не повезло» прерывает серию.
    const mail = (lucky: boolean) => ({ id: `m${s.nextMailNum++}`, day: s.day, read: true, kind: 'event' as const, title: '', body: '', outcome: { lucky, text: '' } });
    s.mail = [mail(true), mail(true), mail(false), mail(true)];
    expect(got(s)).not.toContain('lucky-streak');
    s.mail.push(mail(true), mail(true));
    expect(got(s)).toContain('lucky-streak');

    // Главный соперник обойдён трижды.
    s.duel = emptyDuel();
    s.duel.main = 'gogle';
    s.duel.labs.gogle.youPassed = 2;
    expect(got(s)).not.toContain('main-rival');
    s.duel.labs.gogle.youPassed = 3;
    expect(got(s)).toContain('main-rival');

    // Сделки и финал.
    s.late = emptyLate();
    expect(got(s)).not.toContain('startup');
    s.late.teams.push({ id: 'research', since: s.day });
    s.late.startups.push({ id: 'mozaic', status: 'bought', day: s.day }, { id: 'kodeium', status: 'rival', day: s.day, lab: 'openbrain' });
    s.late.cloudPast.push('azura');
    s.late.finale.done.push({ modelId: 'p1', day: s.day, gain: 10 });
    expect(got(s)).toEqual(expect.arrayContaining(['star-team', 'startup', 'cloud-deal', 'final-update']));
    expect(got(s)).not.toContain('startups-3');
    expect(got(s)).not.toContain('push-held');
    s.late.startups.push({ id: 'charakter', status: 'bought', day: s.day }, { id: 'skale', status: 'bought', day: s.day });
    s.late.finale.pushes.push({ lab: 'gogle', modelId: 'x', kind: 'update', announceDay: s.day, fireDay: s.day, base: 1300, target: 1320, playerElo: 1310, fired: true });
    s.outcome = 'victory';
    expect(got(s)).toEqual(expect.arrayContaining(['startups-3', 'push-held']));

    // Удержанная команда: письмо соперника с выбором «Удержать команду».
    s.mail.push({ ...mail(false), outcome: undefined, eventId: 'rival-poach-team', chosen: 1 });
    expect(got(s)).not.toContain('team-kept');
    s.mail[s.mail.length - 1].chosen = 0;
    expect(got(s)).toContain('team-kept');

    // Дата-центр 50 МВт, заполненный картами.
    const dc = { site: 'lulea' as const, mw: 50, startedDay: 0, stage: 4, stageEndDay: 0, delayDays: 0, stageDelay: 0, paid: 0, gpus: { p100: 0, v100: 0, a100: 0, h100: 0, h200: 0 }, orders: [] };
    s.datacenters.list = [dc];
    expect(got(s)).toContain('dc-50');
    expect(got(s)).not.toContain('dc-full');
    dc.gpus.h100 = gpusPerMw('lulea', 'h100') * 50;
    expect(got(s)).toContain('dc-full');
  });
});
