// Деньги, помесячный учёт, накладные расходы и банкротство (FR-1.5, FR-14.5).

import { BANKRUPT_DAYS, EMERGENCY_ROUND_DAYS, OVERHEAD_MONTHLY, OVERHEAD_REVENUE_SHARE, DAYS_PER_MONTH } from './constants';
import { rentPerDay } from './compute';
import { countryCostMult } from './country';
import { addMail } from './events';
import { emptyLedger } from './state';
import { dayToDate } from './time';
import type { ExpenseKind, GameState, IncomeKind } from './types';

const REVENUE_WINDOW = 90;

/** Начало дня: открыть ячейку выручки на сегодня. Вызывается первым в тике. */
export function beginDay(s: GameState): void {
  s.finance.revenueDaily.push(0);
  if (s.finance.revenueDaily.length > REVENUE_WINDOW) s.finance.revenueDaily.shift();
}

/** Слушатель движения денег для интерфейса (летящие суммы, звук). Симуляция от него не зависит и в сохранение он не попадает. */
type MoneyListener = (kind: IncomeKind | ExpenseKind, amount: number, tag?: string) => void;
let moneyListener: MoneyListener | null = null;

export function setMoneyListener(f: MoneyListener | null): void {
  moneyListener = f;
}

/** tag - подпись для интерфейса («Награда»), на учёт не влияет. */
export function earn(s: GameState, kind: IncomeKind, amount: number, tag?: string): void {
  if (!(amount > 0)) return;
  moneyListener?.(kind, amount, tag);
  s.cash += amount;
  s.finance.month.income[kind] += amount;
  if (kind !== 'investors') {
    const r = s.finance.revenueDaily;
    if (r.length === 0) r.push(0);
    r[r.length - 1] += amount;
  }
}

export function spend(s: GameState, kind: ExpenseKind, amount: number): void {
  if (!(amount > 0)) return;
  moneyListener?.(kind, -amount);
  s.cash -= amount;
  s.finance.month.expense[kind] += amount;
}

/** Выручка (API + подписки + контракты) за последние 90 дней. */
export function revenueLast90(s: GameState): number {
  return s.finance.revenueDaily.reduce((a, b) => a + b, 0);
}

/** Выручка за последний закрытый месяц: API + подписки + контракты (без инвесторов). */
export function lastMonthRevenue(s: GameState): number {
  const h = s.finance.history[s.finance.history.length - 1];
  return h ? h.income.api + h.income.subs + h.income.contracts : 0;
}

export function overheadPerDay(s: GameState): number {
  return ((OVERHEAD_MONTHLY + OVERHEAD_REVENUE_SHARE * lastMonthRevenue(s)) / DAYS_PER_MONTH) * countryCostMult(s);
}

/** Ежедневные расходы и проверка банкротства. Вызывается после рынка и контрактов. */
export function dayStep(s: GameState): void {
  spend(s, 'rent', rentPerDay(s));
  spend(s, 'overhead', overheadPerDay(s));
  if (s.cash < 0) {
    if (s.finance.negativeDays === 0) {
      addMail(s, {
        kind: 'finance',
        title: 'Деньги закончились',
        important: true,
        body:
          `Баланс счёта отрицательный. Если за ${BANKRUPT_DAYS} дней он не станет положительным, лаборатория обанкротится. ` +
          `В «Инвесторах» экстренный раунд можно начать сразу, даже если год с прошлого не прошёл: переговоры идут ${EMERGENCY_ROUND_DAYS} дней, оценка ниже на 40 %. ` +
          'Ещё помогут меньшая аренда и тендеры.',
      });
    }
    s.finance.negativeDays += 1;
    if (s.finance.negativeDays >= BANKRUPT_DAYS) s.outcome = 'bankrupt';
  } else {
    s.finance.negativeDays = 0;
  }
}

/** Закрыть месяц: записать итог в историю (вызывается в последний день месяца). */
export function closeMonth(s: GameState): void {
  const d = dayToDate(s.day);
  s.finance.history.push({
    ...s.finance.month,
    year: d.year,
    month: d.month,
    cashEnd: s.cash,
    // Доля, токены и подписчики - после ограничения мощностью (market.dayStep пишет обслуженные значения).
    marketShare: s.market.labShares.player ?? 0,
    tokensPerDay: s.market.playerTokens,
    subscribers: s.market.playerSubs,
  });
  s.finance.month = emptyLedger();
}
