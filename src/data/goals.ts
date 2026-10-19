// Цели года. В начале года лаборатория получает пять целей разного стиля (деньги, гонка, исследования, рынок, риск)
// и выбирает три. Пороги считаются от положения лаборатории (прошлогодняя выручка, разрыв с соперником, скорость
// исследований, доля рынка), а вид цели внутри стиля выбирается случайно: в каждой партии цели свои.
// У каждого стиля своя награда. Рискованная цель - самая крупная награда и штраф, если к 31 декабря она не выполнена.
// Цели называют только то, что уже есть в игре: вышедшие модели соперников, открытые тесты, технологии с карты.
// Старые цели (до 15.10.2026) остаются в LEGACY_GOALS: сохранение посреди года досчитывает их до 31 декабря.

import { benchDef, benchScore } from '../sim/benchmarks';
import { ARENA_OPEN_DATE } from '../sim/constants';
import { arenaEloGapToTop, raceBenchmark } from '../sim/leaderboard';
import { subsOpen } from '../sim/market';
import { canResearch, researchDaysLeft, rpPerDay, TECHS, techCost } from '../sim/research';
import { ruPlural } from '../sim/text';
import { dateToDay, yearOf } from '../sim/time';
import { archFor, capsFromPlan, modelScore, tierPreset } from '../sim/training';
import type { BenchmarkId, GameState, TechId, YearGoalState } from '../sim/types';
import { eloText, usd } from './eventKit';
import {
  clamp01,
  closeGapOf,
  countText,
  gapText,
  niceCount,
  niceMoney,
  niceShare,
  myRaceValue,
  pointsText,
  raceGap,
  raceKeyOf,
  raceWhere,
  rivalLabel,
  safeStanding,
  shareText,
  splitRace,
  type Penalty,
  type Reward,
} from './questKit';
import { bestRank, playerShare, releasedCount, yearRevenue } from '../sim/yearStats';

export type GoalReward = Reward;

export type GoalStyle = 'money' | 'race' | 'research' | 'market' | 'risk';
export const GOAL_STYLES: readonly GoalStyle[] = ['money', 'race', 'research', 'market', 'risk'];
export const STYLE_NAMES: Record<GoalStyle, string> = {
  money: 'Деньги',
  race: 'Гонка',
  research: 'Исследования',
  market: 'Рынок',
  risk: 'Риск',
};
/** Отмечены по умолчанию (и у ботов): деньги, гонка, исследования. Риск игрок берёт сам. */
export const DEFAULT_STYLES: readonly GoalStyle[] = ['money', 'race', 'research'];

/** Награда стиля: деньги - деньгами, гонка - шумихой и репутацией, исследования и рынок - скидкой, риск - крупно. */
export const STYLE_REWARD: Record<GoalStyle, Reward> = {
  money: { moneyK: 1.5 },
  race: { hype: 10 },
  research: { researchMult: 0.9, days: 90 },
  market: { rentMult: 0.92, days: 60 },
  risk: { moneyK: 3, reputation: 5 },
};
export const RISK_PENALTY: Penalty = { reputation: 5, hype: 10 };

export interface GoalProgress {
  done: boolean;
  /** Одна короткая строка: «Выручка за год: $2,1 млн из $3 млн». */
  text: string;
  /** 0..1 для полоски. */
  fraction: number;
  /** Сколько не хватает: «не хватило $300 тыс.»; для выполненной цели нет. */
  miss?: string;
  /** «Почти»: в гонке - тот же порог, что на верхней панели; иначе полоска от 80 %. */
  almost?: boolean;
}

export interface GoalDef {
  id: string;
  /** Стиль цели; у старых целей нет. */
  style?: GoalStyle;
  /** Название цели; g - параметры цели (порог, соперник, технология). */
  title: (year: number, g?: YearGoalState) => string;
  reward: Reward;
  /** Штраф, если цель не выполнена к 31 декабря (только риск). */
  penalty?: Penalty;
  /** Дешёвая проверка: делается каждый день. Остальные - раз в неделю и в конце года. */
  cheap: boolean;
  /** Засчитывается только 31 декабря: «1-е место на конец года». */
  endOnly?: boolean;
  /** Старые цели: подходит ли цель (новые цели проверяются при выборе). */
  applies?: (s: GameState) => boolean;
  /** Показатель на начало года для целей «за год» (старые цели). */
  base?: (s: GameState) => number;
  progress: (s: GameState, g: YearGoalState) => GoalProgress;
  /** Строка при выборе цели: где лаборатория сейчас («В прошлом году: $2,1 млн»). */
  hint?: (s: GameState, g: YearGoalState) => string;
}

const placeText = (n: number): string => `${n}-е место`;
const nDays = (n: number): string => `${n} ${ruPlural(n, 'день', 'дня', 'дней')}`;

/** Сколько дней обученная, но не выпущенная модель считается «осталось выпустить». */
export const READY_FRESH_DAYS = 60;

/** Доля полоски, с которой цель получает метку «Почти!». */
export const ALMOST_FRACTION = 0.8;

const ARENA_YEAR = yearOf(dateToDay(ARENA_OPEN_DATE));

// ---------- Показатели ----------

/** Выручка закрытых месяцев года и текущего: лучший месяц. */
function bestMonthRevenue(s: GameState, year: number): number {
  let best = 0;
  for (const h of s.finance.history) {
    if (h.year !== year) continue;
    best = Math.max(best, h.income.api + h.income.subs + h.income.contracts);
  }
  if (yearOf(s.day) === year) {
    const m = s.finance.month;
    best = Math.max(best, m.income.api + m.income.subs + m.income.contracts);
  }
  return best;
}

