// Исследования (FR-3). Реализуется в TSK-004.

import type { GameState, Result, TechId } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export interface TechInfo {
  id: TechId;
  name: string; // «Механизм внимания»
  description: string; // что даёт, одна-две фразы
}

/** Четыре технологии в порядке показа. */
export const TECHS: TechInfo[] = [];

/** Цена в очках: TECH_COST × модификатор researchCost(target = tech); algo — ALGO_BASE_COST × ALGO_COST_GROWTH^algoLevel. */
export function techCost(_s: GameState, _tech: TechId): number { return TODO(); }
/** Требования выполнены и (кроме algo) ещё не изучено. */
export function canResearch(_s: GameState, _tech: TechId): boolean { return TODO(); }
/** RP_BASE + RP_K × sqrt(pool(experiments)). */
export function rpPerDay(_s: GameState): number { return TODO(); }
/** Действие: выбрать текущее исследование (null — остановить). Очки по технологиям сохраняются. */
export function setResearch(_s: GameState, _tech: TechId | null): Result { return TODO(); }
/**
 * Ежедневно: прибавить rpPerDay к points[current]. По достижении цены — изучено, письмо (kind 'research').
 * algo: algoLevel += 1, points.algo = 0, current остаётся 'algo'. Остальные: в done, current = null.
 */
export function progressDay(_s: GameState): void { TODO(); }
