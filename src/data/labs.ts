// Семь лабораторий-соперников (решение владельца, CONCEPT.md v0.2).

import type { LabDef } from '../sim/types';

export const LABS: LabDef[] = [
  {
    id: 'openbrain', name: 'OpenBrain', prototype: 'OpenAI', brand: 0.5, color: '#10a37f', chinese: false,
    defaultPricePer1M: { 2017: 100, 2020: 60, 2022: 20, 2023: 10, 2024: 5 },
  },
  {
    id: 'antropik', name: 'Antropik', prototype: 'Anthropic', brand: 0.1, color: '#d97757', chinese: false,
    defaultPricePer1M: { 2023: 15, 2024: 6 },
  },
  {
    id: 'gogle', name: 'Gogle DeepMynd', prototype: 'Google DeepMind', brand: 0.3, color: '#4285f4', chinese: false,
    defaultPricePer1M: { 2017: 100, 2020: 60, 2022: 20, 2023: 5, 2024: 2 },
  },
  {
    id: 'zhipo', name: 'Zhipo', prototype: 'Zhipu AI', brand: -0.7, color: '#7b61ff', chinese: true,
    defaultPricePer1M: { 2022: 5, 2023: 2, 2024: 1 },
  },
  {
    id: 'moonshoot', name: 'Moonshoot', prototype: 'Moonshot AI', brand: -0.7, color: '#f5c518', chinese: true,
    defaultPricePer1M: { 2023: 3, 2024: 1.5 },
  },
  {
    id: 'deepcent', name: 'DeepCent', prototype: 'DeepSeek', brand: -0.5, color: '#4d6bfe', chinese: true,
    defaultPricePer1M: { 2023: 1, 2024: 0.5 },
  },
  {
    id: 'alibabo', name: 'Alibabo', prototype: 'Alibaba (Qwen)', brand: -0.5, color: '#ff6a00', chinese: true,
    defaultPricePer1M: { 2023: 1.5, 2024: 0.8 },
  },
  // Промежуточные лаборатории: короткий взлёт в 2022-2023 и уход в 2024, когда команду забирает корпорация.
  {
    id: 'infleksion', name: 'Infleksion', prototype: 'Inflection AI', brand: 0, color: '#d94f8a', chinese: false,
    defaultPricePer1M: { 2023: 8, 2024: 4 },
    exit: {
      date: '2024-03-19',
      title: 'Infleksion уходит с рынка',
      body: 'Основателей и почти всю команду Infleksion переманила Mikrosoft, партнёр OpenBrain. Модели Infleksion сняты с продажи, их клиенты ищут замену - шанс забрать их себе.',
    },
  },
  {
    id: 'charakter', name: 'Charakter.AI', prototype: 'Character.AI', brand: 0.1, color: '#c0392b', chinese: false,
    defaultPricePer1M: { 2023: 6, 2024: 3 },
    exit: {
      date: '2024-08-02',
      title: 'Charakter.AI уходит с рынка',
      body: 'Gogle купила лицензию на технологии Charakter.AI и забрала основателей. Чат с персонажами закрыт для новых подписчиков, его аудитория ищет другой чат.',
    },
  },
];

export const PLAYER_COLOR = '#e8e8e8';
