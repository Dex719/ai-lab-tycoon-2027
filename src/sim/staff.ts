// Сотрудники (окно «Команда»): кандидаты раз в месяц, найм, опыт и повышение, зарплаты, уход и переманивание.
// Эффекты ролей - в staffEffects.ts. Случайность - свой поток staff.rng: найм не сдвигает остальные события партии.

import { LABS } from '../data/labs';
import { addMail, triggerEvent } from './events';
import { spend } from './finance';
import { LAB_STAGES, labStage } from './labStage';
import { nextRandom } from './rng';
import { findRivalDef } from './rivals';
import {
  levelCap,
  POTENTIAL_INFO,
  type StaffPotential,
  emptyStaff,
  LEVEL_NAMES,
  LEVEL_NAMES_GEN,
  ROLE_INFO,
  STAFF_ROLES,
  isWorking,
  type Candidate,
  type Employee,
  type StaffRole,
  type StaffState,
  type StaffTrait,
  staffEffect,
} from './staffEffects';
import { endSentence, ruPlural } from './text';
import { formatDateShort, isMonthStart, lerpByDate } from './time';
import type { EventDef } from '../data/events';
import type { GameState, Result } from './types';

/** Мест для сотрудников по этапу лаборатории: гараж, офис, этаж, кампус. */
export const STAFF_SEATS = [4, 12, 40, 150] as const;
/** Зарплата в месяц в 2017 году по уровням; дальше растёт по WAGE_GROWTH. */
// Близко к рынку ML-специалистов 2017 года: найм - заметная статья расходов рядом с арендой, а не мелочь.
const LEVEL_SALARY = [8_000, 15_000, 28_000, 50_000] as const;
const WAGE_GROWTH: [string, number][] = [
  ['2017-01-01', 1],
  ['2020-01-01', 1.7],
  ['2023-01-01', 3.2],
  ['2024-12-31', 4.5],
];
/** Месяцев до следующего уровня: джуниор → мидл, мидл → сеньор, сеньор → ведущий. */
export const XP_MONTHS = [12, 18, 30] as const;
export const FAST_XP = 1.7;
/** «Просит долю»: зарплата ×0,7, при найме доля основателя уменьшается на 0,2 %. */
const EQUITY_SALARY = 0.7;
export const EQUITY_SHARE = 0.002;
/** Через сколько дней выходит на работу кандидат по уровню. */
const WAIT_DAYS = [7, 14, 21, 30] as const;
export const CANDIDATES_PER_MONTH = 4;
/** Готов к повышению, но не повышен столько дней - уходит. */
export const READY_QUIT_DAYS = 150;
/** Выходное пособие при увольнении - зарплата за месяц. */
export const SEVERANCE_MONTHS = 1;
/** Удержать переманиваемого - премия в 4 зарплаты, после этого год не переманивают. */
export const RETAIN_MONTHS = 4;
const RETAIN_DAYS = 365;
const POACH_CHANCE = 0.05; // в месяц на каждого сеньора и ведущего
const POACH_COOLDOWN = 120;

/** Имена кандидатов: одно имя не повторяется, пока список не исчерпан. */
const NAMES = [
  'Анна Соколова', 'Дмитрий Ким', 'Лейла Ахмедова', 'Игорь Петров', 'Мария Чен', 'Алексей Орлов', 'Нурлан Сейтов', 'Ольга Белова',
  'Тимур Каримов', 'Сергей Волков', 'Дана Абенова', 'Рустам Алиев', 'Елена Морозова', 'Павел Ли', 'Айгерим Жумабаева', 'Иван Смирнов',
  'Камила Юсупова', 'Артём Новиков', 'Софья Лебедева', 'Ержан Касымов', 'Виктория Ким', 'Максим Фёдоров', 'Алина Гарипова', 'Денис Ворон',
  'Асель Нурланова', 'Кирилл Зайцев', 'Полина Егорова', 'Арман Бекова', 'Юлия Михайлова', 'Глеб Соловьёв', 'Диана Исаева', 'Олжас Ахметов',
  'Екатерина Павлова', 'Роман Голубев', 'Мадина Сулейменова', 'Никита Кузнецов', 'Вера Григорьева', 'Данияр Омаров', 'Ксения Романова',
  'Станислав Ли', 'Амина Хасанова', 'Борис Шевцов', 'Жанна Тулегенова', 'Евгений Медведев', 'Алия Садыкова', 'Михаил Чжан', 'Татьяна Котова',
  'Санжар Ибраев', 'Наталья Ершова', 'Георгий Мамедов',
];

