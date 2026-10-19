// Страна лаборатории: выбирается в новой игре и меняет правила партии.
// США - новые видеокарты раньше всех, дорогой офис. Китай - чужие данные почти без риска и дешёвая команда, но с осени
// 2022 года запрет на ввоз мощных карт. Франция - доверие компаний и дешёвые исследования, но строгие суды за данные и
// дорогая аренда.
// Чужие данные (план обучения stolenData) доступны в любой стране: модель сильнее, но каждый месяц продаж могут подать иск.
// Старые сохранения без страны играют без особенностей страны (countryOf → null).

import { FOREVER, STOLEN_EXPOSE_MONTHLY, STOLEN_FINE_BASE, STOLEN_FINE_EARNED, STOLEN_REP } from './constants';
import { addMail, addModifier } from './events';
import { spend } from './finance';
import { chance } from './rng';
import { byYear, yearOf } from './time';
import type { CountryId, GameState, GpuId, PlayerModel } from './types';

export interface CountryDef {
  id: CountryId;
  name: string;
  /** Где штаб-квартира: в письме об основании и на рабочем столе. */
  city: string;
  /** Плюсы и минусы для выбора в новой игре: коротко, без цифр, которые раскрывают будущее. */
  pros: string[];
  cons: string[];
}

export const COUNTRIES: Record<CountryId, CountryDef> = {
  us: {
    id: 'us',
    name: 'США',
    city: 'Сан-Франциско',
    pros: ['Новые видеокарты - на 3 месяца раньше всех', 'Инвесторы оценивают дороже на 20 %'],
    cons: ['Офис и зарплаты дороже на 30 %'],
  },
  cn: {
    id: 'cn',
    name: 'Китай',
    city: 'Ханчжоу',
    pros: ['Обучение на чужих данных: иски в 3 раза реже, штрафы меньше', 'Офис и зарплаты дешевле на 30 %'],
    cons: ['Зарубежные клиенты доверяют меньше', 'Возможны запреты на ввоз мощных видеокарт'],
  },
  eu: {
    id: 'eu',
    name: 'Франция',
    city: 'Париж',
    pros: ['Репутация +5 на старте', 'Компании-клиенты доверяют больше', 'Исследования дешевле на 10 %'],
    cons: ['Обучение на чужих данных: иски в 2 раза чаще, модель снимают с продажи', 'Аренда карт дороже на 15 %'],
  },
};

/** «Плюсы: …. Минусы: ….» - для письма об основании. */
export function countryPerks(id: CountryId): string {
  const c = COUNTRIES[id];
  const low = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
  return `Плюсы: ${c.pros.map(low).join('; ')}. Минусы: ${c.cons.map(low).join('; ')}.`;
}

/** Страна партии или null (старое сохранение, тесты и боты баланса). */
export function countryOf(s: GameState): CountryId | null {
  return s.country ?? null;
}

// ---------- Видеокарты ----------

/** На сколько дней раньше лаборатория в США получает новое поколение карт (P100 уже на рынке к началу партии). */
export const US_GPU_EARLY_DAYS = 90;

/** Сдвиг даты выхода карты для страны игрока, дней. */
export function gpuEarlyDays(s: GameState, id: GpuId): number {
  return countryOf(s) === 'us' && id !== 'p100' ? US_GPU_EARLY_DAYS : 0;
}

/** Китай: запрет 2022 года - мощные карты только через посредников (дороже и меньше), 2023 года - ещё меньше. */
const CN_BANNED_GPUS: readonly GpuId[] = ['a100', 'h100', 'h200'];
const CN_BAN_RENT_MULT = 1.5;
const CN_BAN_CAP_MULT = 0.25;
const CN_BAN2_CAP_MULT = 0.5;

/**
 * Экспортный запрет США (события export-controls-2022/2023, data/events.ts): для лаборатории в Китае мощные карты дороже
 * и их меньше; клиенты за рубежом доверяют ещё меньше. Для других стран ничего не делает.
 */
export function countryExportControls(s: GameState, stage: 1 | 2): void {
  if (countryOf(s) !== 'cn') return;
  for (const id of CN_BANNED_GPUS) {
    addModifier(s, { id: `country-cn-ban${stage}-cap-${id}`, kind: 'rentCap', target: id, mult: stage === 1 ? CN_BAN_CAP_MULT : CN_BAN2_CAP_MULT, untilDay: FOREVER });
    if (stage === 1) addModifier(s, { id: `country-cn-ban-rent-${id}`, kind: 'rentPrice', target: id, mult: CN_BAN_RENT_MULT, untilDay: FOREVER });
  }
  addModifier(s, { id: `country-cn-ban${stage}-brand`, kind: 'labBrand', target: 'player', add: -0.1, untilDay: FOREVER });
  addMail(s, {
    kind: 'news',
    important: true,
    title: stage === 1 ? 'Запрет на чипы касается и вас' : 'Новый запрет: карт станет ещё меньше',
    body:
      stage === 1
        ? `«${s.labName}» работает в Китае. Карты A100 и новее теперь можно арендовать только через посредников: аренда дороже в ${String(CN_BAN_RENT_MULT).replace('.', ',')} раза, лимит аренды - в 4 раза меньше. Зарубежные клиенты доверяют меньше.`
        : `Лимит аренды карт A100 и новее для лаборатории в Китае сокращён ещё вдвое. Зарубежные клиенты доверяют ещё меньше.`,
  });
}

