// Продукты лаборатории (идея «Продукты», 18.10): окно «Продукты» собирает свои сервисы - переводчик 2017-2020
// (sim/translator.ts) и ИИ-программист с июля 2021 года (помощник в редакторе кода по подписке для разработчиков).
// Запуск - событие с выбором: тихая бета (без риска, медленный рост), презентация (шумиха и быстрый старт, но
// серверы могут не выдержать) или лист ожидания (месяц ожидания, потом наплыв). Места растут к цели года, цель
// зависит от уровня лучшей модели по коду против лучшего соперника. Мощности продукт не берёт (игровое упрощение,
// «долю мощности на каждый продукт» не делаем); суммы заметные, но меньше API. Боты баланса продукты не запускают.

import { addMail } from './events';
import { earn, spend } from './finance';
import { codeLevel, rivalCodeFrontier } from './leaderboard';
import { byYear, dateToDay, formatDateShort, yearOf } from './time';
import type { CoderLaunch, GameState, Result } from './types';

/** С этого дня можно запустить ИИ-программиста (вышел первый тест кода, «HumanEvol»). */
export const CODER_OPEN = '2021-07-07';
/** Цена места в месяц, $. */
export const CODER_PRICE = 10;
/** Цель мест при качестве 1 по годам. */
export const CODER_MARKET: Record<number, number> = { 2021: 40_000, 2022: 150_000, 2023: 600_000, 2024: 1_500_000 };
/** Доля разрыва до цели, которую места проходят за день. */
const CODER_GROWTH = 0.03;

export const CODER_LAUNCH: Record<CoderLaunch, { name: string; text: string }> = {
  beta: { name: 'Тихая бета', text: 'Без шума и риска: первые 60 дней мест вдвое меньше цели' },
  show: { name: 'Презентация', text: 'Шумиха +8, быстрый старт; с шансом 1 к 4 серверы не выдержат' },
  waitlist: { name: 'Лист ожидания', text: 'Откроется через 30 дней; потом 90 дней мест на 20 % больше' },
};
export const CODER_LAUNCH_IDS: readonly CoderLaunch[] = ['beta', 'show', 'waitlist'];

const BETA_DAYS = 60;
const WAIT_DAYS = 30;
const WAIT_BOOST_DAYS = 90;
const SHOW_HYPE = 8;
const SHOW_CRASH_CHANCE = 0.25;
const CRASH_REP = 3;

/** Денежная единица года для цены презентации (как у писем, data/eventKit). */
const UNIT: Record<number, number> = { 2021: 1_000_000, 2022: 2_000_000, 2023: 5_000_000, 2024: 10_000_000 };

export function showCost(s: GameState): number {
  return Math.round(byYear(UNIT, yearOf(s.day)) * 0.3);
}

/** Лучший уровень по коду среди моделей в продаже; null - тестов кода ещё нет. */
function bestCode(s: GameState): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || !(m.onApi || m.onSubs)) continue;
    const v = codeLevel(s, { kind: 'player', id: m.id });
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

/** Качество помощника: 1 на уровне лучшего соперника, ±0,1 за единицу уровня по коду, 0,2..1,6. */
export function coderQuality(s: GameState): number {
  const own = bestCode(s);
  if (own === null) return 0.2;
  const rival = rivalCodeFrontier(s);
  if (rival === null) return 1;
  return Math.min(1.6, Math.max(0.2, 1 + (own - rival) / 10));
}

/** Цель мест сегодня: рынок года × качество × поправка способа запуска. */
export function coderTarget(s: GameState): number {
  const c = s.coder;
  let k = 1;
  if (c?.mode === 'beta' && s.day < c.openDay + BETA_DAYS) k = 0.5;
  if (c?.mode === 'waitlist' && s.day < c.openDay + WAIT_BOOST_DAYS) k = 1.2;
  return Math.round(byYear(CODER_MARKET, yearOf(s.day)) * coderQuality(s) * k);
}

export function coderPerDay(s: GameState): number {
  return Math.round(((s.coder?.seats ?? 0) * CODER_PRICE) / 30);
}

/** Окно «Продукты» открывается с первой выпущенной моделью. */
export function productsOpenedDay(s: GameState): number | null {
  let first: number | null = null;
  for (const m of s.models) if (m.releasedDay !== null && (first === null || m.releasedDay < first)) first = m.releasedDay;
  return first;
}