/** Выручка последнего закрытого месяца. */
function lastMonthRevenue(s: GameState): number {
  const h = s.finance.history[s.finance.history.length - 1];
  return h ? h.income.api + h.income.subs + h.income.contracts : 0;
}

/** Сколько исследований завершено за партию (технологии и уровни цепочек). */
export function researchCount(s: GameState): number {
  return s.research.done.length + s.research.algoLevel + s.research.contextLevel;
}

/** Лучший показанный балл выпущенных моделей игрока на тесте. */
function bestScore(s: GameState, bid: BenchmarkId): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null) continue;
    const v = modelScore(m, bid, false);
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Типичная скорость исследований года (очков в день): по ней проверяется, что технология успевается за год. */
const TYPICAL_RP: Record<number, number> = { 2017: 45, 2018: 70, 2019: 80, 2020: 150, 2021: 300, 2022: 450, 2023: 650, 2024: 1500 };

/** Выручка обычной партии за год: нижняя планка денежной цели. */
const REVENUE_FLOOR: Record<number, number> = {
  2017: 300_000,
  2018: 1_000_000,
  2019: 3_000_000,
  2020: 10_000_000,
  2021: 30_000_000,
  2022: 50_000_000,
  2023: 300_000_000,
  2024: 500_000_000,
};

/** Наибольший отрыв, при котором «удержать 1-е место до 31 декабря» ещё цель: 60 Эло или 3 балла теста. */
const HOLD_MAX_LEAD = { arena: 60, bench: 3 } as const;

/** Тендеров за год в обычной партии. */
const TENDERS_BY_YEAR: Record<number, number> = { 2018: 2, 2019: 3, 2020: 4, 2021: 6, 2022: 8, 2023: 8, 2024: 8 };

const pickBy = <T>(table: Record<number, T>, year: number): T => table[Math.max(2017, Math.min(2024, year))] ?? table[2024];

function daysLeftInYear(s: GameState, year: number): number {
  return Math.max(1, dateToDay(`${year}-12-31`) - s.day + 1);
}

// ---------- Прогресс по видам ----------

/** «$1,2 млрд из $1,2 млрд» при недоборе путает (округление): тогда пишем, сколько не хватает. */
function ofTarget(v: number, target: number): string {
  return v < target && usd(v) === usd(target) ? `${usd(v)}, не хватает ${usd(target - v)}` : `${usd(v)} из ${usd(target)}`;
}

function revenueProgress(s: GameState, target: number): GoalProgress {
  const v = yearRevenue(s, s.yearly.year);
  return {
    done: v >= target,
    fraction: clamp01(v / target),
    text: `Выручка за год: ${ofTarget(v, target)}`,
    miss: `не хватило ${usd(Math.max(0, target - v))}`,
  };
}

function monthProgress(s: GameState, target: number): GoalProgress {
  const v = bestMonthRevenue(s, s.yearly.year);
  return {
    done: v >= target,
    fraction: clamp01(v / target),
    text: `Лучший месяц года: ${ofTarget(v, target)}`,
    miss: `не хватило ${usd(Math.max(0, target - v))}`,
  };
}

function tendersProgress(s: GameState, g: YearGoalState): GoalProgress {
  const n = Math.max(0, s.quests.tendersWon - g.base);
  const t = g.target ?? 0;
  return { done: n >= t, fraction: clamp01(n / t), text: `Выиграно за год: ${n} из ${t}`, miss: `выиграно ${n} из ${t}` };
}

export function shareProgress(s: GameState, target: number): GoalProgress {
  const v = playerShare(s);
  return {
    done: v >= target,
    fraction: clamp01(v / target),
    text: `Доля рынка: ${shareText(v)} из ${shareText(target)}`,
    miss: `не хватило ${pointsText(Math.max(0.1, (target - v) * 100))} %`,
  };
}

function techProgress(s: GameState, tech: TechId): GoalProgress {
  const done = s.research.done.includes(tech);
  if (done) return { done, fraction: 1, text: 'Изучено' };
  const points = s.research.points[tech] ?? 0;
  const f = points > 0 ? clamp01(points / techCost(s, tech)) : 0;
  const miss = `изучено на ${Math.floor(f * 100)} %`;
  if (f > 0) return { done, fraction: f, text: `Изучено на ${Math.floor(f * 100)} %${s.research.current === tech ? '' : ', исследование стоит'}`, miss };
  return { done, fraction: 0, text: s.research.current === tech ? 'Исследование началось' : 'Ещё не начато', miss: 'изучено на 0 %' };
}

/**
 * Прогресс цели «выпустить»: самый продвинутый проект обучения (с RLHF, если rlhf). Обученная, но не выпущенная
 * модель - 95 %: осталось нажать «Выпустить». Без проектов - пустая полоска и текст empty.
 */
