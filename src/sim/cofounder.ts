// Сооснователь (идея «Люди и сюжет», 18.10): выбирается в новой игре - инженер, продавец или учёный. Каждый даёт
// постоянную выгоду и спорит перед спорными решениями: подгонка под тесты, чужие данные, выпуск модели с непроверенными
// уязвимостями. На третьем споре сооснователь уходит и уводит часть команды; выгода пропадает. Предупреждение видно
// заранее (окна «Новая модель» и «Модели»), поэтому спор - выбор игрока, а не случайность. Боты играют без сооснователя.

import { addMail, addModifier } from './events';
import { staffOf } from './staff';
import { FOREVER } from './constants';
import type { CofounderId, GameState, PlayerModel, TrainingPlan } from './types';

export interface CofounderDef {
  id: CofounderId;
  role: string;
  name: string;
  perk: string;
  /** О чём сооснователь говорит в споре (одна фраза, своим голосом). */
  voice: string;
}

export const COFOUNDERS: readonly CofounderDef[] = [
  { id: 'engineer', role: 'Инженер', name: 'Артём Лавров', perk: 'Аренда карт дешевле на 8 %', voice: 'Я строил этот кластер не для того, чтобы мы обманывали' },
  { id: 'seller', role: 'Продавец', name: 'Мира Холт', perk: 'Спрос на API и подписки выше на 6 %', voice: 'Клиенты покупают у нас, потому что верят нам' },
  { id: 'scientist', role: 'Учёный', name: 'Ева Штерн', perk: 'Исследования дешевле на 12 %', voice: 'Если результаты подогнаны, это уже не наука' },
];
export const COFOUNDER_IDS: readonly CofounderId[] = ['engineer', 'seller', 'scientist'];

/** На этом споре сооснователь уходит. */
export const COFOUNDER_LIMIT = 3;
/** Какая часть команды уходит вместе с ним. */
export const COFOUNDER_TEAM_SHARE = 0.2;
const LEAVE_REP = 3;

export type Dispute = 'overfit' | 'stolen' | 'holes';

const DISPUTE_TEXT: Record<Dispute, string> = {
  overfit: 'подгонка модели под тесты',
  stolen: 'обучение на чужих данных',
  holes: 'выпуск модели без ред-тиминга',
};

export function cofounderDef(id: CofounderId): CofounderDef {
  return COFOUNDERS.find((c) => c.id === id)!;
}

/** Сооснователь в лаборатории (выбран и не ушёл). */
export function cofounderHere(s: GameState): CofounderDef | null {
  const c = s.cofounder;
  return c && c.leftDay === undefined ? cofounderDef(c.id) : null;
}

/** Поставить выгоду сооснователя (новая игра). */
export function applyCofounder(s: GameState, id: CofounderId): void {
  s.cofounder = { id, disputes: 0 };
  if (id === 'engineer') addModifier(s, { id: 'cofounder-rent', kind: 'rentPrice', mult: 0.92, untilDay: FOREVER });
  if (id === 'seller') {
    addModifier(s, { id: 'cofounder-demand', kind: 'demand', mult: 1.06, untilDay: FOREVER });
    addModifier(s, { id: 'cofounder-subs', kind: 'subsDemand', mult: 1.06, untilDay: FOREVER });
  }
  if (id === 'scientist') addModifier(s, { id: 'cofounder-research', kind: 'researchCost', mult: 0.88, untilDay: FOREVER });
}

/** Спорные стороны плана обучения. */
export function planDisputes(plan: Pick<TrainingPlan, 'benchShare' | 'stolenData'>): Dispute[] {
  const out: Dispute[] = [];
  if (plan.benchShare > 0) out.push('overfit');
  if (plan.stolenData) out.push('stolen');
  return out;
}

/** Спорен ли выпуск: у модели 4 и больше уязвимостей и ред-тиминга не было. */
export function releaseDisputed(m: Pick<PlayerModel, 'holes' | 'redTeamDone'>): boolean {
  return (m.holes ?? 0) >= 4 && !m.redTeamDone;
}

/** Предупреждение для окна перед действием, или null. */
export function disputeWarning(s: GameState, disputes: readonly Dispute[]): string | null {
  const c = cofounderHere(s);
  if (!c || disputes.length === 0) return null;
  const n = s.cofounder!.disputes + 1;
  const what = disputes.map((d) => DISPUTE_TEXT[d]).join(' и ');
  return n >= COFOUNDER_LIMIT
    ? `${c.name} против: ${what}. Это третий спор - ${c.role.toLowerCase()} уйдёт и уведёт часть команды.`
    : `${c.name} против: ${what}. Спор ${n} из ${COFOUNDER_LIMIT}: на третьем ${c.role.toLowerCase()} уйдёт.`;
}

/** Действие состоялось вопреки сооснователю: спор, письмо; на третьем - уход с частью команды. */
export function dispute(s: GameState, disputes: readonly Dispute[]): void {
  const c = cofounderHere(s);
  if (!c || disputes.length === 0) return;
  const st = s.cofounder!;
  st.disputes += 1;
  const what = disputes.map((d) => DISPUTE_TEXT[d]).join(' и ');
  if (st.disputes < COFOUNDER_LIMIT) {
    addMail(s, {
      kind: 'news',
      title: `${c.name} спорит с решением`,
      body: `«${c.voice}». Сооснователь против: ${what}. Спор ${st.disputes} из ${COFOUNDER_LIMIT}: после третьего ${c.role.toLowerCase()} уйдёт из лаборатории.`,
    });
    return;
  }
  st.leftDay = s.day;
  s.modifiers = s.modifiers.filter((m) => !m.id.startsWith('cofounder-'));
  const staff = staffOf(s);
  const leaving = staff.people.filter((_, i) => i % Math.round(1 / COFOUNDER_TEAM_SHARE) === Math.round(1 / COFOUNDER_TEAM_SHARE) - 1);
  staff.people = staff.people.filter((e) => !leaving.includes(e));
  st.tookStaff = leaving.length;
  s.reputation = Math.max(0, s.reputation - LEAVE_REP);
  addMail(s, {
    kind: 'news',
    title: `${c.name} уходит из лаборатории`,
    body:
      `«${c.voice}». После третьего спора (${what}) сооснователь ушёл` +
      (leaving.length ? ` и увёл ${leaving.length} ${leaving.length === 1 ? 'сотрудника' : 'сотрудников'}` : '') +
      `. Выгода пропала: ${c.perk.charAt(0).toLowerCase()}${c.perk.slice(1)} - больше нет. Репутация −${LEAVE_REP}.`,
  });
}
