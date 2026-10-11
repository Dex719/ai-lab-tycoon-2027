// Доли мощности в целых процентах: общие помощники для окна «Мощности» и диалога исследования.

import type { Allocation } from '../sim/types';

export type AllocKey = keyof Allocation;

export const ALLOC_ROWS: { key: AllocKey; label: string; hint: string; color: string }[] = [
  { key: 'training', label: 'Обучение', hint: 'Скорость обучения новой модели.', color: '#2f80e4' },
  { key: 'contracts', label: 'Контракты', hint: 'Работа по выигранным контрактам.', color: '#d9822b' },
  { key: 'experiments', label: 'Исследования', hint: 'Скорость исследований.', color: '#7b5cd6' },
  { key: 'inference', label: 'Клиенты', hint: 'Обслуживание запросов к выпущенным моделям.', color: '#2e9b4f' },
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

/** Поставить долю key в value % и пропорционально пересчитать остальные три. */
export function withPercent(cur: Percents, key: AllocKey, value: number): Percents {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = ALLOC_ROWS.map((r) => r.key).filter((k) => k !== key);
  const next = distribute(others.map((k) => cur[k]), 100 - v);
  const out = { ...cur, [key]: v };
  others.forEach((k, i) => (out[k] = next[i]));
  return out;
}

export function toAllocation(p: Percents): Allocation {
  return { training: p.training / 100, contracts: p.contracts / 100, experiments: p.experiments / 100, inference: p.inference / 100 };
}

export function samePercents(a: Percents, b: Percents): boolean {
  return ALLOC_ROWS.every((r) => a[r.key] === b[r.key]);
}
