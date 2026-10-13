// Раскладка карты исследований: столбцы - годы появления технологий в истории, строки заданы вручную так,
// чтобы линии от требований не проходили через узлы. Цепочки «Алгоритмы» и «Контекст» - отдельные строки под картой.

import { TECH_HISTORY_DATE, TECH_REQUIRES } from '../../sim/constants';
import type { TechBranch } from '../../sim/research';
import { dayToDate, dateToDay } from '../../sim/time';
import type { ChainTech, TechId } from '../../sim/types';

export type GraphTech = Exclude<TechId, ChainTech>;

/** Строка узла на карте (0 - верхняя). */
export const GRAPH_ROW: Record<GraphTech, number> = {
  scaling: 0,
  moe: 0,
  cot: 0,
  instruct: 1,
  multimodal: 1,
  attention: 2,
  rlhf: 2,
  codetrain: 3,
  synthetic: 3,
  distill: 4,
  quant: 4,
};
export const GRAPH_ROWS = 5;

export const GRAPH_TECHS = Object.keys(GRAPH_ROW) as GraphTech[];

/** Цвета направлений: рамка (светлая) и заливка изученного узла (тёмная, белый текст читается). */
export const BRANCH_COLOR: Record<TechBranch, { line: string; fill: string }> = {
  architecture: { line: '#2f80e4', fill: '#1f5aa8' },
  scale: { line: '#4c5fd0', fill: '#3a4bb5' },
  alignment: { line: '#7b5cd6', fill: '#6244c0' },
  data: { line: '#1fa8a0', fill: '#13807a' },
  efficiency: { line: '#c99a1a', fill: '#8a670b' },
  product: { line: '#d9822b', fill: '#a85a14' },
};

/** Годы, в которые появились технологии карты, по возрастанию: каждый год - столбец. */
export function graphYears(): number[] {
  const years = new Set(GRAPH_TECHS.map((t) => dayToDate(dateToDay(TECH_HISTORY_DATE[t])).year));
  return [...years].sort((a, b) => a - b);
}

/** Столбец технологии (индекс в graphYears). */
export function graphCol(tech: GraphTech, years = graphYears()): number {
  return years.indexOf(dayToDate(dateToDay(TECH_HISTORY_DATE[tech])).year);
}

/** Рёбра карты: от требования к технологии (только между узлами карты). */
export function graphEdges(): [GraphTech, GraphTech][] {
  const out: [GraphTech, GraphTech][] = [];
  for (const to of GRAPH_TECHS) {
    for (const from of TECH_REQUIRES[to]) if (from in GRAPH_ROW) out.push([from as GraphTech, to]);
  }
  return out;
}

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.6;
export const ZOOM_STEP = 0.1;
/** «По размеру» не уменьшает карту меньше этого масштаба: мельче текст на карточках не читается. */
export const FIT_MIN_ZOOM = 0.8;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}
