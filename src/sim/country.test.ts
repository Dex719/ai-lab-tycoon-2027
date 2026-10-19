// Страны лаборатории и чужие данные (sim/country.ts): что меняет каждая страна, иски, сохранение.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { availableGpus, isGpuAvailable, rentCapFor, rentPerGpuDay } from './compute';
import { STOLEN_CAP_BONUS, STOLEN_TOKENS_MULT } from './constants';
import { countryCostMult, monthlyTheftSuits, theftChance, US_GPU_EARLY_DAYS } from './country';
import { triggerEvent } from './events';
import { overheadPerDay } from './finance';
import { valuation } from './investors';
import { labBrand, segBrand } from './market';
import { techCost } from './research';
import { deserialize, serialize } from './save';
import { advanceDay } from './tick';
import { dateToDay } from './time';
import { capsFromPlan, maxTokensB, validatePlan } from './training';
import type { GameState, PlayerModel, TrainingPlan } from './types';

const PLAN: TrainingPlan = {
  name: 'М', paramsB: 0.2, tokensB: 4, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
  benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'mid',
};

function model(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1', name: 'Мозг-1', plan: { ...PLAN, stolenData: true }, arch: 'transformer', algoLevel: 0, trainedDay: 10,
    releasedDay: 20, caps: { language: 30, code: 20, reasoning: 20 }, overfit: {}, rlhf: false, arenaElo: 900, price: 10,
    onApi: true, exposed: false, earned: 1_000_000, onSubs: true, subsPrice: 10, review: 'none', reviewEndDay: null, earnedSubs: 0,
    ...over,
  };
}

function at(s: GameState, date: string): GameState {
  s.day = dateToDay(date);
  return s;
}

describe('страна на старте', () => {
  it('без страны (старые сохранения, боты) - всё как раньше', () => {
    const a = newGame('Т', 1);
    expect(a.country).toBeUndefined();
    expect(countryCostMult(a)).toBe(1);
    expect(a.modifiers.some((m) => m.id.startsWith('country-'))).toBe(false);
  });

  it('письмо об основании называет город и особенности страны', () => {
    const s = newGame('Т', 1, 'normal', 'cn');
    expect(s.mail[0].body).toContain('Ханчжоу, Китай');
    expect(s.mail[0].body).toContain('Минусы:');
  });

  it('США: новая карта на 90 дней раньше, офис дороже, инвесторы оценивают дороже', () => {
    const us = at(newGame('Т', 1, 'normal', 'us'), '2017-08-01');
    const none = at(newGame('Т', 1), '2017-08-01');
    expect(dateToDay('2017-10-25') - us.day).toBeLessThan(US_GPU_EARLY_DAYS);
    expect(isGpuAvailable(us, 'v100')).toBe(true);
    expect(isGpuAvailable(none, 'v100')).toBe(false);
    expect(availableGpus(us).map((g) => g.id)).toContain('v100');
    expect(overheadPerDay(us) / overheadPerDay(none)).toBeCloseTo(1.3, 6);
    expect(valuation(us).total / valuation(none).total).toBeCloseTo(1.2, 6);
  });

  it('США: письмо о новой карте приходит в день, когда её можно арендовать', () => {
    const s = newGame('Т', 1, 'normal', 'us');
    while (!isGpuAvailable(s, 'v100')) advanceDay(s);
    advanceDay(s);
    const mail = s.mail.find((m) => m.title.includes('Fermi V100'));
    expect(mail?.body).toContain('Лаборатории в США получили её раньше остальных');
    expect(s.day).toBeLessThan(dateToDay('2017-10-25'));
  });

  it('Китай: офис дешевле, бренд у зарубежных клиентов ниже; запрет 2022 года - мощные карты дороже и их меньше', () => {
    const cn = newGame('Т', 1, 'normal', 'cn');
    const none = newGame('Т', 1);
    expect(countryCostMult(cn)).toBeCloseTo(0.7, 9);
    expect(labBrand(cn, 'player')).toBeLessThan(labBrand(none, 'player'));
    at(cn, '2022-10-08');
    at(none, '2022-10-08');
    const capBefore = rentCapFor(cn, 'a100');
    const priceBefore = rentPerGpuDay(cn, 'a100');
    triggerEvent(cn, 'export-controls-2022');
    triggerEvent(none, 'export-controls-2022');
    expect(rentCapFor(cn, 'a100')).toBe(Math.floor(capBefore * 0.25));
    expect(rentPerGpuDay(cn, 'a100')).toBeCloseTo(priceBefore * 1.5, 6);
    expect(rentCapFor(none, 'a100')).toBe(capBefore);
    expect(cn.mail.some((m) => m.title === 'Запрет на чипы касается и вас')).toBe(true);
    expect(none.mail.some((m) => m.title === 'Запрет на чипы касается и вас')).toBe(false);
  });

  it('Франция: репутация +5, исследования дешевле, компании доверяют больше, аренда дороже', () => {
    const eu = newGame('Т', 1, 'normal', 'eu');
    const none = newGame('Т', 1);
    expect(eu.reputation).toBe(none.reputation + 5);
    expect(techCost(eu, 'attention') / techCost(none, 'attention')).toBeCloseTo(0.9, 6);
    expect(segBrand(eu, 'player', 'enterprise') - labBrand(eu, 'player')).toBeCloseTo(0.1, 9);
    expect(rentPerGpuDay(eu, 'p100') / rentPerGpuDay(none, 'p100')).toBeCloseTo(1.15, 6);
  });
});

