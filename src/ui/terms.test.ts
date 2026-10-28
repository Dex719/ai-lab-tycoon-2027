import { describe, expect, it } from 'vitest';
import { BENCHMARKS } from '../data/benchmarks';
import { glossFor, TERMS } from './terms';

describe('подсказки к терминам', () => {
  it('Эло находится в тексте прогноза, но не внутри другого слова', () => {
    expect(glossFor('Прогноз Эло')).toContain('«Арене»');
    expect(glossFor('Эловый')).toBeUndefined();
  });

  it('H100e находится в числе с единицей', () => {
    expect(glossFor('1,2 H100e')).toBeDefined();
  });

  it('токен и бенчмарк находятся в формах с окончаниями', () => {
    expect(glossFor('Данные: 3,4 млрд токенов')).toContain('Клиенты платят');
    expect(glossFor('Новый бенчмарк SQuAT')).toContain('Бенчмарк - общий тест');
  });

  it('тексты без терминов не получают подсказку', () => {
    expect(glossFor('Обучение идёт')).toBeUndefined();
  });

  it('у каждого бенчмарка есть описание для подсказки', () => {
    for (const b of BENCHMARKS) {
      expect(b.about, b.id).toBeTruthy();
      expect(glossFor(b.name), b.id).toBe(b.about);
    }
  });

  it('подсказки короткие и без длинных тире', () => {
    for (const t of TERMS) {
      const longDashes = new RegExp('[\\u2014\\u2013\\u2212]');
      expect(t.tip, t.re.source).not.toMatch(longDashes);
      expect(t.tip.length, t.re.source).toBeLessThanOrEqual(100);
    }
  });
});
