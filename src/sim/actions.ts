// Действия игрока - единая точка входа для интерфейса и ботов.

import { BENCHMARKS } from '../data/benchmarks';
import { setAllocation, setRent } from './compute';
import { SUBS_PRICE_MAX, SUBS_PRICE_MIN, TIER_SUBS_PRICE } from './constants';
import { applyTender, cancelContract, setAutoApply } from './contracts';
import { buildDatacenter, buyDcGpus, writeOffDcGpus } from './datacenters';
import { addMail, applyChoice, deferChoice, markRead } from './events';
import { raiseRound } from './investors';
import { releaseHypeBonus, updateSaturation } from './leaderboard';
import { minPrice, subsOpen } from './market';
import { setResearch } from './research';
import { applyDifficultyModifiers } from './rivalry';
import type { Difficulty } from './rivalry';
import { createInitialState } from './state';
import { dateToDay, START_DAY } from './time';
import { cancelTraining, reviewReason, reviewTerms, startReview, startTraining } from './training';
import type { GameState, Result } from './types';

/** Новая игра: сложность из главного меню ставит модификаторы аренды и разоблачения навсегда (только Лёгкая и Сложная). */
export function newGame(labName: string, seed: number, difficulty: Difficulty = 'normal'): GameState {
  const s = createInitialState(labName, seed, difficulty);
  applyDifficultyModifiers(s);
  for (const b of BENCHMARKS) if (dateToDay(b.introduced) < START_DAY) s.benchmarks[b.id].introduced = true;
  addMail(s, {
    kind: 'news',
    title: `Лаборатория «${s.labName}» основана`,
    body:
      'Капитал: $3 млн. Цель: к концу 2024 года занять 1-е место на «Арене». ' +
      'Сначала арендуйте видеокарты в окне «Мощности». ' +
      'Конкуренты опубликуют механизм внимания в июне 2017 года. Лаборатория может изучить его раньше в окне «Исследования». ' +
      'Первый доход дают тендеры в окне «Контракты». Заявку подают выпущенной моделью.',
  });
  return s;
}

function findModel(s: GameState, modelId: string) {
  return s.models.find((m) => m.id === modelId);
}

const MAX_PRICE = 10_000; // $ за 1 млн токенов

