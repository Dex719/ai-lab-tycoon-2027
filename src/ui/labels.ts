// Общие подписи интерфейса: статьи доходов и расходов, место в рейтинге.
// Одно название на статью везде - в подсказке денег на верхней панели, в «Финансах» и «Аналитике».

import { formatDateShort } from '../sim/time';
import type { ExpenseKind, IncomeKind, PlayerModel } from '../sim/types';
import { fmtNum } from './format';

export const INCOME_LABELS: Record<IncomeKind, string> = {
  api: 'Продажа API',
  subs: 'Подписки',
  contracts: 'Контракты',
  investors: 'Инвесторы',
};

export const EXPENSE_LABELS: Record<ExpenseKind, string> = {
  rent: 'Аренда карт',
  overhead: 'Зарплаты и офис',
  labelers: 'Разметчики',
  penalties: 'Штрафы',
  review: 'Проверки',
};

/** Порядок статей в таблицах и подсказках. */
export const INCOME_KINDS: IncomeKind[] = ['api', 'subs', 'contracts', 'investors'];
export const EXPENSE_KINDS: ExpenseKind[] = ['rent', 'overhead', 'labelers', 'penalties', 'review'];

/** 3 → «3-е место», 12 → «12-е место». Для отсутствующего места - «-». */
export function fmtRank(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${fmtNum(n)}-е место`;
}

/** Каналы продажи модели: «API», «Подписка», «API, подписка»; null - модель снята с продажи. Подписка считается, только если канал открыт. */
export function modelChannels(m: PlayerModel, subsAvailable: boolean): string | null {
  const parts: string[] = [];
  if (m.onApi) parts.push('API');
  if (m.onSubs && subsAvailable) parts.push(parts.length > 0 ? 'подписка' : 'Подписка');
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Пометка внешней проверки: «Нужна проверка», «Проверка до ДД.ММ.ГГГГ»; у моделей без проверки и с пройденной - null. */
export function reviewNote(m: PlayerModel): { text: string; tone: 'warn' | 'info' } | null {
  if (m.review === 'required') return { text: 'Нужна проверка', tone: 'warn' };
  if (m.review === 'pending') {
    return { text: m.reviewEndDay !== null ? `Проверка до ${formatDateShort(m.reviewEndDay)}` : 'Идёт проверка', tone: 'info' };
  }
  return null;
}
