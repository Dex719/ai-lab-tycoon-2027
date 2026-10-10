// Тендеры на дообучение и RLHF (FR-9). TSK-008.

import type { GameState, PlayerModel, Result, Tender } from './types';

const TODO = (): never => {
  throw new Error('not implemented');
};

/** Раз в месяц: TENDERS_PER_MONTH(год) + randInt(0, 1) новых тендеров по правилам design.md («Тендеры»). */
export function generateMonthly(_s: GameState): void { TODO(); }
/** Причина, по которой модель не может подать заявку, или null. */
export function canApply(_s: GameState, _tender: Tender, _model: PlayerModel): string | null { return TODO(); }
/** Шанс победы по формуле design.md. */
export function applyChance(_s: GameState, _tender: Tender, _model: PlayerModel): number { return TODO(); }
/** Действие: подать заявку выпущенной моделью. */
export function applyTender(_s: GameState, _tenderId: string, _modelId: string): Result { return TODO(); }
/** Действие: отказаться от контракта (штраф, репутация REP_CONTRACT_FAIL). */
export function cancelContract(_s: GameState, _contractId: string): Result { return TODO(); }
/**
 * Ежедневно: убрать просроченные тендеры без заявки; решить заявки (победа → контракт, для RLHF — разметчики;
 * поражение → письмо); работа контрактов за счёт pool(contracts) поровну; завершение → проверка честного балла,
 * оплата или штраф; просрочка → штраф.
 */
export function progressDay(_s: GameState): void { TODO(); }
