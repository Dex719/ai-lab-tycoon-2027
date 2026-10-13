// Свои дата-центры: площадки, цены стройки и карт (дизайн - .kiro/specs/datacenters/design.md).
// Опоры: стройка ЦОД в США 2023-2024 годов - $10-12 млн за МВт без карт; H100 - $25-30 тыс. за карту,
// сервер на 8 карт с сетью - $250-300 тыс.; промышленное электричество - $30-75 за МВт·ч.

import type { GpuId } from '../sim/types';

export type DcSiteId = 'abilene' | 'ashburn' | 'lulea' | 'quincy';
export const DC_SITE_IDS: readonly DcSiteId[] = ['abilene', 'ashburn', 'lulea', 'quincy'];

/** Этапы стройки по порядку; после последнего дата-центр готов. */
export const DC_STAGE_NAMES = ['Участок', 'Линия электропередачи', 'Здание', 'Охлаждение'] as const;
export const DC_STAGES = DC_STAGE_NAMES.length;
/** Причина задержки этапа для письма: «… задерживается: <причина>». */
export const DC_DELAY_REASONS = [
  'согласование участка затянулось',
  'энергокомпания перенесла подключение к сети',
  'не хватает подрядчиков',
  'поставщик задержал чиллеры',
] as const;

export interface DcSiteDef {
  id: DcSiteId;
  name: string; // «Абилин, Техас»
  note: string; // одна строка: чем площадка хороша
  powerPrice: number; // $ за МВт·ч
  pue: number; // сколько всего электричества на 1 кВт карт (охлаждение и прочее)
  costMult: number; // множитель цены стройки
  stageMonths: [number, number, number, number]; // участок, линия, здание, охлаждение
  risk: number; // вероятность задержки этапа на 1-2 месяца
}

export const DC_SITES: DcSiteDef[] = [
  {
    id: 'abilene',
    name: 'Абилин, Техас',
    note: 'Быстрая стройка, но жара и перегруженная сеть',
    powerPrice: 50,
    pue: 1.4,
    costMult: 0.9,
    stageMonths: [1, 1, 3, 1],
    risk: 0.35,
  },
  {
    id: 'ashburn',
    name: 'Эшберн, Вирджиния',
    note: 'Главный узел дата-центров США: дорогая земля и очередь на подключение',
    powerPrice: 75,
    pue: 1.3,
    costMult: 1.2,
    stageMonths: [1, 3, 4, 2],
    risk: 0.2,
  },
  {
    id: 'lulea',
    name: 'Лулео, Швеция',
    note: 'Холодный климат: охлаждение почти бесплатное',
    powerPrice: 40,
    pue: 1.1,
    costMult: 1.1,
    stageMonths: [2, 2, 5, 1],
    risk: 0.1,
  },
  {
    id: 'quincy',
    name: 'Куинси, Вашингтон',
    note: 'Дешёвое электричество от ГЭС, но долгая линия',
    powerPrice: 30,
    pue: 1.2,
    costMult: 1.0,
    stageMonths: [2, 6, 6, 3],
    risk: 0.1,
  },
];

/** Мощность дата-центра на выбор, МВт. */
export const DC_SIZES: readonly number[] = [5, 20, 50, 100];
/** Крупная стройка дольше: к этапу «Здание» прибавляется столько месяцев. */
export const DC_SIZE_EXTRA_MONTHS: Record<number, number> = { 5: 0, 20: 0, 50: 1, 100: 2 };
/** Стройка, $ за 1 МВт по году начала (без карт); раньше 2021 года - как в 2021, позже 2024 - как в 2024. */
export const DC_COST_PER_MW: Record<number, number> = { 2021: 8e6, 2022: 9e6, 2023: 10e6, 2024: 11e6 };
/** Обслуживание готового дата-центра: $ за 1 МВт в месяц (персонал, охрана, ремонт), даже пустого. */
export const DC_UPKEEP_PER_MW_MONTH = 40_000;
/** Месяц стройки и доставки - столько дней. */
export const DC_MONTH_DAYS = 30;

/** Цена одной карты вместе с долей сервера и сети, $ по годам. */
export const DC_GPU_PRICE: Record<GpuId, Record<number, number>> = {
  p100: { 2017: 9000, 2018: 7000, 2019: 5000, 2020: 4000, 2021: 3000, 2022: 2500, 2023: 2000, 2024: 1500 },
  v100: { 2017: 12000, 2018: 11000, 2019: 10000, 2020: 9000, 2021: 8000, 2022: 6500, 2023: 5500, 2024: 4500 },
  a100: { 2020: 16000, 2021: 15000, 2022: 14000, 2023: 13000, 2024: 10000 },
  h100: { 2023: 32000, 2024: 28000 },
  h200: { 2024: 35000 },
};
/** Мощность одной карты с долей сервера и сети, кВт (без охлаждения: его даёт PUE площадки). */
export const DC_GPU_KW: Record<GpuId, number> = { p100: 0.4, v100: 0.5, a100: 0.65, h100: 1.2, h200: 1.3 };
/** Доставка карт по году заказа, дней: в 2023 году очередь на H100. */
export const DC_DELIVERY_DAYS: Record<number, number> = { 2017: 30, 2022: 30, 2023: 120, 2024: 60 };

/** Функция открывается с этой даты или раньше - по деньгам или выручке (дата игроку не показывается). */
export const DC_UNLOCK_DATE = '2021-01-01';
export const DC_UNLOCK_CASH = 50e6;
export const DC_UNLOCK_MONTH_REVENUE = 5e6;

export function dcSite(id: DcSiteId): DcSiteDef {
  const def = DC_SITES.find((x) => x.id === id);
  if (!def) throw new Error(`Нет площадки ${id}`);
  return def;
}
