// Один игровой день (порядок - design.md, «Порядок тика»).

import { HYPE_MONTHLY_DECAY, HYPE_OWNERS } from './constants';
import { generateMonthly, progressDay as contractsDay } from './contracts';
import { introduceDue } from './benchmarks';
import { expireChoices, fireDue, pendingChoice, pruneModifiers } from './events';
import { beginDay, closeMonth, dayStep as financeDay } from './finance';
import { marketArenaRank, updateSaturation } from './leaderboard';
import { dayStep as marketDay } from './market';
import { progressDay as researchDay } from './research';
import { releaseDue } from './rivals';
import { rivalryDay, rivalryMonth } from './rivalry';
import { END_DAY, isMonthStart } from './time';
import { monthlyExposure, progressDay as trainingDay } from './training';
import type { GameState } from './types';

export function blockedByChoice(s: GameState): boolean {
  return pendingChoice(s) !== null;
}

/**
 * Лучшее место модели игрока на Арене среди моделей, доступных по API (leaderboard.marketArenaRank):
 * null - у игрока нет выпущенных моделей в продаже. По нему считаются победа и monthsFirst.
 */
export function playerBestArenaRank(s: GameState): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onApi) continue;
    const r = marketArenaRank(s, { kind: 'player', id: m.id });
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

/** Продвинуть игру на один день. Ничего не делает, если игра окончена или ждёт выбора в почте. */
export function advanceDay(s: GameState): void {
  if (s.outcome || blockedByChoice(s)) return;

  beginDay(s);
  if (isMonthStart(s.day)) generateMonthly(s);

  introduceDue(s);
  const releasedBefore = s.rivalsReleased.length;
  releaseDue(s);
  rivalryDay(s); // ходы соперников по слухам, память, истечение ходов; ответные модели попадают в rivalsReleased
  expireChoices(s);
  fireDue(s);

  researchDay(s);
  trainingDay(s);
  contractsDay(s);
  marketDay(s);
  financeDay(s);

  if (s.rivalsReleased.length !== releasedBefore) updateSaturation(s);

  const monthEnd = isMonthStart(s.day + 1);
  if (monthEnd) {
    closeMonth(s);
    // Месяц закрыт на 1-м месте среди моделей по API: считается до разоблачений месяца, по состоянию рынка на его конец.
    if (playerBestArenaRank(s) === 1) s.monthsFirst += 1;
    for (const o of HYPE_OWNERS) s.hype[o] *= HYPE_MONTHLY_DECAY;
    monthlyExposure(s);
    // Рычаг игрока, накал и планирование ходов соперников: единственное место модуля со случайностью (с 2021 года).
    rivalryMonth(s);
    updateSaturation(s);
    pruneModifiers(s);
  }

  if (s.outcome) return; // банкротство
  if (s.day >= END_DAY) {
    // Победа - 1-е место на «Арене» среди моделей, доступных по API, в последний день игры.
    s.outcome = playerBestArenaRank(s) === 1 ? 'victory' : 'finished';
    return;
  }
  // Автосохранение просим только у живой игры: конец игры не должен затирать последнее сохранение, с которого можно играть дальше.
  if (monthEnd) s.flags.autosaveDue = true;
  s.day += 1;
}

/** Продвинуть до n дней; останавливается на выборе в почте или конце игры. Возвращает число прожитых дней. */
export function advanceDays(s: GameState, n: number): number {
  let done = 0;
  while (done < n && !s.outcome && !blockedByChoice(s)) {
    advanceDay(s);
    done++;
  }
  return done;
}
