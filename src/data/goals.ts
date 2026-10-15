// Цели года: в начале года лаборатория получает три цели по списку этого года (первые подходящие по ситуации).
// Награда заметная: деньги (единица года), репутация или шумиха. Пороги - планка обычной партии, не рекорд бота.
// Деньги в наградах считаются в единицах года (data/eventKit.ts: 2017 - $100 тыс., 2024 - $10 млн).

import { releasedCount, bestRank, playerShare, yearRevenue } from '../sim/yearStats';
import { ARENA_OPEN_DATE } from '../sim/constants';
import { arenaEloGapToTop } from '../sim/leaderboard';
import { techCost } from '../sim/research';
import { dateToDay, yearOf } from '../sim/time';
import type { GameState, TechId, YearGoalState } from '../sim/types';
import { usd } from './eventKit';

export interface GoalReward {
  /** Сумма в единицах года (см. eventKit.unitForYear). */
  moneyK?: number;
  reputation?: number;
  hype?: number;
}

export interface GoalProgress {
  done: boolean;
  /** Одна короткая строка: «Выручка за год: $2,1 млн из $3 млн». */
  text: string;
  /** 0..1 для полоски. */
  fraction: number;
}

export interface GoalDef {
  id: string;
  /** Название цели; зависит от года (до 2023-го нет «Арены»). */
  title: (year: number) => string;
  reward: GoalReward;
  /** Дешёвая проверка: делается каждый день. Остальные - раз в неделю и в конце года. */
  cheap: boolean;
  applies?: (s: GameState) => boolean;
  /** Показатель на начало года для целей «за год». */
  base?: (s: GameState) => number;
  progress: (s: GameState, g: YearGoalState) => GoalProgress;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const pct1 = (x: number): string => `${String(Math.round(x * 1000) / 10).replace('.', ',')} %`;

/** «5-е место». */
const placeText = (n: number): string => `${n}-е место`;

function revenueGoal(id: string, target: number, reward: GoalReward): GoalDef {
  return {
    id,
    title: () => `Выручка ${usd(target)} за год`,
    reward,
    cheap: true,
    progress: (s) => {
      const v = yearRevenue(s, s.yearly.year);
      return { done: v >= target, fraction: clamp01(v / target), text: `Выручка за год: ${usd(v)} из ${usd(target)}` };
    },
  };
}

function shareGoal(id: string, target: number, reward: GoalReward): GoalDef {
  return {
    id,
    title: () => `Доля рынка ${Math.round(target * 100)} %`,
    reward,
    cheap: false,
    progress: (s) => {
      const v = playerShare(s);
      return { done: v >= target, fraction: clamp01(v / target), text: `Доля рынка: ${pct1(v)} из ${pct1(target)}` };
    },
  };
}

const ARENA_YEAR = yearOf(dateToDay(ARENA_OPEN_DATE));

function rankGoal(id: string, top: number, reward: GoalReward): GoalDef {
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
      // Полоска по разрыву в Эло: 150 Эло и больше - пусто, 0 - цель выполнена.
      const fraction = gap === null ? clamp01(top / r) : clamp01(1 - gap / 150);
      const tail = gap === null ? `нужно ${placeText(top)}` : `до ${top}-го места ${Math.max(1, Math.round(gap))} Эло`;
      return { done: false, fraction, text: `Сейчас: ${placeText(r)}, ${tail}` };
    },
  };
}

function techGoal(id: string, tech: TechId, name: string, reward: GoalReward): GoalDef {
  return {
    id,
    title: () => `Изучить «${name}»`,
    reward,
    cheap: true,
    applies: (s) => !s.research.done.includes(tech),
    progress: (s) => {
      const done = s.research.done.includes(tech);
      if (done) return { done, fraction: 1, text: 'Изучено' };
      const points = s.research.points[tech] ?? 0;
      const f = points > 0 ? clamp01(points / techCost(s, tech)) : 0;
      if (f > 0) return { done, fraction: f, text: `Изучено на ${Math.floor(f * 100)} %${s.research.current === tech ? '' : ', исследование стоит'}` };
      return { done, fraction: 0, text: s.research.current === tech ? 'Исследование началось' : 'Ещё не начато' };
    },
  };
}

function subsGoal(id: string, target: number, label: string, reward: GoalReward): GoalDef {
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
      };
    },
  };
}

/**
 * Прогресс цели «выпустить»: самый продвинутый проект обучения (с RLHF, если rlhf). Обученная, но не выпущенная
 * модель - 95 %: осталось нажать «Выпустить». Без проектов - пустая полоска и текст empty.
 */
