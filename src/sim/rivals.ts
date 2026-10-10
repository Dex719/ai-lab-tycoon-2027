// Модели соперников: способности по реальным баллам, оценки пропусков, выходы по календарю (FR-12). TSK-007.

import type { BenchmarkId, DomainId, GameState, RivalModelDef } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export function rivalDef(_id: string): RivalModelDef { return TODO(); }
/**
 * Способности по доменам: среднее capFromScore по реальным баллам домена; домен без баллов — среднее
 * остальных доменов; модель без баллов — (arenaElo − 800) / 5 во всех доменах. Кешируется по id.
 */
export function rivalCaps(_def: RivalModelDef): Record<DomainId, number> { return TODO(); }
/** Реальный балл, если есть; иначе benchScore(bid, cap домена) с estimated = true. */
export function rivalScore(_def: RivalModelDef, _bid: BenchmarkId): { value: number; estimated: boolean } { return TODO(); }
/** Блended-цена (3·in + out)/4; если пусто — defaultPricePer1M лаборатории на год дня day. */
export function rivalPrice(_def: RivalModelDef, _day: number): number { return TODO(); }
/**
 * Ежедневно: модели каталога с датой ≤ сегодня, которых нет в s.rivalsReleased, — выпустить:
 * добавить id, прибавить шумиху лаборатории (leaderboard.releaseHypeBonus), письмо kind 'rival'
 * с названием, лабораторией и 1–2 главными баллами по вышедшим бенчмаркам.
 */
export function releaseDue(_s: GameState): void { TODO(); }
/**
 * Модели соперников на рынке: выпущены, (api || openWeights), не старше MARKET_MAX_AGE_DAYS,
 * по MARKET_MODELS_PER_LAB новейших на лабораторию.
 */
export function marketRivals(_s: GameState): RivalModelDef[] { return TODO(); }
