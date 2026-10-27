// Деньги, помесячный учёт, накладные расходы и банкротство (FR-1.5, FR-14.5).

import {
  BANKRUPT_DAYS,
  DAYS_PER_MONTH,
  EMERGENCY_ROUND_DAYS,
  OVERHEAD_MONTHLY,
  OVERHEAD_REVENUE_SHARE,
  ROUND_COOLDOWN_DAYS,
  ROUND_RESCUE_GRACE_DAYS,
} from './constants';
import { rentPerDay } from './compute';
import { countryCostMult } from './country';
import { addMail } from './events';
import { emptyLedger } from './state';
import { dayToDate, formatDateShort } from './time';
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

/** Флаг состояния investors.ts (EMERGENCY_USED_FLAG): последний закрытый раунд был экстренным. */
const EMERGENCY_ROUND_USED_FLAG = 'emergencyRoundUsed';

/**
 * Что сказать в письме про раунд, по состоянию: переговоры уже идут, экстренный раунд доступен, экстренный уже был,
 * или обычный. Условия повторяют investors.ts (emergencyRound, canRaise), но без импорта: финансы не зависят от инвесторов.
 */
function roundMailLine(s: GameState): string {
  if (s.round) return `Переговоры о раунде уже идут, деньги придут ${formatDateShort(s.round.closeDay)}. `;
  const cooling = s.lastRoundDay === null || s.day < s.lastRoundDay + ROUND_COOLDOWN_DAYS;
  const used = s.flags[EMERGENCY_ROUND_USED_FLAG] === true;
  if (!used && cooling) {
    return `В «Инвесторах» экстренный раунд можно начать сразу, даже если год с прошлого не прошёл: переговоры идут ${EMERGENCY_ROUND_DAYS} дней, оценка ниже на 40 %. `;
  }
  if (used && cooling) {
    const left = (s.lastRoundDay ?? s.day) + ROUND_COOLDOWN_DAYS - s.day;
    return `Экстренный раунд уже был, следующий раунд - через ${left} дн. `;
  }
  return 'В «Инвесторах» можно начать обычный раунд: переговоры идут от 30 до 60 дней. ';
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
          roundMailLine(s) +
          'Ещё помогут меньшая аренда и тендеры.',
      });
    }
    s.finance.negativeDays += 1;
    // Срок банкротства фиксирован: день, когда счётчик дошёл до BANKRUPT_DAYS (то же, что investors.ts: bankruptDay).
    // Переговоры, которые закроются не позже чем через ROUND_RESCUE_GRACE_DAYS дней после этого срока, откладывают
    // банкротство до своего закрытия. Новый раунд после срока закроется позже окна и не спасает, поэтому отмена и
    // повторный раунд срок не продлевают. Если раунд закрылся, а счёт всё ещё в минусе, банкротство наступает обычным порядком.
    const deadline = s.day + BANKRUPT_DAYS - s.finance.negativeDays;
    const rescue = s.round != null && s.round.closeDay <= deadline + ROUND_RESCUE_GRACE_DAYS;
    if (s.finance.negativeDays >= BANKRUPT_DAYS && !rescue) s.outcome = 'bankrupt';
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