function trainingProgress(s: GameState, empty: string, rlhf = false): GoalProgress {
  // Самая свежая из обученных и не выпущенных: старая слабая модель, которую выпускать не будут, не должна висеть в цели годами.
  const ready = s.models
    .filter((m) => m.releasedDay === null && (!rlhf || m.rlhf))
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

/** Все цели. */
export const GOALS: GoalDef[] = [
  {
    id: 'first-model',
    title: () => 'Выпустить первую модель',
    reward: { moneyK: 1, reputation: 1 },
    cheap: true,
    applies: (s) => releasedCount(s) === 0,
    progress: (s) => {
      const n = releasedCount(s);
      if (n >= 1) return { done: true, fraction: 1, text: 'Модель выпущена' };
      return trainingProgress(s, 'Моделей выпущено: 0 из 1');
    },
  },
  {
    id: 'new-model',
    title: () => 'Выпустить новую модель',
    reward: { reputation: 1 },
    cheap: true,
    applies: (s) => releasedCount(s) > 0,
    base: (s) => releasedCount(s),
    progress: (s, g) => {
      const n = releasedCount(s) - g.base;
      if (n >= 1) return { done: true, fraction: 1, text: `Выпущено за год: ${n} из 1` };
      return trainingProgress(s, 'Выпущено за год: 0 из 1');
    },
  },
  {
    id: 'two-models',
    title: () => 'Выпустить две модели за год',
    reward: { reputation: 2 },
    cheap: true,
    applies: (s) => releasedCount(s) > 0,
    base: (s) => releasedCount(s),
    progress: (s, g) => {
      const n = Math.max(0, releasedCount(s) - g.base);
      if (n >= 2) return { done: true, fraction: 1, text: `Выпущено за год: ${n} из 2` };
      const run = trainingProgress(s, '');
      return { done: false, fraction: clamp01((n + run.fraction) / 2), text: `Выпущено за год: ${n} из 2${run.text ? `. ${run.text}` : ''}` };
    },
  },
  {
    id: 'chat-model',
    title: () => 'Выпустить чат-модель (с RLHF)',
    reward: { moneyK: 1, reputation: 1 },
    cheap: true,
    applies: (s) => !s.models.some((m) => m.releasedDay !== null && m.rlhf),
    progress: (s) => {
      const done = s.models.some((m) => m.releasedDay !== null && m.rlhf);
      if (done) return { done, fraction: 1, text: 'Чат-модель выпущена' };
      return trainingProgress(s, 'Чат-модели пока нет', true);
    },
  },
  techGoal('tech-attention', 'attention', 'Механизм внимания', { reputation: 1 }),
  techGoal('tech-scaling', 'scaling', 'Законы масштабирования', { reputation: 1 }),
  techGoal('tech-rlhf', 'rlhf', 'Обучение на отзывах людей (RLHF)', { reputation: 1 }),
  techGoal('tech-codetrain', 'codetrain', 'Обучение на коде', { reputation: 1 }),
  techGoal('tech-cot', 'cot', 'Цепочки рассуждений', { reputation: 1 }),
  revenueGoal('rev-300k', 300_000, { moneyK: 1 }),
  revenueGoal('rev-1m', 1_000_000, { moneyK: 1 }),
  revenueGoal('rev-3m', 3_000_000, { moneyK: 1 }),
  revenueGoal('rev-10m', 10_000_000, { moneyK: 1 }),
  revenueGoal('rev-30m', 30_000_000, { moneyK: 1 }),
  revenueGoal('rev-40m', 40_000_000, { moneyK: 1 }),
  revenueGoal('rev-300m', 300_000_000, { moneyK: 1 }),
  revenueGoal('rev-500m', 500_000_000, { moneyK: 1 }),
  shareGoal('share-5', 0.05, { moneyK: 1, reputation: 1 }),
  shareGoal('share-10', 0.1, { moneyK: 1, reputation: 1 }),
  shareGoal('share-15', 0.15, { moneyK: 1, reputation: 1 }),
  rankGoal('rank-10', 10, { moneyK: 1, reputation: 1 }),
  rankGoal('rank-5', 5, { moneyK: 1, reputation: 1 }),
  rankGoal('rank-3', 3, { moneyK: 1 }),
  subsGoal('subs-500k', 500_000, '500 тысяч', { moneyK: 1, reputation: 1 }),
  subsGoal('subs-1m', 1_000_000, '1 миллион', { moneyK: 1 }),
];

/** Списки по годам: в начале года берутся первые подходящие по ситуации (applies), всего три. */
export const GOALS_BY_YEAR: Record<number, string[]> = {
  2017: ['tech-attention', 'first-model', 'rev-300k', 'new-model'],
  2018: ['first-model', 'new-model', 'rev-1m', 'rank-10', 'share-5'],
  2019: ['first-model', 'new-model', 'rev-3m', 'share-10', 'tech-scaling'],
  2020: ['tech-rlhf', 'rev-10m', 'share-15', 'first-model', 'new-model'],
  2021: ['rev-30m', 'rank-3', 'tech-codetrain', 'two-models'],
  2022: ['rev-40m', 'chat-model', 'rank-3', 'tech-cot'],
  2023: ['rev-300m', 'subs-500k', 'rank-3', 'two-models'],
  2024: ['rev-500m', 'subs-1m', 'share-15', 'rank-3'],
};

export function findGoal(id: string): GoalDef | undefined {
  return GOALS.find((g) => g.id === id);
}
