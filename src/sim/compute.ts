// Аренда GPU, мощность и её доли (FR-2).

import { GPUS } from '../data/gpus';
import { DEFAULT_ALLOC, RENT_CAP_2017, RENT_HARD_CAP_MULT, RENT_OVER_CAP_MULT } from './constants';
import { modValue } from './events';
import { byYear, dateToDay, yearOf } from './time';
import type { Allocation, GameState, GpuDef, GpuId, Result } from './types';

export const ALLOC_KEYS: readonly (keyof Allocation)[] = ['training', 'contracts', 'experiments', 'api', 'subs'];

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

/**
 * Аренда count карт типа id в день: до лимита (rentCapFor) по обычной цене, сверх лимита - по цене
 * × RENT_OVER_CAP_MULT (мягкий лимит). Число карт выше rentMaxFor здесь не проверяется.
 */
export function rentCostPerDay(s: GameState, id: GpuId, count: number): number {
  if (!(count > 0)) return 0;
  const price = rentPerGpuDay(s, id);
  const cap = rentCapFor(s, id);
  return price * Math.min(count, cap) + price * RENT_OVER_CAP_MULT * Math.max(0, count - cap);
}

/** Аренда всех арендованных GPU в день (с надбавкой за карты сверх лимита). */
export function rentPerDay(s: GameState): number {
  let sum = 0;
  for (const g of GPUS) {
    const count = s.compute.rented[g.id];
    if (count > 0) sum += rentCostPerDay(s, g.id, count);
  }
  return sum;
}

/** Лимит штук на тип по обычной цене: RENT_CAP_2017 × 2^(год − 2017) × модификатор rentCap, вниз до целого. */
export function rentCapFor(s: GameState, id: GpuId): number {
  const base = RENT_CAP_2017 * 2 ** (yearOf(s.day) - 2017);
  return Math.max(0, Math.floor(base * modValue(s, 'rentCap', id).mult));
}

/** Потолок штук на тип: RENT_HARD_CAP_MULT × лимит; сверх лимита карты дороже (rentCostPerDay). */
export function rentMaxFor(s: GameState, id: GpuId): number {
  return rentCapFor(s, id) * RENT_HARD_CAP_MULT;
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

/**
 * Привести доли к неотрицательным с суммой не больше 1: остаток мощности простаивает.
 * Сумма больше 1 делится до 1 с сохранением пропорций; все нули → DEFAULT_ALLOC.
 */
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
  // Сумма не больше 1 (с запасом на ошибки округления процентов) - не трогаем: остаток простаивает.
  if (sum <= 1 + 1e-9) return clean;
  for (const k of ALLOC_KEYS) clean[k] /= sum;
  return clean;
}

/** Действие: поставить доли (сумма не больше 1, остаток простаивает; больше 1 - нормализуется). */
export function setAllocation(s: GameState, a: Allocation): Result {
  s.compute.alloc = normalizeAlloc(a);
  return { ok: true };
}

/**
 * Действие: поставить число арендованных GPU типа (целое 0..потолок rentMaxFor, тип доступен; уменьшать можно всегда).
 * Сверх лимита rentCapFor карты принимаются, но стоят дороже (rentCostPerDay).
 */
export function setRent(s: GameState, id: GpuId, count: number): Result {
  const def = GPUS.find((g) => g.id === id);
  if (!def) return { ok: false, error: 'Неизвестный тип карты' };
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, error: 'Число карт должно быть целым и не меньше нуля' };
  }
  // Уменьшать (и оставлять как есть) можно всегда, даже если потолок упал.
  if (count > s.compute.rented[id]) {
    if (!isGpuAvailable(s, id)) return { ok: false, error: 'Эта карта ещё не вышла' };
    const max = rentMaxFor(s, id);
    if (count > max) {
      return { ok: false, error: `Потолок аренды ${def.name} в этом году - ${max} шт.` };
    }
  }
  s.compute.rented[id] = count + 0; // «+ 0» превращает −0 в обычный 0
  return { ok: true };
}