export function trainingProgress(s: GameState, empty: string, rlhf = false): GoalProgress {
  // Обученная модель, которую давно решили не выпускать, - не «почти»: считается только свежая, из свежих - самая новая.
  const ready = s.models
    .filter((m) => m.releasedDay === null && (!rlhf || m.rlhf) && s.day - m.trainedDay <= READY_FRESH_DAYS)
    .reduce<GameState['models'][number] | null>((b, m) => (!b || m.trainedDay >= b.trainedDay ? m : b), null);
  if (ready) return { done: false, fraction: 0.95, text: `«${ready.name}» обучена, осталось выпустить` };
  let best: { name: string; f: number } | null = null;
  for (const r of s.trainings) {
    if (rlhf && !r.plan.rlhf) continue;
    const f = r.flopTotal > 0 ? clamp01(r.flopDone / r.flopTotal) : 0;
    if (!best || f > best.f) best = { name: r.plan.name, f };
  }
  if (!best) return { done: false, fraction: 0, text: empty };
  return { done: false, fraction: best.f * 0.9, text: `Обучение «${best.name}»: ${Math.floor(best.f * 100)} %` };
}

/** Сколько моделей выпущено с начала года (g.base) - и прогресс к n. */
function modelsProgress(s: GameState, g: YearGoalState, n: number): GoalProgress {
  const got = Math.max(0, releasedCount(s) - g.base);
  if (got >= n) return { done: true, fraction: 1, text: `Выпущено за год: ${got} из ${n}` };
  const run = trainingProgress(s, '');
  return {
    done: false,
    fraction: clamp01((got + run.fraction) / n),
    text: `Выпущено за год: ${got} из ${n}${run.text ? `. ${run.text}` : ''}`,
    miss: `выпущено ${got} из ${n}`,
  };
}

/** 1-е место в гонке (на конец года). */
function firstPlaceProgress(s: GameState): GoalProgress {
  const st = safeStanding(s);
  if (!st) return { done: false, fraction: 0, text: 'Гонки пока нет', miss: 'гонки не было' };
  const key = raceKeyOf(st.metric);
  if (st.rank === 1) {
    const lead = st.below ? `, отрыв ${gapText(key, st.below.gap)}` : '';
    return { done: true, fraction: 1, text: `Сейчас: 1-е место${lead}` };
  }
  const gap = st.ahead[0]?.gap ?? 0;
  const close = closeGapOf(key);
  return {
    done: false,
    fraction: clamp01(1 - gap / (close * 6)),
    text: `Сейчас: ${placeText(st.rank)}, до 1-го ${gapText(key, gap)}`,
    miss: `не хватило ${gapText(key, gap, true)} до 1-го места`,
    almost: gap <= close,
  };
}

// ---------- Новые цели (с выбором) ----------

const T = (g?: YearGoalState): number => g?.target ?? 0;
const P = (g?: YearGoalState): string => g?.param ?? '';

function techName(id: string): string {
  return TECHS.find((t) => t.id === id)?.name ?? id;
}

const ALGO_NAME = techName('algo');

