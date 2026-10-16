// Рост лаборатории на рабочем столе: гараж → офис → этаж в бизнес-центре → кампус.
// Этап выбирается по лучшему месяцу выручки (только растёт) или по оценке компании; достигнутый этап
// запоминается флагом газетной заметки (moment:stage-<n>), поэтому лаборатория не «съезжает» обратно,
// если оценка упала. Ничего не меняет в балансе: только картинка сцены и заметка в «Вестнике».

import { valuation } from './investors';
import type { GameState } from './types';

export type LabStageId = 0 | 1 | 2 | 3;

export interface LabStageDef {
  stage: LabStageId;
  name: string;
  /** Порог: лучший месяц выручки, $ (API + подписки + контракты). */
  month: number;
  /** Или оценка компании, $. */
  value: number;
  /** Рабочих столов на сцене (по два человека) и мест под стойки в серверной. */
  desks: number;
  racks: number;
}

/**
 * Пороги по прогонам ботов (balance-подобные партии): офис - в 2018-2019 году, этаж - в 2020-2021,
 * кампус - в 2023-2024. Бездействующая лаборатория остаётся в гараже.
 */
export const LAB_STAGES: readonly LabStageDef[] = [
  { stage: 0, name: 'Гараж', month: 0, value: 0, desks: 1, racks: 2 },
  { stage: 1, name: 'Офис', month: 500e3, value: 50e6, desks: 3, racks: 3 },
  { stage: 2, name: 'Этаж в бизнес-центре', month: 5e6, value: 300e6, desks: 5, racks: 4 },
  { stage: 3, name: 'Кампус', month: 50e6, value: 3e9, desks: 7, racks: 6 },
];

export const stageFlag = (n: number): string => `moment:stage-${n}`;

/** Лучший месяц выручки за партию, $. */
export function bestMonthRevenue(s: GameState): number {
  let best = 0;
  for (const h of s.finance.history) best = Math.max(best, h.income.api + h.income.subs + h.income.contracts);
  return best;
}

function safeValuation(s: GameState): number {
  try {
    return valuation(s).total;
  } catch {
    return 0;
  }
}

/** Этап по показателям сегодня (без памяти о прошлом) и что его дало. */
export function metricStage(s: GameState): { stage: LabStageId; by: 'month' | 'value' | null; month: number; value: number } {
  const month = bestMonthRevenue(s);
  const value = safeValuation(s);
  for (let i = LAB_STAGES.length - 1; i > 0; i--) {
    const d = LAB_STAGES[i];
    if (month >= d.month) return { stage: d.stage, by: 'month', month, value };
    if (value >= d.value) return { stage: d.stage, by: 'value', month, value };
  }
  return { stage: 0, by: null, month, value };
}

/** Этап лаборатории: по показателям, но не ниже уже достигнутого (флаг заметки). */
export function labStage(s: GameState): LabStageId {
  let stage = metricStage(s).stage;
  for (let i = LAB_STAGES.length - 1; i > stage; i--) {
    if (s.flags[stageFlag(i)]) {
      stage = LAB_STAGES[i].stage;
      break;
    }
  }
  return stage;
}

/** Кубки на витрине: за каждый год - 1-е место на конец года (золото) или все цели года (серебро). */
export interface YearCup {
  year: number;
  kind: 'first' | 'goals';
}

export function yearCups(s: GameState): YearCup[] {
  const out = new Map<number, YearCup['kind']>();
  for (const r of s.yearly.reviews) if (r.goalsTotal > 0 && r.goalsDone === r.goalsTotal) out.set(r.year, 'goals');
  for (const h of s.finance.history) if (h.month === 12 && h.placeEnd === 1) out.set(h.year, 'first');
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([year, kind]) => ({ year, kind }));
}
