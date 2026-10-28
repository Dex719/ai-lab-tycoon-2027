// Сделки поздней игры (с 2023 года): звёздные команды, покупка стартапов, облачная сделка.
// Данные - data/deals.ts, состояние - lateState.ts. Каждая сделка стоит крупных денег и меняет игру надолго:
// команды ускоряют обучение и исследования, но их переманивают соперники (rivalry.ts, ход «переманивание»);
// стартап ждёт покупателя OFFER_DAYS дней, потом его покупает соперник; облако даёт аренду дешевле и выше
// лимит, но обязательный платёж списывается, даже если карты не нужны.

import {
  CLOUD_EXIT_SHARE,
  cloudDef,
  DEALS_FROM,
  MAX_TEAMS,
  OFFER_DAYS,
  RIVAL_BUY_HYPE,
  startupDef,
  STARTUPS,
  teamDef,
  type StartupDef,
} from '../data/deals';
import { LABS } from '../data/labs';
import { FOREVER, DAYS_PER_MONTH } from './constants';
import { addMail, addModifier } from './events';
import { spend } from './finance';
import { hasTeam, lateOf, newModelEloBonus, trainSpeedMult, type CloudId, type StartupId, type TeamId } from './lateState';
import { endSentence } from './text';
import { dateToDay, dayToDate, formatDate } from './time';
import type { GameState, LabId, Result } from './types';

const DEALS_DAY = dateToDay(DEALS_FROM);

/** «$1,5 млн», «$300 млн», «$1,2 млрд» - для писем и ошибок. */
export function dealMoney(n: number): string {
  const dec = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
  if (n >= 1e9 - 5e4) return `$${dec(n / 1e9)} млрд`;
  if (n >= 1e6 - 500) return `$${dec(n / 1e6)} млн`;
  if (n >= 1e3 - 0.5) return `$${dec(n / 1e3)} тыс.`;
  return `$${Math.round(n)}`;
}

function labName(lab: LabId): string {
  return LABS.find((l) => l.id === lab)?.name ?? lab;
}

function noMoney(need: number, s: GameState): string {
  return `Не хватает денег: нужно ${dealMoney(need)}, на счету ${endSentence(dealMoney(Math.max(0, s.cash)))}`;
}

/** День открытия сделок или null, если ещё рано (ярлык «Сделки» не показываем: будущее не раскрываем). */
export function dealsOpenedDay(s: GameState): number | null {
  return s.day >= DEALS_DAY ? DEALS_DAY : null;
}

function closedReason(s: GameState): string | null {
  if (s.outcome) return 'Партия окончена.';
  if (s.day < DEALS_DAY) return 'Сделки откроются в 2023 году.';
  return null;
}

// ---------- Звёздные команды ----------

const TEAM_RESEARCH_MOD = 'team-research';
/** Команда исследований: исследования дешевле на 30 %. */
const TEAM_RESEARCH_MULT = 0.7;

export function teamHireError(s: GameState, id: TeamId): string | null {
  const closed = closedReason(s);
  if (closed) return closed;
  const late = lateOf(s);
  if (late.teams.some((t) => t.id === id)) return 'Команда уже работает в лаборатории.';
  if (late.teams.length >= MAX_TEAMS) return `Больше ${MAX_TEAMS} команд лаборатория не удержит: сначала отпустите одну.`;
  const def = teamDef(id);
  if (s.cash < def.signing) return noMoney(def.signing, s);
  return null;
}

function applyTeam(s: GameState, id: TeamId, on: boolean): void {
  if (id !== 'research') return;
  if (on) addModifier(s, { id: TEAM_RESEARCH_MOD, kind: 'researchCost', mult: TEAM_RESEARCH_MULT, untilDay: FOREVER });
  else s.modifiers = s.modifiers.filter((m) => m.id !== TEAM_RESEARCH_MOD);
}

