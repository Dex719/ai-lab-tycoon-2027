// Аренда GPU, мощность и её доли (FR-2).

import { staffEffect } from './staffEffects';
import { GPUS } from '../data/gpus';
import { DEFAULT_ALLOC, RENT_CAP_2017, RENT_HARD_CAP_MULT, RENT_OVER_CAP_MULT } from './constants';
import { modValue } from './events';
import { byYear, dateToDay, yearOf } from './time';
import type { Allocation, DcOrder, GameState, GpuDef, GpuId, Result } from './types';

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

/** Арендованная мощность: Σ count × h100e. */
export function rentedH100e(s: GameState): number {
  let sum = 0;
  for (const g of GPUS) sum += s.compute.rented[g.id] * g.h100e;
  return sum;
}

/** Своя мощность: карты в своих дата-центрах (они есть только в готовых). */
export function ownedH100e(s: GameState): number {
  let sum = 0;
  for (const dc of s.datacenters?.list ?? []) for (const g of GPUS) sum += (dc.gpus[g.id] ?? 0) * g.h100e;
  return sum;
}

/** Вся мощность: аренда плюс свои дата-центры. */
export function totalH100e(s: GameState): number {
  // Инфраструктура в команде выжимает из тех же карт больше (staffEffects.ts).
  return (rentedH100e(s) + ownedH100e(s)) * (1 + staffEffect(s, 'infra'));
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
 * Срок поставки арендованных карт, дней: облако выделяет стойки не сразу. По годам - от недели в 2017-2019 годах
 * до трёх недель в 2023 году (очереди на H100); во время дефицита (модификатор rentCap < 1) - вдвое дольше.
 */
export const RENT_DELIVERY_DAYS: Record<number, number> = { 2017: 7, 2018: 7, 2019: 7, 2020: 10, 2021: 10, 2022: 14, 2023: 21, 2024: 14 };
export const RENT_SHORTAGE_DELIVERY_MULT = 2;

export function rentDeliveryDays(s: GameState, id: GpuId): number {
  const base = byYear(RENT_DELIVERY_DAYS, yearOf(s.day));
  return modValue(s, 'rentCap', id).mult < 1 ? base * RENT_SHORTAGE_DELIVERY_MULT : base;
}

/** Заказанные и ещё не пришедшие карты (в старых сохранениях списка нет - заводится пустым). */
export function rentIncoming(s: GameState): DcOrder[] {
  if (!s.compute.incoming) s.compute.incoming = [];
  return s.compute.incoming;
}

/** Сколько карт типа едет. */
export function incomingCount(s: GameState, id: GpuId): number {
  return (s.compute.incoming ?? []).reduce((a, o) => (o.gpu === id ? a + o.count : a), 0);
}

/** Карт типа в аренде вместе с теми, что едут: то самое число, которое ставит игрок. */
export function orderedCount(s: GameState, id: GpuId): number {
  return s.compute.rented[id] + incomingCount(s, id);
}

/**
 * Действие: поставить число арендованных GPU типа вместе с заказанными (целое 0..потолок rentMaxFor, тип доступен;
 * уменьшать можно всегда). Прибавка приезжает через rentDeliveryDays, аренда за неё платится с прихода.
 * Уменьшение сначала отменяет ещё не пришедшие заказы (без штрафа, деньги за них не платились), потом возвращает
 * работающие карты сразу: облачная аренда посуточная, минимального срока нет.
 * Сверх лимита rentCapFor карты принимаются, но стоят дороже (rentCostPerDay).
 */
export function setRent(s: GameState, id: GpuId, count: number): Result {
  const def = GPUS.find((g) => g.id === id);
  if (!def) return { ok: false, error: 'Неизвестный тип карты' };
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, error: 'Число карт должно быть целым и не меньше нуля' };
  }
  const current = orderedCount(s, id);
  // Уменьшать (и оставлять как есть) можно всегда, даже если потолок упал.
  if (count > current) {
    if (!isGpuAvailable(s, id)) return { ok: false, error: 'Эта карта ещё не вышла' };
    const max = rentMaxFor(s, id);
    if (count > max) {
      return { ok: false, error: `Потолок аренды ${def.name} в этом году - ${max} шт.` };
    }
    rentIncoming(s).push({ gpu: id, count: count - current, arriveDay: s.day + rentDeliveryDays(s, id) });
  } else if (count < current) {
    let cut = current - count;
    const list = rentIncoming(s);
    // Сначала отменяем самые поздние заказы этого типа.
    for (let i = list.length - 1; i >= 0 && cut > 0; i--) {
      const o = list[i];
      if (o.gpu !== id) continue;
      const take = Math.min(o.count, cut);
      o.count -= take;
      cut -= take;
      if (o.count === 0) list.splice(i, 1);
    }
    if (cut > 0) s.compute.rented[id] = s.compute.rented[id] - cut + 0; // «+ 0» превращает −0 в обычный 0
  }
  if (count !== current) s.compute.rentChangedDay = s.day;
  return { ok: true };
}

/** День: пришедшие заказы встают в стойки и начинают работать (и оплачиваться). */
export function computeDay(s: GameState): void {
  const list = s.compute.incoming;
  if (!list || list.length === 0) return;
  let arrived = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (s.day < o.arriveDay) continue;
    s.compute.rented[o.gpu] += o.count;
    list.splice(i, 1);
    arrived = true;
  }
  // Предупреждение о простое молчит пару дней после прихода карт, как после изменения аренды.
  if (arrived) s.compute.rentChangedDay = s.day;
}

/** Поставить карты сразу, без поставки (setRent + приход в тот же день). Для тестов и сценариев, где нужна готовая мощность. */
export function rentNow(s: GameState, id: GpuId, count: number): Result {
  const r = setRent(s, id, count);
  if (!r.ok) return r;
  for (const o of rentIncoming(s)) if (o.gpu === id) o.arriveDay = s.day;
  computeDay(s);
  return r;
}

/** Есть ли мощность или хотя бы заказ на неё (для подсказок: «арендуйте» не нужно, если карты уже едут). */
export function computeOrdered(s: GameState): boolean {
  return totalH100e(s) > 0 || (s.compute.incoming ?? []).some((o) => o.count > 0);
}

/** Ближайший приход заказанных карт: сколько и когда (null - ничего не едет). */
export function nextArrival(s: GameState): { count: number; day: number } | null {
  const list = (s.compute.incoming ?? []).filter((o) => o.count > 0);
  if (list.length === 0) return null;
  const day = Math.min(...list.map((o) => o.arriveDay));
  return { day, count: list.filter((o) => o.arriveDay === day).reduce((a, o) => a + o.count, 0) };
}
