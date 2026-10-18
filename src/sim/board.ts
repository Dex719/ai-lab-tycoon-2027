// Совет директоров с доверием (идея «Экономика поздней игры», 18.10). Когда у инвесторов большинство (доля основателя
// ниже половины), у совета появляется шкала доверия к основателю. Раз в месяц она меняется по итогам: место в гонке,
// выручка, деньги на счёте, репутация. Если доверие упало до порога, совет голосует об отставке, как в ноябре 2023
// года: пять дней основатель не управляет лабораторией (не начать обучение, не выпустить модель, не открыть раунд),
// потом команда добивается возвращения, и основатель выбирает условия. Отставка - один раз за партию, возвращение
// гарантировано. Совет есть только у партий из окна игры (план с TrainingPlan.checkpoint): боты баланса играют как раньше.

import { FOUNDER_BOARD_SHARE } from './constants';
import { addMail, triggerEvent } from './events';
import { formatDateShort } from './time';
import type { BoardState, GameState } from './types';

export const BOARD_START_TRUST = 60;
/** На этом доверии и ниже совет голосует об отставке. */
export const BOARD_OUST_TRUST = 20;
/** С этого доверия совет предупреждает. */
export const BOARD_WARN_TRUST = 35;
export const OUSTER_DAYS = 5;
export const BOARD_RETURN_EVENT = 'board-return';

/** Партия из окна игры: обучалась хоть одна модель с выбором сохранений (боты такой план не собирают). */
export function uiPlayer(s: GameState): boolean {
  return s.models.some((m) => m.plan.checkpoint !== undefined) || s.trainings.some((t) => t.plan.checkpoint !== undefined);
}

export function boardOusted(s: GameState): boolean {
  const b = s.board;
  // Пять дней ровно: отложенное письмо о возвращении не продлевает отставку.
  return b?.oustedDay !== undefined && b.returnedDay === undefined && s.day < b.oustedDay + OUSTER_DAYS;
}

/** Причина запрета, пока основатель отстранён, или null (проверки: обучение, выпуск, раунд). */
export function boardBlock(s: GameState): string | null {
  if (!boardOusted(s)) return null;
  return `Основатель отстранён советом до ${formatDateShort(s.board!.oustedDay! + OUSTER_DAYS)}`;
}

/** Изменения доверия за месяц с причинами (для окна «Инвесторы» и проверок). */
export function boardMonthDelta(s: GameState): { delta: number; reasons: string[] } {
  const h = s.finance.history.at(-1);
  const prev = s.finance.history.at(-2);
  const reasons: string[] = [];
  let delta = 0;
  const add = (v: number, why: string) => {
    delta += v;
    reasons.push(`${v > 0 ? '+' : '−'}${Math.abs(v)} ${why}`);
  };
  const place = h?.placeEnd ?? null;
  if (place === 1) add(5, 'первое место');
  else if (place !== null && place <= 3) add(2, 'в тройке лидеров');
  else if (place !== null && place >= 6) add(-4, `${place}-е место`);
  const rev = (r: typeof h) => (r ? r.income.api + r.income.subs + r.income.contracts : 0);
  if (h && prev && rev(prev) > 0) {
    const g = rev(h) / rev(prev) - 1;
    if (g >= 0.05) add(2, 'выручка растёт');
    else if (g <= -0.1) add(-3, 'выручка упала');
  }
  const spent = h ? Object.values(h.expense).reduce((a, b) => a + b, 0) : 0;
  if (spent > 0 && s.cash < spent) add(-5, 'денег меньше чем на месяц');
  const rep = s.board?.lastRep;
  if (rep !== undefined && s.reputation <= rep - 5) add(-4, 'репутация упала');
  return { delta, reasons };
}

/** Конец месяца: завести совет, когда большинство у инвесторов; обновить доверие; при пороге - голосование. */
export function boardMonth(s: GameState): void {
  if (!s.board) {
    if (s.founderShare >= FOUNDER_BOARD_SHARE || !uiPlayer(s)) return;
    s.board = { trust: BOARD_START_TRUST, since: s.day, lastRep: s.reputation, reasons: [] };
    addMail(s, {
      kind: 'news',
      title: 'У совета директоров появилось мнение о вас',
      body:
        `Большинство в совете теперь у инвесторов. Доверие совета к основателю - ${BOARD_START_TRUST} из 100, оно видно в окне «Инвесторы». ` +
        `Каждый месяц доверие растёт за место в гонке и рост выручки и падает за провалы, пустую кассу и скандалы. ` +
        `Если оно упадёт до ${BOARD_OUST_TRUST}, совет может проголосовать за вашу отставку.`,
    });
    return;
  }
  const b = s.board;
  if (boardOusted(s)) return;
  const { delta, reasons } = boardMonthDelta(s);
  const before = b.trust;
  b.trust = Math.max(0, Math.min(100, b.trust + delta));
  b.reasons = reasons;
  b.lastRep = s.reputation;
  if (b.trust <= BOARD_OUST_TRUST && b.oustedDay === undefined) {
    b.oustedDay = s.day;
    addMail(s, {
      kind: 'news',
      title: 'Совет директоров отправил основателя в отставку',
      body:
        `Совет проголосовал за отставку: доверие упало до ${b.trust} из 100. Пять дней лаборатория работает без основателя: ` +
        'обучение и продажи идут, но новое обучение, выпуск моделей и раунды недоступны. Сотрудники уже обсуждают письмо в вашу поддержку.',
    });
  } else if (b.trust <= BOARD_WARN_TRUST && before > BOARD_WARN_TRUST) {
    addMail(s, {
      kind: 'news',
      title: 'Совет директоров недоволен',
      body: `Доверие совета упало до ${b.trust} из 100. При ${BOARD_OUST_TRUST} совет может проголосовать за отставку основателя. Причины: ${reasons.join(', ') || 'итоги месяца'}.`,
    });
  }
}

/** Ежедневно: через пять дней после отставки - письмо о возвращении с выбором условий. */
export function boardDay(s: GameState): void {
  const b = s.board;
  if (!b || b.oustedDay === undefined || b.returnedDay !== undefined || b.returnOffered) return;
  if (s.day < b.oustedDay + OUSTER_DAYS) return;
  b.returnOffered = true;
  triggerEvent(s, BOARD_RETURN_EVENT);
}

/** Возвращение основателя: новое доверие; вызывает выбор письма data/boardEvents. */
export function boardReturn(s: GameState, trust: number): void {
  const b = s.board;
  if (!b) return;
  b.returnedDay = s.day;
  b.trust = trust;
  b.reasons = [];
  b.lastRep = s.reputation;
}

export type { BoardState };