export function coderVisible(s: GameState): boolean {
  return s.day >= dateToDay(CODER_OPEN) || s.coder !== undefined;
}

function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

/** Почему ИИ-программиста сейчас не запустить, или null. */
export function coderBlock(s: GameState, mode: CoderLaunch): string | null {
  if (s.coder) return 'ИИ-программист уже запущен';
  if (s.day < dateToDay(CODER_OPEN)) return 'Рынка помощников для кода ещё нет';
  if (bestCode(s) === null) return 'Нужна модель в продаже';
  if (mode === 'show' && s.cash < showCost(s)) return `Не хватает денег: презентация стоит ${fmtMoney(showCost(s))}`;
  return null;
}

function crashRoll(s: GameState): number {
  const h = Math.imul((s.seed ^ 0x5bd1e995 ^ Math.imul(s.day, 0x27d4eb2f)) >>> 0, 0x85ebca77) >>> 0;
  return (h % 100_000) / 100_000;
}

/** Действие: запустить ИИ-программиста выбранным способом. */
export function launchCoder(s: GameState, mode: CoderLaunch): Result {
  const block = coderBlock(s, mode);
  if (block) return { ok: false, error: block };
  const openDay = mode === 'waitlist' ? s.day + WAIT_DAYS : s.day;
  s.coder = { launchedDay: s.day, openDay, mode, seats: 0, earned: 0 };
  if (mode === 'show') {
    spend(s, 'overhead', showCost(s));
    s.hype.player += SHOW_HYPE;
    const crashed = crashRoll(s) < SHOW_CRASH_CHANCE;
    s.coder.seats = Math.round(coderTarget(s) * (crashed ? 0.1 : 0.4));
    if (crashed) {
      s.coder.crashed = true;
      s.reputation = Math.max(0, s.reputation - CRASH_REP);
    }
    addMail(s, {
      kind: 'news',
      title: crashed ? 'Презентация ИИ-программиста: серверы не выдержали' : 'Презентация ИИ-программиста прошла хорошо',
      body: crashed
        ? `После презентации разработчики пришли разом, и сервис лежал полдня. О помощнике говорят (шумиха +${SHOW_HYPE}), но часть людей ушла: репутация −${CRASH_REP}, мест на старте меньше.`
        : `Помощник показали вживую, ролик разошёлся по сети: шумиха +${SHOW_HYPE}. Подписались ${s.coder.seats.toLocaleString('ru-RU')} разработчиков.`,
    });
  } else {
    addMail(s, {
      kind: 'news',
      read: true,
      title: mode === 'beta' ? 'ИИ-программист: тихая бета открыта' : `ИИ-программист: лист ожидания до ${formatDateShort(openDay)}`,
      body:
        mode === 'beta'
          ? 'Помощник открыли небольшой группе разработчиков. Первые 60 дней мест немного, потом сервис открыт всем.'
          : `Разработчики записываются в лист ожидания. Сервис откроется ${formatDateShort(openDay)}, первые 90 дней после открытия мест будет больше.`,
    });
  }
  return { ok: true };
}

/** Ежедневно: места идут к цели, выручка по подписке разработчиков. */
export function productsDay(s: GameState): void {
  const c = s.coder;
  if (!c && s.day === dateToDay(CODER_OPEN) && productsOpenedDay(s) !== null) {
    addMail(s, {
      kind: 'news',
      title: 'Разработчики ждут помощника для кода',
      body:
        'Вышел первый тест моделей на написание кода. Разработчики готовы платить за помощника прямо в редакторе. ' +
        'Лаборатория может запустить своего ИИ-программиста в окне «Продукты»: тихо, с презентацией или через лист ожидания.',
    });
  }
  if (!c || s.outcome) return;
  if (s.day < c.openDay) {
    s.hype.player += 0.1; // лист ожидания подогревает интерес
    return;
  }
  if (s.day === c.openDay && c.mode === 'waitlist') {
    c.seats = Math.round(coderTarget(s) * 0.4);
    addMail(s, {
      kind: 'news',
      title: 'ИИ-программист открыт для всех из листа ожидания',
      body: `Из листа ожидания пришли ${c.seats.toLocaleString('ru-RU')} разработчиков. Следующие 90 дней спрос выше обычного.`,
    });
  }
  c.seats = Math.max(0, Math.round(c.seats + (coderTarget(s) - c.seats) * CODER_GROWTH));
  const v = coderPerDay(s);
  earn(s, 'subs', v, 'coder');
  c.earned += v;
}
