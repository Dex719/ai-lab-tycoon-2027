// Модели промежуточных лабораторий (Infleksion, Charakter.AI): заданы руками, не из research/catalog, поэтому лежат
// отдельно от сгенерированного rivalModels.ts. Лаборатории уходят с рынка в 2024 году (LabDef.exit), тогда их модели
// снимаются с продажи (sim/rivals.retireLab). Эло - оценки.

import type { RivalModelDef } from '../sim/types';

export const MINOR_MODELS: RivalModelDef[] = [
  {
    id: 'charakter-c1', lab: 'charakter', gameName: 'Charakter c1', realName: 'Character.AI c1', released: '2022-09-27',
    api: false, openWeights: false, chat: true, paramsB: 100, priceIn: null, priceOut: null,
    scores: {}, arenaElo: 1010, arenaEstimated: true, contaminated: false, context: 2048, tier: 'mid',
    notes: 'Чат с персонажами: собеседник для развлечения, а не для работы. Без API, только чат.',
  },
  {
    id: 'pie-1', lab: 'infleksion', gameName: 'Pie', realName: 'Pi (Inflection-1)', released: '2023-05-02',
    api: false, openWeights: false, chat: true, paramsB: null, priceIn: null, priceOut: null,
    scores: { mmlu: 72.7 }, arenaElo: 1080, arenaEstimated: true, contaminated: false, context: 4096, tier: 'mid',
    notes: 'Личный помощник с упором на доброжелательный разговор. Только чат.',
  },
  {
    id: 'charakter-c1-plus', lab: 'charakter', gameName: 'Charakter c1+', realName: 'Character.AI c1+ (c.ai+)', released: '2023-05-23',
    api: false, openWeights: false, chat: true, paramsB: 100, priceIn: null, priceOut: null,
    scores: {}, arenaElo: 1060, arenaEstimated: true, contaminated: false, context: 4096, tier: 'mid',
    notes: 'Платная подписка чата с персонажами: быстрее ответы и длиннее память.',
  },
  {
    id: 'infleksion-1', lab: 'infleksion', gameName: 'Infleksion-1', realName: 'Inflection-1', released: '2023-06-22',
    api: true, openWeights: false, chat: true, paramsB: null, priceIn: 8, priceOut: 8,
    scores: { mmlu: 72.7, gsm8k: 39.9 }, arenaElo: 1110, arenaEstimated: true, contaminated: false, context: 4096, tier: 'mid',
    notes: 'Первая модель Infleksion по API.',
  },
  {
    id: 'infleksion-2', lab: 'infleksion', gameName: 'Infleksion-2', realName: 'Inflection-2', released: '2023-11-22',
    api: true, openWeights: false, chat: true, paramsB: null, priceIn: 8, priceOut: 8,
    scores: { mmlu: 79.6, gsm8k: 81.4 }, arenaElo: 1160, arenaEstimated: true, contaminated: false, context: 8192, tier: 'flagship',
    notes: 'Флагман Infleksion: по заявлению компании - вторая модель в мире после GTP-4.',
  },
  {
    id: 'charakter-c2', lab: 'charakter', gameName: 'Charakter c2', realName: 'Character.AI c2', released: '2024-01-16',
    api: false, openWeights: false, chat: true, paramsB: null, priceIn: null, priceOut: null,
    scores: {}, arenaElo: 1100, arenaEstimated: true, contaminated: false, context: 8192, tier: 'mid',
    notes: 'Новая модель чата с персонажами: дольше держит характер и сюжет.',
  },
  {
    id: 'infleksion-2-5', lab: 'infleksion', gameName: 'Infleksion-2.5', realName: 'Inflection-2.5', released: '2024-03-07',
    api: true, openWeights: false, chat: true, paramsB: null, priceIn: 6, priceOut: 6,
    scores: { mmlu: 85.5, gsm8k: 91.2, humaneval: 73.8 }, arenaElo: 1185, arenaEstimated: true, contaminated: false, context: 8192, tier: 'flagship',
    notes: 'Последняя модель Infleksion: через две недели после выхода команда ушла в Mikrosoft.',
  },
];
