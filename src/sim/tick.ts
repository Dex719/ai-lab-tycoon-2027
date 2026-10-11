// Один игровой день (порядок - design.md, «Порядок тика»).

import { HYPE_MONTHLY_DECAY, HYPE_OWNERS } from './constants';
import { generateMonthly, progressDay as contractsDay } from './contracts';
import { introduceDue } from './benchmarks';
import { expireChoices, fireDue, pendingChoice, pruneModifiers } from './events';
import { beginDay, closeMonth, dayStep as financeDay } from './finance';
import { arenaRank, updateSaturation } from './leaderboard';
import { dayStep as marketDay } from './market';
import { progressDay as researchDay } from './research';
import { releaseDue } from './rivals';
import { END_DAY, isMonthStart } from './time';
import { monthlyExposure, progressDay as trainingDay } from './training';
import type { GameState } from './types';

export function blockedByChoice(s: GameState): boolean {
  return pendingChoice(s) !== null;
}

/** Лучшее место модели игрока на Арене (null - нет выпущенных моделей). */
export function playerBestArenaRank(s: GameState): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null) continue;
    const r = arenaRank(s, { kind: 'player', id: m.id });
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
    for (const o of HYPE_OWNERS) s.hype[o] *= HYPE_MONTHLY_DECAY;
    monthlyExposure(s);
    updateSaturation(s);
    pruneModifiers(s);
  }

  if (s.outcome) return; // банкротство
  if (s.day >= END_DAY) {
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
