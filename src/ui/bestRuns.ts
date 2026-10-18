// Лучшие партии на этом компьютере (идея «Режимы», 18.10): счёт, лаборатория, страна, сложность, концовка и Эло по
// месяцам - для таблицы в итоговом окне и «призрака» лучшей прошлой партии на графике. Хранится в localStorage,
// как достижения; без него таблица просто пустая.

import type { CountryId, GameState } from '../sim/types';

export interface BestRun {
  /** Партия: зерно и лаборатория (одна и та же партия при повторном открытии итога не записывается дважды). */
  id: string;
  score: number;
  labName: string;
  country: CountryId | null;
  difficulty: GameState['difficulty'];
  title: string;
  /** День записи (дата реального мира, ISO). */
  at: string;
  /** Эло лучшей модели в продаже на конец каждого месяца. */
  elo: number[];
}

const KEY = 'ailab.bestRuns';
const MAX_RUNS = 10;

export function runId(s: GameState): string {
  return `${s.seed}:${s.labName}`;
}

export function loadRuns(): BestRun[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list.filter((r) => r && typeof r.score === 'number' && Array.isArray(r.elo)) as BestRun[]) : [];
  } catch {
    return [];
  }
}

/** Записать партию (повторная запись той же партии заменяет прежнюю); вернуть список, лучшие сверху. */
export function saveRun(run: BestRun): BestRun[] {
  const list = [run, ...loadRuns().filter((r) => r.id !== run.id)].sort((a, b) => b.score - a.score).slice(0, MAX_RUNS);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // хранилище недоступно: таблица покажет только эту партию
  }
  return list;
}
