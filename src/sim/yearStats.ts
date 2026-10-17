// Показатели года для целей и итогов: выручка, расходы, выпущенные модели, лучшее место, доля рынка.
// Отдельный файл без зависимостей от целей: его читают и data/goals.ts, и sim/goals.ts.

import { marketArenaRank } from './leaderboard';
import { dayToDate, yearOf } from './time';
import type { GameState, MonthLedger } from './types';

export const ledgerRevenue = (l: MonthLedger): number => l.income.api + l.income.subs + l.income.contracts;
// Текущие расходы, как в окне «Финансы»: всё, кроме разовых вложений в дата-центры и карты (capex). Электричество своих
// дата-центров - текущий расход: без него итоги года занижали расходы у игроков с дата-центрами.
export const ledgerExpense = (l: MonthLedger): number =>
  l.expense.rent + l.expense.overhead + l.expense.labelers + l.expense.penalties + l.expense.review + (l.expense.power ?? 0);

/** Закрытые месяцы года и (если год идёт) текущий месяц. */
function ledgersOf(s: GameState, year: number): MonthLedger[] {
  const out: MonthLedger[] = s.finance.history.filter((h) => h.year === year);
  if (yearOf(s.day) === year) out.push(s.finance.month);
  return out;
}

/** Выручка за год: API + подписки + контракты (без денег инвесторов и грантов). */
export function yearRevenue(s: GameState, year: number): number {
  return ledgersOf(s, year).reduce((a, l) => a + ledgerRevenue(l), 0);
}

/** Расходы за год. */
export function yearExpense(s: GameState, year: number): number {
  return ledgersOf(s, year).reduce((a, l) => a + ledgerExpense(l), 0);
}

/** Сколько моделей выпущено за всё время. */
export function releasedCount(s: GameState): number {
  return s.models.filter((m) => m.releasedDay !== null).length;
}

/** Сколько моделей выпущено в данном году. */
export function releasedInYear(s: GameState, year: number): number {
  return s.models.filter((m) => m.releasedDay !== null && dayToDate(m.releasedDay).year === year).length;
}

/** Лучшее место среди моделей в продаже (по API) или null - то же, что tick.playerBestArenaRank, без импорта tick. */
export function bestRank(s: GameState): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onApi) continue;
    const r = marketArenaRank(s, { kind: 'player', id: m.id });
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

/** Общая доля рынка игрока, 0..1. */
export function playerShare(s: GameState): number {
  const x = s.market.labShares.player;
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}
