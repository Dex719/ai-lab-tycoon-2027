// Раунды инвестиций (FR-10). TSK-008.

import {
  BOARD_BUYBACK_PREMIUM,
  BOARD_BUYBACK_SHARE,
  BOARD_PLAN_VALUATION_MULT,
  EMERGENCY_ROUND_DAYS,
  EMERGENCY_VALUATION_MULT,
  FOUNDER_WARN_SHARE,
  MANIA,
  REV_MULT,
  ROUND_COOLDOWN_DAYS,
  ROUND_FRACTIONS,
  VALUATION_FLOOR,
} from './constants';
import { countryValuationMult } from './country';
import { addMail } from './events';
import { endSentence } from './text';
import { earn, revenueLast90, spend } from './finance';
import { arenaStanding, marketArenaRank, rivalsSellByApi } from './leaderboard';
import { byYear, formatDateShort, lerpByDate, yearOf } from './time';
import type { GameState, PendingRound, Result } from './types';

export interface Valuation {
  total: number;
  annualRevenue: number;
  revenuePart: number; // annualRevenue × revMult
  techPart: number; // rankFactor × mania
  rankFactor: number;
  bestRank: number | null; // место лучшей модели игрока на Арене среди моделей, доступных по API
  hypeMult: number;
  repMult: number;
  /** Множитель плана совета директоров (BOARD_PLAN_VALUATION_MULT до следующего раунда), иначе 1. */
  boardMult: number;
  /** Экстренный раунд (деньги в минусе, перерыв не прошёл): EMERGENCY_VALUATION_MULT, иначе 1. */
  emergencyMult: number;
  /** Страна (sim/country.ts): в США инвесторы оценивают дороже. */
  countryMult: number;
}

/**
 * Деньги в минусе, а годовой перерыв между раундами не прошёл: можно провести экстренный раунд со скидкой.
 * Один раз подряд: после экстренного раунда следующий - только обычный, через перерыв. Иначе экстренные раунды
 * брали каждые две недели, уходя в минус покупками, и годовой перерыв ничего не значил.
 */
export function emergencyRound(s: GameState): boolean {
  return (
    s.cash < 0 && s.lastRoundDay !== null && s.day < s.lastRoundDay + ROUND_COOLDOWN_DAYS && !s.flags[EMERGENCY_USED_FLAG]
  );
}

/** Флаг состояния: последний закрытый раунд был экстренным - второго экстренного подряд не будет. */
export const EMERGENCY_USED_FLAG = 'emergencyRoundUsed';
/** Флаг состояния: принят план совета директоров, следующий раунд пройдёт по сниженной оценке. */
export const BOARD_PLAN_FLAG = 'boardPlan';
/** Флаг состояния: письмо о доле основателя ниже FOUNDER_WARN_SHARE уже отправлено. */
export const FOUNDER_WARNED_FLAG = 'founderWarned';

/** «$1,2 млн», «$350 тыс.», «$800». */
function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  // Пороги чуть ниже круглых чисел, чтобы после округления не вышло «$1000 тыс.».
  if (x >= 999_950_000) return `$${one(x / 1e9)} млрд`;
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

/** Множитель технологий по месту на Арене: 1 → 1, 2-3 → 0,5, 4-10 → 0,2, ниже → 0,05; моделей на рынке нет → 0. */
function rankFactorFor(rank: number | null): number {
  if (rank === null) return 0;
  if (rank <= 1) return 1;
  if (rank <= 3) return 0.5;
  if (rank <= 10) return 0.2;
  return 0.05;
}

/**
 * Лучшее место среди выпущенных моделей игрока, которые продаются по API. Пока соперники по API не продают, место
 * на рынке всегда 1-е и ничего не значит: тогда берётся место в гонке по главному тесту (SQuAT, затем GLUU), как
 * на верхней панели. Раньше любая слабая модель на API получала полную технологическую часть оценки.
 */
function bestMarketRank(s: GameState): number | null {
  if (!s.models.some((m) => m.releasedDay !== null && m.onApi)) return null;
  if (!rivalsSellByApi(s)) return arenaStanding(s)?.rank ?? null;
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onApi) continue;
    const r = marketArenaRank(s, { kind: 'player', id: m.id });
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

export function valuation(s: GameState): Valuation {
  const annualRevenue = (revenueLast90(s) * 365) / 90;
  const bestRank = bestMarketRank(s);
  const rankFactor = rankFactorFor(bestRank);
  const revenuePart = annualRevenue * byYear(REV_MULT, yearOf(s.day));
  const techPart = rankFactor * lerpByDate(MANIA, s.day, true);
  const hypeMult = 1 + s.hype.player / 100;
  const repMult = 0.6 + s.reputation / 125;
  const boardMult = s.flags[BOARD_PLAN_FLAG] ? BOARD_PLAN_VALUATION_MULT : 1;
  const emergencyMult = emergencyRound(s) ? EMERGENCY_VALUATION_MULT : 1;
  const countryMult = countryValuationMult(s);
  const total = Math.max(VALUATION_FLOOR, revenuePart + techPart) * hypeMult * repMult * boardMult * emergencyMult * countryMult;
  return { total, annualRevenue, revenuePart, techPart, rankFactor, bestRank, hypeMult, repMult, boardMult, emergencyMult, countryMult };
}

