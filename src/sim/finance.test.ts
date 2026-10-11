// Тесты денег: письмо «Деньги закончились» и банкротство.

import { describe, expect, it } from 'vitest';
import { BANKRUPT_DAYS } from './constants';
import { closeMonth, dayStep } from './finance';
import { createInitialState } from './state';
import { dateToDay } from './time';
import type { GameState } from './types';

function broke(): GameState {
  const s = createInitialState('Тест', 1);
  s.cash = -1000;
  return s;
}

describe('dayStep: деньги кончились', () => {
  it('первый день в минусе: важное письмо о финансах, игра встаёт на паузу', () => {
    const s = broke();
    dayStep(s);
    expect(s.mail).toHaveLength(1);
    const mail = s.mail[0];
    expect(mail.kind).toBe('finance');
    expect(mail.title).toBe('Деньги закончились');
    expect(mail.important).toBe(true);
    expect(mail.body).toContain(`за ${BANKRUPT_DAYS} дней`);
    expect(s.finance.negativeDays).toBe(1);
  });

  it('письмо приходит один раз за период в минусе, а не каждый день', () => {
    const s = broke();
    for (let i = 0; i < 5; i++) dayStep(s);
    expect(s.mail).toHaveLength(1);
    expect(s.finance.negativeDays).toBe(5);
  });

  it('выход в плюс сбрасывает счётчик, новый минус - новое письмо', () => {
    const s = broke();
    dayStep(s);
    s.cash = 1e9;
    dayStep(s);
    expect(s.finance.negativeDays).toBe(0);
    s.cash = -1e9;
    dayStep(s);
    expect(s.mail).toHaveLength(2);
    expect(s.mail.every((m) => m.important)).toBe(true);
  });

  it('в плюсе писем нет', () => {
    const s = createInitialState('Тест', 1);
    dayStep(s);
    expect(s.mail).toHaveLength(0);
  });

  it(`${BANKRUPT_DAYS}-й день подряд в минусе - банкротство`, () => {
    const s = broke();
    s.cash = -1e9;
    for (let i = 1; i < BANKRUPT_DAYS; i++) {
      dayStep(s);
      expect(s.outcome).toBeNull();
    }
    dayStep(s);
    expect(s.outcome).toBe('bankrupt');
  });
});

describe('closeMonth: история месяца', () => {
  it('берёт долю и токены игрока из s.market - уже после ограничения мощностью', () => {
    const s = createInitialState('Тест', 1);
    s.day = dateToDay('2020-03-31');
    // market.dayStep записал обслуженные значения: спрос был 0,8, обслужена половина
    s.market = {
      shares: { none: 0.6, 'player:p1': 0.4 },
      labShares: { ...s.market.labShares, none: 0.6, player: 0.4 },
      playerTokens: 123,
      lostFraction: 0.5,
      totalTokens: 1000,
    };
    s.finance.month.income.api = 50;
    closeMonth(s);
    const h = s.finance.history[s.finance.history.length - 1];
    expect(h.year).toBe(2020);
    expect(h.month).toBe(3);
    expect(h.marketShare).toBe(0.4);
    expect(h.tokensPerDay).toBe(123);
    expect(h.income.api).toBe(50);
    expect(h.cashEnd).toBe(s.cash);
    expect(s.finance.month.income.api).toBe(0); // новый месяц начат с нуля
  });
});
