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

/** Доли в целых процентах, сумма ровно 100. */
export function percentsOf(alloc: Allocation): Percents {
  const p = distribute(ALLOC_ROWS.map((r) => alloc[r.key]), 100);
  const out = {} as Percents;
  ALLOC_ROWS.forEach((r, i) => (out[r.key] = p[i]));
  return out;
}

/** Поставить долю key в value % и пропорционально пересчитать остальные доли (диалог исследования). */
export function withPercent(cur: Percents, key: AllocKey, value: number): Percents {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = ALLOC_ROWS.map((r) => r.key).filter((k) => k !== key);
  const next = distribute(others.map((k) => cur[k]), 100 - v);
  const out = { ...cur, [key]: v };
  others.forEach((k, i) => (out[k] = next[i]));
  return out;
}

/** Поставить долю key в value % (0…100), не трогая остальные: ползунки окна «Мощности» независимы. */
export function setPercent(cur: Percents, key: AllocKey, value: number): Percents {
  const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
  return { ...cur, [key]: v };
}

/** Сумма долей в процентах («Занято: N %»). */
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

/** Строка «Занято: N %»: tone full - ровно 100, free - есть свободные проценты, over - лишние. */
export function occupancy(p: Percents): { total: number; tone: 'full' | 'free' | 'over'; text: string } {
  const total = totalPercent(p);
  if (total === 100) return { total, tone: 'full', text: 'Занято: 100 %' };
  if (total < 100) return { total, tone: 'free', text: `Занято: ${total} %, свободно: ${100 - total} %` };
  return { total, tone: 'over', text: `Занято: ${total} %, лишние: ${total - 100} %` };
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
  /** Текст ошибки (сумма не 100 %) или null: действие вызывать нельзя. */
  error: string | null;
  /** Каналы с долей 0 %, в которых есть продажи: нужно подтверждение игрока. Пусто, пока есть ошибка. */
  zero: (keyof SoldChannels)[];
}

/** Проверка перед «Распределить»: сумма ровно 100 %, затем нули в каналах с продажами. Ошибки показывают только после нажатия. */
export function checkAllocation(p: Percents, sold: SoldChannels): AllocCheck {
  const total = totalPercent(p);
  if (total !== 100) return { error: `Сумма долей должна быть 100 %. Сейчас ${total} %.`, zero: [] };
  const zero: (keyof SoldChannels)[] = [];
  if (sold.api && p.api === 0) zero.push('api');
  if (sold.subs && p.subs === 0) zero.push('subs');
  return { error: null, zero };
}
