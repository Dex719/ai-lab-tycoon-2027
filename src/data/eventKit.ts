// Общие помощники для новых событий (ранние заказы, история, случайные письма). Отдельный файл,
// чтобы data/events.ts не импортировался обратно (цикл модулей) и не разрастался.

import { earn, spend } from '../sim/finance';
import { nextRandom } from '../sim/rng';
import { dateToDay, yearOf } from '../sim/time';
import type { GameState, HypeOwner } from '../sim/types';

/**
 * Деньги для писем и подсказок: «$1,2 млн», «$350 тыс.», «$800». Округление как у fmtMoney в интерфейсе
 * (десятые только у сумм меньше $10 тыс., $100 млн, $100 млрд), чтобы цель и окна показывали одну и ту же сумму.
 */
export function usd(n: number): string {
  const dec = (x: number, d: number): string => String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ',');
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < 999.5) return `${sign}$${Math.round(a)}`;
  if (a < 999_500) return `${sign}$${dec(a / 1e3, a < 1e4 ? 1 : 0)} тыс.`;
  if (a < 999_500_000) return `${sign}$${dec(a / 1e6, a < 1e8 ? 1 : 0)} млн`;
  return `${sign}$${dec(a / 1e9, a < 1e11 ? 1 : 0)} млрд`;
}

/** Эло целым с разрядами, как в окнах (fmtElo): «987», «1 294». */
export function eloText(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Базовая сумма случайных писем по годам: растёт вместе с деньгами в игре, чтобы суммы не были смешными в 2024-м. */
const UNIT_BY_YEAR: Record<number, number> = {
  2017: 100_000,
  2018: 150_000,
  2019: 250_000,
  2020: 500_000,
  2021: 1_000_000,
  2022: 2_000_000,
  2023: 5_000_000,
  2024: 10_000_000,
};

/** Денежная единица года. */
export function unitForYear(year: number): number {
  return UNIT_BY_YEAR[Math.max(2017, Math.min(2024, year))];
}

export function unitForDay(day: number): number {
  return unitForYear(yearOf(day));
}

/** Единица, зафиксированная при отправке письма (подсказки и эффекты берут одно и то же число). */
export function unit(s: GameState): number {
  return s.yearly.eventUnit > 0 ? s.yearly.eventUnit : unitForDay(s.day);
}

/** Сумма в единицах, круглая до тысяч (или сотен долларов, если единица мала). */
function roundMoney(x: number): number {
  const step = x >= 20_000 ? 1_000 : 100;
  return Math.round(x / step) * step;
}

export function amount(s: GameState, k: number): number {
  return roundMoney(unit(s) * k);
}

/** То же для целей года: единица берётся по году цели. */
export function amountForYear(year: number, k: number): number {
  return roundMoney(unitForYear(year) * k);
}

/** Фиксируем единицу на день письма: вызывается из onFire. */
export function fixUnit(s: GameState): void {
  s.yearly.eventUnit = unitForDay(s.day);
}

const clamp100 = (x: number): number => Math.max(0, Math.min(100, x));

export function addHype(s: GameState, owner: HypeOwner, delta: number): void {
  s.hype[owner] = clamp100(s.hype[owner] + delta);
}

export function addRep(s: GameState, delta: number): void {
  s.reputation = clamp100(s.reputation + delta);
}

/** Потратить на письмо: уходит в «накладные». Касса может уйти в минус - как и от любых других расходов. */
export function pay(s: GameState, sum: number): void {
  spend(s, 'overhead', sum);
}

/** Получить деньги за заказ (учитывается как выручка контрактов). */
export function order(s: GameState, sum: number): void {
  earn(s, 'contracts', sum);
}

/** Получить грант или иное разовое поступление (не выручка: в «Итог без инвесторов» не входит). */
export function grant(s: GameState, sum: number): void {
  earn(s, 'investors', sum);
}

/** Броски, сделанные во время выбора в письме: по ним письмо узнаёт исход («повезло» или «не повезло»). */
let rollLog: { hit: boolean; good: boolean }[] | null = null;

/** Начать запись бросков (перед выбором в письме). */
export function startRollLog(): void {
  rollLog = [];
}

/** Закончить запись: null - бросков не было. lucky - все броски легли в пользу лаборатории. */
export function finishRollLog(): { lucky: boolean } | null {
  const log = rollLog;
  rollLog = null;
  if (!log || log.length === 0) return null;
  return { lucky: log.every((r) => r.hit === r.good) };
}

/**
 * Бросок в потоке случайных событий: основной поток игры (s.rng) не трогаем.
 * good - выпадение (true) хорошо для лаборатории: грант одобрен. false - выпадение плохо: утечку заметили.
 */
export function roll(s: GameState, p: number, good: boolean): boolean {
  const hit = nextRandom(s.yearly) < p;
  rollLog?.push({ hit, good });
  return hit;
}

export const pct = (p: number): string => `${Math.round(p * 100)} %`;

/** «+3 репутации», «-5 репутации». */
export function repText(delta: number): string {
  return `${delta > 0 ? '+' : '-'}${Math.abs(delta)} репутации`;
}

/** «+10 шумихи». */
export function hypeText(delta: number): string {
  return `${delta > 0 ? '+' : '-'}${Math.abs(delta)} шумихи`;
}

/** «+$300 тыс.» или «-$300 тыс.». */
export function sumText(delta: number): string {
  return `${delta >= 0 ? '+' : '-'}${usd(Math.abs(delta))}`;
}

/** Есть выпущенная модель игрока. */
export function hasReleased(s: GameState): boolean {
  return s.models.some((m) => m.releasedDay !== null);
}

/** Есть модель игрока в продаже (API или подписка). */
export function hasOnSale(s: GameState): boolean {
  return s.models.some((m) => m.releasedDay !== null && (m.onApi || m.onSubs));
}

/** Сколько видеокарт арендовано. */
export function rentedCount(s: GameState): number {
  return Object.values(s.compute.rented).reduce((a, b) => a + b, 0);
}

/** Письмо приходит в свою дату и не позже чем через 60 дней: сохранение, загруженное позже, не получит разом все старые письма. */
export function windowFrom(date: string): { check: (s: GameState) => boolean } {
  const from = dateToDay(date);
  return { check: (s) => s.day >= from && s.day < from + 60 };
}