/** Состояние команды; в старых сохранениях его нет - заводится пустым. */
export function staffOf(s: GameState): StaffState {
  if (!s.staff) s.staff = emptyStaff(s.seed);
  return s.staff;
}

/** Множитель зарплат года: специалисты дорожают вместе с отраслью. */
export function wageMult(day: number): number {
  return lerpByDate(WAGE_GROWTH, day);
}

export function levelSalary(level: number, day: number, trait: StaffTrait | null, potential: StaffPotential = 'mid'): number {
  const base = LEVEL_SALARY[Math.max(0, Math.min(3, level))] * wageMult(day) * POTENTIAL_INFO[potential].salary;
  return Math.round((trait === 'equity' ? base * EQUITY_SALARY : base) / 100) * 100;
}

/** Курс обучения (прокачка): стоит COURSE_MONTHS зарплат, даёт COURSE_XP опыта × потенциал; не чаще раза в COURSE_COOLDOWN дней. */
export const COURSE_MONTHS = 2;
export const COURSE_XP = 0.35;
export const COURSE_COOLDOWN = 90;

export function courseCost(e: Employee): number {
  return e.salary * COURSE_MONTHS;
}

/** Сколько опыта даст курс (доля шага до следующего уровня). */
export function courseXp(e: Employee): number {
  return COURSE_XP * POTENTIAL_INFO[e.potential ?? 'mid'].course;
}

/** Почему курс сейчас недоступен (или null). */
export function courseBlock(s: GameState, e: Employee): string | null {
  if (!isWorking(e, s.day)) return 'Сотрудник ещё не вышел на работу';
  if (e.level >= levelCap(e)) return `Потолок: выше уровня «${LEVEL_NAMES[e.level]}» не вырастет`;
  if (e.xp >= 1) return 'Опыта уже хватает: сначала повысьте';
  const since = s.day - (e.lastCourseDay ?? -100_000);
  if (since < COURSE_COOLDOWN) return `Следующий курс - через ${ruDays(COURSE_COOLDOWN - since)}`;
  if (courseCost(e) > s.cash) return `Не хватает денег: курс стоит ${money(courseCost(e))}`;
  return null;
}

/** Действие: отправить на курс - опыт растёт сразу, деньги списываются. */
export function trainEmployee(s: GameState, id: string): Result {
  const e = staffOf(s).people.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Сотрудника уже нет в лаборатории' };
  const block = courseBlock(s, e);
  if (block) return { ok: false, error: block };
  spend(s, 'overhead', courseCost(e));
  e.lastCourseDay = s.day;
  e.xp = Math.min(1, e.xp + courseXp(e));
  if (e.xp >= 1) e.readyDay = s.day;
  return { ok: true };
}

/** Вывод о росте: top - высший уровень, capped - потолок потенциала, worth / normal / slow - растёт с высоким, средним, низким потенциалом. */
export type GrowthVerdict = 'worth' | 'normal' | 'slow' | 'capped' | 'top';

export function growthVerdict(e: { level: number; potential?: StaffPotential }): GrowthVerdict {
  if (e.level >= 3) return 'top';
  if (e.level >= levelCap(e)) return 'capped';
  const p = e.potential ?? 'mid';
  return p === 'high' ? 'worth' : p === 'low' ? 'slow' : 'normal';
}

/** Месяцев работы до следующего уровня при нынешнем опыте (без курсов); null - расти некуда. */
export function monthsToNext(e: Employee): number | null {
  if (e.level >= levelCap(e)) return null;
  const rate = POTENTIAL_INFO[e.potential ?? 'mid'].growth * (e.trait === 'fast' ? FAST_XP : 1);
  return Math.max(0, Math.ceil(((1 - Math.min(1, e.xp)) * XP_MONTHS[e.level]) / rate));
}

/** Эффект роли, если заменить состав команды (для «что даст повышение / найм»). */
function effectWith(s: GameState, role: StaffRole, people: Employee[]): number {
  const st = staffOf(s);
  return staffEffect({ day: s.day, staff: { ...st, people } }, role);
}

/** На сколько вырастет эффект роли, если повысить сотрудника (доля, 0,021 = +2,1 %). Считается как будто он уже работает. */
export function promotionGain(s: GameState, e: Employee): number {
  const people = staffOf(s).people.map((x) => (x.id === e.id ? { ...x, startDay: Math.min(x.startDay, s.day) } : x));
  const after = people.map((x) => (x.id === e.id ? { ...x, level: x.level + 1 } : x));
  return effectWith(s, e.role, after) - effectWith(s, e.role, people);
}

