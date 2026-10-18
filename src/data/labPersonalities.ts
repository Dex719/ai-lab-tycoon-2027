// Характеры лабораторий-соперников: как каждая отвечает на успехи игрока (срез «Соперники с характерами»).
// Числа - из утверждённой спецификации. Сами ходы, накал и письма - в sim/rivalry.ts.
// Ход без веса лаборатория не делает; список never дублирует это явно для проверок и подсказок.

import type { MoveId } from '../sim/rivalry';
import type { LabId } from '../sim/types';

export interface LabPersonality {
  lab: LabId;
  /** «Характер» во вкладке «Лаборатории»: «гегемон», «ценовой боец»… */
  archetype: string;
  /** Подсказка к характеру: чего ждать от лаборатории (одна-две фразы). */
  description: string;
  /** Множитель роста накала к игроку (heat += 30 × threat × gain × сложность − 8). */
  gain: number;
  /** Веса ходов при выборе; ход без веса недоступен. */
  weights: Partial<Record<MoveId, number>>;
  /** Ходы, которых лаборатория не делает никогда. */
  never: MoveId[];
  /** Множитель задержки между слухом и ходом (большая компания действует медленнее). */
  delayMult: number;
  /** Множитель силы снижения цен (priceCut: цена × (1 − 0,3 × k × priceCutMult)). */
  priceCutMult: number;
  gates: {
    /** Лаборатория спит до этой даты (помимо выхода первой модели на рынок). */
    activeFrom?: string;
    /** Действует, только если доля игрока на рынке не ниже (0..1). */
    minPlayerShare?: number;
    /** Отдельные ходы доступны не раньше даты. */
    moveFrom?: Partial<Record<MoveId, string>>;
    /** Снижение цен - только если собственная доля упала от максимума не меньше чем на столько (0..1, 0,05 = 5 п.п.). */
    priceCutShareDrop?: number;
  };
}

export const LAB_PERSONALITIES: LabPersonality[] = [
  {
    lab: 'openbrain',
    archetype: 'гегемон',
    description: 'Первое место на «Арене» и в умах: ускоряет флагман, открывает бесплатный чат, запускает рекламу, переманивает людей. Цены снижает неохотно.',
    gain: 1.2,
    weights: { flagship: 3, freeTier: 2, hype: 2, poach: 2, priceCut: 1 },
    never: ['openWeights', 'cheapShock', 'priceWar', 'context', 'audit'],
    delayMult: 1,
    priceCutMult: 1,
    gates: { moveFrom: { priceCut: '2023-11-01' }, priceCutShareDrop: 0.05 },
  },
  {
    lab: 'antropik',
    archetype: 'осторожный премиум',
    description: 'Тройка лучших по Эло и честные баллы: перепроверяет чужие результаты, отвечает длинным контекстом, изредка переманивает людей, цены не роняет. Спит до выхода первой модели.',
    gain: 1.0,
    // poach: по таблице ходов переманивают OpenBrain, Gogle и Antropik; в списке never спецификации его нет.
    weights: { audit: 3, context: 2, flagship: 2, poach: 1 },
    never: ['priceCut', 'priceWar', 'cheapShock', 'freeTier', 'openWeights', 'hype'],
    delayMult: 1,
    priceCutMult: 1,
    gates: {},
  },
  {
    lab: 'gogle',
    archetype: 'быстрый последователь',
    description: 'Масштаб и каналы продаж: реклама, бесплатный доступ, снижение цен, длинный контекст. Большая компания, поэтому действует медленно.',
    gain: 1.1,
    weights: { hype: 3, freeTier: 2, priceCut: 2, context: 2, poach: 1, audit: 1, priceWar: 1 },
    never: ['cheapShock', 'flagship', 'openWeights'],
    delayMult: 1.5,
    priceCutMult: 1.2,
    gates: {},
  },
  {
    lab: 'zhipo',
    archetype: 'ценовой боец',
    description: 'Дешёвый домашний сегмент: скидки, открытые веса, дешёвая модель. Замечает игрока только с заметной долей рынка.',
    gain: 0.8,
    weights: { priceCut: 3, openWeights: 2, cheapShock: 1, freeTier: 1, priceWar: 1 },
    never: ['audit', 'poach', 'flagship', 'hype', 'context'],
    delayMult: 1,
    priceCutMult: 1,
    gates: { minPlayerShare: 0.1 },
  },
  {
    lab: 'moonshoot',
    archetype: 'длинный контекст',
    description: 'Потребительская ниша: отвечает длинным контекстом и рекламой, с осени 2023 года - бесплатным чатом. Цены не трогает.',
    gain: 0.7,
    weights: { context: 3, hype: 2, freeTier: 1 },
    never: ['priceCut', 'priceWar', 'cheapShock', 'audit', 'poach', 'flagship', 'openWeights'],
    delayMult: 1,
    priceCutMult: 1,
    gates: { moveFrom: { freeTier: '2023-10-01' } },
  },
  {
    lab: 'deepcent',
    archetype: 'дешёвый шок',
    description: 'Дешевле всех: выпускает модель втрое дешевле рынка, ведёт ценовую войну, открывает веса. Появляется в ноябре 2023 года.',
    gain: 1.3,
    weights: { cheapShock: 3, priceWar: 2, priceCut: 2, openWeights: 2 },
    never: ['hype', 'freeTier', 'audit', 'poach', 'flagship', 'context'],
    delayMult: 1,
    priceCutMult: 1,
    gates: { activeFrom: '2023-11-02' },
  },
  {
    lab: 'alibabo',
    archetype: 'открытые веса',
    description: 'Экосистема: открывает веса, выпускает дешёвые версии, изредка снижает цены. Рекламой и проверками не занимается.',
    gain: 0.9,
    weights: { openWeights: 3, cheapShock: 2, priceCut: 1, priceWar: 1 },
    never: ['audit', 'poach', 'hype', 'flagship', 'freeTier', 'context'],
    delayMult: 1,
    priceCutMult: 1,
    gates: {},
  },
  // Промежуточные лаборатории (2022-2024): громкие, но короткие; цены не трогают, уходят с рынка в 2024 году.
  {
    lab: 'infleksion',
    archetype: 'выскочка',
    description: 'Много денег инвесторов и мало времени: громкая реклама и переманивание людей. Цены не снижает. Уходит с рынка в 2024 году.',
    gain: 0.7,
    weights: { hype: 3, poach: 2 },
    never: ['audit', 'priceCut', 'priceWar', 'cheapShock', 'openWeights', 'flagship', 'freeTier', 'context'],
    delayMult: 0.8,
    priceCutMult: 1,
    gates: { activeFrom: '2023-06-22' },
  },
  {
    lab: 'charakter',
    archetype: 'развлечения',
    description: 'Чат с персонажами для обычных пользователей: бесплатный доступ и реклама. Рабочими задачами не занимается. Уходит с рынка в 2024 году.',
    gain: 0.6,
    weights: { freeTier: 3, hype: 2 },
    never: ['audit', 'poach', 'priceCut', 'priceWar', 'cheapShock', 'openWeights', 'flagship', 'context'],
    delayMult: 1,
    priceCutMult: 1,
    gates: { activeFrom: '2023-01-01' },
  },
];

const BY_LAB = new Map<LabId, LabPersonality>(LAB_PERSONALITIES.map((p) => [p.lab, p]));

export function personalityOf(lab: LabId): LabPersonality {
  const p = BY_LAB.get(lab);
  if (!p) throw new Error(`Нет характера лаборатории ${lab}`);
  return p;
}