/** Цена выкупа BOARD_BUYBACK_SHARE компании: доля × оценка × надбавка инвесторам. */
export function buybackCost(s: GameState): number {
  return valuation(s).total * BOARD_BUYBACK_SHARE * BOARD_BUYBACK_PREMIUM;
}

/**
 * Выкупить BOARD_BUYBACK_SHARE компании у инвесторов по buybackCost (деньги могут уйти в минус: это решение
 * игрока в событии 'board-control'). Доля основателя не выше 1.
 */
export function buyBackShares(s: GameState): void {
  const cost = buybackCost(s);
  spend(s, 'overhead', cost);
  s.founderShare = Math.min(1, s.founderShare + BOARD_BUYBACK_SHARE);
  addMail(s, {
    kind: 'finance',
    title: `Выкуплено ${Math.round(BOARD_BUYBACK_SHARE * 100)} % компании`,
    body: `Доля выкуплена у инвесторов за ${endSentence(fmtMoney(cost))} Доля основателя - ${fmtShare(s.founderShare)} %.`,
  });
}

// ---------- Выкуп доли из окна «Инвесторы» ----------

/** Шаг выкупа: 5 % компании раз в BUYBACK_GAP_DAYS дней по оценке × BOARD_BUYBACK_PREMIUM. */
export const BUYBACK_STEP = 0.05;
export const BUYBACK_GAP_DAYS = 90;

/** Сколько компании выкупается сейчас: шаг, но не больше доли инвесторов. */
export function buybackStep(s: GameState): number {
  return Math.min(BUYBACK_STEP, Math.max(0, 1 - s.founderShare));
}

export function buybackStepCost(s: GameState): number {
  return valuation(s).total * buybackStep(s) * BOARD_BUYBACK_PREMIUM;
}

/** Почему выкуп сейчас невозможен, или null. */
export function buybackError(s: GameState): string | null {
  if (s.outcome) return 'Партия окончена';
  if (buybackStep(s) < 0.001) return 'Вся компания уже ваша';
  const r = pendingRound(s);
  if (r) return `Идут переговоры о раунде до ${formatDateShort(r.closeDay)}`;
  if (s.lastBuybackDay !== undefined && s.day - s.lastBuybackDay < BUYBACK_GAP_DAYS) {
    return `Следующий выкуп - ${formatDateShort(s.lastBuybackDay + BUYBACK_GAP_DAYS)}`;
  }
  const cost = buybackStepCost(s);
  if (s.cash < cost) return `Не хватает денег: нужно ${fmtMoney(cost)}, на счету ${endSentence(fmtMoney(s.cash))}`;
  return null;
}

/**
 * Действие: выкупить buybackStep компании у инвесторов по buybackStepCost. Лишние деньги поздней игры становятся долей
 * основателя (плейтест 18.10: к 2024 году у сильного игрока $100-400 млн лежали без дела, а доля падала до 8 %).
 */
export function buyBackStake(s: GameState): Result {
  const error = buybackError(s);
  if (error) return { ok: false, error };
  const step = buybackStep(s);
  const cost = buybackStepCost(s);
  spend(s, 'capex', cost);
  s.founderShare = Math.min(1, s.founderShare + step);
  s.lastBuybackDay = s.day;
  addMail(s, {
    kind: 'finance',
    read: true,
    title: `Выкуплено ${Math.round(step * 100)} % компании`,
    body: `Доля выкуплена у инвесторов за ${endSentence(fmtMoney(cost))} Доля основателя - ${fmtShare(s.founderShare)} %.`,
  });
  return { ok: true };
}

/** «50,4» из 0,504: доля основателя с десятыми. */
function fmtShare(share: number): string {
  return String(Math.round(share * 1000) / 10).replace('.', ',');
}

/** Один раз, когда доля основателя опустилась ниже FOUNDER_WARN_SHARE: важное письмо. */
function warnFounderShare(s: GameState): void {
  if (s.founderShare >= FOUNDER_WARN_SHARE || s.flags[FOUNDER_WARNED_FLAG]) return;
  s.flags[FOUNDER_WARNED_FLAG] = true;
  addMail(s, {
    kind: 'finance',
    important: true,
    title: `Доля основателя ниже ${Math.round(FOUNDER_WARN_SHARE * 100)} %`,
    body:
      `У основателя осталось ${fmtShare(s.founderShare)} % компании. ` +
      'Контроль над лабораторией у инвесторов, и каждый новый раунд оставляет основателю всё меньше. ' +
      'Деньги надёжнее брать с рынка: выручка API и контракты долю не размывают.',
  });
}

