// Сотрудники: типы, уровни и что команда даёт лаборатории. Модуль без тяжёлых зависимостей: его читают
// compute (мощность), research (исследования), lateState (обучение) и market (выручка), а сам он ничего из них не берёт.

import { lerpByDate } from './time';

export type StaffRole = 'research' | 'training' | 'infra' | 'sales';
export const STAFF_ROLES: readonly StaffRole[] = ['research', 'training', 'infra', 'sales'];
/** fast - растёт быстрее; equity - просит долю компании, зарплата ниже. */
export type StaffTrait = 'fast' | 'equity';
/**
 * Потенциал: до какого уровня дорастёт, как быстро растёт и сколько даёт обучение. Низкий - дешевле, но упирается
 * в мидла и курсы почти не окупаются; высокий - дороже, растёт до ведущего, курсы выгодны.
 */
export type StaffPotential = 'low' | 'mid' | 'high';

export const POTENTIAL_INFO: Record<StaffPotential, { name: string; cap: number; growth: number; course: number; salary: number }> = {
  low: { name: 'низкий', cap: 1, growth: 0.6, course: 0.5, salary: 0.85 },
  mid: { name: 'средний', cap: 2, growth: 1, course: 1, salary: 1 },
  high: { name: 'высокий', cap: 3, growth: 1.4, course: 1.5, salary: 1.15 },
};

/** Потолок уровня сотрудника: по потенциалу, но не ниже уровня, с которым его наняли. */
export function levelCap(e: { level: number; potential?: StaffPotential }): number {
  return Math.max(e.level, POTENTIAL_INFO[e.potential ?? 'mid'].cap);
}

export interface Employee {
  id: string;
  name: string;
  role: StaffRole;
  /** 0 - джуниор, 1 - мидл, 2 - сеньор, 3 - ведущий. */
  level: number;
  /** Опыт до следующего уровня, 0..1; 1 - готов к повышению. */
  xp: number;
  /** Зарплата в месяц, $. */
  salary: number;
  trait: StaffTrait | null;
  /** Потенциал; в старых сохранениях нет - средний. */
  potential?: StaffPotential;
  /** День последнего курса обучения (прокачки). */
  lastCourseDay?: number;
  /** С этого дня работает (до него - вышел на работу, но ещё не приступил). */
  startDay: number;
  /** День, когда стал готов к повышению; null - не готов. */
  readyDay: number | null;
  /** До этого дня соперники его не переманивают (удержали премией). */
  retainedUntil?: number;
}

export interface Candidate {
  id: string;
  name: string;
  role: StaffRole;
  level: number;
  salary: number;
  trait: StaffTrait | null;
  potential?: StaffPotential;
  /** Через сколько дней выйдет на работу после найма. */
  wait: number;
  /** Последний день, когда можно нанять (кандидаты меняются раз в месяц). */
  expiresDay: number;
}

export interface StaffState {
  /** Свой поток случайных чисел: найм не сдвигает остальную случайность партии. */
  rng: number;
  people: Employee[];
  candidates: Candidate[];
  nextId: number;
  /** Переманивание, ждущее ответа в письме. */
  poach: { employeeId: string; lab: string } | null;
  lastPoachDay: number;
}

/** Пустая команда новой партии; свой поток случайных чисел от зерна партии. */
export function emptyStaff(seed: number): StaffState {
  return { rng: (seed ^ 0x57af) >>> 0 || 1, people: [], candidates: [], nextId: 1, poach: null, lastPoachDay: -100_000 };
}

export const LEVEL_NAMES = ['Джуниор', 'Мидл', 'Сеньор', 'Ведущий'] as const;
/** «до мидла», «до ведущего». */
export const LEVEL_NAMES_GEN = ['джуниора', 'мидла', 'сеньора', 'ведущего'] as const;
/** Вклад сотрудника в эффект роли по уровню. */
export const LEVEL_WEIGHT = [1, 2.2, 4, 7] as const;

export const ROLE_INFO: Record<StaffRole, { name: string; effect: string; color: string; cap: number }> = {
  research: { name: 'Исследования', effect: 'исследования быстрее', color: '#7b5cd6', cap: 0.25 },
  training: { name: 'Обучение', effect: 'модели учатся быстрее', color: '#2f80e4', cap: 0.12 },
  infra: { name: 'Инфраструктура', effect: 'мощность карт выше', color: '#d9822b', cap: 0.06 },
  sales: { name: 'Продажи', effect: 'выручка API и подписок выше', color: '#2e9b4f', cap: 0.15 },
};

/**
 * Сколько очков вклада дают ~63 % наибольшего эффекта роли: лаборатория растёт, и той же команды со временем
 * становится мало (в 2017 году хватает пары человек, в 2024-м нужны десятки).
 */
const EFFECT_SCALE: [string, number][] = [
  ['2017-01-01', 6],
  ['2019-01-01', 12],
  ['2021-01-01', 25],
  ['2023-01-01', 50],
  ['2024-12-31', 90],
];

/** Работает ли сотрудник сегодня (вышел на работу). */
export function isWorking(e: Employee, day: number): boolean {
  return e.startDay <= day;
}

/** Очки вклада роли: сумма весов уровней работающих сотрудников. */
export function rolePoints(s: { day: number; staff?: StaffState }, role: StaffRole): number {
  let p = 0;
  for (const e of s.staff?.people ?? []) if (e.role === role && isWorking(e, s.day)) p += LEVEL_WEIGHT[e.level] ?? 1;
  return p;
}

/** Эффект роли, доля: cap × (1 − e^(−очки / масштаб года)). Без сотрудников - 0. */
export function staffEffect(s: { day: number; staff?: StaffState }, role: StaffRole): number {
  const p = rolePoints(s, role);
  if (p <= 0) return 0;
  return ROLE_INFO[role].cap * (1 - Math.exp(-p / lerpByDate(EFFECT_SCALE, s.day, true)));
}
