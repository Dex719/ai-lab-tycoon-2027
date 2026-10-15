// Цели года и «Итоги года». В начале года лаборатория получает пять целей разного стиля (data/goals.ts) и выбирает
// три; по умолчанию отмечены деньги, гонка и исследования (их же получают боты, которые не выбирают). Награда приходит
// сразу после выполнения; рискованная цель, не выполненная к 31 декабря, даёт штраф. 31 декабря считаются итоги года
// (окно «Итоги {год}», с тем, сколько не хватило до каждой цели), и тут же предлагаются цели следующего года.
// Случайность (вид цели внутри стиля) - свой поток на каждый год от зерна: основной поток игры не сдвигается.

import { ALMOST_FRACTION, DEFAULT_STYLES, findGoal, makeOffer, type GoalDef, type GoalProgress } from '../data/goals';
import { applyPenalty, capitalize, giveReward, penaltyText, rewardMoney, rewardShort, rewardText, type Reward } from '../data/questKit';
import { addMail } from './events';
import { rivalsSellByApi } from './leaderboard';
import { nextRandom } from './rng';
import { endSentence } from './text';
import { dayToDate, yearOf } from './time';
import type { GameState, Result, YearGoalResult, YearGoalState, YearReview } from './types';
import { bestRank, playerShare, releasedInYear, yearExpense, yearRevenue } from './yearStats';

export const GOALS_PER_YEAR = 3;
/** Последний год с итогами: 31.12.2024 игра заканчивается своим окном. */
export const LAST_REVIEW_YEAR = 2023;

export { rewardMoney, rewardText };

/** Название цели с её порогом и предметом. */
export function goalTitle(g: YearGoalState, year: number): string {
  return findGoal(g.id)?.title(year, g) ?? g.id;
}

/** Три цели по умолчанию: деньги, гонка, исследования; если какого-то стиля нет - следующие по списку, риск последним. */
export function defaultPick(offer: YearGoalState[]): YearGoalState[] {
  const style = (g: YearGoalState): string => findGoal(g.id)?.style ?? '';
  const out: YearGoalState[] = [];
  for (const st of DEFAULT_STYLES) {
    const g = offer.find((x) => style(x) === st);
    if (g) out.push(g);
  }
  for (const g of offer) if (out.length < GOALS_PER_YEAR && !out.includes(g) && style(g) !== 'risk') out.push(g);
  for (const g of offer) if (out.length < GOALS_PER_YEAR && !out.includes(g)) out.push(g);
  return out;
}

/**
 * Случайность выбора целей: свой поток на каждый год от зерна партии. Ни основной поток, ни поток задач
 * (s.quests.rng) не сдвигаются, и цели года не зависят от того, сколько задач было до этого.
 */
function yearRandom(seed: number, year: number): () => number {
  const g = { rng: (seed ^ Math.imul(year, 0x9e3779b1) ^ 0x5bd1e995) >>> 0 };
  return () => nextRandom(g);
}

/**
 * Начало года: пять целей на выбор (s.quests.offer) и три по умолчанию сразу в работе. Пока игрок выбирает,
 * интерфейс держит время на паузе; симуляция без интерфейса (боты, тесты) остаётся с целями по умолчанию.
 */
export function startYear(s: GameState, year: number): void {
  const offer = makeOffer(s, year, yearRandom(s.seed, year));
  s.yearly.year = year;
  s.yearly.goals = defaultPick(offer).map((g) => ({ ...g }));
  s.quests.offer = offer.length > GOALS_PER_YEAR ? { year, goals: offer, open: true } : null;
}

/** Ждёт ли выбор целей года игрока. */
export function goalOfferOpen(s: GameState): boolean {
  const o = s.quests.offer;
  return !!o && o.open && o.year === s.yearly.year;
}

