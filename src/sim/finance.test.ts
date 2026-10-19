// Тесты денег: письмо «Деньги закончились» и банкротство.

import { describe, expect, it } from 'vitest';
import { BANKRUPT_DAYS, OVERHEAD_MONTHLY, OVERHEAD_REVENUE_SHARE, DAYS_PER_MONTH } from './constants';
import { beginDay, closeMonth, dayStep, earn, lastMonthRevenue, overheadPerDay, revenueLast90, spend } from './finance';
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
      ...s.market,
      shares: { none: 0.6, 'player:p1': 0.4 },
      labShares: { ...s.market.labShares, none: 0.6, player: 0.4 },
      playerTokens: 123,
      lostFraction: 0.5,
      totalTokens: 1000,
      playerSubs: 77,
    };
    s.finance.month.income.api = 50;
    closeMonth(s);
    const h = s.finance.history[s.finance.history.length - 1];
    expect(h.year).toBe(2020);
    expect(h.month).toBe(3);
    expect(h.marketShare).toBe(0.4);
    expect(h.tokensPerDay).toBe(123);
    expect(h.subscribers).toBe(77);
    expect(h.income.api).toBe(50);
    expect(h.cashEnd).toBe(s.cash);
    expect(s.finance.month.income.api).toBe(0); // новый месяц начат с нуля
    expect(s.finance.month.income.subs).toBe(0);
    expect(s.finance.month.expense.review).toBe(0);
  });
});

describe('подписки и проверки в учёте', () => {
  it('earn(subs) идёт в кассу, в статью «Подписки» и в выручку 90 дней; инвесторы - нет', () => {
    const s = createInitialState('Тест', 1);
    beginDay(s);
    const cash = s.cash;
    earn(s, 'subs', 1000);
    earn(s, 'api', 300);
    earn(s, 'investors', 5000);
    expect(s.cash).toBe(cash + 6300);
    expect(s.finance.month.income.subs).toBe(1000);
    expect(s.finance.month.income.api).toBe(300);
    expect(revenueLast90(s)).toBe(1300);
  });

  it('выручка месяца включает подписки: накладные 3 % считаются от API + подписок + контрактов', () => {
    const s = createInitialState('Тест', 1);
    s.day = dateToDay('2020-03-31');
    s.finance.month.income.api = 100;
    s.finance.month.income.subs = 200;
    s.finance.month.income.contracts = 300;
    s.finance.month.income.investors = 10_000;
    closeMonth(s);
    expect(lastMonthRevenue(s)).toBe(600);
    expect(overheadPerDay(s)).toBeCloseTo((OVERHEAD_MONTHLY + OVERHEAD_REVENUE_SHARE * 600) / DAYS_PER_MONTH, 9);
  });

  it('spend(review) списывает деньги в статью «Проверки»', () => {
    const s = createInitialState('Тест', 1);
    const cash = s.cash;
    spend(s, 'review', 300_000);
    expect(s.cash).toBe(cash - 300_000);
    expect(s.finance.month.expense.review).toBe(300_000);
    spend(s, 'review', -5); // отрицательное и нулевое не списывается
    spend(s, 'review', 0);
    expect(s.finance.month.expense.review).toBe(300_000);
  });
});
