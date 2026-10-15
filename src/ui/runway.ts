// Темп денег в месяц и запас: на сколько месяцев хватит денег на счёте (верхняя панель, пауза «деньги кончаются»).

import { rentPerDay } from '../sim/compute';
import { dcCostPerDay } from '../sim/datacenters';
import { overheadPerDay } from '../sim/finance';
import type { GameState } from '../sim/types';
import { EXPENSE_KINDS } from './labels';

/** Изменение денег в месяц: итог прошлого месяца без инвесторов, а в первый месяц - текущие расходы. */
export function monthlyRate(s: GameState): number {
  const h = s.finance.history.at(-1);
  if (h) {
    const inc = h.income.api + h.income.subs + h.income.contracts;
    const exp = EXPENSE_KINDS.reduce((sum, k) => (k === 'capex' ? sum : sum + (h.expense[k] ?? 0)), 0); // разовые вложения не в счёт
    return inc - exp;
  }
  return -(rentPerDay(s) + overheadPerDay(s) + dcCostPerDay(s)) * 30;
}

/** На сколько месяцев хватит денег при нынешнем темпе; null - денег не убывает или их уже нет. */
export function runwayMonths(s: GameState): number | null {
  const rate = monthlyRate(s);
  if (rate >= 0 || s.cash <= 0) return null;
  return s.cash / -rate;
}