/** Действие: выбрать три цели из предложенных. Цель, которая уже была в работе, сохраняет своё состояние. */
export function chooseGoals(s: GameState, ids: string[]): Result {
  const o = s.quests.offer;
  if (!o || !o.open || o.year !== s.yearly.year) return { ok: false, error: 'Цели этого года уже выбраны' };
  const need = Math.min(GOALS_PER_YEAR, o.goals.length);
  const uniq = [...new Set(ids)];
  if (uniq.length !== need) return { ok: false, error: `Выберите ${need} цели` };
  if (!uniq.every((id) => o.goals.some((g) => g.id === id))) return { ok: false, error: 'Такой цели нет среди предложенных' };
  const prev = new Map(s.yearly.goals.map((g) => [g.id, g]));
  s.yearly.goals = o.goals.filter((g) => uniq.includes(g.id)).map((g) => prev.get(g.id) ?? { ...g });
  o.open = false;
  return { ok: true };
}

export interface GoalView {
  def: GoalDef;
  title: string;
  progress: GoalProgress & { almost: boolean };
}

/** Состояние выполнения цели для интерфейса: название, прогресс, «почти». */
export function goalProgress(s: GameState, g: YearGoalState, year = s.yearly.year): GoalView | null {
  const def = findGoal(g.id);
  if (!def) return null;
  const p = def.progress(s, g);
  const title = def.title(year, g);
  // Выполненная цель остаётся выполненной, даже если показатель потом упал.
  if (g.done) return { def, title, progress: { ...p, done: true, fraction: 1, almost: false } };
  // Цель «на 31 декабря», которая сейчас держится, - не «почти», а «пока выполняется»; обычная цель с выполненным
  // условием тоже не «почти»: награду выдаст ближайшая проверка.
  const almost = !p.done && (p.almost ?? p.fraction >= ALMOST_FRACTION);
  return { def, title, progress: { ...p, almost } };
}

function award(s: GameState, def: GoalDef, g: YearGoalState, year: number): void {
  giveReward(s, def.reward, year, `goal-${year}-${g.id}`);
  addMail(s, {
    kind: 'event',
    title: `Цель выполнена: ${def.title(year, g)}`,
    reward: true,
    body: `Цель года выполнена. Награда: ${endSentence(rewardText(def.reward, year))}`,
  });
}

/**
 * Проверить цели. Дешёвые - каждый день, остальные (место в гонке, доля рынка) - раз в неделю; full = true
 * проверяет всё. Цели «на 31 декабря» проверяются только в конце года (yearEndCheck). Награда выдаётся один раз.
 */
export function checkGoals(s: GameState, full = false, yearEndCheck = false): void {
  const y = s.yearly;
  const weekly = s.day % 7 === 0;
  for (const g of y.goals) {
    if (g.done) continue;
    const def = findGoal(g.id);
    if (!def || (def.endOnly && !yearEndCheck) || !(full || def.cheap || weekly)) continue;
    if (!def.progress(s, g).done) continue;
    g.done = true;
    g.doneDay = s.day;
    award(s, def, g, y.year);
  }
}

/** Ежедневно: выдать цели, если года ещё нет в списке, и проверить выполнение. */
export function goalsDay(s: GameState): void {
  const year = yearOf(s.day);
  if (s.yearly.year !== year && year >= 2017) startYear(s, year);
  checkGoals(s);
}

/** Итог цели на 31 декабря: что вышло и сколько не хватило. */
function resultOf(s: GameState, g: YearGoalState, year: number): YearGoalResult & { fraction: number } {
  const v = goalProgress(s, g, year);
  if (!v) return { title: g.id, style: '', done: g.done, text: '', miss: '', prize: '', penalty: '', fraction: g.done ? 1 : 0 };
  const { def, title, progress: p } = v;
  return {
    title,
    style: def.style ?? '',
    done: g.done,
    text: g.done ? 'Выполнено' : p.text,
    miss: g.done ? '' : (p.miss ?? ''),
    prize: rewardText(def.reward, year),
    penalty: !g.done && def.penalty ? penaltyText(def.penalty) : '',
    fraction: p.fraction,
  };
}

