// Свой переводчик 2017-2020 (идея «Продукты», 18.10): до рынка API (середина 2020 года) первые месяцы партии пустые,
// а нейросетевые переводчики уже зарабатывали. После «Механизма внимания» и первой выпущенной модели игрок запускает
// сервис перевода: каждый день небольшая выручка, она растёт с Эло лучшей модели и падает после 2020 года, когда
// клиенты уходят на API. Мощности сервис не берёт: это игровое упрощение, суммы маленькие.

import { addMail } from './events';
import { earn } from './finance';
import { byYear, dateToDay, yearOf } from './time';
import type { GameState, Result } from './types';

/** Выручка в день при качестве 1, $ по годам. */
export const TRANSLATOR_PER_DAY: Record<number, number> = { 2017: 500, 2018: 1_100, 2019: 1_800, 2020: 2_000, 2021: 1_200, 2022: 700, 2023: 400, 2024: 300 };
/** Запустить можно до этого дня: потом переводы - одна из функций любой модели по API. */
export const TRANSLATOR_LAST_LAUNCH = '2021-01-01';

function bestElo(s: GameState): number {
  return s.models.reduce((b, m) => (m.releasedDay !== null ? Math.max(b, m.arenaElo) : b), 0);
}

/** Качество переводов: от Эло лучшей выпущенной модели, 0,3..1,5. */
export function translatorQuality(s: GameState): number {
  return Math.min(1.5, Math.max(0.3, (bestElo(s) - 450) / 300));
}

export function translatorPerDay(s: GameState): number {
  return Math.round(byYear(TRANSLATOR_PER_DAY, yearOf(s.day)) * translatorQuality(s));
}

/** Почему переводчик сейчас не запустить, или null. */
export function translatorBlock(s: GameState): string | null {
  if (s.translator) return 'Переводчик уже работает';
  if (s.day >= dateToDay(TRANSLATOR_LAST_LAUNCH)) return 'Переводы теперь продают по API: отдельный сервис не нужен';
  if (!s.research.done.includes('attention')) return 'Нужно исследование «Механизм внимания»';
  if (!s.models.some((m) => m.releasedDay !== null)) return 'Нужна выпущенная модель';
  return null;
}

/** Действие: запустить сервис перевода. */
export function launchTranslator(s: GameState): Result {
  const block = translatorBlock(s);
  if (block) return { ok: false, error: block };
  s.translator = { launchedDay: s.day, earned: 0 };
  addMail(s, {
    kind: 'news',
    read: true,
    title: 'Переводчик лаборатории открыт',
    body: `Сервис переводит тексты лучшей моделью лаборатории. Сейчас он приносит около $${String(translatorPerDay(s)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} в день; с более сильной моделью - больше.`,
  });
  return { ok: true };
}

/** Ежедневно: выручка переводчика. */
export function translatorDay(s: GameState): void {
  if (!s.translator || s.outcome) return;
  const v = translatorPerDay(s);
  earn(s, 'api', v, 'translator');
  s.translator.earned += v;
}