/** На сколько вырастет эффект роли с этим кандидатом (когда выйдет на работу). */
export function hireGain(s: GameState, c: Candidate): number {
  const people = staffOf(s).people;
  const added: Employee = { id: 'tmp', name: c.name, role: c.role, level: c.level, xp: 0, salary: c.salary, trait: c.trait, potential: c.potential, startDay: s.day, readyDay: null };
  return effectWith(s, c.role, [...people, added]) - effectWith(s, c.role, people);
}

export function staffSeats(s: GameState): number {
  return STAFF_SEATS[labStage(s)] ?? STAFF_SEATS[0];
}

/** Название этапа, где мест больше (для подсказки «больше мест - ...»), или null на последнем этапе. */
export function nextSeatsStage(s: GameState): string | null {
  const next = LAB_STAGES[labStage(s) + 1];
  return next ? next.name : null;
}

/** Зарплаты всех нанятых в месяц (и тех, кто ещё не вышел: им платят с выхода). */
export function payrollMonthly(s: GameState): number {
  return (s.staff?.people ?? []).reduce((a, e) => a + e.salary, 0);
}

function rand(st: StaffState): number {
  return nextRandom(st);
}

function pickIndex(st: StaffState, n: number): number {
  return Math.min(n - 1, Math.floor(rand(st) * n));
}

/** Уровень кандидата: в гараже - в основном джуниоры и мидлы, с ростом лаборатории приходят сеньоры и ведущие. */
function candidateLevel(st: StaffState, stage: number): number {
  const weights = [
    [0.6, 0.3, 0.1, 0],
    [0.4, 0.35, 0.2, 0.05],
    [0.3, 0.35, 0.25, 0.1],
    [0.25, 0.3, 0.3, 0.15],
  ][Math.max(0, Math.min(3, stage))];
  let x = rand(st);
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return 0;
}

function freeName(st: StaffState): string {
  const used = new Set([...st.people.map((e) => e.name), ...st.candidates.map((c) => c.name)]);
  const free = NAMES.filter((n) => !used.has(n));
  const list = free.length > 0 ? free : NAMES;
  return list[pickIndex(st, list.length)];
}

/** Новые кандидаты в начале месяца: прежние, кого не наняли, уходят к другим. */
export function refreshCandidates(s: GameState): void {
  const st = staffOf(s);
  const stage = labStage(s);
  st.candidates = [];
  const end = nextMonthStart(s.day) - 1;
  for (let i = 0; i < CANDIDATES_PER_MONTH; i++) {
    const level = candidateLevel(st, stage);
    const t = rand(st);
    const trait: StaffTrait | null = t < 0.22 ? 'fast' : t < 0.36 ? 'equity' : null;
    const p = rand(st);
    const potential: StaffPotential = p < 0.3 ? 'low' : p < 0.75 ? 'mid' : 'high';
    // Роли по кругу со сдвигом: в каждом месяце хотя бы три разные роли.
    const role = STAFF_ROLES[(pickIndex(st, STAFF_ROLES.length) + i) % STAFF_ROLES.length];
    st.candidates.push({
      id: `c${st.nextId++}`,
      name: freeName(st),
      role,
      level,
      salary: levelSalary(level, s.day, trait, potential),
      potential,
      trait,
      wait: WAIT_DAYS[level],
      expiresDay: end,
    });
  }
}

function nextMonthStart(day: number): number {
  let d = day + 1;
  while (!isMonthStart(d)) d++;
  return d;
}

/** Почему нельзя нанять (или null). */
export function hireBlock(s: GameState, c: Candidate | undefined): string | null {
  if (!c) return 'Кандидат уже ушёл к другим';
  const st = staffOf(s);
  if (st.people.length >= staffSeats(s)) {
    const next = nextSeatsStage(s);
    return `Мест нет: ${staffSeats(s)} из ${staffSeats(s)}${next ? `, больше мест - когда лаборатория вырастет до этапа «${next}»` : ''}`;
  }
  return null;
}