/** Действие: нанять команду - подъёмные сразу, зарплата в конце каждого месяца. */
export function hireTeam(s: GameState, id: TeamId): Result {
  const error = teamHireError(s, id);
  if (error) return { ok: false, error };
  const def = teamDef(id);
  spend(s, 'capex', def.signing);
  lateOf(s).teams.push({ id, since: s.day });
  applyTeam(s, id, true);
  addMail(s, {
    kind: 'finance',
    title: `${def.name} в лаборатории`,
    read: true,
    body: `${def.name} (руководитель - ${def.leader}) приступила к работе. ${def.effect}. Разовая выплата ${dealMoney(def.signing)}, зарплата ${dealMoney(def.salary)} в месяц.`,
  });
  return { ok: true };
}

/** Команда уходит (отпустили или переманили): эффект пропадает, подъёмные не возвращаются. */
export function dropTeam(s: GameState, id: TeamId): boolean {
  const late = lateOf(s);
  const before = late.teams.length;
  late.teams = late.teams.filter((t) => t.id !== id);
  if (late.teams.length === before) return false;
  applyTeam(s, id, false);
  return true;
}

/** Действие: отпустить команду. */
export function releaseTeam(s: GameState, id: TeamId): Result {
  if (s.outcome) return { ok: false, error: 'Партия окончена.' };
  if (!dropTeam(s, id)) return { ok: false, error: 'Этой команды нет в лаборатории.' };
  return { ok: true };
}

/** Зарплата всех команд в месяц, $. */
export function teamsSalary(s: GameState): number {
  return (s.late?.teams ?? []).reduce((sum, t) => sum + teamDef(t.id).salary, 0);
}

// ---------- Стартапы ----------

export type OfferStatus = 'open' | 'bought' | 'rival';

export interface StartupOffer {
  def: StartupDef;
  openDay: number;
  closeDay: number; // последний день, когда можно купить
  status: OfferStatus;
  day: number | null; // день покупки (игроком или соперником)
  lab: LabId | null; // кто купил, если не игрок
}

/** Стартапы, которые уже выставлены на продажу (будущие не показываем), новые сверху. */
export function startupOffers(s: GameState): StartupOffer[] {
  const out: StartupOffer[] = [];
  for (const def of STARTUPS) {
    const openDay = dateToDay(def.from);
    if (s.day < openDay) continue;
    const deal = s.late?.startups.find((d) => d.id === def.id);
    out.push({
      def,
      openDay,
      closeDay: openDay + OFFER_DAYS - 1,
      status: deal ? deal.status : 'open',
      day: deal?.day ?? null,
      lab: deal?.status === 'rival' ? (deal.lab ?? def.rival) : null,
    });
  }
  return out.reverse();
}

export function buyStartupError(s: GameState, id: StartupId): string | null {
  const closed = closedReason(s);
  if (closed) return closed;
  const offer = startupOffers(s).find((o) => o.def.id === id);
  if (!offer) return 'Этот стартап не продаётся.';
  if (offer.status === 'bought') return 'Стартап уже ваш.';
  if (offer.status === 'rival') return `Стартап уже купила ${labName(offer.lab ?? offer.def.rival)}.`;
  if (s.cash < offer.def.price) return noMoney(offer.def.price, s);
  return null;
}

function applyStartup(s: GameState, def: StartupDef): void {
  const a = def.apply;
  if (a.kind === 'segBrand') {
    addModifier(s, { id: `deal-${def.id}`, kind: 'segBrand', target: `player:${a.seg}`, add: a.add, untilDay: FOREVER });
  } else if (a.kind === 'algo') {
    s.research.algoLevel += a.levels;
  }
  // trainSpeed и rlhfElo читаются из состояния (lateState.trainSpeedMult, newModelEloBonus).
}

