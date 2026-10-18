// Один игровой день (порядок - design.md, «Порядок тика»).

import { HYPE_MONTHLY_DECAY, HYPE_OWNERS } from './constants';
import { generateMonthly, progressDay as contractsDay } from './contracts';
import { introduceDue } from './benchmarks';
import { computeDay } from './compute';
import { investorsDay } from './investors';
import { datacentersDay } from './datacenters';
import { duelDay } from './duel';
import { dealsDay, dealsMonthEnd } from './deals';
import { finaleDay } from './finale';
import { expireChoices, fireDue, pendingChoice, pruneMail, pruneModifiers } from './events';
import { beginDay, closeMonth, dayStep as financeDay } from './finance';
import { goalsDay, yearEnd } from './goals';
import { noteLabStage } from './labStage';
import { marketArenaRank, rivalFrontierElo, rivalsSellByApi, updateSaturation } from './leaderboard';
import { tasksDay } from './tasks';
import { staffDay } from './staff';
import { dayStep as marketDay } from './market';
import { randomEventDay } from './randomEvents';
import { progressDay as researchDay } from './research';
import { marketRivals, releaseDue } from './rivals';
import { rivalEloIn, rivalPriceIn, rivalryDay, rivalryMonth } from './rivalry';
import { dayToDate, END_DAY, isMonthStart } from './time';
import { monthlyTheftSuits } from './country';
import { monthlyExposure, progressDay as trainingDay, reviewDay } from './training';
import type { GameState } from './types';

export function blockedByChoice(s: GameState): boolean {
  return pendingChoice(s) !== null;
}

/**
 * Лучшее место модели игрока на Арене среди моделей, доступных по API (leaderboard.marketArenaRank):
 * null - у игрока нет выпущенных моделей в продаже. По нему считаются победа и monthsFirst.
 */
export function playerBestArenaRank(s: GameState): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onApi) continue;
    const r = marketArenaRank(s, { kind: 'player', id: m.id });
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

/** Цены за 1 млн токенов на конец месяца: самая сильная модель каждой лаборатории на витрине API и лучшая модель игрока. */
export function monthPrices(s: GameState): Record<string, number> {
  const best = new Map<string, { elo: number; price: number }>();
  for (const def of marketRivals(s)) {
    const elo = rivalEloIn(s, def);
    const cur = best.get(def.lab);
    if (!cur || elo > cur.elo) best.set(def.lab, { elo, price: rivalPriceIn(s, def) });
  }
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onApi) continue;
    const cur = best.get('player');
    if (!cur || m.arenaElo > cur.elo) best.set('player', { elo: m.arenaElo, price: m.price });
  }
  const out: Record<string, number> = {};
  for (const [owner, v] of best) if (Number.isFinite(v.price) && v.price > 0) out[owner] = v.price;
  return out;
}

/** Продвинуть игру на один день. Ничего не делает, если игра окончена или ждёт выбора в почте. */
export function advanceDay(s: GameState): void {
  if (s.outcome || blockedByChoice(s)) return;

  beginDay(s);
  if (isMonthStart(s.day)) generateMonthly(s);

  introduceDue(s);
  const releasedBefore = s.rivalsReleased.length;
  releaseDue(s);
  rivalryDay(s); // ходы соперников по слухам, память, истечение ходов; ответные модели попадают в rivalsReleased
  finaleDay(s); // финальный квартал: анонсы, рывки соперников, доработка моделей игрока
  dealsDay(s); // сделки 2023-2024: стартапы на продаже, конец облачной сделки
  staffDay(s); // команда: зарплаты; в начале месяца - кандидаты, опыт, уход неповышенных, переманивание
  expireChoices(s);
  fireDue(s);
  investorsDay(s); // переговоры о раунде инвестиций: в срок закрываются, деньги приходят
  computeDay(s); // арендованные карты, заказанные раньше, приходят и начинают работать
  datacentersDay(s); // свои дата-центры: этапы стройки, доставка карт (мощность нужна уже сегодня), электричество
  randomEventDay(s); // случайное письмо с выбором: своё расписание и свой поток случайных чисел
  goalsDay(s); // цели года: выдача в начале года и проверка выполнения

  researchDay(s);
  trainingDay(s);
  reviewDay(s); // 5а: завершение внешних проверок сильных моделей
  contractsDay(s);
  marketDay(s);
  financeDay(s);
  tasksDay(s); // короткие задачи: проверка после денег и контрактов дня, новая задача
  duelDay(s); // личное соперничество: счёт обгонов, главный соперник, письма соперников (на баланс не влияет)

  if (s.rivalsReleased.length !== releasedBefore) updateSaturation(s);

  const monthEnd = isMonthStart(s.day + 1);
  if (monthEnd) {
    dealsMonthEnd(s); // зарплата звёздных команд и недобор по облачной сделке - в журнал этого месяца
    closeMonth(s);
    const rec = s.finance.history[s.finance.history.length - 1];
    // Лучшая модель игрока в продаже: по ней считается место, и график в итоге партии должен с ним сходиться.
    rec.eloMine = s.models.reduce((b, m) => (m.releasedDay !== null && m.onApi ? Math.max(b, m.arenaElo) : b), 0);
    rec.eloRival = rivalFrontierElo(s);
    rec.placeEnd = rivalsSellByApi(s) ? playerBestArenaRank(s) : null;
    rec.prices = monthPrices(s);
    // Месяц закрыт на 1-м месте среди моделей по API: считается до разоблачений месяца, по состоянию рынка на его конец.
    // Месяц считается, только когда соперники уже продают модели по API: до этого первое место ничего не значит.
    if (playerBestArenaRank(s) === 1 && rivalsSellByApi(s)) s.monthsFirst += 1;
    for (const o of HYPE_OWNERS) s.hype[o] *= HYPE_MONTHLY_DECAY;
    monthlyExposure(s);
    monthlyTheftSuits(s);
    noteLabStage(s);
    // Рычаг игрока, накал и планирование ходов соперников: единственное место модуля со случайностью (с 2021 года).
    rivalryMonth(s);
    updateSaturation(s);
    pruneModifiers(s);
    pruneMail(s);
    if (dayToDate(s.day).month === 12) yearEnd(s); // 31 декабря: итоги года и цели следующего
  }

  if (s.outcome) return; // банкротство
  if (s.day >= END_DAY) {
    // Победа - 1-е место на «Арене» среди моделей, доступных по API, в последний день игры.
    s.outcome = playerBestArenaRank(s) === 1 ? 'victory' : 'finished';
    return;
  }
  // Автосохранение просим только у живой игры: конец игры не должен затирать последнее сохранение, с которого можно играть дальше.
  if (monthEnd) s.flags.autosaveDue = true;
  s.day += 1;
}

/** Продвинуть до n дней; останавливается на выборе в почте или конце игры. Возвращает число прожитых дней. */
export function advanceDays(s: GameState, n: number): number {
  let done = 0;
  while (done < n && !s.outcome && !blockedByChoice(s)) {
    advanceDay(s);
    done++;
  }
  return done;
}
