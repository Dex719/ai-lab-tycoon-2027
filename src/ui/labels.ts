// Общие подписи интерфейса: статьи доходов и расходов, место в рейтинге.
// Одно название на статью везде - в подсказке денег на верхней панели, в «Финансах» и «Аналитике».

import type { ExpenseKind, IncomeKind } from '../sim/types';
import { fmtNum } from './format';

export const INCOME_LABELS: Record<IncomeKind, string> = {
  api: 'Продажа API',
  contracts: 'Контракты',
  investors: 'Инвесторы',
};

export const EXPENSE_LABELS: Record<ExpenseKind, string> = {
  rent: 'Аренда карт',
  overhead: 'Зарплаты и офис',
  labelers: 'Разметчики',
  penalties: 'Штрафы',
};

/** Порядок статей в таблицах и подсказках. */
export const INCOME_KINDS: IncomeKind[] = ['api', 'contracts', 'investors'];
export const EXPENSE_KINDS: ExpenseKind[] = ['rent', 'overhead', 'labelers', 'penalties'];

/** 3 → «3-е место», 12 → «12-е место». Для отсутствующего места - «-». */
export function fmtRank(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${fmtNum(n)}-е место`;
}