const NEW_GOALS: GoalDef[] = [
  // Деньги
  {
    id: 'm-revenue',
    style: 'money',
    title: (_y, g) => `Выручка ${usd(T(g))} за год`,
    reward: STYLE_REWARD.money,
    cheap: true,
    progress: (s, g) => revenueProgress(s, T(g)),
    hint: (s) => {
      const last = yearRevenue(s, s.yearly.year - 1);
      return last > 0 ? `В прошлом году: ${usd(last)}` : 'Выручки пока не было';
    },
  },
  {
    id: 'm-month',
    style: 'money',
    title: (_y, g) => `Выручка ${usd(T(g))} за месяц`,
    reward: STYLE_REWARD.money,
    cheap: true,
    progress: (s, g) => monthProgress(s, T(g)),
    hint: (s) => {
      const last = lastMonthRevenue(s);
      return last > 0 ? `Прошлый месяц: ${usd(last)}` : 'Выручки пока не было';
    },
  },
  // Гонка
  {
    id: 'g-beat',
    style: 'race',
    title: (_y, g) => {
      const { key, rivalId } = splitRace(P(g));
      return `Обогнать ${rivalLabel(rivalId)} ${raceWhere(key)}`;
    },
    reward: STYLE_REWARD.race,
    cheap: false,
    progress: (s, g) => beatProgress(s, P(g), g.base),
    hint: (_s, g) => {
      const { key } = splitRace(P(g));
      return `Разрыв сейчас: ${gapText(key, g.base)}`;
    },
  },
  {
    id: 'g-top',
    style: 'race',
    title: (_y, g) => `${placeText(T(g))} в гонке или выше`,
    reward: STYLE_REWARD.race,
    cheap: false,
    progress: (s, g) => {
      const top = T(g);
      const st = safeStanding(s);
      if (!st) return { done: false, fraction: 0, text: 'Гонки пока нет', miss: 'гонки не было' };
      if (st.rank <= top) return { done: true, fraction: 1, text: `Сейчас: ${placeText(st.rank)}` };
      const key = raceKeyOf(st.metric);
      const gap = st.ahead[top - 1]?.gap ?? 0;
      const close = closeGapOf(key);
      return {
        done: false,
        fraction: clamp01(1 - gap / Math.max(g.base, close * 2)),
        text: `Сейчас: ${placeText(st.rank)}, до ${top}-го ${gapText(key, gap)}`,
        miss: `не хватило ${gapText(key, gap, true)} до ${top}-го места`,
        almost: gap <= close,
      };
    },
    hint: (s) => {
      const st = safeStanding(s);
      return st ? `Сейчас: ${placeText(st.rank)}` : 'Гонки пока нет';
    },
  },
  {
    id: 'g-hold',
    style: 'race',
    title: () => '1-е место в гонке 31 декабря',
    reward: STYLE_REWARD.race,
    cheap: false,
    endOnly: true,
    progress: (s) => firstPlaceProgress(s),
    hint: (s) => {
      const st = safeStanding(s);
      return st?.below ? `Отрыв сейчас: ${gapText(raceKeyOf(st.metric), st.below.gap)}` : 'Сейчас: 1-е место';
    },
  },
  {
    id: 'g-quality',
    style: 'race',
    title: (_y, g) => `Модель с баллом ${benchDef(P(g) as BenchmarkId).name} от ${T(g)} %`,
    reward: STYLE_REWARD.race,
    cheap: true,
    progress: (s, g) => {
      const bid = P(g) as BenchmarkId;
      const t = T(g);
      const v = bestScore(s, bid);
      if (v === null) {
        const run = trainingProgress(s, 'Моделей пока нет');
        return { done: false, fraction: run.fraction * 0.5, text: run.text, miss: 'модель не выпущена' };
      }
      const gap = t - v;
      return {
        done: v >= t,
        fraction: clamp01(v / t),
        text: `Лучший балл: ${pointsText(v)} % из ${t} %`,
        miss: `не хватило ${gapText(bid, gap, true)}`,
        almost: gap <= closeGapOf(bid),
      };
    },
    hint: (s, g) => {
      const v = bestScore(s, P(g) as BenchmarkId);
      return v === null ? 'Моделей пока нет' : `Лучший балл сейчас: ${pointsText(v)} %`;
    },
  },
  {
    id: 'g-elo',
    style: 'race',
    title: (_y, g) => `Модель с Эло от ${eloText(T(g))} на «Арене»`,
    reward: STYLE_REWARD.race,
    cheap: true,
    progress: (s, g) => {
      const t = T(g);
      const v = myRaceValue(s, 'arena');
      if (v === null) return { done: false, fraction: 0, text: 'Нет моделей в продаже', miss: 'моделей в продаже не было' };
      const gap = t - v;
      return {
        done: v >= t,
        fraction: clamp01(1 - gap / Math.max(1, t - g.base)),
        text: `Лучшая модель: ${eloText(v)} Эло из ${eloText(t)}`,
        miss: `не хватило ${gapText('arena', gap, true)}`,
        almost: gap <= closeGapOf('arena'),
      };
    },
    hint: (s) => {
      const v = myRaceValue(s, 'arena');
      return v === null ? 'Нет моделей в продаже' : `Лучшая модель сейчас: ${eloText(v)} Эло`;
    },
  },
  // Исследования
  {
    id: 'r-tech',
    style: 'research',
    title: (_y, g) => `Изучить «${techName(P(g))}»`,
    reward: STYLE_REWARD.research,
    cheap: true,
    progress: (s, g) => techProgress(s, P(g) as TechId),
    hint: (s, g) => researchHint(s, P(g) as TechId),
  },
  {
    id: 'r-algo',
    style: 'research',
    title: (_y, g) => `«${ALGO_NAME}»: уровень ${T(g)}`,
    reward: STYLE_REWARD.research,
    cheap: true,
    progress: (s, g) => {
      const lvl = s.research.algoLevel;
      const t = T(g);
      if (lvl >= t) return { done: true, fraction: 1, text: `Уровень ${lvl}` };
      const part = clamp01((s.research.points.algo ?? 0) / techCost(s, 'algo'));
      const span = Math.max(1, t - g.base);
      return {
        done: false,
        fraction: clamp01((lvl - g.base + part) / span),
        text: `Уровень ${lvl} из ${t}, следующий изучен на ${Math.floor(part * 100)} %`,
        miss: `уровень ${lvl} из ${t}`,
      };
    },
    hint: (s) => `Сейчас: уровень ${s.research.algoLevel}`,
  },
  {
    id: 'r-count',
    style: 'research',
    title: (_y, g) => `Завершить ${T(g)} ${ruPlural(T(g), 'исследование', 'исследования', 'исследований')} за год`,
    reward: STYLE_REWARD.research,
    cheap: true,
    progress: (s, g) => {
      const n = Math.max(0, researchCount(s) - g.base);
      const t = T(g);
      const cur = s.research.current;
      const part = cur && n < t ? clamp01((s.research.points[cur] ?? 0) / techCost(s, cur)) : 0;
      return {
        done: n >= t,
        fraction: clamp01((n + part) / t),
        text: `Завершено за год: ${n} из ${t}`,
        miss: `завершено ${n} из ${t}`,
      };
    },
    hint: (s) => (s.research.current ? `Сейчас идёт: «${techName(s.research.current)}»` : 'Исследование не выбрано'),
  },
  // Рынок
  {
    id: 'k-share',
    style: 'market',
    title: (_y, g) => `Доля рынка ${shareText(T(g))}`,
    reward: STYLE_REWARD.market,
    cheap: false,
    progress: (s, g) => shareProgress(s, T(g)),
    hint: (s) => `Сейчас: ${shareText(playerShare(s))}`,
  },
  {
    id: 'k-tenders',
    style: 'market',
    title: (_y, g) => `Выиграть ${T(g)} ${ruPlural(T(g), 'тендер', 'тендера', 'тендеров')}`,
    reward: STYLE_REWARD.market,
    cheap: true,
    progress: (s, g) => tendersProgress(s, g),
    hint: (s) => `Выиграно за всё время: ${s.quests.tendersWon}`,
  },
  {
    id: 'k-subs',
    style: 'market',
    title: (_y, g) => `${countText(T(g))} подписчиков`,
    reward: STYLE_REWARD.market,
    cheap: true,
    progress: (s, g) => {
      const v = Math.round(Number.isFinite(s.market.playerSubs) ? s.market.playerSubs : 0);
      const t = T(g);
      return {
        done: v >= t,
        fraction: clamp01(v / t),
        text: `Подписчиков: ${countText(v)} из ${countText(t)}`,
        miss: `не хватило ${countText(Math.max(0, t - v))}`,
      };
    },
    hint: (s) => `Сейчас: ${countText(Math.round(s.market.playerSubs))}`,
  },
  // Риск: крупная награда, штраф при провале
  {
    id: 'x-revenue',
    style: 'risk',
    title: (_y, g) => `Выручка ${usd(T(g))} за год`,
    reward: STYLE_REWARD.risk,
    penalty: RISK_PENALTY,
    cheap: true,
    progress: (s, g) => revenueProgress(s, T(g)),
    hint: (s) => {
      const last = yearRevenue(s, s.yearly.year - 1);
      return last > 0 ? `В прошлом году: ${usd(last)}` : 'Выручки пока не было';
    },
  },
  {
    id: 'x-first',
    style: 'risk',
    title: () => '1-е место в гонке 31 декабря',
    reward: STYLE_REWARD.risk,
    penalty: RISK_PENALTY,
    cheap: false,
    endOnly: true,
    progress: (s) => firstPlaceProgress(s),
    hint: (s) => {
      const st = safeStanding(s);
      if (!st) return 'Гонки пока нет';
      const gap = st.ahead[0]?.gap;
      return gap === undefined ? `Сейчас: ${placeText(st.rank)}` : `Сейчас: ${placeText(st.rank)}, до 1-го ${gapText(raceKeyOf(st.metric), gap)}`;
    },
  },
  {
    id: 'x-month',
    style: 'risk',
    title: (_y, g) => `Выручка ${usd(T(g))} за месяц`,
    reward: STYLE_REWARD.risk,
    penalty: RISK_PENALTY,
    cheap: true,
    progress: (s, g) => monthProgress(s, T(g)),
    hint: (s) => {
      const last = lastMonthRevenue(s);
      return last > 0 ? `Прошлый месяц: ${usd(last)}` : 'Выручки пока не было';
    },
  },
  {
    id: 'x-tenders',
    style: 'risk',
    title: (_y, g) => `Выиграть ${T(g)} ${ruPlural(T(g), 'тендер', 'тендера', 'тендеров')}`,
    reward: STYLE_REWARD.risk,
    penalty: RISK_PENALTY,
    cheap: true,
    progress: (s, g) => tendersProgress(s, g),
    hint: (s) => `Выиграно за всё время: ${s.quests.tendersWon}`,
  },
  {
    id: 'x-models',
    style: 'risk',
    title: (_y, g) => `Выпустить ${T(g)} ${ruPlural(T(g), 'модель', 'модели', 'моделей')} за год`,
    reward: STYLE_REWARD.risk,
    penalty: RISK_PENALTY,
    cheap: true,
    progress: (s, g) => modelsProgress(s, g, T(g)),
    hint: (s) => `Выпущено за всё время: ${releasedCount(s)}`,
  },
  {
    id: 'x-share',
    style: 'risk',
    title: (_y, g) => `Доля рынка ${shareText(T(g))}`,
    reward: STYLE_REWARD.risk,
    penalty: RISK_PENALTY,
    cheap: false,
    progress: (s, g) => shareProgress(s, T(g)),
    hint: (s) => `Сейчас: ${shareText(playerShare(s))}`,
  },
];

