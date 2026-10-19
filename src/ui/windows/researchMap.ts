// Раскладка карты исследований и короткие тексты для окна «Исследования».
// Карта не двигается и не масштабируется: три столбца-ступени (основа, первый шаг, второй шаг) и шесть строк;
// строки подобраны так, чтобы линии от требований шли слева направо и не проходили через узлы.
// Цепочки с уровнями («Алгоритмические улучшения», «Длинный контекст») - отдельной полосой под картой.
// Годов на карте нет: будущее не раскрываем.

import {
  ALGO_MULT,
  CODE_TRAIN_CAP,
  CONTEXT_LEVELS,
  COT_REASONING_CAP,
  DISTILL_LIGHT_CAP,
  INSTRUCT_ELO,
  MOE_SERVING_MULT,
  QUANT_SERVING_COST,
  SYNTHETIC_TOKENS_MULT,
  TECH_REQUIRES,
  DAYS_PER_MONTH,
} from '../../sim/constants';
import { CONTEXT_MAX_LEVEL, contextLabel, type TechBranch } from '../../sim/research';
import { ruPlural, tokensWord } from '../../sim/text';
import type { ChainTech, GameState, TechId } from '../../sim/types';
import { fmtDays } from '../format';

export type GraphTech = Exclude<TechId, ChainTech>;

/** Клетка узла на карте: столбец (0 - основа) и строка (0 - верхняя). */
export const MAP_CELL: Record<GraphTech, { col: number; row: number }> = {
  attention: { col: 0, row: 2 },
  scaling: { col: 1, row: 0 },
  rlhf: { col: 1, row: 1 },
  instruct: { col: 1, row: 2 },
  distill: { col: 1, row: 4 },
  codetrain: { col: 1, row: 5 },
  moe: { col: 2, row: 0 },
  cot: { col: 2, row: 2 },
  multimodal: { col: 2, row: 3 },
  quant: { col: 2, row: 4 },
  synthetic: { col: 2, row: 5 },
};
export const MAP_COLS = 3;
export const MAP_ROWS = 6;

export const GRAPH_TECHS = Object.keys(MAP_CELL) as GraphTech[];
export const CHAIN_TECHS: ChainTech[] = ['algo', 'context'];

/** Сколько технологий можно изучить до конца: все с карты и «Длинный контекст» (у алгоритмов конца нет). */
export const TECHS_TO_LEARN = GRAPH_TECHS.length + 1;

/** Цвета направлений: рамка (светлая) и тёмный оттенок (текст, значок). */
export const BRANCH_COLOR: Record<TechBranch, { line: string; fill: string }> = {
  architecture: { line: '#2f80e4', fill: '#1f5aa8' },
  scale: { line: '#4c5fd0', fill: '#3a4bb5' },
  alignment: { line: '#7b5cd6', fill: '#6244c0' },
  data: { line: '#1fa8a0', fill: '#13807a' },
  efficiency: { line: '#c99a1a', fill: '#8a670b' },
  product: { line: '#d9822b', fill: '#a85a14' },
};

/** Рёбра карты: от требования к технологии (только между узлами карты). */
export function graphEdges(): [GraphTech, GraphTech][] {
  const out: [GraphTech, GraphTech][] = [];
  for (const to of GRAPH_TECHS) {
    for (const from of TECH_REQUIRES[to]) if (from in MAP_CELL) out.push([from as GraphTech, to]);
  }
  return out;
}

// ---------- Тексты ----------

/** Подпись узла на карте, если полное название не помещается в две строки. */
export const MAP_LABEL: Partial<Record<TechId, string>> = {
  rlhf: 'RLHF: отзывы людей',
  // Мягкий перенос: Chrome на Windows не расставляет переносы в русском, и слово рвалось на «Мультимодальност / ь» (QA 19.10).
  multimodal: 'Мульти­модальность',
};

/** Срок по-человечески: «45 дней», «≈ 5 месяцев», «≈ 1,5 года», «больше 10 лет». */
export function termText(days: number): string {
  if (!Number.isFinite(days)) return 'больше 10 лет';
  const d = Math.max(1, Math.round(days));
  if (d <= 60) return fmtDays(d);
  const months = Math.round(d / DAYS_PER_MONTH);
  if (months < 12) return `≈ ${months} ${ruPlural(months, 'месяц', 'месяца', 'месяцев')}`;
  const years = Math.round((d / 365) * 10) / 10;
  if (years >= 10) return 'больше 10 лет';
  if (Number.isInteger(years)) return `≈ ${years} ${ruPlural(years, 'год', 'года', 'лет')}`;
  return `≈ ${String(years).replace('.', ',')} года`;
}

/** 1.95 → «1,95», 1.1 → «1,1». */
function factor(x: number): string {
  return String(Math.round(x * 100) / 100).replace('.', ',');
}

/** Что даст технология - одна короткая строка для карточек и полосы вверху окна. */
export function techGain(s: GameState, id: TechId): string {
  switch (id) {
    case 'attention':
      return 'Обучение эффективнее в 7 раз';
    case 'scaling':
      return 'Прогноз баллов модели до начала обучения';
    case 'rlhf':
      return 'Эло на «Арене» выше, открываются RLHF-тендеры';
    case 'algo':
      return `Обучение эффективнее: ×${factor(ALGO_MULT ** (s.research.algoLevel + 1))} к исходному`;
    case 'context': {
      if (s.research.contextLevel >= CONTEXT_MAX_LEVEL) return 'Наибольший контекст уже доступен';
      const next = CONTEXT_LEVELS[s.research.contextLevel + 1][0];
      return `Контекст новых моделей до ${contextLabel(next)} ${tokensWord(next)}`;
    }
    case 'distill':
      return `Лёгкие модели сильнее: +${DISTILL_LIGHT_CAP} ко всем областям`;
    case 'moe':
      return `В ${factor(MOE_SERVING_MULT)} раза больше токенов на ту же мощность`;
    case 'codetrain':
      return `Новые модели: +${CODE_TRAIN_CAP} к способности «Код»`;
    case 'instruct':
      return `Новые модели без RLHF: +${INSTRUCT_ELO} Эло на «Арене»`;
    case 'cot':
      return `Новые модели: +${COT_REASONING_CAP} к «Математике и науке»`;
    case 'quant':
      return `Обслуживание всех моделей дешевле на ${Math.round((1 - QUANT_SERVING_COST) * 100)} %`;
    case 'multimodal':
      return 'Модели понимают изображения, их охотнее выбирают';
    case 'synthetic':
      return `Данных для обучения в ${factor(SYNTHETIC_TOKENS_MULT)} раза больше`;
  }
}