/** Действие: купить стартап - деньги сразу, эффект навсегда. */
export function buyStartup(s: GameState, id: StartupId): Result {
  const error = buyStartupError(s, id);
  if (error) return { ok: false, error };
  const def = startupDef(id);
  spend(s, 'capex', def.price);
  lateOf(s).startups.push({ id, status: 'bought', day: s.day });
  applyStartup(s, def);
  addMail(s, {
    kind: 'finance',
    title: `${def.name} теперь ваша`,
    read: true,
    body: `Лаборатория купила ${def.name} за ${dealMoney(def.price)}: ${def.what}. ${def.effect}.`,
  });
  return { ok: true };
}

/** Ежедневно: новый стартап на продаже - письмо; срок вышел - его покупает соперник. */
function startupsDay(s: GameState): void {
  for (const def of STARTUPS) {
    const openDay = dateToDay(def.from);
    if (s.day === openDay) {
      addMail(s, {
        kind: 'finance',
        title: `${def.name} ищет покупателя`,
        body:
          `${def.name}: ${def.what}. Цена ${dealMoney(def.price)}, после покупки: ${def.effect.charAt(0).toLowerCase()}${def.effect.slice(1)}. ` +
          `Интерес проявляет ${labName(def.rival)}: если не купить до ${formatDate(openDay + OFFER_DAYS - 1)}, стартап уйдёт к ней. Купить можно в окне «Сделки».`,
      });
    }
    if (s.day === openDay + OFFER_DAYS) {
      const late = lateOf(s);
      if (late.startups.some((d) => d.id === def.id)) continue;
      late.startups.push({ id: def.id, status: 'rival', day: s.day, lab: def.rival });
      s.hype[def.rival] = Math.min(100, (s.hype[def.rival] ?? 0) + RIVAL_BUY_HYPE);
      addMail(s, {
        kind: 'rival',
        title: `${labName(def.rival)} купила ${def.name}`,
        body: `${def.name} досталась ${labName(def.rival)}: шумиха лаборатории выросла на ${RIVAL_BUY_HYPE}.`,
      });
    }
  }
}

// ---------- Облачная сделка ----------

const CLOUD_RENT_MOD = 'cloud-rent';
const CLOUD_CAP_MOD = 'cloud-cap';

/** Аренда прошлого закрытого месяца, $ (0 - месяцев ещё не было). */
function lastMonthRent(s: GameState): number {
  return s.finance.history.at(-1)?.expense.rent ?? 0;
}

export interface CloudTerms {
  monthly: number; // обязательный платёж в месяц
  until: number; // последний день сделки
}

/**
 * Условия сделки сегодня: обязательный платёж - доля аренды прошлого месяца уже со скидкой партнёра (те же карты
 * дешевле), но не меньше minMonthly. Срок - months месяцев от сегодня.
 */
export function cloudTerms(s: GameState, id: CloudId): CloudTerms {
  const def = cloudDef(id);
  const monthly = Math.max(def.minMonthly, Math.round((def.commit * lastMonthRent(s) * (1 - def.discount)) / 1e5) * 1e5);
  return { monthly, until: s.day + Math.round(def.months * DAYS_PER_MONTH) - 1 };
}

export function cloudSignError(s: GameState, id: CloudId): string | null {
  const closed = closedReason(s);
  if (closed) return closed;
  const late = lateOf(s);
  if (late.cloud) return `Уже действует сделка с ${cloudDef(late.cloud.id).name}.`;
  if (late.cloudPast.includes(id)) return `Сделка с ${cloudDef(id).name} уже была: второй раз партнёр её не предлагает.`;
  const { monthly } = cloudTerms(s, id);
  if (s.cash < monthly) return `${noMoney(monthly, s)} Первый платёж нужен на счету.`;
  return null;
}

function setCloudModifiers(s: GameState, id: CloudId, until: number): void {
  const def = cloudDef(id);
  addModifier(s, { id: CLOUD_RENT_MOD, kind: 'rentPrice', mult: 1 - def.discount, untilDay: until });
  addModifier(s, { id: CLOUD_CAP_MOD, kind: 'rentCap', mult: def.capMult, untilDay: until });
}

