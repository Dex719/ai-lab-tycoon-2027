// Доли мощности в целых процентах: общие помощники для окна «Мощности» и диалога исследования.

import type { Allocation, PlayerModel } from '../sim/types';

export type AllocKey = keyof Allocation;

export const ALLOC_ROWS: { key: AllocKey; label: string; hint: string; color: string }[] = [
  { key: 'training', label: 'Обучение', hint: 'Скорость обучения новой модели.', color: '#2f80e4' },
  { key: 'contracts', label: 'Контракты', hint: 'Работа по выигранным контрактам.', color: '#d9822b' },
  { key: 'experiments', label: 'Исследования', hint: 'Скорость исследований.', color: '#7b5cd6' },
  { key: 'api', label: 'API', hint: 'Обслуживание запросов по API: корпоративные клиенты и разработчики.', color: '#2e9b4f' },
  { key: 'subs', label: 'Подписки', hint: 'Обслуживание чата для подписчиков.', color: '#1fa8a0' },
];

export type Percents = Record<AllocKey, number>;

/** Разложить total на целые части пропорционально весам (метод наибольших остатков); все веса нулевые - поровну. */
export function distribute(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wsum = sum > 0 ? sum : weights.length;
  const exact = w.map((x) => (x / wsum) * total);
  const out = exact.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i]++;
  return out;
}

/** Доли в целых процентах; сумма - доля занятой мощности (до 100), остаток простаивает. */
export function percentsOf(alloc: Allocation): Percents {
  const weights = ALLOC_ROWS.map((r) => (Number.isFinite(alloc[r.key]) && alloc[r.key] > 0 ? alloc[r.key] : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = {} as Percents;
  if (!(sum > 0)) {
    ALLOC_ROWS.forEach((r) => (out[r.key] = 0));
    return out;
  }
  const p = distribute(weights, Math.min(100, Math.round(sum * 100)));
  ALLOC_ROWS.forEach((r, i) => (out[r.key] = p[i]));
  return out;
}

/**
 * Поставить долю key в value % и пропорционально пересчитать остальные доли (диалог исследования).
 * Занятая мощность не уменьшается: если часть простаивала, простаивает и дальше (пока хватает места под value).
 */
export function withPercent(cur: Percents, key: AllocKey, value: number): Percents {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const used = Math.min(100, Math.max(totalPercent(cur), v));
  const others = ALLOC_ROWS.map((r) => r.key).filter((k) => k !== key);
  const next = distribute(others.map((k) => cur[k]), used - v);
  const out = { ...cur, [key]: v };
  others.forEach((k, i) => (out[k] = next[i]));
  return out;
}

/** Наибольшее значение доли key: 100 минус сумма остальных долей (сумма никогда не больше 100 %). */
export function maxPercent(cur: Percents, key: AllocKey): number {
  return Math.max(0, 100 - (totalPercent(cur) - cur[key]));
}

/** Поставить долю key в value %, не трогая остальные; значение зажимается в 0…(100 − сумма остальных). */
export function setPercent(cur: Percents, key: AllocKey, value: number): Percents {
  const v = Math.max(0, Math.min(maxPercent(cur, key), Math.round(Number.isFinite(value) ? value : 0)));
  return { ...cur, [key]: v };
}

/** Сумма долей в процентах. */
export function totalPercent(p: Percents): number {
  return ALLOC_ROWS.reduce((a, r) => a + p[r.key], 0);
}

export function toAllocation(p: Percents): Allocation {
  const out = {} as Allocation;
  for (const r of ALLOC_ROWS) out[r.key] = p[r.key] / 100;
  return out;
}

export function samePercents(a: Percents, b: Percents): boolean {
  return ALLOC_ROWS.every((r) => a[r.key] === b[r.key]);
}

/** Строка о занятой мощности: tone full - занято 100 %, idle - часть мощности простаивает (мягкое предупреждение). */
export function occupancy(p: Percents): { total: number; tone: 'full' | 'idle'; text: string } {
  const total = Math.min(100, totalPercent(p));
  if (total >= 100) return { total, tone: 'full', text: 'Используется 100 % мощности.' };
  return { total, tone: 'idle', text: `Используется ${total} % мощности, ${100 - total} % простаивает.` };
}

/** Каналы, в которых сейчас что-то продаётся: хотя бы одна выпущенная модель с включённым каналом. */
export type SoldChannels = { api: boolean; subs: boolean };

export function soldChannels(models: readonly Pick<PlayerModel, 'releasedDay' | 'onApi' | 'onSubs'>[]): SoldChannels {
  const sold = models.filter((m) => m.releasedDay !== null);
  return { api: sold.some((m) => m.onApi), subs: sold.some((m) => m.onSubs) };
}

/** Что сказать игроку, если доле канала выставили 0 %, а в канале есть что продавать. */
export const ZERO_SHARE_WARNING: Record<keyof SoldChannels, string> = {
  api: 'Клиентам API не будет выделено мощности: продажи по API остановятся.',
  subs: 'Подписчикам не будет выделено мощности: подписки остановятся.',
};

export interface AllocCheck {
  /** Текст ошибки или null: действие вызывать нельзя. Сумма больше 100 % из окна не набирается, это страховка. */
  error: string | null;
  /** Каналы с долей 0 %, в которых есть продажи: нужно подтверждение игрока. Пусто, пока есть ошибка. */
  zero: (keyof SoldChannels)[];
}

/** Проверка перед «Распределить»: сумма не больше 100 % и не ноль, затем нули в каналах с продажами. */
export function checkAllocation(p: Percents, sold: SoldChannels): AllocCheck {
  const total = totalPercent(p);
  if (total > 100) return { error: 'Сумма долей должна быть 100 %.', zero: [] };
  if (total <= 0) return { error: 'Выделите мощность хотя бы на одну долю.', zero: [] };
  const zero: (keyof SoldChannels)[] = [];
  if (sold.api && p.api === 0) zero.push('api');
  if (sold.subs && p.subs === 0) zero.push('subs');
  return { error: null, zero };
}
