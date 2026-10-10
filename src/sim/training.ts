// Проекты обучения, способности моделей игрока, Арена игрока, подгонка и разоблачение (FR-4, FR-6, FR-7). TSK-005.

import type { BenchmarkId, DomainId, GameState, PlayerModel, Result, TrainingPlan } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

export type Arch = 'lstm' | 'transformer';

export interface TrainingEstimate {
  flop: number;
  days: number | null; // null — доля «Обучение» = 0
  arch: Arch;
  labelers: number; // $ разметчикам при старте (RLHF)
  error: string | null; // текст ошибки validatePlan или null
  forecast: null | {
    caps: Record<DomainId, number>;
    scores: Partial<Record<BenchmarkId, number>>; // показанные (с подгонкой), по вышедшим бенчмаркам
    elo: number;
  }; // null, если не исследованы «Законы масштабирования»
  optimal: null | { paramsB: number; tokensB: number }; // подсказка по Шиншилле для того же FLOP (только со scaling)
}

/** 6 × N × D × (1 + RLHF_FLOP_EXTRA, если rlhf). */
export function planFlop(_plan: TrainingPlan): number { return TODO(); }
export function archFor(_s: GameState): Arch { return TODO(); }
export function chinchillaFactor(_paramsB: number, _tokensB: number): number { return TODO(); }
/** E = 6·N·D·(1 − b)·arch·algoMult·chin (без надбавки RLHF). */
export function effectiveCompute(_plan: TrainingPlan, _algoLevel: number, _arch: Arch): number { return TODO(); }
/** base = 10·(log10 E − 18). */
export function baseLevel(_effective: number): number { return TODO(); }
export function capsFromPlan(_plan: TrainingPlan, _algoLevel: number, _arch: Arch, _failPenalty?: number): Record<DomainId, number> { return TODO(); }
export function overfitFromPlan(_plan: TrainingPlan): Partial<Record<BenchmarkId, number>> { return TODO(); }
/** Elo = ELO_BASE + ELO_PER_CAP × capA + (rlhf ? ELO_RLHF_BASE + ELO_RLHF_PER_ALGO × algoLevel : 0). */
export function arenaElo(_caps: Record<DomainId, number>, _rlhf: boolean, _algoLevel: number): number { return TODO(); }
/** Балл модели игрока: honest — без подгонки; иначе с подгонкой, если модель не разоблачена. */
export function modelScore(_model: PlayerModel, _bid: BenchmarkId, _honest: boolean): number { return TODO(); }
export function labelersCost(_plan: TrainingPlan): number { return TODO(); }
/** Ошибка или null: размеры в границах, токены ≤ MAX_TOKENS_B(год), микс ≈ 1, b в [0, 0.5], ≤ 3 цели (только вышедшие бенчмарки), rlhf только после исследования, нет идущего проекта, хватает денег на разметчиков. */
export function validatePlan(_s: GameState, _plan: TrainingPlan): string | null { return TODO(); }
export function estimate(_s: GameState, _plan: TrainingPlan): TrainingEstimate { return TODO(); }
/** Действие: начать проект (списать разметчиков, бросить шанс срыва). */
export function startTraining(_s: GameState, _plan: TrainingPlan): Result { return TODO(); }
export function cancelTraining(_s: GameState): Result { return TODO(); }
/** Выбор в событии «срыв обучения» (вызывается из data/events.ts). */
export function applyFailChoice(_s: GameState, _choice: 'rollback' | 'continue'): void { TODO(); }
/** Ежедневно: прогресс; срыв (triggerEvent 'training-fail'); завершение → PlayerModel в s.models, bestFlop, письмо. */
export function progressDay(_s: GameState): void { TODO(); }
/** Раз в месяц: шанс разоблачения выпущенных подогнанных моделей. */
export function monthlyExposure(_s: GameState): void { TODO(); }