/** Действие: нанять кандидата. Выходит на работу через c.wait дней; «просит долю» - доля основателя −0,2 %. */
export function hireCandidate(s: GameState, id: string): Result {
  const st = staffOf(s);
  const c = st.candidates.find((x) => x.id === id);
  const block = hireBlock(s, c);
  if (block || !c) return { ok: false, error: block ?? 'Кандидат уже ушёл к другим' };
  st.candidates = st.candidates.filter((x) => x.id !== id);
  st.people.push({
    id: `e${st.nextId++}`,
    name: c.name,
    role: c.role,
    level: c.level,
    xp: 0,
    salary: c.salary,
    trait: c.trait,
    potential: c.potential ?? 'mid',
    startDay: s.day + c.wait,
    readyDay: null,
  });
  if (c.trait === 'equity') s.founderShare *= 1 - EQUITY_SHARE;
  return { ok: true };
}

/** Действие: уволить (выходное пособие - зарплата за месяц). */
export function fireEmployee(s: GameState, id: string): Result {
  const st = staffOf(s);
  const e = st.people.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Сотрудника уже нет в лаборатории' };
  spend(s, 'overhead', e.salary * SEVERANCE_MONTHS);
  st.people = st.people.filter((x) => x.id !== id);
  if (st.poach?.employeeId === id) st.poach = null;
  return { ok: true };
}

/** Зарплата после повышения. */
export function promotedSalary(s: GameState, e: Employee): number {
  return Math.max(e.salary, levelSalary(e.level + 1, s.day, e.trait, e.potential ?? 'mid'));
}

/** Действие: повысить готового к повышению. */
export function promoteEmployee(s: GameState, id: string): Result {
  const e = staffOf(s).people.find((x) => x.id === id);
  if (!e) return { ok: false, error: 'Сотрудника уже нет в лаборатории' };
  if (e.level >= levelCap(e)) return { ok: false, error: `Потолок: выше уровня «${LEVEL_NAMES[e.level]}» не вырастет` };
  if (e.xp < 1) return { ok: false, error: `Опыта ещё мало: до уровня «${LEVEL_NAMES[e.level + 1]}» нужно поработать` };
  e.salary = promotedSalary(s, e);
  e.level += 1;
  e.xp = 0;
  e.readyDay = null;
  return { ok: true };
}

/** Ежедневно: зарплаты; в начале месяца - кандидаты, опыт, уход неповышенных и переманивание. */
export function staffDay(s: GameState): void {
  const st = staffOf(s);
  let pay = 0;
  for (const e of st.people) if (isWorking(e, s.day)) pay += e.salary / 30;
  spend(s, 'overhead', pay);
  if (!isMonthStart(s.day)) return;
  refreshCandidates(s);
  growExperience(s, st);
  quitUnpromoted(s, st);
  maybePoach(s, st);
}

function growExperience(s: GameState, st: StaffState): void {
  for (const e of st.people) {
    // На потолке опыт не растёт: дальше этого уровня сотрудник не вырастет (потенциал).
    if (!isWorking(e, s.day) || e.level >= levelCap(e) || e.xp >= 1) continue;
    const growth = POTENTIAL_INFO[e.potential ?? 'mid'].growth * (e.trait === 'fast' ? FAST_XP : 1);
    e.xp = Math.min(1, e.xp + (1 / XP_MONTHS[e.level]) * growth);
    if (e.xp >= 1) {
      e.readyDay = s.day;
      addMail(s, {
        kind: 'news',
        title: `Можно повысить: ${e.name}`,
        body:
          `Опыта хватает для уровня «${LEVEL_NAMES[e.level + 1]}» (${ROLE_INFO[e.role].name.toLowerCase()}). ` +
          `Повышение в окне «Команда»: зарплата станет ${money(promotedSalary(s, e))} в месяц, вклад в команду вырастет. ` +
          `Без повышения за ${ruDays(READY_QUIT_DAYS)} сотрудник уйдёт к тем, кто повысит.`,
      });
    }
  }
}

function quitUnpromoted(s: GameState, st: StaffState): void {
  for (const e of [...st.people]) {
    if (e.readyDay === null || s.day - e.readyDay < READY_QUIT_DAYS) continue;
    st.people = st.people.filter((x) => x.id !== e.id);
    addMail(s, {
      kind: 'news',
      important: true,
      title: `Из команды ушли: ${e.name}`,
      body: `Повышения до уровня «${LEVEL_NAMES[e.level + 1]}» (${ROLE_INFO[e.role].name.toLowerCase()}) ждали с ${formatDateShort(e.readyDay)}. Его не было, и теперь ${e.name} работает у другого работодателя.`,
    });
  }
}