/** Действие: подписать сделку. Скидка и лимит действуют сразу, обязательный платёж считается в конце каждого месяца. */
export function signCloud(s: GameState, id: CloudId): Result {
  const error = cloudSignError(s, id);
  if (error) return { ok: false, error };
  const def = cloudDef(id);
  const terms = cloudTerms(s, id);
  lateOf(s).cloud = { id, since: s.day, until: terms.until, monthly: terms.monthly, shortfall: 0 };
  setCloudModifiers(s, id, terms.until);
  addMail(s, {
    kind: 'finance',
    title: `Сделка с ${def.name} подписана`,
    read: true,
    body:
      `До ${formatDate(terms.until)} аренда дешевле на ${Math.round(def.discount * 100)} %, лимит аренды выше ${timesText(def.capMult)}. ` +
      `Обязательный платёж ${dealMoney(terms.monthly)} в месяц: если аренда за месяц меньше, разница списывается.`,
  });
  return { ok: true };
}

/** «в 1,5 раза», «в 1,15 раза». */
function timesText(x: number): string {
  return `в ${String(Math.round(x * 100) / 100).replace('.', ',')} раза`;
}

/** Сколько месяцев сделки осталось (дробно, по дням). */
function cloudMonthsLeft(s: GameState): number {
  const c = s.late?.cloud;
  return c ? Math.max(0, (c.until - s.day + 1) / DAYS_PER_MONTH) : 0;
}

/** Плата за расторжение: CLOUD_EXIT_SHARE оставшихся обязательных платежей. */
export function cloudExitFee(s: GameState): number {
  const c = s.late?.cloud;
  return c ? Math.round(CLOUD_EXIT_SHARE * c.monthly * cloudMonthsLeft(s)) : 0;
}

function closeCloud(s: GameState): void {
  const late = lateOf(s);
  const c = late.cloud;
  if (!c) return;
  if (!late.cloudPast.includes(c.id)) late.cloudPast.push(c.id);
  late.cloud = null;
  s.modifiers = s.modifiers.filter((m) => m.id !== CLOUD_RENT_MOD && m.id !== CLOUD_CAP_MOD);
}

/** Действие: расторгнуть сделку раньше срока - плата за расторжение сразу, скидка и лимит пропадают. */
export function endCloud(s: GameState): Result {
  if (s.outcome) return { ok: false, error: 'Партия окончена.' };
  const c = s.late?.cloud;
  if (!c) return { ok: false, error: 'Облачной сделки нет.' };
  const fee = cloudExitFee(s);
  spend(s, 'capex', fee);
  const name = cloudDef(c.id).name;
  closeCloud(s);
  addMail(s, {
    kind: 'finance',
    title: `Сделка с ${name} расторгнута`,
    read: true,
    body: `Плата за расторжение ${dealMoney(fee)}. Аренда снова по обычной цене и в обычном лимите.`,
  });
  return { ok: true };
}

/** Сколько дней месяца, который заканчивается сегодня, попадает в отрезок from..to. */
function daysThisMonth(s: GameState, from: number, to: number): { days: number; total: number } {
  const total = dayToDate(s.day).day; // сегодня - последний день месяца
  const monthStart = s.day - total + 1;
  return { days: Math.max(0, Math.min(s.day, to) - Math.max(monthStart, from) + 1), total };
}

// ---------- Ежедневно и в конце месяца ----------

/** Ежедневно (после ходов соперников): стартапы на продаже, конец облачной сделки. */
export function dealsDay(s: GameState): void {
  if (s.day < DEALS_DAY) return;
  startupsDay(s);
  const c = s.late?.cloud;
  if (c && s.day > c.until) {
    const name = cloudDef(c.id).name;
    closeCloud(s);
    addMail(s, { kind: 'finance', title: `Сделка с ${name} закончилась`, body: 'Аренда снова по обычной цене и в обычном лимите.' });
  }
}

