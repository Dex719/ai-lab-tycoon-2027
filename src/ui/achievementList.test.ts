import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/actions';
import { runBot } from '../sim/bots';
import { ACHIEVEMENTS } from './achievementList';

describe('достижения', () => {
  it('id не повторяются, у каждого есть название и условие', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ACHIEVEMENTS) expect(a.title && a.how).toBeTruthy();
  });

  it('новая партия - ни одного достижения; партия бота до конца - часть достижений получена', () => {
    const fresh = newGame('Тест', 1);
    expect(ACHIEVEMENTS.filter((a) => a.check(fresh))).toEqual([]);
    const { state } = runBot('reasonable', 2, 4000, 'normal');
    const got = ACHIEVEMENTS.filter((a) => a.check(state)).map((a) => a.id);
    expect(got).toContain('first-model');
    expect(got).toContain('ten-models');
    expect(got.length).toBeGreaterThan(5);
  });
});
