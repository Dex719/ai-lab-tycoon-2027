// Расписание случайных писем с выбором: примерно раз в 2-3 месяца, не больше одного неотвеченного за раз.
// Жребий идёт в отдельном потоке s.yearly.rng (nextRandom): основной поток игры (s.rng) не сдвигается,
// поэтому тендеры, рынок и соперники до первого письма и после него считаются так же, как раньше.
// Чтобы письма с выбором не шли вплотную: письмо по дате (история, ранние заказы) приходит не раньше чем через неделю
// после другого письма с выбором и не за неделю до сюжетного письма по дате; случайное - не раньше чем через 10 дней
// после любого решения. Частоту случайных писем это почти не меняет: их отказы по умолчанию - часть баланса
// (боты отвечают вариантом по умолчанию, balance.test.ts).

import { EVENTS, EXTRA_EVENTS } from '../data/events';
import { EARLY_EVENTS } from '../data/earlyEvents';
import { HISTORY_DATE } from '../data/historyEvents';
import { LATE_DATE, leakTarget } from '../data/lateEvents';
import { openChoices, triggerEvent } from './events';
import { nextRandom, randInt } from './rng';
import { dateToDay, isMonthStart, yearOf } from './time';
import type { GameState } from './types';

/** Через сколько дней после письма может прийти следующее: от 60 до 90 (примерно раз в 2-3 месяца). */
export const RANDOM_GAP_MIN = 60;
export const RANDOM_GAP_MAX = 90;
/** Сколько дней одно и то же письмо не повторяется (если оно не «только раз за игру»). */
export const RANDOM_COOLDOWN_DAYS = 540;
/** Письмо по дате ждёт столько дней после любого письма с выбором (окно письма - 60 дней, успевает). */
export const DATED_SPACING_DAYS = 7;
/** Случайное письмо ждёт столько дней после любого письма с выбором. */
export const RANDOM_QUIET_DAYS = 10;

/** Сюжетное письмо с выбором по дате (data/events.ts EVENTS) придёт в ближайшие days дней: не ставить письма вплотную. */
export function mainChoiceSoon(s: GameState, days: number): boolean {
  for (const e of EVENTS) {
    if (!e.choices || !('date' in e.when) || s.firedEvents.includes(e.id)) continue;
    const d = dateToDay(e.when.date);
    if (d >= s.day && d - s.day < days) return true;
  }
  return false;
}

/** День последнего письма с выбором (любого: история, соперники, случайное); -Infinity, если их не было. */
export function lastChoiceDay(s: GameState): number {
  // Письма добавляются по порядку дней, поэтому первое с конца - самое позднее.
  for (let i = s.mail.length - 1; i >= 0; i--) if (s.mail[i].choices && s.mail[i].eventId !== LEAK_ID) return s.mail[i].day;
  return -Infinity;
}

export interface RandomCandidate {
  id: string;
  weight: number;
}

/** Случайные события, которые сейчас можно отправить, с весами. Пусто - ни одно не подходит. */
export function randomCandidates(s: GameState): RandomCandidate[] {
  const out: RandomCandidate[] = [];
  for (const def of EXTRA_EVENTS) {
    if (!def.random) continue;
    const last = s.yearly.lastFired[def.id];
    if (last !== undefined && (def.random.once || s.day - last < (def.random.cooldown ?? RANDOM_COOLDOWN_DAYS))) continue;
    const weight = def.random.weight(s);
    if (weight > 0) out.push({ id: def.id, weight });
  }
  return out;
}

/**
 * Мелкие письма с выбором (ранние заказы и гранты, случайные письма) не останавливают игру: приходят сразу отложенными,
 * ответ - в «Почте» до срока, без ответа срабатывает вариант по умолчанию. Плейтест 17.10: такие письма каждые 10-15 дней
 * ставили игру на паузу. Сюжетные письма, соперники, команда и срыв обучения по-прежнему ждут ответа.
 */
const EARLY_IDS = new Set(EARLY_EVENTS.map((e) => e.id));

function deferLast(s: GameState): void {
  const m = s.mail[s.mail.length - 1];
  if (m?.choices && m.chosen === undefined) m.deferred = true;
}

/** Выбор по весам; r - число из [0, 1). */
export function pickWeighted(list: readonly RandomCandidate[], r: number): RandomCandidate | null {
  const total = list.reduce((a, c) => a + c.weight, 0);
  if (!(total > 0)) return null;
  let x = r * total;
  for (const c of list) {
    x -= c.weight;
    if (x < 0) return c;
  }
  return list[list.length - 1];
}

