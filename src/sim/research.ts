// Исследования (FR-3).

import {
  ALGO_BASE_COST,
  ALGO_COST_GROWTH,
  ALGO_HISTORY_START,
  ALGO_LEVEL_DAYS,
  ALGO_MULT,
  CONTEXT_BASE_COST,
  CONTEXT_COST_GROWTH,
  CONTEXT_LEVELS,
  EARLY_PENALTY_PER_YEAR,
  RP_BASE,
  RP_K,
  TECH_COST,
  TECH_HISTORY_DATE,
  TECH_REQUIRES,
} from './constants';
import { pool } from './compute';
import { addMail, modValue } from './events';
import { dateToDay } from './time';
import type { ChainTech, GameState, Result, TechId } from './types';
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
    description: 'Архитектура «Трансформер» вместо LSTM. Обучение эффективнее примерно в 7 раз.',
  },
  {
    id: 'scaling',
    name: 'Законы масштабирования',
    description: 'Прогноз баллов модели до начала обучения и оптимальный размер модели.',
  },
  {
    id: 'rlhf',
    name: 'Обучение на отзывах людей (RLHF)',
    description: 'Модели с RLHF получают более высокое Эло на «Арене». Открываются RLHF-тендеры.',
  },
  {
    id: 'algo',
    name: 'Алгоритмические улучшения',
    description: 'Каждый уровень повышает эффективность обучения в 1,25 раза. У моделей с RLHF растёт и Эло.',
  },
  {
    id: 'context',
    name: 'Длинный контекст',
    description: 'Каждый уровень увеличивает контекст новых моделей. Модели с длинным контекстом покупают охотнее.',
  },
];

/** Наибольший контекст, доступный для обучения сейчас. */
export function maxContext(s: GameState): number {
  return CONTEXT_LEVELS[Math.min(s.research.contextLevel, CONTEXT_LEVELS.length - 1)][0];
}

/** Последний уровень «Длинного контекста». */
export const CONTEXT_MAX_LEVEL = CONTEXT_LEVELS.length - 1;

/** 512 → «512», 2048 → «2 тыс.», 128000 → «128 тыс.», 1000000 → «1 млн». */
export function contextLabel(tokens: number): string {
  if (tokens >= 1e6) return `${String(Math.round((tokens / 1e6) * 10) / 10).replace('.', ',')} млн`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)} тыс.`;
  return String(Math.round(tokens));
}

/** Одна строка о том, что изменилось, - для письма о завершении. */
const EFFECT_LINE: Record<Exclude<TechId, ChainTech>, string> = {
  attention: 'Доступна архитектура «Трансформер». Обучение эффективнее, чем на LSTM, примерно в 7 раз.',
  scaling: 'В окне «Новая модель» отображаются прогноз баллов до запуска и оптимальный размер модели.',
  rlhf: 'Доступно обучение с RLHF: Эло на «Арене» выше, открыты RLHF-тендеры.',
};

function techName(tech: TechId): string {
  return TECHS.find((t) => t.id === tech)?.name ?? tech;
}

/** 1,25 → «1,25» (запятая, как принято в тексте игры). */
function fmtMult(x: number): string {
  return x.toFixed(2).replace('.', ',');
}

/** День, когда технология (для algo - следующий уровень) появилась в истории. */
export function techHistoryDay(s: GameState, tech: TechId): number {
  if (tech === 'algo') return dateToDay(ALGO_HISTORY_START) + s.research.algoLevel * ALGO_LEVEL_DAYS;
  if (tech === 'context') return dateToDay(CONTEXT_LEVELS[Math.min(s.research.contextLevel + 1, CONTEXT_MAX_LEVEL)][1]);
  return dateToDay(TECH_HISTORY_DATE[tech]);
}

/** Насколько лет игрок опережает историю с этой технологией (0 - не опережает). */
export function yearsEarly(s: GameState, tech: TechId): number {
  return Math.max(0, (techHistoryDay(s, tech) - s.day) / 365);
}

/** Множитель цены за опережение истории: 1 + EARLY_PENALTY_PER_YEAR × лет. */
export function earlyPenalty(s: GameState, tech: TechId): number {
  return 1 + EARLY_PENALTY_PER_YEAR * yearsEarly(s, tech);
}

/**
 * Цена в очках: TECH_COST × модификатор researchCost(target = tech); algo - ALGO_BASE_COST × ALGO_COST_GROWTH^algoLevel.
 * Всё × earlyPenalty: раньше исторической даты исследовать дороже. Цена пересчитывается каждый день,
 * поэтому с приближением исторической даты она падает.
 */
export function techCost(s: GameState, tech: TechId): number {
  const base =
    tech === 'algo'
      ? ALGO_BASE_COST * ALGO_COST_GROWTH ** s.research.algoLevel
      : tech === 'context'
        ? CONTEXT_BASE_COST * CONTEXT_COST_GROWTH ** s.research.contextLevel
        : TECH_COST[tech];
  return base * modValue(s, 'researchCost', tech).mult * earlyPenalty(s, tech);
}

/** Почему сейчас нельзя исследовать (null - можно). Текст готов для показа игроку. */
export function researchBlockReason(s: GameState, tech: TechId): string | null {
  if (!TECH_IDS.includes(tech)) return 'Нет такого исследования';
  if (tech === 'context' && s.research.contextLevel >= CONTEXT_MAX_LEVEL) return 'Достигнут наибольший контекст';
  if (tech !== 'algo' && s.research.done.includes(tech)) return 'Это исследование уже завершено';
  const missing = TECH_REQUIRES[tech].filter((t) => !s.research.done.includes(t));
  if (missing.length > 0) return `Требуется исследование: ${missing.map(techName).join(', ')}`;
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

/** Действие: выбрать текущее исследование (null - остановить). Очки по технологиям сохраняются. */
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
 * Ежедневно: прибавить rpPerDay к points[current]. По достижении цены - изучено, письмо (kind 'research').
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

  if (tech === 'context') {
    s.research.contextLevel += 1;
    s.research.points.context = 0;
    s.research.current = null;
    const level = s.research.contextLevel;
    const last = level >= CONTEXT_MAX_LEVEL;
    if (last) s.research.done.push('context');
    addMail(s, {
      kind: 'research',
      title: `Исследование завершено: ${techName(tech)}, ${contextLabel(maxContext(s))} токенов`,
      body:
        `Новые модели можно обучать с контекстом до ${contextLabel(maxContext(s))} токенов. Контекст выбирается в окне «Новая модель».` +
        (last ? '' : ' Следующий уровень можно начать в окне «Исследования».'),
    });
    return;
  }
  if (tech === 'algo') {
    s.research.algoLevel += 1;
    s.research.points.algo = 0;
    const level = s.research.algoLevel;
    addMail(s, {
      kind: 'research',
      title: `Исследование завершено: ${techName(tech)}, уровень ${level}`,
      body: `Эффективность обучения новых проектов выросла в ${fmtMult(ALGO_MULT ** level)} раза по сравнению с исходной.`,
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
