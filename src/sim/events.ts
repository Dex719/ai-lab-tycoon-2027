// Почта, модификаторы и движок событий (FR-11). Содержание событий - в data/events.ts.

// Импорт constants стоит первым: FOREVER реэкспортируется отсюда, а rivalry.ts читает его на верхнем уровне модуля
// внутри цикла sim/events → data/events → sim/rivalry → sim/events. В ESM привязка реэкспорта ведёт прямо в
// constants.ts (без TDZ); в vitest (vite-node) она готова, только если импорт constants завершён до входа в цикл.
import { CHOICE_DAYS, FOREVER } from './constants';
import { EVENTS, findEvent } from '../data/events';
import { dateToDay } from './time';
import type { GameState, Mail, MailChoice, Modifier, ModifierKind, Result } from './types';

export interface NewMail {
  title: string;
  body: string;
  kind: Mail['kind'];
  eventId?: string;
  choices?: MailChoice[];
  important?: boolean;
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

export { FOREVER };

export function addModifier(s: GameState, m: Omit<Modifier, 'id'> & { id?: string }): void {
  const id = m.id ?? `mod${s.modifiers.length + 1}-${s.day}`;
  s.modifiers = s.modifiers.filter((x) => x.id !== id);
  s.modifiers.push({ ...m, id });
}

/**
 * Суммарный эффект активных модификаторов вида kind: произведение mult и сумма add.
 * Модификатор без target действует на всё; с target - только если target совпадает.
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

/** Запустить событие по id (EVENTS или письма соперников): письмо, эффект onFire, выбор (если есть). */
export function triggerEvent(s: GameState, id: string): void {
  const def = findEvent(id);
  if (!def) throw new Error(`Нет события ${id}`);
  if (!def.repeatable) {
    if (s.firedEvents.includes(id)) return;
    s.firedEvents.push(id);
  }
  const mail = def.mail(s);
  def.onFire?.(s);
  const added = addMail(s, {
    ...mail,
    eventId: def.choices ? id : undefined,
    choices: def.choices?.map((c) => ({ label: c.label, hint: c.hint })),
  });
  if (def.choices) {
    added.replyByDay = s.day + (def.choiceDays ?? CHOICE_DAYS);
    added.defaultChoice = def.defaultChoice ?? def.choices.length - 1;
  }
}

/** Ежедневно: сработать события, чья дата наступила или условие выполнено. Только EVENTS: письма соперников запускает rivalry.ts. */
export function fireDue(s: GameState): void {
  for (const def of EVENTS) {
    if (s.firedEvents.includes(def.id) || def.repeatable) continue;
    const due = 'date' in def.when ? s.day >= dateToDay(def.when.date) : def.when.check(s);
    if (due) triggerEvent(s, def.id);
  }
}

/** Неотвеченное и неотложенное письмо с выбором: игра стоит, пока оно есть. */
export function pendingChoice(s: GameState): Mail | null {
  return s.mail.find((m) => m.choices && m.chosen === undefined && !m.deferred) ?? null;
}

/** Все письма, которые ждут ответа, включая отложенные. */
export function openChoices(s: GameState): Mail[] {
  return s.mail.filter((m) => m.choices && m.chosen === undefined);
}

/** Есть неотвеченное письмо события eventId. */
export function awaitingEvent(s: GameState, eventId: string): boolean {
  return s.mail.some((m) => m.eventId === eventId && m.choices && m.chosen === undefined);
}

/** Действие: отложить решение. Игра идёт дальше, письмо ждёт ответа в «Почте» до replyByDay. */
export function deferChoice(s: GameState, mailId: string): Result {
  const mail = s.mail.find((m) => m.id === mailId);
  if (!mail || !mail.choices) return { ok: false, error: 'Письмо без выбора' };
  if (mail.chosen !== undefined) return { ok: false, error: 'Выбор уже сделан' };
  mail.deferred = true;
  mail.read = true;
  return { ok: true };
}

/** Ежедневно: если срок ответа истёк, выбрать вариант по умолчанию. */
export function expireChoices(s: GameState): void {
  for (const m of s.mail) {
    if (!m.choices || m.chosen !== undefined || m.replyByDay === undefined || s.day < m.replyByDay) continue;
    const idx = m.defaultChoice ?? m.choices.length - 1;
    if (applyChoice(s, m.id, idx).ok) {
      m.autoChosen = true;
      m.read = false; // игрок должен увидеть, что решение принято без него
    }
  }
}

/** Снять выбор с писем события: решение больше не нужно (например, проект отменён). */
export function dropChoices(s: GameState, eventId: string, note: string): void {
  for (const m of s.mail) {
    if (m.eventId !== eventId || !m.choices || m.chosen !== undefined) continue;
    m.choices = undefined;
    m.eventId = undefined;
    m.replyByDay = undefined;
    m.defaultChoice = undefined;
    m.deferred = undefined;
    m.body = `${m.body} ${note}`;
  }
}

export function applyChoice(s: GameState, mailId: string, idx: number): Result {
  const mail = s.mail.find((m) => m.id === mailId);
  if (!mail || !mail.choices || !mail.eventId) return { ok: false, error: 'Письмо без выбора' };
  if (mail.chosen !== undefined) return { ok: false, error: 'Выбор уже сделан' };
  const def = findEvent(mail.eventId);
  const choice = def?.choices?.[idx];
  if (!def || !choice) return { ok: false, error: 'Нет такого варианта' };
  mail.chosen = idx;
  mail.read = true;
  choice.apply(s);
  return { ok: true };
}
