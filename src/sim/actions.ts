// Действия игрока — единая точка входа для интерфейса и ботов.

import { BENCHMARKS } from '../data/benchmarks';
import { setAllocation, setRent } from './compute';
import { applyTender, cancelContract } from './contracts';
import { addMail, applyChoice, markRead } from './events';
import { raiseRound } from './investors';
import { releaseHypeBonus, updateSaturation } from './leaderboard';
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
      'Капитал — $3 млн. Цель — к концу 2024 года занять 1-е место на «Арене». ' +
      'Сначала нужно арендовать GPU в окне «Мощности» и выделить часть мощности на эксперименты. ' +
      'Конкуренты опубликуют механизм внимания в июне 2017 года; лаборатория может изучить его раньше в окне «Исследования». ' +
      'Первый доход дают тендеры в окне «Контракты», когда есть своя модель.',
  });
  return s;
}

function findModel(s: GameState, modelId: string) {
  return s.models.find((m) => m.id === modelId);
}

function validPrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && price <= 10_000;
}

/** Выпустить обученную модель на рынок API по цене за 1М токенов. */
export function releaseModel(s: GameState, modelId: string, price: number): Result {
  const m = findModel(s, modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  if (m.releasedDay !== null) return { ok: false, error: 'Модель уже выпущена' };
  if (!validPrice(price)) return { ok: false, error: 'Цена должна быть больше нуля' };
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
  if (!validPrice(price)) return { ok: false, error: 'Цена должна быть больше нуля' };
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
  raiseRound,
  setAllocation,
  setRent,
  setResearch,
  startTraining,
};
