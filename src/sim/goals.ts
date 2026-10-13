// Цели года и «Итоги года». В начале года лаборатория получает три цели (data/goals.ts), награда приходит письмом
// сразу после выполнения. 31 декабря считаются итоги года (окно «Итоги {год}»), и тут же выдаются цели следующего года.
// Случайных чисел здесь нет: цели зависят только от года и положения лаборатории.

import { findGoal, GOALS_BY_YEAR, type GoalDef, type GoalProgress, type GoalReward } from '../data/goals';
import { amountForYear, usd } from '../data/eventKit';
import { addMail } from './events';
import { earn } from './finance';
import { endSentence } from './text';
import { dayToDate, yearOf } from './time';
import type { GameState, Result, YearGoalState, YearReview } from './types';
import { bestRank, playerShare, releasedInYear, yearExpense, yearRevenue } from './yearStats';

export const GOALS_PER_YEAR = 3;
/** Последний год с итогами: 31.12.2024 игра заканчивается своим окном. */
export const LAST_REVIEW_YEAR = 2023;

const clamp100 = (x: number): number => Math.max(0, Math.min(100, x));

/** Деньги награды в долларах: единицы года × коэффициент цели. */
export function rewardMoney(reward: GoalReward, year: number): number {
  return reward.moneyK ? amountForYear(year, reward.moneyK) : 0;
}

/** «+$100 тыс., +2 репутации, +3 шумихи». */
export function rewardText(reward: GoalReward, year: number): string {
  const parts: string[] = [];
  const money = rewardMoney(reward, year);
  if (money > 0) parts.push(`+${usd(money)}`);
  if (reward.reputation) parts.push(`+${reward.reputation} репутации`);
  if (reward.hype) parts.push(`+${reward.hype} шумихи`);
  return parts.join(', ');
}

/** Выбрать цели года: первые GOALS_PER_YEAR подходящие из списка года. */
export function startYear(s: GameState, year: number): void {
  const ids = GOALS_BY_YEAR[year] ?? [];
  const goals: YearGoalState[] = [];
  for (const id of ids) {
    if (goals.length >= GOALS_PER_YEAR) break;
    const def = findGoal(id);
    if (!def || (def.applies && !def.applies(s))) continue;
    goals.push({ id, done: false, doneDay: null, base: def.base ? def.base(s) : 0 });
  }
  s.yearly.year = year;
  s.yearly.goals = goals;
}

/** Состояние выполнения цели для интерфейса. */
export function goalProgress(s: GameState, g: YearGoalState): { def: GoalDef; progress: GoalProgress } | null {
  const def = findGoal(g.id);
  if (!def) return null;
  const progress = def.progress(s, g);
  // Выполненная цель остаётся выполненной, даже если показатель потом упал.
  if (g.done) return { def, progress: { ...progress, done: true, fraction: 1 } };
  return { def, progress };
}

function award(s: GameState, def: GoalDef, year: number): void {
  const money = rewardMoney(def.reward, year);
  if (money > 0) earn(s, 'investors', money); // не выручка: на накладные расходы и итог без инвесторов не влияет
  if (def.reward.reputation) s.reputation = clamp100(s.reputation + def.reward.reputation);
  if (def.reward.hype) s.hype.player = clamp100(s.hype.player + def.reward.hype);
  addMail(s, {
    kind: 'event',
    title: `Цель выполнена: ${def.title(year)}`,
    body: `Цель года выполнена. Награда: ${endSentence(rewardText(def.reward, year))}`,
  });
}

/**
 * Проверить цели. Дешёвые - каждый день, остальные (место на «Арене», доля рынка) - раз в неделю; full = true
 * проверяет всё (в конце года). Выполненная цель получает награду один раз.
 */
export function checkGoals(s: GameState, full = false): void {
  const y = s.yearly;
  const weekly = s.day % 7 === 0;
  for (const g of y.goals) {
    if (g.done) continue;
    const def = findGoal(g.id);
    if (!def || !(full || def.cheap || weekly)) continue;
    if (!def.progress(s, g).done) continue;
    g.done = true;
    g.doneDay = s.day;
    award(s, def, y.year);
  }
}

/** Ежедневно: выдать цели, если года ещё нет в списке, и проверить выполнение. */
export function goalsDay(s: GameState): void {
  const year = yearOf(s.day);
  if (s.yearly.year !== year && year >= 2017) startYear(s, year);
  checkGoals(s);
}

function commentFor(s: GameState, r: Omit<YearReview, 'comment' | 'seen'>): string {
  const prev = s.yearly.reviews[s.yearly.reviews.length - 1];
  if (r.goalsTotal > 0 && r.goalsDone === r.goalsTotal) return 'Все цели года выполнены.';
  if (r.revenue <= 0) return 'Выручки не было: её дают тендеры и продажа моделей.';
  if (r.bestRank === 1) return 'Лучшая модель лаборатории - первая среди моделей в продаже.';
  if (prev && prev.revenue > 0 && r.revenue >= 1.5 * prev.revenue) return 'Выручка выросла больше чем в полтора раза.';
  if (prev && r.revenue < prev.revenue) return 'Выручка ниже, чем в прошлом году.';
  if (r.goalsTotal > 0 && r.goalsDone === 0) return 'Ни одна цель года не выполнена.';
  if (r.models === 0) return 'За год не вышло ни одной модели.';
  return 'Год закончился без потрясений.';
}

/** Итоги года: цифры из учёта, лучшее место и доля на конец года. */
export function buildReview(s: GameState, year: number): YearReview {
  const total = s.yearly.goals.length;
  const done = s.yearly.goals.filter((g) => g.done).length;
  const base = {
    year,
    revenue: yearRevenue(s, year),
    expense: yearExpense(s, year),
    models: releasedInYear(s, year),
    bestRank: bestRank(s),
    share: playerShare(s),
    goalsDone: done,
    goalsTotal: total,
    cash: s.cash,
  };
  return { ...base, comment: commentFor(s, base), seen: false };
}

/**
 * Последний день года (после закрытия декабря): проверить цели, записать итоги и выдать цели следующего года.
 * Итогов 2024 года нет - игра заканчивается своим окном.
 */
export function yearEnd(s: GameState): void {
  const day = dayToDate(s.day);
  if (day.month !== 12 || s.yearly.year !== day.year) return;
  checkGoals(s, true);
  if (day.year > LAST_REVIEW_YEAR) return;
  s.yearly.reviews.push(buildReview(s, day.year));
  startYear(s, day.year + 1);
}

/** Итоги, которые игрок ещё не видел (окно показывается один раз). */
export function unseenReview(s: GameState): YearReview | null {
  for (let i = s.yearly.reviews.length - 1; i >= 0; i--) if (!s.yearly.reviews[i].seen) return s.yearly.reviews[i];
  return null;
}

/** Действие: закрыть окно итогов года. */
export function ackYearReview(s: GameState): Result {
  const r = unseenReview(s);
  if (!r) return { ok: false, error: 'Итогов для показа нет' };
  for (const x of s.yearly.reviews) x.seen = true;
  return { ok: true };
}
