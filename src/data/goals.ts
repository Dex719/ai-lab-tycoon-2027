// Цели года: в начале года лаборатория получает три цели по списку этого года (первые подходящие по ситуации).
// Награда небольшая: деньги, репутация или шумиха. Пороги - планка обычной партии, не рекорд бота.
// Деньги в наградах считаются в единицах года (data/eventKit.ts: 2017 - $100 тыс., 2024 - $10 млн).

import { releasedCount, bestRank, playerShare, yearRevenue } from '../sim/yearStats';
import { ARENA_OPEN_DATE } from '../sim/constants';
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
      return { done: r <= top, fraction: clamp01(top / r), text: `Сейчас: ${placeText(r)}, нужно ${placeText(top)}` };
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
      return { done, fraction: done ? 1 : 0, text: done ? 'Изучено' : 'Ещё не изучено' };
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

/** Все цели. */
export const GOALS: GoalDef[] = [
  {
    id: 'first-model',
    title: () => 'Выпустить первую модель',
    reward: { moneyK: 0.5, reputation: 1 },
    cheap: true,
    applies: (s) => releasedCount(s) === 0,
    progress: (s) => {
      const n = releasedCount(s);
      return { done: n >= 1, fraction: n >= 1 ? 1 : 0, text: n >= 1 ? 'Модель выпущена' : 'Моделей выпущено: 0 из 1' };
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
      return { done: n >= 1, fraction: n >= 1 ? 1 : 0, text: `Выпущено за год: ${Math.max(0, n)} из 1` };
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
      return { done: n >= 2, fraction: clamp01(n / 2), text: `Выпущено за год: ${n} из 2` };
    },
  },
  {
    id: 'chat-model',
    title: () => 'Выпустить чат-модель (с RLHF)',
    reward: { moneyK: 0.5, reputation: 1 },
    cheap: true,
    applies: (s) => !s.models.some((m) => m.releasedDay !== null && m.rlhf),
    progress: (s) => {
      const done = s.models.some((m) => m.releasedDay !== null && m.rlhf);
      return { done, fraction: done ? 1 : 0, text: done ? 'Чат-модель выпущена' : 'Чат-модели пока нет' };
    },
  },
  techGoal('tech-attention', 'attention', 'Механизм внимания', { reputation: 1 }),
  techGoal('tech-scaling', 'scaling', 'Законы масштабирования', { reputation: 1 }),
  techGoal('tech-rlhf', 'rlhf', 'Обучение на отзывах людей (RLHF)', { reputation: 1 }),
  techGoal('tech-codetrain', 'codetrain', 'Обучение на коде', { reputation: 1 }),
  techGoal('tech-cot', 'cot', 'Цепочки рассуждений', { reputation: 1 }),
  revenueGoal('rev-300k', 300_000, { moneyK: 0.5 }),
  revenueGoal('rev-1m', 1_000_000, { moneyK: 0.5 }),
  revenueGoal('rev-3m', 3_000_000, { moneyK: 0.5 }),
  revenueGoal('rev-10m', 10_000_000, { moneyK: 0.5 }),
  revenueGoal('rev-30m', 30_000_000, { moneyK: 0.5 }),
  revenueGoal('rev-40m', 40_000_000, { moneyK: 0.5 }),
  revenueGoal('rev-300m', 300_000_000, { moneyK: 0.5 }),
  revenueGoal('rev-500m', 500_000_000, { moneyK: 0.5 }),
  shareGoal('share-5', 0.05, { moneyK: 0.5, reputation: 1 }),
  shareGoal('share-10', 0.1, { moneyK: 0.5, reputation: 1 }),
  shareGoal('share-15', 0.15, { moneyK: 0.5, reputation: 1 }),
  rankGoal('rank-10', 10, { moneyK: 0.5, reputation: 1 }),
  rankGoal('rank-5', 5, { moneyK: 0.5, reputation: 1 }),
  rankGoal('rank-3', 3, { moneyK: 0.5 }),
  subsGoal('subs-500k', 500_000, '500 тысяч', { moneyK: 0.5, reputation: 1 }),
  subsGoal('subs-1m', 1_000_000, '1 миллион', { moneyK: 0.5 }),
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
