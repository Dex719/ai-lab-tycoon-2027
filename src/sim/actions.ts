// Действия игрока - единая точка входа для интерфейса и ботов.

import { BENCHMARKS } from '../data/benchmarks';
import { setAllocation, setRent } from './compute';
import { applyTender, cancelContract } from './contracts';
import { addMail, applyChoice, deferChoice, markRead } from './events';
import { raiseRound } from './investors';
import { releaseHypeBonus, updateSaturation } from './leaderboard';
import { minPrice } from './market';
import { setResearch } from './research';
import { createInitialState } from './state';
import { dateToDay, START_DAY } from './time';
import { cancelTraining, startTraining } from './training';
import type { GameState, Result } from './types';

export function newGame(labName: string, seed: number): GameState {
  const s = createInitialState(labName, seed);
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

/** Выпустить обученную модель на рынок API по цене за 1М токенов. */
export function releaseModel(s: GameState, modelId: string, price: number): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (m.releasedDay !== null) return { ok: false, error: 'Модель уже выпущена' };
  const bad = priceError(s, price);
  if (bad !== null) return { ok: false, error: bad };
  m.releasedDay = s.day;
  m.onApi = true;
  m.price = price;
  const bonus = releaseHypeBonus(s, { kind: 'player', id: m.id });
  s.hype.player = Math.min(100, s.hype.player + bonus);
  addMail(s, {
    kind: 'news',
    title: `Модель «${m.name}» выпущена`,
    body: `Модель доступна клиентам по API. Шумиха от выпуска: +${Math.round(bonus)}.`,
  });
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

/** Снять модель с продажи или вернуть её (только выпущенные). */
export function setOnApi(s: GameState, modelId: string, onApi: boolean): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (m.releasedDay === null) return { ok: false, error: 'Модель ещё не выпущена' };
  m.onApi = onApi;
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
  cancelContract,
  cancelTraining,
  applyChoice as chooseOption,
  deferChoice,
  raiseRound,
  setAllocation,
  setRent,
  setResearch,
  startTraining,
};