export function beatProgress(s: GameState, subject: string, base: number): GoalProgress {
  const { key, rivalId } = splitRace(subject);
  const gap = raceGap(s, key, rivalId);
  if (gap === null) return { done: false, fraction: 0, text: key === 'arena' ? 'Нет моделей в продаже' : 'Моделей пока нет', miss: 'моделей в гонке не было' };
  if (gap < 0) return { done: true, fraction: 1, text: `Впереди на ${gapText(key, -gap)}` };
  const close = closeGapOf(key);
  return {
    done: false,
    fraction: clamp01(1 - gap / Math.max(base, close * 2)),
    text: `Разрыв: ${gapText(key, gap)}`,
    miss: `не хватило ${gapText(key, gap, true)}`,
    almost: gap <= close,
  };
}

function researchHint(s: GameState, tech: TechId): string {
  const d = researchDaysLeft(s, tech, rpPerDay(s));
  if (Number.isFinite(d) && d <= 730 && s.research.current === tech) return `Около ${nDays(d)} при нынешней мощности`;
  return `Цена: ${Math.round(techCost(s, tech)).toLocaleString('ru-RU')} очков`;
}

// ---------- Выбор пяти целей на год ----------

interface Made {
  target?: number;
  param?: string;
  base: number;
}
type Maker = { id: string; make: (s: GameState, year: number, rnd: () => number) => Made | null };

/**
 * Порог денежной цели «выручка за год»: не ниже планки обычной партии и чуть выше прошлого года. Рост от прошлого года
 * ограничен REVENUE_GROWTH_CAP планками: в 2017-2019 годах деньги - разовые оплаты тендеров, и один крупный контракт
 * прошлого года делал цель невыполнимой (плейтест 17.10: $5 млн на 2018 год при реальных $1,1 млн).
 */
