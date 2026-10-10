// Аренда GPU, мощность и её доли (FR-2). Реализуется в TSK-004.

import type { Allocation, GameState, GpuDef, GpuId, Result } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export function gpuDef(_id: GpuId): GpuDef { return TODO(); }
/** День наступил ≥ availableFrom. */
export function isGpuAvailable(_s: GameState, _id: GpuId): boolean { return TODO(); }
/** Доступные сейчас типы, по порядку данных. */
export function availableGpus(_s: GameState): GpuDef[] { return TODO(); }
/** $ за GPU в день: rentPerGpuHour(год; если года нет — ближайший известный) × 24 × модификатор rentPrice (общий или target = id). */
export function rentPerGpuDay(_s: GameState, _id: GpuId): number { return TODO(); }
/** Аренда всех арендованных GPU в день. */
export function rentPerDay(_s: GameState): number { return TODO(); }
/** Лимит штук на тип: RENT_CAP_2017 × 2^(год − 2017) × модификатор rentCap, вниз до целого. */
export function rentCapFor(_s: GameState, _id: GpuId): number { return TODO(); }
/** Σ count × h100e. */
export function totalH100e(_s: GameState): number { return TODO(); }
/** Мощность доли: totalH100e × alloc[kind]. */
export function pool(_s: GameState, _kind: keyof Allocation): number { return TODO(); }
/** Самая дешёвая цена H100e-дня среди доступных сейчас GPU (с модификаторами). */
export function cheapestH100eDay(_s: GameState): number { return TODO(); }
/** Привести доли к неотрицательным с суммой 1 (все нули → DEFAULT_ALLOC). */
export function normalizeAlloc(_a: Allocation): Allocation { return TODO(); }
/** Действие: поставить долю (нормализуется). */
export function setAllocation(_s: GameState, _a: Allocation): Result { return TODO(); }
/** Действие: поставить число арендованных GPU типа (целое 0..лимит, тип доступен; уменьшать можно всегда). */
export function setRent(_s: GameState, _id: GpuId, _count: number): Result { return TODO(); }
