// «Новая модель»: размер всегда внутри границ выбранного уровня (иначе симуляция отклонит проект),
// пресет уровня проходит проверку, устаревший черновик возвращается к пресету.

import { describe, expect, it } from 'vitest';
import { newGame } from '../../sim/actions';
import { dateToDay, END_DAY, START_DAY } from '../../sim/time';
import { tierAvailable, tierOf, validatePlan } from '../../sim/training';
import { TIER_IDS, type GameState, type Tier, type TrainingPlan } from '../../sim/types';
import { fitTier, normalizeDraft, pickTier, presetOf, tierSpan, type Draft } from './TrainingWindow';

function stateOn(iso: string): GameState {
  const s = newGame('Тест', 1);
  s.day = dateToDay(iso);
  return s;
}

function planOf(tier: Tier, paramsB: number, tokensB: number): TrainingPlan {
  return {
    name: 'Проверка',
    paramsB,
    tokensB,
    mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
    benchShare: 0,
    benchTargets: [],
    rlhf: false,
    context: 512,
    tier,
  };
}

describe('tierSpan и fitTier', () => {
  it('крайние значения диапазона и любое подогнанное значение остаются в своём уровне на всех датах игры', () => {
    for (let day = START_DAY; day <= END_DAY; day += 13) {
      for (const tier of TIER_IDS) {
        if (!tierAvailable(day, tier)) continue;
        const [a, b] = tierSpan(day, tier);
        expect(a).toBeLessThanOrEqual(b);
        expect(tierOf(a, day)).toBe(tier);
        expect(tierOf(b, day)).toBe(tier);
        // слишком маленькое и слишком большое значения прижимаются к границам уровня
        expect(tierOf(fitTier(1e-6, day, tier), day)).toBe(tier);
        expect(tierOf(fitTier(1e9, day, tier), day)).toBe(tier);
        expect(fitTier((a + b) / 2, day, tier)).toBeCloseTo((a + b) / 2, 9);
      }
    }
  });

  it('в 2017 году лёгкая модель - от 50 до 80 млн параметров, средняя - до 350 млн', () => {
    const day = dateToDay('2017-01-01');
    const [lo, hi] = tierSpan(day, 'light');
    expect(lo).toBeCloseTo(0.05, 6);
    expect(hi).toBeLessThan(0.08);
    expect(hi).toBeGreaterThan(0.0799);
    const [mLo, mHi] = tierSpan(day, 'mid');
    expect(mLo).toBeGreaterThanOrEqual(0.08);
    expect(mHi).toBeLessThan(0.35);
  });
});

describe('пресет уровня', () => {
  it('размер пресета в границах уровня, проект с пресетом проходит проверку симуляции', () => {
    for (const iso of ['2017-01-01', '2019-06-01', '2021-03-15', '2023-07-01', '2024-11-30']) {
      const s = stateOn(iso);
      for (const tier of TIER_IDS) {
        if (!tierAvailable(s.day, tier)) continue;
        const p = presetOf(s, tier);
        const [a, b] = tierSpan(s.day, tier);
        expect(p.paramsB).toBeGreaterThanOrEqual(a);
        expect(p.paramsB).toBeLessThanOrEqual(b);
        expect(tierOf(p.paramsB, s.day)).toBe(tier);
        expect(validatePlan(s, planOf(tier, p.paramsB, p.tokensB))).toBeNull();
      }
    }
  });

  it('уровни по размеру растут: лёгкая меньше средней, средняя меньше флагмана', () => {
    const s = stateOn('2023-07-01');
    const light = presetOf(s, 'light').paramsB;
    const mid = presetOf(s, 'mid').paramsB;
    const flagship = presetOf(s, 'flagship').paramsB;
    expect(light).toBeLessThan(mid);
    expect(mid).toBeLessThan(flagship);
  });
});

describe('черновик и смена года', () => {
  const draft = (tier: Tier, paramsB: number): Draft => ({
    game: 'g',
    name: null,
    tier,
    paramsB,
    tokensB: 10,
    mix: { language: 50, code: 25, reasoning: 25 },
    share: 0,
    targets: [],
    rlhf: false,
    context: null,
  });

  it('подходящий черновик не меняется', () => {
    const s = stateOn('2017-01-01');
    const d = draft('flagship', 0.5);
    expect(normalizeDraft(s, d)).toBe(d);
  });

  it('размер, который вышел из уровня за годы, заменяется пресетом уровня', () => {
    const s = stateOn('2024-11-30');
    const out = normalizeDraft(s, draft('flagship', 0.5));
    expect(out.tier).toBe('flagship');
    expect(out.paramsB).toBeGreaterThan(300);
    expect(tierOf(out.paramsB, s.day)).toBe('flagship');
  });

  it('pickTier оставляет доступный уровень', () => {
    const s = stateOn('2020-01-01');
    for (const t of TIER_IDS) expect(pickTier(s, t)).toBe(t);
  });
});