// ---------- Офис ----------

const OVERHEAD_MULT: Record<CountryId, number> = { us: 1.3, cn: 0.7, eu: 1 };
const VALUATION_MULT: Record<CountryId, number> = { us: 1.2, cn: 1, eu: 1 };

/** Множитель оценки компании инвесторами. */
export function countryValuationMult(s: GameState): number {
  const c = countryOf(s);
  return c ? VALUATION_MULT[c] : 1;
}

/** Множитель постоянных расходов и зарплат страны. */
export function countryCostMult(s: GameState): number {
  const c = countryOf(s);
  return c ? OVERHEAD_MULT[c] : 1;
}

// ---------- Старт ----------

const EU_START_REP = 5;
const EU_ENTERPRISE_BRAND = 0.1;
const EU_RESEARCH_MULT = 0.9;
const EU_RENT_MULT = 1.15;
const CN_START_BRAND = -0.15;

/** Постоянные особенности страны на старте партии (вызывает actions.newGame). */
export function applyCountryStart(s: GameState, country: CountryId): void {
  s.country = country;
  if (country === 'eu') {
    s.reputation = Math.min(100, s.reputation + EU_START_REP);
    addModifier(s, { id: 'country-eu-research', kind: 'researchCost', mult: EU_RESEARCH_MULT, untilDay: FOREVER });
    addModifier(s, { id: 'country-eu-enterprise', kind: 'segBrand', target: 'player:enterprise', add: EU_ENTERPRISE_BRAND, untilDay: FOREVER });
    addModifier(s, { id: 'country-eu-rent', kind: 'rentPrice', mult: EU_RENT_MULT, untilDay: FOREVER });
  }
  if (country === 'cn') {
    addModifier(s, { id: 'country-cn-brand', kind: 'labBrand', target: 'player', add: CN_START_BRAND, untilDay: FOREVER });
  }
}

// ---------- Чужие данные ----------

const THEFT: Record<CountryId | 'none', { expose: number; fine: number; rep: number; pull: boolean }> = {
  none: { expose: 1, fine: 1, rep: 1, pull: false },
  us: { expose: 1, fine: 1, rep: 1, pull: false },
  cn: { expose: 1 / 3, fine: 0.4, rep: 0.5, pull: false },
  eu: { expose: 2, fine: 1.5, rep: 1.25, pull: true },
};

function theftRules(s: GameState) {
  return THEFT[countryOf(s) ?? 'none'];
}

/** Шанс иска в месяц для одной модели на чужих данных, пока она в продаже. */
export function theftChance(s: GameState): number {
  return STOLEN_EXPOSE_MONTHLY * theftRules(s).expose;
}

/** Штраф по иску: база плюс доля выручки модели, с поправкой страны. */
export function theftFine(s: GameState, m: Pick<PlayerModel, 'earned'>): number {
  return (byYear(STOLEN_FINE_BASE, yearOf(s.day)) + STOLEN_FINE_EARNED * m.earned) * theftRules(s).fine;
}

/** Потеря репутации по иску (положительное число). */
export function theftRepLoss(s: GameState): number {
  return Math.round(Math.abs(STOLEN_REP) * theftRules(s).rep);
}

/** Во Франции (строгие суды ЕС) по иску модель снимают с продажи. */
export function theftPulls(s: GameState): boolean {
  return theftRules(s).pull;
}

function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

/** Конец месяца: иски по выпущенным моделям на чужих данных. Иск по модели бывает один раз. */
export function monthlyTheftSuits(s: GameState): void {
  for (const m of s.models) {
    if (!m.plan.stolenData || m.stolenCaught || m.releasedDay === null) continue;
    if (!chance(s, theftChance(s))) continue;
    m.stolenCaught = true;
    const fine = theftFine(s, m);
    const rep = theftRepLoss(s);
    spend(s, 'penalties', fine);
    s.reputation = Math.max(0, s.reputation - rep);
    const pulled = theftPulls(s);
    if (pulled) {
      m.onApi = false;
      m.onSubs = false;
    }
    addMail(s, {
      kind: 'news',
      important: true,
      title: `Иск за чужие данные: ${m.name}`,
      body:
        `Авторы книг и сайтов доказали, что «${m.name}» обучена на их текстах без разрешения. ` +
        `Суд назначил штраф ${fmtMoney(fine)}, репутация упала на ${rep}.` +
        (pulled ? ' По решению суда модель снята с продажи.' : ' Модель остаётся в продаже, новых исков по ней не будет.'),
    });
  }
}
