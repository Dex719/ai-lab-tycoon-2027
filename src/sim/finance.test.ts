// Тесты денег: письмо «Деньги закончились» и банкротство.

import { describe, expect, it } from 'vitest';
import { BANKRUPT_DAYS } from './constants';
import { dayStep } from './finance';
import { createInitialState } from './state';
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
