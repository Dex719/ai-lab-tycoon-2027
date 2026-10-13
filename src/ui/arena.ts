// Место на «Арене» - одно правило для всего интерфейса: считаются только модели, которые продаются по API.
// По этому месту засчитывается победа, поэтому верхняя панель, сводка, окно «Модели», «Аналитика» и итог партии
// берут число отсюда и нигде не считают своё.

import { marketArenaRank } from '../sim/leaderboard';
import { playerBestArenaRank } from '../sim/tick';
import type { GameState, PlayerModel } from '../sim/types';
import { fmtRank } from './labels';

/** Подсказка к месту на «Арене»: одна на всех. */
export const ARENA_PLACE_TITLE =
  'Место по Эло среди моделей, которые продаются по API. Цель: 1-е место на 31.12.2024. Модели, снятые с продажи, не считаются.';

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/** Лучшее место моделей игрока среди моделей в продаже; null - у игрока нет моделей в продаже. */
export function bestArenaPlace(s: GameState): number | null {
  return safe(() => playerBestArenaRank(s));
}

/** Место одной модели игрока среди моделей в продаже; null - модель не выпущена или снята с API. */
export function modelArenaPlace(s: GameState, m: Pick<PlayerModel, 'id' | 'releasedDay' | 'onApi'>): number | null {
  if (m.releasedDay === null || !m.onApi) return null;
  return safe(() => marketArenaRank(s, { kind: 'player', id: m.id }));
}

/** «3-е место» или «-»: общий вид места. */
export function placeText(rank: number | null): string {
  return fmtRank(rank);
}
