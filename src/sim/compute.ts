// Аренда GPU, мощность и её доли (FR-2).

import { GPUS } from '../data/gpus';
import { DEFAULT_ALLOC, RENT_CAP_2017 } from './constants';
import { modValue } from './events';
import { byYear, dateToDay, yearOf } from './time';
import type { Allocation, GameState, GpuDef, GpuId, Result } from './types';

const ALLOC_KEYS: readonly (keyof Allocation)[] = ['training', 'contracts', 'experiments', 'inference'];

export function gpuDef(id: GpuId): GpuDef {
  const def = GPUS.find((g) => g.id === id);
  if (!def) throw new Error(`Нет GPU ${id}`);
  return def;
}

/** День наступил ≥ availableFrom. */
export function isGpuAvailable(s: GameState, id: GpuId): boolean {
  return s.day >= dateToDay(gpuDef(id).availableFrom);
}

/** Доступные сейчас типы, по порядку данных. */
export function availableGpus(s: GameState): GpuDef[] {
  return GPUS.filter((g) => s.day >= dateToDay(g.availableFrom));
}

/** $ за GPU в день: rentPerGpuHour(год; если года нет - ближайший известный) × 24 × модификатор rentPrice (общий или target = id). */
export function rentPerGpuDay(s: GameState, id: GpuId): number {
  const perHour = byYear(gpuDef(id).rentPerGpuHour, yearOf(s.day));
  return perHour * 24 * modValue(s, 'rentPrice', id).mult;
}

/** Аренда всех арендованных GPU в день. */
export function rentPerDay(s: GameState): number {
  let sum = 0;
  for (const g of GPUS) {
    const count = s.compute.rented[g.id];
    if (count > 0) sum += count * rentPerGpuDay(s, g.id);
  }
  return sum;
}

/** Лимит штук на тип: RENT_CAP_2017 × 2^(год − 2017) × модификатор rentCap, вниз до целого. */
export function rentCapFor(s: GameState, id: GpuId): number {
  const base = RENT_CAP_2017 * 2 ** (yearOf(s.day) - 2017);
  return Math.max(0, Math.floor(base * modValue(s, 'rentCap', id).mult));
}

/** Σ count × h100e. */
export function totalH100e(s: GameState): number {
  let sum = 0;
  for (const g of GPUS) sum += s.compute.rented[g.id] * g.h100e;
  return sum;
}

/** Мощность доли: totalH100e × alloc[kind]. */
export function pool(s: GameState, kind: keyof Allocation): number {
  return totalH100e(s) * s.compute.alloc[kind];
}

/** Самая дешёвая цена H100e-дня среди доступных сейчас GPU (с модификаторами). */
export function cheapestH100eDay(s: GameState): number {
  let best = Infinity;
  for (const g of availableGpus(s)) {
    const price = rentPerGpuDay(s, g.id) / g.h100e;
    if (price < best) best = price;
  }
  return best;
}

/** Привести доли к неотрицательным с суммой 1 (все нули → DEFAULT_ALLOC). */
export function normalizeAlloc(a: Allocation): Allocation {
  const clean = {} as Allocation;
  let sum = 0;
  for (const k of ALLOC_KEYS) {
    const v = a[k];
    clean[k] = Number.isFinite(v) && v > 0 ? v : 0;
    sum += clean[k];
  }
  // Нули или переполнение суммы (бессмысленные числа) - стартовые доли.
  if (!(sum > 0) || !Number.isFinite(sum)) return { ...DEFAULT_ALLOC };
  // Доли уже в сумме дают 1 - не трогаем, чтобы не плодить мелкие ошибки округления.
  if (Math.abs(sum - 1) < 1e-9) return clean;
  for (const k of ALLOC_KEYS) clean[k] /= sum;
  return clean;
}

/** Действие: поставить долю (нормализуется). */
export function setAllocation(s: GameState, a: Allocation): Result {
  s.compute.alloc = normalizeAlloc(a);
  return { ok: true };
}

/** Действие: поставить число арендованных GPU типа (целое 0..лимит, тип доступен; уменьшать можно всегда). */
export function setRent(s: GameState, id: GpuId, count: number): Result {
  const def = GPUS.find((g) => g.id === id);
  if (!def) return { ok: false, error: 'Неизвестный тип GPU' };
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, error: 'Число GPU должно быть целым и не меньше нуля' };
  }
  // Уменьшать (и оставлять как есть) можно всегда, даже если лимит упал.
  if (count > s.compute.rented[id]) {
    if (!isGpuAvailable(s, id)) return { ok: false, error: 'Этот GPU ещё не вышел' };
    const cap = rentCapFor(s, id);
    if (count > cap) {
      return { ok: false, error: `Лимит аренды ${def.name} в этом году - ${cap} шт.` };
    }
  }
  s.compute.rented[id] = count + 0; // «+ 0» превращает −0 в обычный 0
  return { ok: true };
}
