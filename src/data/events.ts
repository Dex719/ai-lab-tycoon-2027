// Исторические и механические события среза (FR-11). Заполняется в TSK-009.
// Эффекты — функции над состоянием; в сохранение попадают только id события и номер выбора.

import type { GameState, Mail } from '../sim/types';

export interface EventChoiceDef {
  label: string;
  hint: string; // коротко, что будет: «+15 репутации, −$200 тыс.»
  apply: (s: GameState) => void;
}

export interface EventDef {
  id: string;
  /** Дата срабатывания или условие (проверяется ежедневно, пока событие не сработало). */
  when: { date: string } | { check: (s: GameState) => boolean };
  /** Повторяемые события (срыв обучения) запускаются только явно через triggerEvent. */
  repeatable?: boolean;
  mail: (s: GameState) => { title: string; body: string; kind: Mail['kind'] };
  onFire?: (s: GameState) => void;
  choices?: EventChoiceDef[];
}

export const EVENTS: EventDef[] = [];