function commentFor(s: GameState, r: Omit<YearReview, 'comment' | 'seen'>, near: { title: string; miss: string } | null): string {
  const prev = s.yearly.reviews[s.yearly.reviews.length - 1];
  if (r.goalsTotal > 0 && r.goalsDone === r.goalsTotal) return 'Все цели года выполнены.';
  if (near) return endSentence(`Почти: «${near.title}» - ${near.miss}`);
  if (r.revenue <= 0) return 'Выручки не было: её дают тендеры и продажа моделей.';
  // Первое место что-то значит, только когда соперники уже продают модели по API.
  if (r.bestRank === 1 && rivalsSellByApi(s)) return 'Лучшая модель лаборатории - первая среди моделей в продаже.';
  if (prev && prev.revenue > 0 && r.revenue >= 1.5 * prev.revenue) return 'Выручка выросла больше чем в полтора раза.';
  if (prev && r.revenue < prev.revenue) return 'Выручка ниже, чем в прошлом году.';
  if (r.goalsTotal > 0 && r.goalsDone === 0) return 'Ни одна цель года не выполнена.';
  if (r.models === 0) return 'За год не вышло ни одной модели.';
  return 'Год закончился без потрясений.';
}

/** Итоги года: цифры из учёта, лучшее место, доля на конец года и итог каждой цели. */
export function buildReview(s: GameState, year: number): YearReview {
  const total = s.yearly.goals.length;
  const done = s.yearly.goals.filter((g) => g.done).length;
  const full = s.yearly.goals.map((g) => resultOf(s, g, year));
  const results: YearGoalResult[] = full.map(({ fraction: _f, ...r }) => r);
  // «Почти получилось»: невыполненная цель с полоской от 80 %, ближайшая к выполнению.
  const near = full.filter((r) => !r.done && r.miss && r.fraction >= ALMOST_FRACTION).sort((a, b) => b.fraction - a.fraction)[0] ?? null;
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
  return { ...base, comment: commentFor(s, base, near), seen: false, results };
}

/** Рискованные цели, не выполненные к 31 декабря: штраф и письмо. */
function riskPenalties(s: GameState, year: number): void {
  for (const g of s.yearly.goals) {
    if (g.done) continue;
    const def = findGoal(g.id);
    if (!def?.penalty) continue;
    applyPenalty(s, def.penalty);
    const miss = def.progress(s, g).miss;
    addMail(s, {
      kind: 'event',
      title: `Рискованная цель не выполнена: ${def.title(year, g)}`,
      body: `${miss ? `${endSentence(capitalize(miss))} ` : ''}Штраф: ${endSentence(penaltyText(def.penalty))}`,
    });
  }
}

/**
 * Последний день года (после закрытия декабря): проверить цели, записать итоги, наложить штрафы рискованных целей
 * и предложить цели следующего года. Итогов 2024 года нет - игра заканчивается своим окном.
 */
export function yearEnd(s: GameState): void {
  const day = dayToDate(s.day);
  if (day.month !== 12 || s.yearly.year !== day.year) return;
  checkGoals(s, true, true);
  if (day.year > LAST_REVIEW_YEAR) return;
  const review = buildReview(s, day.year);
  riskPenalties(s, day.year);
  s.yearly.reviews.push(review);
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

/** Награда цели одной строкой («+$150 тыс.»): для окна выбора и боковой панели. */
export function goalRewardText(g: YearGoalState, year: number): string {
  const def = findGoal(g.id);
  return def ? rewardText(def.reward, year) : '';
}

/** Награда цели коротко («аренда -8 %») для боковой панели. */
export function goalRewardShort(g: YearGoalState, year: number): string {
  const def = findGoal(g.id);
  return def ? rewardShort(def.reward, year) : '';
}

/** Штраф цели одной строкой (только риск) или ''. */
export function goalPenaltyText(g: YearGoalState): string {
  return penaltyText(findGoal(g.id)?.penalty);
}

export type { Reward };