function maybePoach(s: GameState, st: StaffState): void {
  if (st.poach || s.day - st.lastPoachDay < POACH_COOLDOWN) return;
  const targets = st.people.filter((e) => isWorking(e, s.day) && e.level >= 2 && (e.retainedUntil ?? -1) < s.day);
  for (const e of targets) {
    if (rand(st) >= POACH_CHANCE) continue;
    // Только лаборатории, которые уже на рынке: будущее не раскрываем (Antropik в 2018 году - ошибка).
    const present = LABS.filter((l) => s.rivalsReleased.some((id) => findRivalDef(id)?.lab === l.id));
    const pool = present.length > 0 ? present : LABS.filter((l) => l.id === 'openbrain' || l.id === 'gogle');
    startPoach(s, e.id, pool[pickIndex(st, pool.length)].name);
    return;
  }
}

/** Соперник переманивает сотрудника: письмо с выбором «удержать / отпустить». */
export function startPoach(s: GameState, employeeId: string, lab: string): void {
  const st = staffOf(s);
  st.poach = { employeeId, lab };
  st.lastPoachDay = s.day;
  triggerEvent(s, STAFF_POACH_ID);
}

/** Сотрудник, которого переманивают сейчас (для письма с выбором). */
export function poachTarget(s: GameState): Employee | null {
  const st = s.staff;
  if (!st?.poach) return null;
  return st.people.find((e) => e.id === st.poach!.employeeId) ?? null;
}

export function retainCost(e: Employee | null): number {
  return e ? e.salary * RETAIN_MONTHS : 0;
}

export const STAFF_POACH_ID = 'staff-poach';

/** Удержать: премия, год не переманивают. */
export function retainPoached(s: GameState): void {
  const e = poachTarget(s);
  if (e) {
    spend(s, 'overhead', retainCost(e));
    e.retainedUntil = s.day + RETAIN_DAYS;
  }
  if (s.staff) s.staff.poach = null;
}

/** Отпустить: уходит к сопернику. */
export function releasePoached(s: GameState): void {
  const e = poachTarget(s);
  if (e && s.staff) s.staff.people = s.staff.people.filter((x) => x.id !== e.id);
  if (s.staff) s.staff.poach = null;
}

function money(n: number): string {
  const dec = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
  if (n >= 1e6 - 500) return `$${dec(n / 1e6)} млн`;
  if (n >= 1e3 - 0.5) return `$${dec(n / 1e3)} тыс.`;
  return `$${Math.round(n)}`;
}

function ruDays(n: number): string {
  return `${n} ${ruPlural(n, 'день', 'дня', 'дней')}`;
}

/** Текст письма о переманивании. */
export function poachMailText(s: GameState): { title: string; body: string } {
  const e = poachTarget(s);
  const lab = s.staff?.poach?.lab ?? 'Соперник';
  if (!e) return { title: `${lab} переманивает сотрудника`, body: 'Сотрудника уже нет в лаборатории.' };
  return {
    title: `${lab} переманивает: ${e.name}`,
    body: endSentence(
      `${lab} предлагает сотруднику ${e.name} (${LEVEL_NAMES[e.level].toLowerCase()}, ${ROLE_INFO[e.role].name.toLowerCase()}) вдвое больше. ` +
        `Удержать стоит ${money(retainCost(e))} (премия в ${RETAIN_MONTHS} зарплаты), после этого год не переманят. ` +
        `Если отпустить, команда потеряет вклад ${LEVEL_NAMES_GEN[e.level]}`,
    ),
  };
}

/** Письмо с выбором о переманивании (findEvent в data/events.ts). Вариант 0 - удержать, по умолчанию - отпустить. */
export const STAFF_EVENTS: EventDef[] = [
  {
    id: STAFF_POACH_ID,
    repeatable: true,
    when: { check: () => false },
    defaultChoice: 1,
    mail: (s) => ({ kind: 'rival', ...poachMailText(s) }),
    choices: [
      {
        label: 'Удержать',
        story: 'Сотрудник остаётся за премию, год его не переманят',
        hint: 'премия в 4 зарплаты',
        hintFn: (s) => `${money(retainCost(poachTarget(s)))}, сотрудник остаётся`,
        apply: retainPoached,
      },
      {
        label: 'Отпустить',
        story: 'Сотрудник уходит к сопернику, вклад в команду пропадает',
        hint: 'сотрудник уходит',
        apply: releasePoached,
      },
    ],
  },
];
