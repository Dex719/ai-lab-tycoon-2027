import { describe, expect, it } from 'vitest';
import { runBot } from './bots';
import { serialize } from './save';

describe('страховка: размер сохранения и время партии', () => {
  it('полная партия бота: состояние меньше 300 тыс. символов и расчёт быстрее 20 с', () => {
    const t = performance.now();
    const { state } = runBot('reasonable', 7);
    const ms = performance.now() - t;
    // Сейчас ~150 тыс. символов и ~1,3 с; порог с запасом, чтобы новые системы не росли незаметно (TECH-8, tech-M1).
    expect(serialize(state).length).toBeLessThan(300_000);
    expect(ms).toBeLessThan(20_000);
  }, 60_000);
});
