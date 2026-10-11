// Исследования (FR-3).

import { ALGO_BASE_COST, ALGO_COST_GROWTH, ALGO_MULT, RP_BASE, RP_K, TECH_COST, TECH_REQUIRES } from './constants';
import { pool } from './compute';
import { addMail, modValue } from './events';
import type { GameState, Result, TechId } from './types';
import { TECH_IDS } from './types';

export interface TechInfo {
  id: TechId;
  name: string; // «Механизм внимания»
  description: string; // что даёт, одна-две фразы
}

/** Четыре технологии в порядке показа. */
export const TECHS: TechInfo[] = [
  {
    id: 'attention',
    name: 'Механизм внимания',
    description: 'Архитектура «Трансформер» вместо LSTM: обучение примерно в 7 раз эффективнее.',
  },
  {
    id: 'scaling',
    name: 'Законы масштабирования',
    description: 'Прогноз баллов модели до обучения и подсказка оптимального размера.',
  },
  {
    id: 'rlhf',
    name: 'Обучение на отзывах людей (RLHF)',
    description: 'Модели становятся полезными собеседниками: выше Эло на Арене, открываются RLHF-тендеры.',
  },
  {
    id: 'algo',
    name: 'Алгоритмические улучшения',
    description: 'Каждый уровень — обучение в 1,25 раза эффективнее; для моделей с RLHF ещё и выше Эло.',
  },
];

/** Одна строка о том, что изменилось, — для письма о завершении. */
const EFFECT_LINE: Record<Exclude<TechId, 'algo'>, string> = {
  attention: 'Теперь доступна архитектура «Трансформер»: обучение примерно в 7 раз эффективнее, чем на LSTM.',
  scaling: 'Теперь окно обучения показывает прогноз баллов до запуска и подсказывает оптимальный размер модели.',
  rlhf: 'Теперь модели можно обучать с RLHF: выше Эло на Арене, и открыты RLHF-тендеры.',
};

function techName(tech: TechId): string {
  return TECHS.find((t) => t.id === tech)?.name ?? tech;
}

/** 1,25 → «1,25» (запятая, как принято в тексте игры). */
function fmtMult(x: number): string {
  return x.toFixed(2).replace('.', ',');
}

/** Цена в очках: TECH_COST × модификатор researchCost(target = tech); algo — ALGO_BASE_COST × ALGO_COST_GROWTH^algoLevel. */
export function techCost(s: GameState, tech: TechId): number {
  const base = tech === 'algo' ? ALGO_BASE_COST * ALGO_COST_GROWTH ** s.research.algoLevel : TECH_COST[tech];
  return base * modValue(s, 'researchCost', tech).mult;
}

/** Почему сейчас нельзя исследовать (null — можно). Текст готов для показа игроку. */
export function researchBlockReason(s: GameState, tech: TechId): string | null {
  if (!TECH_IDS.includes(tech)) return 'Нет такого исследования';
  if (tech !== 'algo' && s.research.done.includes(tech)) return 'Это исследование уже завершено';
  const missing = TECH_REQUIRES[tech].filter((t) => !s.research.done.includes(t));
  if (missing.length > 0) return `Сначала изучите: ${missing.map(techName).join(', ')}`;
  return null;
}

/** Требования выполнены и (кроме algo) ещё не изучено. */
export function canResearch(s: GameState, tech: TechId): boolean {
  return researchBlockReason(s, tech) === null;
}

/** RP_BASE + RP_K × sqrt(pool(experiments)). */
export function rpPerDay(s: GameState): number {
  const power = pool(s, 'experiments');
  // Кривая доля (минус или NaN) не должна давать NaN: тогда исследование завершилось бы мгновенно.
  return RP_BASE + RP_K * Math.sqrt(power > 0 ? power : 0);
}

/** Действие: выбрать текущее исследование (null — остановить). Очки по технологиям сохраняются. */
export function setResearch(s: GameState, tech: TechId | null): Result {
  if (tech === null) {
    s.research.current = null;
    return { ok: true };
  }
  const reason = researchBlockReason(s, tech);
  if (reason) return { ok: false, error: reason };
  s.research.current = tech;
  return { ok: true };
}

/**
 * Ежедневно: прибавить rpPerDay к points[current]. По достижении цены — изучено, письмо (kind 'research').
 * algo: algoLevel += 1, points.algo = 0, current остаётся 'algo'. Остальные: в done, current = null.
 */
export function progressDay(s: GameState): void {
  const tech = s.research.current;
  if (tech === null) return;
  // Защита от кривого состояния: нельзя вести то, что уже изучено или ещё не открыто.
  if (!canResearch(s, tech)) {
    s.research.current = null;
    return;
  }
  s.research.points[tech] += rpPerDay(s);
  if (s.research.points[tech] < techCost(s, tech)) return;

  if (tech === 'algo') {
    s.research.algoLevel += 1;
    s.research.points.algo = 0;
    const level = s.research.algoLevel;
    addMail(s, {
      kind: 'research',
      title: `Исследование завершено: ${techName(tech)}, уровень ${level}`,
      body: `Новые проекты обучаются в ${fmtMult(ALGO_MULT ** level)} раза эффективнее, чем без улучшений.`,
    });
    return;
  }
  s.research.done.push(tech);
  s.research.current = null;
  addMail(s, {
    kind: 'research',
    title: `Исследование завершено: ${techName(tech)}`,
    body: EFFECT_LINE[tech],
  });
}