const REVENUE_GROWTH_CAP = 2.5;
export function revenueTarget(s: GameState, year: number, r: number): number {
  const last = yearRevenue(s, year - 1);
  const floor = pickBy(REVENUE_FLOOR, year);
  return niceMoney(Math.max(floor * (0.8 + 0.3 * r), Math.min(last * (1.1 + 0.2 * r), floor * REVENUE_GROWTH_CAP)));
}

/**
 * Цели «выручка за месяц» - только с 2020 года: до выхода GTP-3 по API рынок API крошечный, и месяц закрывался одной
 * оплатой тендера (плейтест 17.10: «$40 тыс. за месяц» выполнялась одним заказом за награду $150 тыс.).
 */
export const MONTH_GOALS_FROM = 2020;

function shareTarget(cur: number, r: number, risky: boolean): number {
  const raw = risky ? Math.max(cur * (1.5 + 0.3 * r), cur + 0.08, 0.12) : Math.max(cur * (1.2 + 0.2 * r), cur + 0.03, 0.05 + 0.05 * r);
  return niceShare(Math.min(risky ? 0.7 : 0.6, raw));
}

/** Балл флагмана, который можно обучить сейчас (данные с упором на тексты): планка цели «модель с баллом». */
function reachableScore(s: GameState, bid: BenchmarkId): number {
  const p = tierPreset(s, 'flagship');
  const plan = {
    name: '',
    ...p,
    mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
    benchShare: 0,
    benchTargets: [],
    rlhf: false,
    context: 512,
    tier: 'flagship' as const,
  };
  const caps = capsFromPlan(plan, s.research.algoLevel, archFor(s));
  return benchScore(bid, caps[benchDef(bid).domain], 0);
}

/** Технологии, которые можно начать сейчас и успеть за год при обычной для года скорости. */
function feasibleTechs(s: GameState, year: number): TechId[] {
  const rp = Math.max(rpPerDay(s), pickBy(TYPICAL_RP, year));
  const limit = daysLeftInYear(s, year) * 0.7;
  return TECHS.map((t) => t.id).filter(
    (id) => id !== 'algo' && id !== 'context' && canResearch(s, id) && researchDaysLeft(s, id, rp) <= limit,
  );
}

const MAKERS: Record<GoalStyle, Maker[]> = {
  money: [
    { id: 'm-revenue', make: (s, year, rnd) => ({ target: revenueTarget(s, year, rnd()), base: 0 }) },
    {
      id: 'm-month',
      make: (s, year, rnd) => {
        if (year < MONTH_GOALS_FROM) return null;
        const floor = (pickBy(REVENUE_FLOOR, year) / 12) * (1.6 + 0.4 * rnd());
        return { target: niceMoney(Math.max(floor, lastMonthRevenue(s) * (1.4 + 0.4 * rnd()))), base: 0 };
      },
    },
  ],
  race: [
    {
      id: 'g-beat',
      make: (s, _y, rnd) => {
        const st = safeStanding(s);
        if (!st || st.rank === 1 || st.ahead.length === 0) return null;
        const two = st.ahead.length >= 2 && rnd() < 0.35;
        const rival = two ? st.ahead[st.ahead.length - 2] : st.ahead[st.ahead.length - 1];
        const key = raceKeyOf(st.metric);
        return { param: `${key}:${rival.id}`, base: rival.gap };
      },
    },
    {
      id: 'g-top',
      make: (s, _y, rnd) => {
        const st = safeStanding(s);
        if (!st || st.rank < 3) return null;
        const top = st.rank - 1 - (st.rank >= 5 && rnd() < 0.5 ? 1 : 0);
        return { target: top, base: st.ahead[top - 1]?.gap ?? 0 };
      },
    },
    {
      id: 'g-hold',
      make: (s) => {
        const st = safeStanding(s);
        if (!st || st.rank !== 1) return null;
        // С большим отрывом удержать 1-е место - не цель: тогда гонка предлагает рекорд модели.
        const lead = st.below?.gap ?? Infinity;
        return lead <= HOLD_MAX_LEAD[raceKeyOf(st.metric) === 'arena' ? 'arena' : 'bench'] ? { base: 0 } : null;
      },
    },
    {
      id: 'g-elo',
      make: (s, _y, rnd) => {
        const st = safeStanding(s);
        if (!st || st.rank !== 1 || st.metric.kind !== 'arena') return null;
        const best = myRaceValue(s, 'arena');
        if (best === null) return null;
        return { target: Math.round((best + 20 + 25 * rnd()) / 5) * 5, base: Math.round(best) };
      },
    },
    {
      id: 'g-quality',
      make: (s, _y, rnd) => {
        const st = safeStanding(s);
        if (st && (st.rank !== 1 || st.metric.kind !== 'bench')) return null;
        const bid = raceBenchmark(s);
        if (!s.benchmarks[bid]?.introduced) return null;
        const best = bestScore(s, bid);
        const reach = Math.floor(reachableScore(s, bid));
        const target = Math.min(95, Math.max(reach, best === null ? 0 : Math.ceil(best + 3 + 2 * rnd())));
        if (best !== null && best >= target) return null;
        return { target, param: bid, base: 0 };
      },
    },
  ],
  research: [
    {
      id: 'r-tech',
      make: (s, year, rnd) => {
        const list = feasibleTechs(s, year);
        if (list.length === 0) return null;
        return { param: list[Math.floor(rnd() * list.length)], base: 0 };
      },
    },
    {
      id: 'r-algo',
      make: (s, year, rnd) => {
        const rp = Math.max(rpPerDay(s), pickBy(TYPICAL_RP, year));
        const one = researchDaysLeft(s, 'algo', rp);
        if (one > daysLeftInYear(s, year) * 0.5) return null;
        const two = one * 2.6 <= daysLeftInYear(s, year) * 0.6 && rnd() < 0.5;
        return { target: s.research.algoLevel + (two ? 2 : 1), base: s.research.algoLevel };
      },
    },
    { id: 'r-count', make: (s, year) => ({ target: year >= 2020 ? 3 : year === 2019 ? 2 : 1, base: researchCount(s) }) },
  ],
  market: [
    {
      id: 'k-subs',
      make: (s, _y, rnd) => {
        if (!subsOpen(s.day) || !(s.market.playerSubs >= 1000)) return null;
        return { target: niceCount(Math.max(200_000, s.market.playerSubs * (1.4 + 0.3 * rnd()))), base: 0 };
      },
    },
    {
      id: 'k-tenders',
      make: (s, year) => (year >= 2018 ? { target: pickBy(TENDERS_BY_YEAR, year), base: s.quests.tendersWon } : null),
    },
    {
      id: 'k-share',
      make: (s, _y, rnd) => {
        const cur = playerShare(s);
        return cur < 0.55 ? { target: shareTarget(cur, rnd(), false), base: 0 } : null;
      },
    },
  ],
  risk: [
    { id: 'x-revenue', make: (s, year, rnd) => ({ target: niceMoney(revenueTarget(s, year, 0.5) * (1.7 + 0.3 * rnd())), base: 0 }) },
    {
      id: 'x-first',
      make: (s) => {
        const st = safeStanding(s);
        return st && st.rank >= 2 && st.rank <= 4 ? { base: 0 } : null;
      },
    },
    { id: 'x-models', make: (s) => ({ target: 3, base: releasedCount(s) }) },
    {
      id: 'x-month',
      make: (s, year, rnd) => {
        if (year < MONTH_GOALS_FROM) return null;
        const floor = (pickBy(REVENUE_FLOOR, year) / 12) * (2.8 + 0.6 * rnd());
        return { target: niceMoney(Math.max(floor, lastMonthRevenue(s) * (2.5 + 0.5 * rnd()))), base: 0 };
      },
    },
    {
      id: 'x-tenders',
      make: (s, year) => (year >= 2018 ? { target: pickBy(TENDERS_BY_YEAR, year) * 2, base: s.quests.tendersWon } : null),
    },
    {
      id: 'x-share',
      make: (s, _y, rnd) => {
        const cur = playerShare(s);
        return cur < 0.5 ? { target: shareTarget(cur, rnd(), true), base: 0 } : null;
      },
    },
  ],
};

