// Темп денег в месяц и запас: на сколько месяцев хватит денег на счёте (верхняя панель, пауза «деньги кончаются»).
// Без разовых операций (покупки, штрафы, разметчики, вложения): плейтест 16.10 - после покупки стартапа панель
// писала «−$7,6 млн/мес., хватит на 2 месяца», после оплаты контракта - «+$900 тыс./мес.».

import { rentPerDay } from '../sim/compute';
import { dcCostPerDay } from '../sim/datacenters';
import { dealsMonthly } from '../sim/deals';
import { overheadPerDay } from '../sim/finance';
import type { GameState } from '../sim/types';

/** Сколько закрытых месяцев усреднять доход: контракты платят разом, по одному месяцу темп скачет. */
const INCOME_MONTHS = 3;

/** Постоянные расходы в месяц: аренда, зарплаты и офис, зарплаты команд, дата-центры (электричество и содержание). */
export function recurringMonthly(s: GameState): number {
  return (rentPerDay(s) + overheadPerDay(s) + dcCostPerDay(s)) * 30 + dealsMonthly(s).salary;
}

/** Средний доход за последние закрытые месяцы (API, подписки, контракты); месяцев нет - 0. */
export function averageIncome(s: GameState): number {
  const last = s.finance.history.slice(-INCOME_MONTHS);
  if (last.length === 0) return 0;
  return last.reduce((a, h) => a + h.income.api + h.income.subs + h.income.contracts, 0) / last.length;
}

/** Изменение денег в месяц: средний доход минус постоянные расходы. */
export function monthlyRate(s: GameState): number {
  return averageIncome(s) - recurringMonthly(s);
}

/** На сколько месяцев хватит денег при нынешнем темпе; null - денег не убывает или их уже нет. */
export function runwayMonths(s: GameState): number | null {
  const rate = monthlyRate(s);
  if (rate >= 0 || s.cash <= 0) return null;
  return s.cash / -rate;
}
