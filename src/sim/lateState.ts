// Поздняя игра (2023-2024): сделки (звёздные команды, покупка стартапов, облачная сделка) и финальный квартал.
// Здесь только типы состояния и чистые помощники эффектов: модуль ничего не импортирует, кроме типов,
// поэтому его безопасно подключать из training.ts и research.ts (логика - в deals.ts и finale.ts).
//
// Поле GameState.late необязательное: в старых сохранениях его нет, оно появляется при первой сделке
// или в начале финального квартала (lateOf).

import { staffEffect } from './staffEffects';
import type { GameState, LabId } from './types';

// ---------- Сделки ----------

export type TeamId = 'training' | 'research' | 'posttrain';
export const TEAM_IDS: readonly TeamId[] = ['training', 'research', 'posttrain'];

export type StartupId = 'mozaic' | 'kodeium' | 'charakter' | 'inflexion' | 'adapt' | 'skale';
export const STARTUP_IDS: readonly StartupId[] = ['mozaic', 'kodeium', 'charakter', 'inflexion', 'adapt', 'skale'];

export type CloudId = 'azura' | 'awz' | 'orakle';
export const CLOUD_IDS: readonly CloudId[] = ['azura', 'awz', 'orakle'];

/** Нанятая звёздная команда. */
export interface StarTeam {
  id: TeamId;
  since: number; // день найма
}

/** Чем закончилось предложение стартапа: куплен игроком или ушёл к сопернику. */
export interface StartupDeal {
  id: StartupId;
  status: 'bought' | 'rival';
  day: number;
  lab?: LabId; // кто купил, если не игрок
}

/** Действующая облачная сделка: обязательный платёж за аренду в месяц, срок. */
export interface CloudDeal {
  id: CloudId;
  since: number;
  until: number; // последний день сделки
  monthly: number; // обязательный платёж за аренду в месяц, $
  shortfall: number; // сколько всего доплачено за недобор, $
}

// ---------- Финальный квартал ----------

/**
 * Финальный рывок соперника: объявлен заранее с целью по Эло, цель после объявления не меняется.
 * update - обновление уже вышедшей модели в день fireDay; release - модель каталога выходит раньше и сильнее
 * (поправка ставится в день объявления, выход - по обычному расписанию соперников).
 */
export interface FinalPush {
  lab: LabId;
  modelId: string;
  kind: 'update' | 'release';
  announceDay: number;
  fireDay: number;
  base: number; // Эло модели в день объявления
  target: number; // Эло после рывка
  playerElo: number; // лучшая модель игрока в продаже в день объявления
  fired: boolean;
}

/** Доработка модели игрока: идёт до endDay, потом модель получает gain Эло. */
export interface FinalUpdate {
  modelId: string;
  startDay: number;
  endDay: number;
  gain: number;
  cost: number;
}

/** Готовая доработка - для истории в окне «Финал». */
export interface FinalUpdateDone {
  modelId: string;
  day: number;
  gain: number;
}

export interface FinaleState {
  pushes: FinalPush[];
  /** Модели каталога, о выходе которых уже было объявление. */
  announced: string[];
  /** Сколько проверок финала прошло (дни FINALE_CHECKS). */
  checks: number;
  update: FinalUpdate | null;
  done: FinalUpdateDone[];
}

export interface LateState {
  teams: StarTeam[];
  startups: StartupDeal[];
  cloud: CloudDeal | null;
  /** Облачные сделки, которые уже закончились или расторгнуты (одна сделка с партнёром за игру). */
  cloudPast: CloudId[];
  finale: FinaleState;
}

export function emptyFinale(): FinaleState {
  return { pushes: [], announced: [], checks: 0, update: null, done: [] };
}

export function emptyLate(): LateState {
  return { teams: [], startups: [], cloud: null, cloudPast: [], finale: emptyFinale() };
}

/** Состояние поздней игры; создаётся при первом обращении (старые сохранения и партии до 2023 года его не имеют). */
export function lateOf(s: GameState): LateState {
  if (!s.late) s.late = emptyLate();
  return s.late;
}

// ---------- Эффекты для обучения и финала (без логики сделок) ----------

/** Прибавка скорости обучения: команда обучения +25 %, MozaicML +10 %. */
export const TEAM_TRAIN_SPEED = 0.25;
export const STARTUP_TRAIN_SPEED = 0.1;
/** Прибавка Эло новым моделям с RLHF: команда дообучения +8, Skale AI +5. */
export const TEAM_RLHF_ELO = 8;
export const STARTUP_RLHF_ELO = 5;
/** Доработка в финале сильнее с командой дообучения. */
export const TEAM_UPDATE_MULT = 1.5;

export function hasTeam(s: GameState, id: TeamId): boolean {
  return s.late?.teams.some((t) => t.id === id) ?? false;
}

export function ownsStartup(s: GameState, id: StartupId): boolean {
  return s.late?.startups.some((d) => d.id === id && d.status === 'bought') ?? false;
}

/** Множитель скорости обучения от сделок (1 - без сделок). */
export function trainSpeedMult(s: GameState): number {
  // + инженеры обучения в команде (staffEffects.ts).
  return 1 + (hasTeam(s, 'training') ? TEAM_TRAIN_SPEED : 0) + (ownsStartup(s, 'mozaic') ? STARTUP_TRAIN_SPEED : 0) + staffEffect(s, 'training');
}

/** Прибавка Эло модели, обученной сейчас (только с RLHF): команда дообучения и Skale AI. */
export function newModelEloBonus(s: GameState, rlhf: boolean): number {
  if (!rlhf) return 0;
  return (hasTeam(s, 'posttrain') ? TEAM_RLHF_ELO : 0) + (ownsStartup(s, 'skale') ? STARTUP_RLHF_ELO : 0);
}
