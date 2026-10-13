// Расписание случайных писем с выбором: примерно раз в 2-3 месяца, не больше одного неотвеченного за раз.
// Жребий идёт в отдельном потоке s.yearly.rng (nextRandom): основной поток игры (s.rng) не сдвигается,
// поэтому тендеры, рынок и соперники до первого письма и после него считаются так же, как раньше.

import { EXTRA_EVENTS } from '../data/events';
import { openChoices, triggerEvent } from './events';
import { nextRandom, randInt } from './rng';
import type { GameState } from './types';

/** Через сколько дней после письма может прийти следующее: от 60 до 90 (примерно раз в 2-3 месяца). */
export const RANDOM_GAP_MIN = 60;
export const RANDOM_GAP_MAX = 90;
/** Сколько дней одно и то же письмо не повторяется (если оно не «только раз за игру»). */
export const RANDOM_COOLDOWN_DAYS = 540;

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
 * с выбором - ждут ответа на прежнее. Окно письма - 60 дней (data/eventKit.windowFrom).
 */
export function extraDateEventsDay(s: GameState): void {
  if (openChoices(s).length > 0) return;
  for (const def of EXTRA_EVENTS) {
    if (def.random || def.repeatable || s.firedEvents.includes(def.id) || !('check' in def.when)) continue;
    if (!def.when.check(s)) continue;
    triggerEvent(s, def.id);
    return; // не больше одного письма за день
  }
}

/**
 * Ежедневно: если пришёл срок и в почте нет ни одного неотвеченного письма с выбором (даже отложенного),
 * бросить жребий и отправить письмо. Если жребий не из чего бросать, ждём до завтра.
 */
export function randomEventDay(s: GameState): void {
  extraDateEventsDay(s);
  const y = s.yearly;
  if (s.day < y.nextEventDay) return;
  if (openChoices(s).length > 0) return; // не больше одного письма с выбором: ждём ответа
  const list = randomCandidates(s);
  const pick = pickWeighted(list, nextRandom(y));
  if (!pick) return;
  y.lastFired[pick.id] = s.day;
  y.nextEventDay = s.day + randInt(y, RANDOM_GAP_MIN, RANDOM_GAP_MAX);
  triggerEvent(s, pick.id);
}
