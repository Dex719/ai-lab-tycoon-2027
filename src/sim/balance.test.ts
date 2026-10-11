// Опоры баланса (NFR-2, NFR-3): полный прогон 2017-2024 ботами.

import { describe, expect, it } from 'vitest';
import { runBot } from './bots';
import { leaderboard } from './leaderboard';
import { deserialize, serialize } from './save';
import { advanceDays } from './tick';
import { dateToDay, formatDate } from './time';
import { playerBestArenaRank } from './tick';
import { newGame } from './actions';

function summary(kind: string, seed: number) {
  const t0 = performance.now();
  const { state: s } = runBot(kind as never, seed);
  const ms = performance.now() - t0;
  const best = s.models.filter((m) => m.releasedDay !== null).sort((a, b) => b.arenaElo - a.arenaElo)[0];
  const top = leaderboard(s).sort((a, b) => b.elo - a.elo)[0];
  const info = {
    kind,
    seed,
    outcome: s.outcome,
    end: formatDate(s.day),
    cash: Math.round(s.cash / 1e6),
    share: Math.round(s.founderShare * 100),
    rank: playerBestArenaRank(s),
    bestElo: best ? Math.round(best.arenaElo) : null,
    topElo: top ? `${top.name} ${Math.round(top.elo)}` : null,
    models: s.models.length,
    algo: s.research.algoLevel,
    ms: Math.round(ms),
  };
  console.log(JSON.stringify(info));
  return { s, info, ms };
}

describe('баланс', () => {
  it('бот «ничего» банкротится до 2020 года', () => {
    const { s } = summary('idle', 1);
    expect(s.outcome).toBe('bankrupt');
    expect(s.day).toBeLessThan(dateToDay('2020-01-01'));
  });

  it.each([1, 2, 3])('бот «разумный» доживает до конца и входит в топ-5 Арены (зерно %i)', (seed) => {
    const { s, ms } = summary('reasonable', seed);
    expect(s.outcome).not.toBe('bankrupt');
    expect(s.outcome).not.toBeNull();
    expect(playerBestArenaRank(s)).not.toBeNull();
    expect(playerBestArenaRank(s)!).toBeLessThanOrEqual(5);
    expect(ms).toBeLessThan(5000);
  });

  it('бот «сильный» - только отчёт', () => {
    summary('strong', 7);
  });

  it('бот «подгонщик» - только отчёт', () => {
    const { s } = summary('benchmaxx', 3);
    console.log('разоблачено моделей:', s.models.filter((m) => m.exposed).length);
  });
});

describe('сохранения', () => {
  it('загрузка сохранения даёт тот же результат', () => {
    const a = newGame('A', 99);
    advanceDays(a, 400);
    const saved = serialize(a);
    advanceDays(a, 300);
    const r = deserialize(saved);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    advanceDays(r.state, 300);
    expect(serialize(r.state)).toBe(serialize(a));
  });

  it('чужая версия сохранения не ломает игру', () => {
    expect(deserialize('{"version":2}').ok).toBe(false);
    expect(deserialize('не json').ok).toBe(false);
  });
});
