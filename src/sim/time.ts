// Игровое время: день - целое число дней от 01.01.2017 (день 0), календарь UTC.

import { END_DATE, START_DATE } from './constants';

const MS_PER_DAY = 86_400_000;
const EPOCH = Date.UTC(2017, 0, 1);

export interface YMD {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export function dateToDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / MS_PER_DAY);
}

export function dayToDate(day: number): YMD {
  const dt = new Date(EPOCH + day * MS_PER_DAY);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function yearOf(day: number): number {
  return dayToDate(day).year;
}

export function isMonthStart(day: number): boolean {
  return dayToDate(day).day === 1;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** «12 июня 2017» */
export function formatDate(day: number): string {
  const d = dayToDate(day);
  return `${d.day} ${MONTHS_GEN[d.month - 1]} ${d.year}`;
}

/** «Июнь 2017» */
export function formatMonth(year: number, month: number): string {
  return `${MONTHS_NOM[month - 1]} ${year}`;
}

/** «12.06.2017» */
export function formatDateShort(day: number): string {
  const d = dayToDate(day);
  return `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${d.year}`;
}

export const START_DAY = dateToDay(START_DATE);
export const END_DAY = dateToDay(END_DATE);

// Дни точек кривой разбираются один раз на массив (кривые - константы, вызываются много раз за тик).
const curveDays = new WeakMap<object, number[]>();

/**
 * Значение кривой на дату. points - [['YYYY-MM-DD', value], ...] по возрастанию дат.
 * log = true - интерполяция в логарифме (для величин, растущих на порядки).
 * До первой точки - первое значение, после последней - последнее.
 */
export function lerpByDate(points: readonly (readonly [string, number])[], day: number, log = false): number {
  if (points.length === 0) return 0;
  let days = curveDays.get(points);
  if (!days) {
    days = points.map(([iso]) => dateToDay(iso));
    curveDays.set(points, days);
  }
  if (day <= days[0]) return points[0][1];
  const last = points.length - 1;
  if (day >= days[last]) return points[last][1];
  let i = 0;
  while (day > days[i + 1]) i++;
  const t = (day - days[i]) / (days[i + 1] - days[i]);
  const a = points[i][1];
  const b = points[i + 1][1];
  if (log && a > 0 && b > 0) return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
  return a + (b - a) * t;
}

/** Значение по году из таблицы {год: значение}; годы вне таблицы - ближайший край. */
export function byYear(table: Record<number, number>, year: number): number {
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (year <= years[0]) return table[years[0]];
  if (year >= years[years.length - 1]) return table[years[years.length - 1]];
  let best = years[0];
  for (const y of years) if (y <= year) best = y;
  return table[best];
}