describe('чужие данные', () => {
  it('лимит данных года ×1,5 и +3 к способностям во всех областях', () => {
    const s = newGame('Т', 1);
    expect(maxTokensB(s, true)).toBeCloseTo(maxTokensB(s) * STOLEN_TOKENS_MULT, 9);
    const honest = capsFromPlan(PLAN, 0, 'lstm');
    const stolen = capsFromPlan({ ...PLAN, stolenData: true }, 0, 'lstm');
    for (const d of ['language', 'code', 'reasoning'] as const) expect(stolen[d] - honest[d]).toBeCloseTo(STOLEN_CAP_BONUS, 9);
    const tokens = maxTokensB(s) * 1.2;
    expect(validatePlan(s, { ...PLAN, tokensB: tokens })).toMatch(/Максимальный объём данных/);
    expect(validatePlan(s, { ...PLAN, tokensB: tokens, stolenData: true }) ?? '').not.toMatch(/Максимальный объём данных/);
  });

  it('иск: штраф, репутация, один раз на модель; в Европе модель снимают с продажи', () => {
    for (const c of ['us', 'eu'] as const) {
      const s = newGame('Т', 3, 'normal', c);
      s.models.push(model());
      let guard = 0;
      let cashBefore = s.cash;
      let repBefore = s.reputation;
      while (!s.models[0].stolenCaught && guard++ < 2000) {
        cashBefore = s.cash;
        repBefore = s.reputation;
        monthlyTheftSuits(s);
      }
      const m = s.models[0];
      expect(m.stolenCaught).toBe(true);
      expect(s.cash).toBeLessThan(cashBefore);
      expect(s.reputation).toBeLessThan(repBefore);
      expect(m.onApi).toBe(c !== 'eu');
      expect(s.mail.at(-1)?.title).toBe('Иск за чужие данные: Мозг-1');
      const cash = s.cash;
      for (let i = 0; i < 200; i++) monthlyTheftSuits(s);
      expect(s.cash).toBe(cash);
    }
  });

  it('в Китае иски в 3 раза реже, в Европе в 2 раза чаще, чем в США; честную и невыпущенную модель не судят', () => {
    const us = theftChance(newGame('Т', 1, 'normal', 'us'));
    expect(theftChance(newGame('Т', 1, 'normal', 'cn'))).toBeCloseTo(us / 3, 9);
    expect(theftChance(newGame('Т', 1, 'normal', 'eu'))).toBeCloseTo(us * 2, 9);
    const s = newGame('Т', 1, 'normal', 'eu');
    s.models.push(model({ id: 'p1', plan: { ...PLAN } }), model({ id: 'p2', releasedDay: null }));
    for (let i = 0; i < 300; i++) monthlyTheftSuits(s);
    expect(s.models.every((m) => !m.stolenCaught)).toBe(true);
  });

  it('страна и чужие данные переживают сохранение', () => {
    const s = newGame('Т', 1, 'normal', 'cn');
    s.models.push(model({ stolenCaught: true }));
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.country).toBe('cn');
    expect(r.state.models[0].plan.stolenData).toBe(true);
    expect(r.state.models[0].stolenCaught).toBe(true);
  });
});