/**
 * Сколько дней идут переговоры: 10 % - месяц, 20 % - полтора, 30 % - два (чем больше доля, тем дольше проверка компании).
 * Экстренный раунд (деньги в минусе) - две недели: иначе он не успевал бы до банкротства (BANKRUPT_DAYS).
 */
export { EMERGENCY_ROUND_DAYS };
export const ROUND_DAYS: Record<number, number> = { 0.1: 30, 0.2: 45, 0.3: 60 };
/** Прервать переговоры: рынок узнаёт о сорванной сделке, шумиха падает. Без этого можно было бы «бронировать» оценку и отменять. */
export const ROUND_CANCEL_HYPE = 3;

export function roundDays(s: GameState, fraction: number): number {
  return emergencyRound(s) ? EMERGENCY_ROUND_DAYS : (ROUND_DAYS[fraction] ?? 45);
}

/** Раунд на переговорах (или null). */
export function pendingRound(s: GameState): PendingRound | null {
  return s.round ?? null;
}

/** Причина, почему раунд недоступен (переговоры уже идут, кулдаун - «через N дней»), или null. */
export function canRaise(s: GameState): string | null {
  const r = pendingRound(s);
  if (r) return `Идут переговоры до ${formatDateShort(r.closeDay)}`;
  if (s.lastRoundDay === null || emergencyRound(s)) return null;
  const left = s.lastRoundDay + ROUND_COOLDOWN_DAYS - s.day;
  if (left > 0) return `Следующий раунд - через ${left} дн.`;
  return null;
}

/**
 * Действие: начать переговоры о продаже доли fraction ∈ ROUND_FRACTIONS. Оценка и сумма фиксируются сегодня,
 * деньги earn('investors') и доля ×(1 − f) - в день закрытия (investorsDay), с письмом.
 */
export function raiseRound(s: GameState, fraction: number): Result {
  // Допуск на ошибку дробей: 0,1 + 0,2 - это почти 0,3. Дальше считаем по точному значению из списка.
  const f = ROUND_FRACTIONS.find((x) => Math.abs(x - fraction) < 1e-9);
  if (f === undefined) {
    const pct = ROUND_FRACTIONS.map((x) => Math.round(x * 100));
    const last = pct[pct.length - 1];
    return { ok: false, error: `Можно продать ${pct.slice(0, -1).join(', ')} или ${last} % компании` };
  }
  const reason = canRaise(s);
  if (reason !== null) return { ok: false, error: reason };
  const emergency = emergencyRound(s);
  const value = valuation(s).total;
  s.round = { fraction: f, valuation: value, money: value * f, startDay: s.day, closeDay: s.day + roundDays(s, f), emergency };
  return { ok: true };
}

/** Действие: прервать переговоры. Денег и размытия нет, шумиха −ROUND_CANCEL_HYPE; новый раунд можно начать сразу. */
export function cancelRound(s: GameState): Result {
  if (!pendingRound(s)) return { ok: false, error: 'Переговоров нет' };
  s.round = null;
  s.hype.player = Math.max(0, s.hype.player - ROUND_CANCEL_HYPE);
  return { ok: true };
}

/** Закрыть раунд: деньги, размытие доли, письмо. */
function closeRound(s: GameState, r: PendingRound): void {
  s.round = null;
  earn(s, 'investors', r.money);
  s.founderShare *= 1 - r.fraction;
  s.lastRoundDay = s.day;
  if (r.emergency) s.flags[EMERGENCY_USED_FLAG] = true;
  else delete s.flags[EMERGENCY_USED_FLAG];
  // План совета директоров действует на один раунд: скидка к оценке снята.
  if (s.flags[BOARD_PLAN_FLAG]) delete s.flags[BOARD_PLAN_FLAG];
  addMail(s, {
    kind: 'finance',
    title: `${r.emergency ? 'Экстренный раунд закрыт' : 'Раунд инвестиций закрыт'}: ${fmtMoney(r.money)}`,
    reward: true,
    body:
      `При оценке лаборатории в ${fmtMoney(r.valuation)} инвесторы вложили ${fmtMoney(r.money)} ` +
      `за ${Math.round(r.fraction * 100)} % компании. Доля основателя - ${fmtShare(s.founderShare)} %. ` +
      `Следующий раунд возможен через ${ROUND_COOLDOWN_DAYS} дн.`,
  });
  warnFounderShare(s);
}

/** День: переговоры, дошедшие до срока, закрываются. */
export function investorsDay(s: GameState): void {
  const r = pendingRound(s);
  if (r && s.day >= r.closeDay) closeRound(s, r);
}

/** Начать и сразу закрыть раунд (без переговоров): для тестов и сценариев, где нужны деньги раунда сегодня. */
export function raiseRoundNow(s: GameState, fraction: number): Result {
  const res = raiseRound(s, fraction);
  if (!res.ok) return res;
  closeRound(s, s.round!);
  return res;
}
