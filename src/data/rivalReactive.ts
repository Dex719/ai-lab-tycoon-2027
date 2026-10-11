// Шаблоны ответных моделей соперников (срез «Соперники с характерами»).
// Это не каталог: шаблон становится моделью только ходом соперника (cheapShock, openWeights, context) и
// попадает в rivalry.extra (день выхода) и rivalry.overrides (Эло, цена, контекст). Названия - производные от
// базовой модели с суффиксом лаборатории: OpenBrain «Nano», Antropik «Instant», Gogle «Flesh-8B», Zhipo «Lite»,
// Moonshoot «Lite», DeepCent «Lito», Alibabo «Turbu»; длинный контекст - «… 128K» / «… 1M».
// Уникальность названий относительно каталога проверяет rivalry.test.ts (reactiveNameProblems).

import type { LabId } from '../sim/types';
import { RIVAL_MODELS } from './rivalModels';

export interface ReactiveTemplate {
  id: string; // 'mv-<lab>-<n>'
  lab: LabId;
  gameName: string;
  /** id базовой модели каталога: от неё берутся realName, chat и контекст по умолчанию; выходит не раньше неё. */
  base: string;
  notBefore: string; // YYYY-MM-DD
  /** Открытые веса (ход openWeights): без API. */
  openWeights?: boolean;
  /** Шаблон для хода context: контекст модели, токенов. */
  context?: number;
}

export const RIVAL_REACTIVE: ReactiveTemplate[] = [
  // OpenBrain: характер не делает ходов с дополнительными моделями, шаблоны - на будущее.
  { id: 'mv-openbrain-1', lab: 'openbrain', gameName: 'GTP-3.5 Nano', base: 'gtp-3-5-turbu', notBefore: '2023-08-01' },
  { id: 'mv-openbrain-2', lab: 'openbrain', gameName: 'GTP-4 Nano', base: 'gtp-4-turbu', notBefore: '2024-02-01' },

  // Antropik: только длинный контекст.
  { id: 'mv-antropik-1', lab: 'antropik', gameName: 'Clade Instant 1 128K', base: 'clade-instant-1', notBefore: '2023-06-01', context: 128000 },
  { id: 'mv-antropik-2', lab: 'antropik', gameName: 'Clade 2 Instant', base: 'clade-2', notBefore: '2023-09-15' },
  { id: 'mv-antropik-3', lab: 'antropik', gameName: 'Clade 3 Haiko 1M', base: 'clade-3-haiko', notBefore: '2024-05-01', context: 1000000 },

  // Gogle DeepMynd: длинный контекст; дешёвые версии - на будущее.
  { id: 'mv-gogle-1', lab: 'gogle', gameName: 'PaLN 2 128K', base: 'paln-2', notBefore: '2023-07-01', context: 128000 },
  { id: 'mv-gogle-2', lab: 'gogle', gameName: 'PaLN 2 Flesh-8B', base: 'paln-2', notBefore: '2023-08-01' },
  { id: 'mv-gogle-3', lab: 'gogle', gameName: 'Gemeni 1.0 Flesh-8B', base: 'gemeni-1-0-pro', notBefore: '2024-01-15' },

  // Zhipo: открытые веса и дешёвые версии.
  { id: 'mv-zhipo-1', lab: 'zhipo', gameName: 'ChatGML2 Lite', base: 'chatgml2-6b', notBefore: '2023-08-01', openWeights: true },
  { id: 'mv-zhipo-2', lab: 'zhipo', gameName: 'GML-4-Lite', base: 'gml-4', notBefore: '2024-02-15' },
  { id: 'mv-zhipo-3', lab: 'zhipo', gameName: 'GML-4-Lite-9B', base: 'gml-4-9b', notBefore: '2024-07-15', openWeights: true },
  { id: 'mv-zhipo-4', lab: 'zhipo', gameName: 'GML-4-Plos Lite', base: 'gml-4-plos', notBefore: '2024-10-01' },

  // Moonshoot: длинный контекст; дешёвая версия - на будущее.
  { id: 'mv-moonshoot-1', lab: 'moonshoot', gameName: 'Kimo Chat 128K', base: 'kimo-chat', notBefore: '2023-11-01', context: 128000 },
  { id: 'mv-moonshoot-2', lab: 'moonshoot', gameName: 'moonshoot-v1 Lite', base: 'moonshoot-v1', notBefore: '2024-04-01' },
  { id: 'mv-moonshoot-3', lab: 'moonshoot', gameName: 'moonshoot-v1 1M', base: 'moonshoot-v1', notBefore: '2024-05-01', context: 1000000 },

  // DeepCent: дешёвый шок и открытые веса.
  { id: 'mv-deepcent-1', lab: 'deepcent', gameName: 'DeepSeak LLM Lito', base: 'deepseak-llm-67b', notBefore: '2023-12-15' },
  { id: 'mv-deepcent-2', lab: 'deepcent', gameName: 'DeepSeak-MoE Lito', base: 'deepseak-moe-16b', notBefore: '2024-02-01', openWeights: true },
  { id: 'mv-deepcent-3', lab: 'deepcent', gameName: 'DeepSeak-V2 Lito', base: 'deepseak-v2', notBefore: '2024-06-01' },
  { id: 'mv-deepcent-4', lab: 'deepcent', gameName: 'DeepSeak-V2.5 Lito', base: 'deepseak-v2-5', notBefore: '2024-10-01' },

  // Alibabo: открытые веса и дешёвые версии.
  { id: 'mv-alibabo-1', lab: 'alibabo', gameName: 'Qwin-14B Turbu', base: 'qwin-14b', notBefore: '2023-10-15', openWeights: true },
  { id: 'mv-alibabo-2', lab: 'alibabo', gameName: 'Qwin1.5-Turbu', base: 'qwin1-5-72b', notBefore: '2024-03-01' },
  { id: 'mv-alibabo-3', lab: 'alibabo', gameName: 'Qwin2-Turbu', base: 'qwin2-72b', notBefore: '2024-07-01' },
  { id: 'mv-alibabo-4', lab: 'alibabo', gameName: 'Qwin2.5-Turbu', base: 'qwin2-5-72b', notBefore: '2024-10-15', openWeights: true },
];

/**
 * Проблемы шаблонов: повтор id или названия (в том числе с каталогом), нет базовой модели, базовая модель другой
 * лаборатории, выход раньше базовой. Пустой список - всё в порядке. Проверяется тестом.
 */
export function reactiveNameProblems(): string[] {
  const out: string[] = [];
  const catalogNames = new Set(RIVAL_MODELS.map((m) => m.gameName));
  const catalogIds = new Map(RIVAL_MODELS.map((m) => [m.id, m]));
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const t of RIVAL_REACTIVE) {
    if (ids.has(t.id) || catalogIds.has(t.id)) out.push(`${t.id}: повтор id`);
    ids.add(t.id);
    if (names.has(t.gameName) || catalogNames.has(t.gameName)) out.push(`${t.id}: название «${t.gameName}» уже занято`);
    names.add(t.gameName);
    if (!/^mv-[a-z]+-\d+$/.test(t.id)) out.push(`${t.id}: id не вида mv-<lab>-<n>`);
    const base = catalogIds.get(t.base);
    if (!base) out.push(`${t.id}: нет базовой модели ${t.base}`);
    else {
      if (base.lab !== t.lab) out.push(`${t.id}: базовая модель другой лаборатории`);
      if (t.notBefore < base.released) out.push(`${t.id}: выходит раньше базовой модели`);
    }
  }
  return out;
}