/** «$1», «$0,6», «$0,025», «$10 000». */
function fmtPrice(x: number): string {
  if (x >= 1000) return `$${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
  return `$${String(Number(x.toFixed(3))).replace('.', ',')}`;
}

/** Причина, по которой цена не годится, или null. Нижняя граница - minPrice(day): опорная цена / 100. */
function priceError(s: GameState, price: number): string | null {
  if (!Number.isFinite(price)) return 'Цена не указана';
  const min = minPrice(s.day);
  if (price < min) return `Цена не может быть ниже ${fmtPrice(min)} за 1 млн токенов.`;
  if (price > MAX_PRICE) return `Цена не может быть выше ${fmtPrice(MAX_PRICE)} за 1 млн токенов.`;
  return null;
}

/** Цена подписки в границах SUBS_PRICE_MIN…SUBS_PRICE_MAX, округлённая до центов; иначе текст ошибки. */
function subsPriceOrError(price: number): { price: number } | { error: string } {
  if (!Number.isFinite(price)) return { error: 'Цена подписки не указана' };
  if (price < SUBS_PRICE_MIN || price > SUBS_PRICE_MAX) {
    return { error: `Цена подписки - от ${fmtPrice(SUBS_PRICE_MIN)} до ${fmtPrice(SUBS_PRICE_MAX)} в месяц.` };
  }
  return { price: Math.round(price * 100) / 100 };
}

export interface ReleaseOptions {
  onSubs?: boolean; // включить подписку сразу (только после чат-момента и без внешней проверки)
  subsPrice?: number; // $ в месяц; по умолчанию - цена уровня модели
}

/**
 * Выпустить обученную модель на рынок: API по цене за 1 млн токенов, подписка - по желанию (opts.onSubs), если канал открыт
 * и модели не нужна внешняя проверка. Нужна ли проверка, решается здесь один раз (передний край только растёт).
 */
export function releaseModel(s: GameState, modelId: string, price: number, opts: ReleaseOptions = {}): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (m.releasedDay !== null) return { ok: false, error: 'Модель уже выпущена' };
  const bad = priceError(s, price);
  if (bad !== null) return { ok: false, error: bad };
  const subs = subsPriceOrError(opts.subsPrice ?? TIER_SUBS_PRICE[m.plan.tier] ?? TIER_SUBS_PRICE.mid);
  if ('error' in subs) return { ok: false, error: subs.error };
  m.releasedDay = s.day;
  m.onApi = true;
  m.price = price;
  m.subsPrice = subs.price;
  const reason = reviewReason(s, m);
  m.review = reason === null ? 'none' : 'required';
  m.reviewEndDay = null;
  m.onSubs = !!opts.onSubs && subsOpen(s.day) && m.review === 'none';
  const bonus = releaseHypeBonus(s, { kind: 'player', id: m.id });
  s.hype.player = Math.min(100, s.hype.player + bonus);
  addMail(s, {
    kind: 'news',
    title: `Модель «${m.name}» выпущена`,
    body: `Модель доступна клиентам по API${m.onSubs ? ' и по подписке' : ''}. Шумиха от выпуска: +${Math.round(bonus)}.`,
  });
  if (reason !== null) {
    addMail(s, {
      kind: 'training',
      title: `Нужна внешняя проверка: «${m.name}»`,
      body:
        `Модель заметно сильнее переднего края (${reason}). ` +
        'До проверки её можно продавать только по API корпоративным клиентам и разработчикам. ' +
        `${reviewTerms(s, m)}; начать её можно в окне «Модели».`,
    });
  }
  updateSaturation(s);
  return { ok: true };
}

export function setModelPrice(s: GameState, modelId: string, price: number): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  const bad = priceError(s, price);
  if (bad !== null) return { ok: false, error: bad };
  m.price = price;
  return { ok: true };
}

/** Снять модель с продажи по API или вернуть её (только выпущенные). */
export function setOnApi(s: GameState, modelId: string, onApi: boolean): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (m.releasedDay === null) return { ok: false, error: 'Модель ещё не выпущена' };
  m.onApi = onApi;
  return { ok: true };
}

/** Включить или выключить подписку (чат): только выпущенные модели, после чат-момента, без незавершённой внешней проверки. */
export function setOnSubs(s: GameState, modelId: string, onSubs: boolean): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (m.releasedDay === null) return { ok: false, error: 'Модель ещё не выпущена' };
  if (onSubs) {
    if (!subsOpen(s.day)) return { ok: false, error: 'Подписки появятся позже.' };
    if (m.review === 'required' || m.review === 'pending') return { ok: false, error: 'Сначала пройдите внешнюю проверку.' };
  }
  m.onSubs = onSubs;
  return { ok: true };
}

/** Цена подписки, $ в месяц: от SUBS_PRICE_MIN до SUBS_PRICE_MAX, до центов. */
export function setSubsPrice(s: GameState, modelId: string, price: number): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  const subs = subsPriceOrError(price);
  if ('error' in subs) return { ok: false, error: subs.error };
  m.subsPrice = subs.price;
  return { ok: true };
}

export function renameModel(s: GameState, modelId: string, name: string): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (!name.trim()) return { ok: false, error: 'Название не указано' };
  m.name = name.trim().slice(0, 40);
  return { ok: true };
}

export function markMailRead(s: GameState, mailId: string): Result {
  markRead(s, mailId);
  return { ok: true };
}

export function markAllRead(s: GameState): Result {
  for (const m of s.mail) if (!m.choices || m.chosen !== undefined) m.read = true;
  return { ok: true };
}

export {
  applyTender,
  buildDatacenter,
  buyDcGpus,
  cancelContract,
  cancelTraining,
  applyChoice as chooseOption,
  deferChoice,
  raiseRound,
  setAllocation,
  setAutoApply,
  setRent,
  setResearch,
  startReview,
  startTraining,
  writeOffDcGpus,
};