/** Рискованная цель и обычная цель с тем же показателем: вместе не предлагаются. */
const RISK_TWIN: Record<string, string> = { 'x-share': 'k-share', 'x-revenue': 'm-revenue', 'x-month': 'm-month', 'x-tenders': 'k-tenders' };

/** Порядок перебора видов внутри стиля: случайный, но последний вид - запасной (подходит почти всегда). */
function shuffled<T>(list: T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Пять целей на год, по одной каждого стиля. Вид цели внутри стиля выбирается случайно (rnd - свой поток года,
 * sim/goals.ts), порог - от положения лаборатории. Если ни один вид стиля не подходит, стиль пропускается.
 */
export function makeOffer(s: GameState, year: number, rnd: () => number): YearGoalState[] {
  const out: YearGoalState[] = [];
  for (const style of GOAL_STYLES) {
    for (const maker of shuffled(MAKERS[style], rnd)) {
      // Риск не повторяет показатель, который уже есть среди целей года (доля рынка, выручка за год).
      const twin = RISK_TWIN[maker.id];
      if (twin && out.some((g) => g.id === twin)) continue;
      const made = maker.make(s, year, rnd);
      if (!made) continue;
      const g: YearGoalState = { id: maker.id, done: false, doneDay: null, base: made.base };
      if (made.target !== undefined) g.target = made.target;
      if (made.param !== undefined) g.param = made.param;
      out.push(g);
      break;
    }
  }
  return out;
}

/** Стиль цели по id: у новых целей - из описания, у старых - нет. */
export function goalStyle(id: string): GoalStyle | null {
  return findGoal(id)?.style ?? null;
}

// ---------- Старые цели (сохранения до 15.10.2026) ----------

function legacyRevenue(id: string, target: number, reward: Reward): GoalDef {
  return { id, title: () => `Выручка ${usd(target)} за год`, reward, cheap: true, progress: (s) => revenueProgress(s, target) };
}

function legacyShare(id: string, target: number, reward: Reward): GoalDef {
  return { id, title: () => `Доля рынка ${Math.round(target * 100)} %`, reward, cheap: false, progress: (s) => shareProgress(s, target) };
}

function legacyRank(id: string, top: number, reward: Reward): GoalDef {
  return {
    id,
    title: (year) => (year >= ARENA_YEAR ? `Модель в топ-${top} «Арены»` : `Модель в топ-${top} рейтинга`),
    reward,
    cheap: false,
    progress: (s) => {
      const r = bestRank(s);
      if (r === null) return { done: false, fraction: 0, text: 'Нет моделей в продаже' };
      if (r <= top) return { done: true, fraction: 1, text: `Сейчас: ${placeText(r)}` };
      const gap = arenaEloGapToTop(s, top);
      const fraction = gap === null ? clamp01(top / r) : clamp01(1 - gap / 150);
      const tail = gap === null ? `нужно ${placeText(top)}` : `до ${top}-го места ${Math.max(1, Math.round(gap))} Эло`;
      return {
        done: false,
        fraction,
        text: `Сейчас: ${placeText(r)}, ${tail}`,
        miss: gap === null ? `${placeText(r)} вместо ${top}-го` : `не хватило ${Math.max(1, Math.round(gap))} Эло`,
        almost: gap !== null && gap <= closeGapOf('arena'),
      };
    },
  };
}

function legacyTech(id: string, tech: TechId, name: string, reward: Reward): GoalDef {
  return { id, title: () => `Изучить «${name}»`, reward, cheap: true, applies: (s) => !s.research.done.includes(tech), progress: (s) => techProgress(s, tech) };
}

function legacySubs(id: string, target: number, label: string, reward: Reward): GoalDef {
  return {
    id,
    title: () => `${label} подписчиков`,
    reward,
    cheap: true,
    progress: (s) => {
      const v = Math.round(Number.isFinite(s.market.playerSubs) ? s.market.playerSubs : 0);
      return {
        done: v >= target,
        fraction: clamp01(v / target),
        text: `Подписчиков: ${v.toLocaleString('ru-RU')} из ${target.toLocaleString('ru-RU')}`,
        miss: `не хватило ${countText(Math.max(0, target - v))}`,
      };
    },
  };
}

/** Цели до выбора целей (15.10.2026): только для сохранений, где они уже выданы. */
export const LEGACY_GOALS: GoalDef[] = [
  {
    id: 'first-model',
    title: () => 'Выпустить первую модель',
    reward: { moneyK: 1, reputation: 1 },
    cheap: true,
    progress: (s) => (releasedCount(s) >= 1 ? { done: true, fraction: 1, text: 'Модель выпущена' } : trainingProgress(s, 'Моделей выпущено: 0 из 1')),
  },
  {
    id: 'new-model',
    title: () => 'Выпустить новую модель',
    reward: { reputation: 1 },
    cheap: true,
    base: (s) => releasedCount(s),
    progress: (s, g) => modelsProgress(s, g, 1),
  },
  {
    id: 'two-models',
    title: () => 'Выпустить две модели за год',
    reward: { reputation: 2 },
    cheap: true,
    base: (s) => releasedCount(s),
    progress: (s, g) => modelsProgress(s, g, 2),
  },
  {
    id: 'chat-model',
    title: () => 'Выпустить чат-модель (с RLHF)',
    reward: { moneyK: 1, reputation: 1 },
    cheap: true,
    progress: (s) =>
      s.models.some((m) => m.releasedDay !== null && m.rlhf)
        ? { done: true, fraction: 1, text: 'Чат-модель выпущена' }
        : trainingProgress(s, 'Чат-модели пока нет', true),
  },
  legacyTech('tech-attention', 'attention', 'Механизм внимания', { reputation: 1 }),
  legacyTech('tech-scaling', 'scaling', 'Законы масштабирования', { reputation: 1 }),
  legacyTech('tech-rlhf', 'rlhf', 'Обучение на отзывах людей (RLHF)', { reputation: 1 }),
  legacyTech('tech-codetrain', 'codetrain', 'Обучение на коде', { reputation: 1 }),
  legacyTech('tech-cot', 'cot', 'Цепочки рассуждений', { reputation: 1 }),
  legacyRevenue('rev-300k', 300_000, { moneyK: 1 }),
  legacyRevenue('rev-1m', 1_000_000, { moneyK: 1 }),
  legacyRevenue('rev-3m', 3_000_000, { moneyK: 1 }),
  legacyRevenue('rev-10m', 10_000_000, { moneyK: 1 }),
  legacyRevenue('rev-30m', 30_000_000, { moneyK: 1 }),
  legacyRevenue('rev-40m', 40_000_000, { moneyK: 1 }),
  legacyRevenue('rev-300m', 300_000_000, { moneyK: 1 }),
  legacyRevenue('rev-500m', 500_000_000, { moneyK: 1 }),
  legacyShare('share-5', 0.05, { moneyK: 1, reputation: 1 }),
  legacyShare('share-10', 0.1, { moneyK: 1, reputation: 1 }),
  legacyShare('share-15', 0.15, { moneyK: 1, reputation: 1 }),
  legacyRank('rank-10', 10, { moneyK: 1, reputation: 1 }),
  legacyRank('rank-5', 5, { moneyK: 1, reputation: 1 }),
  legacyRank('rank-3', 3, { moneyK: 1 }),
  legacySubs('subs-500k', 500_000, '500 тысяч', { moneyK: 1, reputation: 1 }),
  legacySubs('subs-1m', 1_000_000, '1 миллион', { moneyK: 1 }),
];

/** Все описания целей: новые и старые. */
export const GOALS: GoalDef[] = [...NEW_GOALS, ...LEGACY_GOALS];

export function findGoal(id: string): GoalDef | undefined {
  return GOALS.find((g) => g.id === id);
}

/** День года для подписи «до 31.12». */
export function yearEndDay(year: number): number {
  return dateToDay(`${year}-12-31`);
}
