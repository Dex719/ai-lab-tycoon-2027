// Новая игра: сложность из главного меню и её модификаторы навсегда; начальное состояние соперников.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { modValue } from './events';
import { DIFFICULTY, DIFFICULTY_IDS, emptyRivalry } from './rivalry';
import { createInitialState } from './state';
import { END_DAY } from './time';

describe('newGame и сложность', () => {
  it('по умолчанию Обычная: без модификаторов сложности, соперники спокойны', () => {
    const s = newGame('Лаб', 1);
    expect(s.difficulty).toBe('normal');
    expect(s.rivalry).toEqual(emptyRivalry());
    expect(s.modifiers.filter((m) => m.id.startsWith('difficulty-'))).toEqual([]);
    expect(modValue(s, 'rentPrice').mult).toBe(1);
    expect(modValue(s, 'exposure', 'p1').mult).toBe(1);
    expect(createInitialState('Лаб', 1).difficulty).toBe('normal');
    expect(createInitialState('Лаб', 1, 'easy').difficulty).toBe('easy');
  });

  it.each(DIFFICULTY_IDS)('сложность «%s»: аренда и шанс разоблачения по таблице DIFFICULTY, навсегда', (d) => {
    const s = newGame('Лаб', 1, d);
    expect(s.difficulty).toBe(d);
    const def = DIFFICULTY[d];
    for (const day of [0, END_DAY]) {
      s.day = day;
      expect(modValue(s, 'rentPrice').mult).toBeCloseTo(def.rentPrice, 10);
      expect(modValue(s, 'exposure', 'p1').mult).toBeCloseTo(def.exposure, 10);
    }
    // Один модификатор на эффект, и только когда множитель не 1.
    expect(s.modifiers.filter((m) => m.id === 'difficulty-rent')).toHaveLength(def.rentPrice === 1 ? 0 : 1);
    expect(s.modifiers.filter((m) => m.id === 'difficulty-exposure')).toHaveLength(def.exposure === 1 ? 0 : 1);
  });

  it('письмо об основании и остальное начальное состояние не зависят от сложности', () => {
    const a = newGame('Лаб', 5, 'easy');
    const b = newGame('Лаб', 5, 'hard');
    expect(a.mail).toEqual(b.mail);
    expect(a.rng).toBe(b.rng);
    expect(a.cash).toBe(b.cash);
    expect(a.benchmarks).toEqual(b.benchmarks);
  });
});