/**
 * Ранние заказы и события по датам (EXTRA_EVENTS без жребия): приходят в своё окно, но не поверх другого письма
 * с выбором - ждут ответа на прежнее и ещё неделю после него. Окно письма - 60 дней (data/eventKit.windowFrom).
 */
export function extraDateEventsDay(s: GameState): void {
  if (openChoices(s).length > 0) return;
  if (s.day - lastChoiceDay(s) < DATED_SPACING_DAYS || mainChoiceSoon(s, DATED_SPACING_DAYS)) return;
  for (const def of EXTRA_EVENTS) {
    if (def.random || def.repeatable || s.firedEvents.includes(def.id) || !('check' in def.when)) continue;
    if (!def.when.check(s)) continue;
    triggerEvent(s, def.id);
    if (EARLY_IDS.has(def.id)) deferLast(s);
    return; // не больше одного письма за день
  }
}

/**
 * Ежедневно: если пришёл срок, в почте нет ни одного неотвеченного письма с выбором (даже отложенного),
 * последнее такое письмо было не меньше 10 дней назад и сюжетное письмо не на подходе, бросить жребий и отправить
 * письмо. Если жребий не из чего бросать, ждём до завтра.
 */
/** Утечка планов соперника: не чаще раза в LEAK_GAP_DAYS, с 2019 года, в начале месяца с вероятностью 1/4 по зерну. */
export const LEAK_ID = 'rnd-rival-leak';
const LEAK_GAP_DAYS = 400;
const LEAK_YEAR_MAX = 13;
const LEAK_BUSY_YEAR = 10;

/** Сколько писем по датам (история и поздняя игра) запланировано на год. */
function datedInYear(year: number): number {
  let n = 0;
  for (const d of [...Object.values(HISTORY_DATE), ...Object.values(LATE_DATE)]) if (Number(d.slice(0, 4)) === year) n++;
  return n;
}

/**
 * Своё расписание письма об утечке (data/lateEvents.LEAK_EVENT): без общего потока жребия s.yearly.rng, приходит
 * отложенным (игра не встаёт) и не считается «последним решением» для расписания других писем (lastChoiceDay).
 */
export function leakDay(s: GameState): void {
  if (!isMonthStart(s.day) || s.day < dateToDay('2019-01-01')) return;
  const last = s.yearly.lastFired[LEAK_ID];
  if (last !== undefined && s.day - last < LEAK_GAP_DAYS) return;
  if (openChoices(s).length > 0 || !leakTarget(s)) return;
  // Год и так полон решений (не больше 16 в год вместе со всеми письмами): в годы, где писем по датам много (2023),
  // и когда решений в году уже LEAK_YEAR_MAX, утечка ждёт следующего года.
  const year = yearOf(s.day);
  if (datedInYear(year) >= LEAK_BUSY_YEAR) return;
  if (s.mail.filter((m) => m.choices && yearOf(m.day) === year).length >= LEAK_YEAR_MAX) return;
  // Как у случайных писем: не раньше чем через 10 дней после другого решения.
  if (s.day - lastChoiceDay(s) < RANDOM_QUIET_DAYS || mainChoiceSoon(s, DATED_SPACING_DAYS)) return;
  // Детерминированный «жребий» от зерна и дня: основной и годовой потоки случайности не сдвигаются.
  const h = Math.imul((s.seed ^ (s.day * 2654435761)) >>> 0, 2246822519) >>> 0;
  if (h % 4 !== 0) return;
  s.yearly.lastFired[LEAK_ID] = s.day;
  triggerEvent(s, LEAK_ID);
  deferLast(s);
}

export function randomEventDay(s: GameState): void {
  extraDateEventsDay(s);
  leakDay(s);
  const y = s.yearly;
  if (s.day < y.nextEventDay) return;
  if (openChoices(s).length > 0) return; // не больше одного письма с выбором: ждём ответа
  if (s.day - lastChoiceDay(s) < RANDOM_QUIET_DAYS) return; // только что было другое решение: даём передохнуть
  if (mainChoiceSoon(s, DATED_SPACING_DAYS)) return;
  const list = randomCandidates(s);
  const pick = pickWeighted(list, nextRandom(y));
  if (!pick) return;
  y.lastFired[pick.id] = s.day;
  y.nextEventDay = s.day + randInt(y, RANDOM_GAP_MIN, RANDOM_GAP_MAX);
  triggerEvent(s, pick.id);
  deferLast(s);
}
