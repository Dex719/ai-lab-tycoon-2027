// Раунды инвестиций (FR-10). TSK-008.

import type { GameState, Result } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export interface Valuation {
  total: number;
  annualRevenue: number;
  revenuePart: number; // annualRevenue × revMult
  techPart: number; // rankFactor × mania
  rankFactor: number;
  bestRank: number | null; // место лучшей модели игрока на Арене среди моделей на рынке
  hypeMult: number;
  repMult: number;
}

export function valuation(_s: GameState): Valuation { return TODO(); }
/** Причина, почему раунд недоступен (кулдаун — «через N дней»), или null. */
export function canRaise(_s: GameState): string | null { return TODO(); }
/** Действие: продать долю fraction ∈ ROUND_FRACTIONS. Деньги earn('investors'), доля ×(1 − f), письмо. */
export function raiseRound(_s: GameState, _fraction: number): Result { return TODO(); }
