// Почта, модификаторы и движок событий (FR-11). Содержание событий — в data/events.ts.

import { EVENTS } from '../data/events';
import { dateToDay } from './time';
import type { GameState, Mail, MailChoice, Modifier, ModifierKind, Result } from './types';

export interface NewMail {
  title: string;
  body: string;
  kind: Mail['kind'];
  eventId?: string;
  choices?: MailChoice[];
}

export function addMail(s: GameState, m: NewMail): Mail {
  const mail: Mail = { id: `m${s.nextMailNum++}`, day: s.day, read: false, ...m };
  s.mail.push(mail);
  return mail;
}

export function markRead(s: GameState, mailId: string): void {
  const m = s.mail.find((x) => x.id === mailId);
  if (m) m.read = true;
}

export function unreadCount(s: GameState): number {
  return s.mail.filter((m) => !m.read).length;
}

export const FOREVER = Number.MAX_SAFE_INTEGER;

export function addModifier(s: GameState, m: Omit<Modifier, 'id'> & { id?: string }): void {
  const id = m.id ?? `mod${s.modifiers.length + 1}-${s.day}`;
  s.modifiers = s.modifiers.filter((x) => x.id !== id);
  s.modifiers.push({ ...m, id });
}

/**
 * Суммарный эффект активных модификаторов вида kind: произведение mult и сумма add.
 * Модификатор без target действует на всё; с target — только если target совпадает.
 */
export function modValue(s: GameState, kind: ModifierKind, target?: string): { mult: number; add: number } {
  let mult = 1;
  let add = 0;
  for (const m of s.modifiers) {
    if (m.kind !== kind || m.untilDay < s.day) continue;
    if (m.target !== undefined && m.target !== target) continue;
    if (m.mult !== undefined) mult *= m.mult;
    if (m.add !== undefined) add += m.add;
  }
  return { mult, add };
}

export function pruneModifiers(s: GameState): void {
  s.modifiers = s.modifiers.filter((m) => m.untilDay >= s.day);
}

/** Запустить событие по id: письмо, эффект onFire, выбор (если есть). */
export function triggerEvent(s: GameState, id: string): void {
  const def = EVENTS.find((e) => e.id === id);
  if (!def) throw new Error(`Нет события ${id}`);
  if (!def.repeatable) {
    if (s.firedEvents.includes(id)) return;
    s.firedEvents.push(id);
  }
  const mail = def.mail(s);
  def.onFire?.(s);
  addMail(s, {
    ...mail,
    eventId: def.choices ? id : undefined,
    choices: def.choices?.map((c) => ({ label: c.label, hint: c.hint })),
  });
}

/** Ежедневно: сработать события, чья дата наступила или условие выполнено. */
export function fireDue(s: GameState): void {
  for (const def of EVENTS) {
    if (s.firedEvents.includes(def.id) || def.repeatable) continue;
    const due = 'date' in def.when ? s.day >= dateToDay(def.when.date) : def.when.check(s);
    if (due) triggerEvent(s, def.id);
  }
}

/** Неотвеченное письмо с выбором (игра стоит, пока оно есть). */
export function pendingChoice(s: GameState): Mail | null {
  return s.mail.find((m) => m.choices && m.chosen === undefined) ?? null;
}

export function applyChoice(s: GameState, mailId: string, idx: number): Result {
  const mail = s.mail.find((m) => m.id === mailId);
  if (!mail || !mail.choices || !mail.eventId) return { ok: false, error: 'Письмо без выбора' };
  if (mail.chosen !== undefined) return { ok: false, error: 'Выбор уже сделан' };
  const def = EVENTS.find((e) => e.id === mail.eventId);
  const choice = def?.choices?.[idx];
  if (!def || !choice) return { ok: false, error: 'Нет такого варианта' };
  mail.chosen = idx;
  mail.read = true;
  choice.apply(s);
  return { ok: true };
}
