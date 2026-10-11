// Раунды инвестиций (FR-10). TSK-008.

import { MANIA, REV_MULT, ROUND_COOLDOWN_DAYS, ROUND_FRACTIONS, VALUATION_FLOOR } from './constants';
import { addMail } from './events';
import { earn, revenueLast90 } from './finance';
import { marketArenaRank } from './leaderboard';
import { byYear, lerpByDate, yearOf } from './time';
import type { GameState, Result } from './types';

export interface Valuation {
  total: number;
  annualRevenue: number;
  revenuePart: number; // annualRevenue × revMult
  techPart: number; // rankFactor × mania
  rankFactor: number;
  bestRank: number | null; // место лучшей модели игрока на Арене среди моделей на рынке
  hypeMult: number;
  repMult: number;
}

/** «$1,2 млн», «$350 тыс.», «$800». */
function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  // Пороги чуть ниже круглых чисел, чтобы после округления не вышло «$1000 тыс.».
  if (x >= 999_950_000) return `$${one(x / 1e9)} млрд`;
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

/** Множитель технологий по месту на Арене: 1 → 1, 2–3 → 0,5, 4–10 → 0,2, ниже → 0,05; моделей на рынке нет → 0. */
function rankFactorFor(rank: number | null): number {
  if (rank === null) return 0;
  if (rank <= 1) return 1;
  if (rank <= 3) return 0.5;
  if (rank <= 10) return 0.2;
  return 0.05;
}

/** Лучшее место среди выпущенных моделей игрока, которые продаются по API. */
function bestMarketRank(s: GameState): number | null {
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
  const total = Math.max(VALUATION_FLOOR, revenuePart + techPart) * hypeMult * repMult;
  return { total, annualRevenue, revenuePart, techPart, rankFactor, bestRank, hypeMult, repMult };
}

/** Причина, почему раунд недоступен (кулдаун — «через N дней»), или null. */
export function canRaise(s: GameState): string | null {
  if (s.lastRoundDay === null) return null;
  const left = s.lastRoundDay + ROUND_COOLDOWN_DAYS - s.day;
  if (left > 0) return `Следующий раунд — через ${left} дн.`;
  return null;
}

/** Действие: продать долю fraction ∈ ROUND_FRACTIONS. Деньги earn('investors'), доля ×(1 − f), письмо. */
export function raiseRound(s: GameState, fraction: number): Result {
  // Допуск на ошибку дробей: 0,1 + 0,2 — это почти 0,3. Дальше считаем по точному значению из списка.
  const f = ROUND_FRACTIONS.find((x) => Math.abs(x - fraction) < 1e-9);
  if (f === undefined) {
    const pct = ROUND_FRACTIONS.map((x) => Math.round(x * 100));
    const last = pct[pct.length - 1];
    return { ok: false, error: `Можно продать ${pct.slice(0, -1).join(', ')} или ${last} % компании` };
  }
  const reason = canRaise(s);
  if (reason !== null) return { ok: false, error: reason };
  const value = valuation(s).total;
  const money = value * f;
  earn(s, 'investors', money);
  s.founderShare *= 1 - f;
  s.lastRoundDay = s.day;
  const share = String(Math.round(s.founderShare * 1000) / 10).replace('.', ',');
  addMail(s, {
    kind: 'finance',
    title: 'Раунд инвестиций закрыт',
    body:
      `Инвесторы оценили лабораторию в ${fmtMoney(value)} и вложили ${fmtMoney(money)} ` +
      `за ${Math.round(f * 100)} % компании. У вас осталось ${share} %. ` +
      `Следующий раунд возможен через ${ROUND_COOLDOWN_DAYS} дн.`,
  });
  return { ok: true };
}