/**
 * Последний день месяца, до закрытия месяца: зарплата команд (за дни месяца в лаборатории) и недобор по облачной
 * сделке (обязательный платёж за дни сделки в этом месяце минус аренда месяца).
 */
export function dealsMonthEnd(s: GameState): void {
  const late = s.late;
  if (!late) return;
  let salary = 0;
  for (const t of late.teams) {
    const { days, total } = daysThisMonth(s, t.since, s.day);
    salary += (teamDef(t.id).salary * days) / total;
  }
  spend(s, 'overhead', salary);
  const c = late.cloud;
  if (c) {
    const { days, total } = daysThisMonth(s, c.since, c.until);
    const owed = (c.monthly * days) / total;
    const short = Math.round(owed - s.finance.month.expense.rent);
    if (short > 0) {
      spend(s, 'rent', short);
      c.shortfall += short;
      addMail(s, {
        kind: 'finance',
        title: `Доплата по сделке с ${cloudDef(c.id).name}: ${dealMoney(short)}`,
        body: `Аренда за месяц меньше обязательного платежа ${dealMoney(owed)}: разница списана. Сделка действует до ${formatDate(c.until)}.`,
      });
    }
  }
}

// ---------- Для окна «Сделки» ----------

const SEG_WHO: Record<string, string> = { consumers: 'обычных пользователей', enterprise: 'корпоративных клиентов', developers: 'разработчиков' };

/** Что сейчас дают сделки: короткие строки для полосы окна («Обучение быстрее на 35 %»). */
export function activeEffects(s: GameState): string[] {
  const late = s.late;
  if (!late) return [];
  const out: string[] = [];
  const train = Math.round((trainSpeedMult(s) - 1) * 100);
  if (train > 0) out.push(`Обучение быстрее на ${train} %`);
  if (hasTeam(s, 'research')) out.push(`Исследования дешевле на ${Math.round((1 - TEAM_RESEARCH_MULT) * 100)} %`);
  const elo = newModelEloBonus(s, true);
  if (elo > 0) out.push(`+${elo} Эло новым моделям с RLHF`);
  for (const d of late.startups) {
    if (d.status !== 'bought') continue;
    const a = startupDef(d.id).apply;
    if (a.kind === 'segBrand') out.push(`Бренд у ${SEG_WHO[a.seg]} +${String(a.add).replace('.', ',')}`);
  }
  if (late.cloud) {
    const def = cloudDef(late.cloud.id);
    out.push(`Аренда дешевле на ${Math.round(def.discount * 100)} %`);
    out.push(`Лимит аренды выше ${timesText(def.capMult)}`);
  }
  return out;
}

/** Обязательные расходы сделок в месяц: зарплата команд и платёж облака. */
export function dealsMonthly(s: GameState): { salary: number; cloud: number } {
  return { salary: teamsSalary(s), cloud: s.late?.cloud?.monthly ?? 0 };
}

/**
 * Облачная сделка в текущем месяце: аренда с начала месяца, обязательный платёж за весь месяц (за дни сделки)
 * и его часть, набежавшая к сегодняшнему дню (по ней видно, идёт ли аренда в темпе платежа). null - сделки нет.
 */
export function cloudMonth(s: GameState): { rent: number; owedMonth: number; owedToDate: number } | null {
  const c = s.late?.cloud;
  if (!c) return null;
  const d = dayToDate(s.day);
  const monthStart = s.day - d.day + 1;
  const total = new Date(Date.UTC(d.year, d.month, 0)).getUTCDate();
  const monthEnd = monthStart + total - 1;
  const from = Math.max(monthStart, c.since);
  const daysMonth = Math.max(0, Math.min(monthEnd, c.until) - from + 1);
  const daysToDate = Math.max(0, Math.min(s.day, c.until) - from + 1);
  return {
    rent: s.finance.month.expense.rent,
    owedMonth: (c.monthly * daysMonth) / total,
    owedToDate: (c.monthly * daysToDate) / total,
  };
}
