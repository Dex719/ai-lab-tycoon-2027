// Почта, модификаторы и движок событий (FR-11). Содержание событий - в data/events.ts.

// Импорт constants стоит первым: FOREVER реэкспортируется отсюда, а rivalry.ts читает его на верхнем уровне модуля
// внутри цикла sim/events → data/events → sim/rivalry → sim/events. В ESM привязка реэкспорта ведёт прямо в
// constants.ts (без TDZ); в vitest (vite-node) она готова, только если импорт constants завершён до входа в цикл.
import { CHOICE_DAYS, FOREVER } from './constants';
import { EVENTS, findEvent } from '../data/events';
import type { EventChoiceDef, EventDef } from '../data/events';
import { finishRollLog, hypeText, repText, startRollLog, sumText } from '../data/eventKit';
import { dateToDay } from './time';
import type { GameState, Mail, MailChoice, Modifier, ModifierKind, Result } from './types';

export interface NewMail {
  title: string;
  body: string;
  kind: Mail['kind'];
  eventId?: string;
  choices?: MailChoice[];
  important?: boolean;
  reward?: boolean;
  /** Письмо приходит прочитанным и без уведомления: событие игрок уже видел на экране. */
  read?: boolean;
  /** Письмо лично от лаборатории-соперника (sim/duel.ts). */
  from?: Mail['from'];
}

export function addMail(s: GameState, m: NewMail): Mail {
  const mail: Mail = { id: `m${s.nextMailNum++}`, day: s.day, read: false, ...m };
  s.mail.push(mail);
  return mail;
}

/** Через сколько дней прочитанные письма без нерешённого выбора уходят из почты. */
export const MAIL_KEEP_DAYS = 365;

/** Убрать из почты прочитанные письма старше года; письма с невыбранным ответом остаются. */
export function pruneMail(s: GameState): void {
  const limit = s.day - MAIL_KEEP_DAYS;
  const keep = (m: Mail): boolean => !m.read || m.day >= limit || (m.choices !== undefined && m.chosen === undefined);
  if (s.mail.some((m) => !keep(m))) s.mail = s.mail.filter(keep);
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

/** Варианты письма на день отправки: подпись, числа (hint или hintFn) и последствие словами (story). */
export function mailChoices(s: GameState, def: EventDef): MailChoice[] | undefined {
  return def.choices?.map((c) => {
    const choice: MailChoice = { label: c.label, hint: c.hintFn ? c.hintFn(s) : c.hint };
    const story = typeof c.story === 'function' ? c.story(s) : c.story;
    if (story) choice.story = story;
    return choice;
  });
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
    choices: mailChoices(s, def),
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

/** «+$350 тыс., -5 репутации» по разнице до и после выбора; без изменений - «без последствий». */
function changesText(before: { cash: number; rep: number; hype: number }, s: GameState): string {
  const parts: string[] = [];
  const money = Math.round(s.cash - before.cash);
  const rep = Math.round(s.reputation - before.rep);
  const hype = Math.round(s.hype.player - before.hype);
  if (money !== 0) parts.push(sumText(money));
  if (rep !== 0) parts.push(repText(rep));
  if (hype !== 0) parts.push(hypeText(hype));
  return parts.length > 0 ? parts.join(', ') : 'без последствий';
}

/** «Журналисты раскопали утечку (-8 репутации, -15 шумихи)»; без слов - только числа, как раньше. */
function outcomeText(luck: EventChoiceDef['luck'], lucky: boolean, changes: string): string {
  if (!luck) return changes;
  const words = lucky ? luck.good : luck.bad;
  return changes === 'без последствий' ? words : `${words} (${changes})`;
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
  const before = { cash: s.cash, rep: s.reputation, hype: s.hype.player };
  startRollLog();
  try {
    choice.apply(s, mail);
  } finally {
    const luck = finishRollLog();
    if (luck) mail.outcome = { lucky: luck.lucky, text: outcomeText(choice.luck, luck.lucky, changesText(before, s)) };
  }
  return { ok: true };
}
