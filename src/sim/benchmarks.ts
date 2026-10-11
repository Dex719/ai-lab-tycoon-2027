// Формулы бенчмарков и их появление (FR-5). TSK-005.

import { BENCHMARKS } from '../data/benchmarks';
import { addMail } from './events';
import { dateToDay } from './time';
import type { BenchmarkDef, BenchmarkId, DomainId, GameState } from './types';

/** Названия областей для писем и интерфейса. */
export const DOMAIN_NAMES: Record<DomainId, string> = {
  language: 'Язык',
  code: 'Код',
  reasoning: 'Рассуждения',
};

// Запас от краёв, чтобы обратная формула не уходила в бесконечность.
const SCORE_EPS = 1e-3;
// Способность из балла не уходит дальше этого от сложности бенчмарка.
const CAP_RANGE = 40;

const BY_ID = new Map<BenchmarkId, BenchmarkDef>(BENCHMARKS.map((b) => [b.id, b]));

export function benchDef(id: BenchmarkId): BenchmarkDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Нет бенчмарка ${id}`);
  return def;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** score = 100 × (g + (1 − g) × σ((cap + overfit − Dif) / S)), в %. */
export function benchScore(id: BenchmarkId, cap: number, overfit = 0): number {
  const d = benchDef(id);
  return 100 * (d.guess + (1 - d.guess) * sigmoid((cap + overfit - d.difficulty) / d.spread));
}

/** Обратная формула: способность по баллу; балл обрезается в (g, 100) с запасом, итог — в [Dif − 40, Dif + 40]. */
export function capFromScore(id: BenchmarkId, score: number): number {
  const d = benchDef(id);
  const p = Math.min(1 - SCORE_EPS, Math.max(SCORE_EPS, (score / 100 - d.guess) / (1 - d.guess)));
  const cap = d.difficulty + d.spread * Math.log(p / (1 - p));
  return Math.min(d.difficulty + CAP_RANGE, Math.max(d.difficulty - CAP_RANGE, cap));
}

/** Вышедшие бенчмарки (introduced), по порядку данных. */
export function introducedBenchmarks(s: GameState): BenchmarkId[] {
  return BENCHMARKS.filter((b) => s.benchmarks[b.id].introduced).map((b) => b.id);
}

/** Вышедшие и не насыщенные. */
export function activeBenchmarks(s: GameState): BenchmarkId[] {
  return BENCHMARKS.filter((b) => s.benchmarks[b.id].introduced && !s.benchmarks[b.id].saturated).map((b) => b.id);
}

/** Ежедневно: отметить introduced у бенчмарков, чья дата наступила (≤ сегодня), и отправить письмо (kind 'benchmark'). */
export function introduceDue(s: GameState): void {
  for (const def of BENCHMARKS) {
    const state = s.benchmarks[def.id];
    if (state.introduced || dateToDay(def.introduced) > s.day) continue;
    state.introduced = true;
    addMail(s, {
      kind: 'benchmark',
      title: `Новый бенчмарк: ${def.name}`,
      body:
        `${def.description} Область: ${DOMAIN_NAMES[def.domain]}. ` +
        'Баллы моделей отображаются в окне «Аналитика», вкладка «Бенчмарки».',
    });
  }
}
