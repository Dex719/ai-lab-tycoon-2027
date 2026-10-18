// Сохранения: состояние целиком в JSON, включая генератор случайных чисел (FR-13).
// При загрузке форма состояния проверяется целиком, до самых вложенных полей: сохранение от старой версии игры
// или битый файл отклоняются понятной ошибкой, а не роняют тик и отрисовку позже (например, нет нового бенчмарка).

import type { StaffState } from './staffEffects';
import { DC_SITE_IDS } from '../data/datacenters';
import { findEvent } from '../data/events';
import { CHAT_MOMENT_DATE, CHOICE_DAYS, FAIL_CHOICE_DAYS, HYPE_OWNERS, TIER_SUBS_PRICE } from './constants';
import { DIFFICULTY_IDS, emptyRivalry, LEVERS, MOVE_IDS } from './rivalry';
import type { ActiveMove, HistoryRow, LabMemory, PendingMove, RivalOverride, RivalryState } from './rivalry';
import { CLOUD_IDS, STARTUP_IDS, TEAM_IDS } from './lateState';
import type { DuelLab, DuelState } from './duel';
import type { CloudDeal, FinalPush, FinaleState, FinalUpdate, FinalUpdateDone, LateState, StarTeam, StartupDeal } from './lateState';
import { emptyMarket, emptyQuests, emptySegmentShares, emptyYearly } from './state';
import { dateToDay } from './time';
import { tierOf } from './training';
import type {
  Contract,
  Datacenter,
  GoalOffer,
  DcOrder,
  PendingRound,
  ExpenseKind,
  GameState,
  IncomeKind,
  Mail,
  MailChoice,
  Modifier,
  ModifierKind,
  MonthLedger,
  MonthRecord,
  PlayerModel,
  QuestState,
  SegmentShares,
  TaskState,
  TechId,
  Tender,
  Tier,
  TrainingPlan,
  TrainingRun,
  YearGoalResult,
  YearGoalState,
  YearlyState,
  YearReview,
} from './types';
import { BENCHMARK_IDS, COUNTRY_IDS, DOMAINS, GPU_IDS, LAB_IDS, REVIEW_STATES, SEGMENT_IDS, TECH_IDS, TIER_IDS } from './types';

export const SAVE_KEY = 'ailab.save.v1';
export const AUTOSAVE_KEY = 'ailab.autosave.v1';

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

// ---------- Проверка формы ----------

/** Где именно сохранение не подошло: путь к полю и признак «поля нет вовсе». */
interface Problem {
  path: string;
  missing: boolean;
}

/** Проверка значения v по пути path: null - всё в порядке. Для отсутствующего поля v === undefined. */
type Check = (v: unknown, path: string) => Problem | null;

const bad = (path: string): Problem => ({ path, missing: false });
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Конечное число: NaN и бесконечность в JSON превращаются в null, так что порча числа ловится здесь. */
const num: Check = (v, p) => (typeof v === 'number' && Number.isFinite(v) ? null : bad(p));
const nonNeg: Check = (v, p) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : bad(p));
const int: Check = (v, p) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? null : bad(p));
const posInt: Check = (v, p) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? null : bad(p));
const str: Check = (v, p) => (typeof v === 'string' ? null : bad(p));
const bool: Check = (v, p) => (typeof v === 'boolean' ? null : bad(p));
const literal =
  (expected: unknown): Check =>
  (v, p) =>
    v === expected ? null : bad(p);
const oneOf =
  (allowed: readonly string[]): Check =>
  (v, p) =>
    typeof v === 'string' && allowed.includes(v) ? null : bad(p);
const nullable =
  (c: Check): Check =>
  (v, p) =>
    v === null ? null : c(v, p);
/** Поле может отсутствовать (в JSON undefined пропадает), но если оно есть, должно подойти. */
const optional =
  (c: Check): Check =>
  (v, p) =>
    v === undefined ? null : c(v, p);

const arrayOf =
  (c: Check): Check =>
  (v, p) => {
    if (!Array.isArray(v)) return bad(p);
    for (let i = 0; i < v.length; i++) {
      const r = c(v[i], `${p}[${i}]`);
      if (r) return r;
    }
    return null;
  };

const join = (parent: string, key: string): string => (parent ? `${parent}.${key}` : key);

/** Объект с заранее известными полями. Лишние поля не мешают (они могут прийти из более новой версии). */
function shape(fields: Record<string, Check>): Check {
  return (v, p) => {
    if (!isRec(v)) return v === undefined ? { path: p, missing: true } : bad(p);
    for (const [key, check] of Object.entries(fields)) {
      const path = join(p, key);
      const value = v[key];
      const r = check(value, path);
      // Не подошло значение, которого нет вовсе, - значит, поля нет.
      if (r) return value === undefined ? { path, missing: true } : r;
    }
    return null;
  };
}

/** То же, что shape, но TypeScript требует перечислить каждое поле типа T: добавили поле в тип, не добавили сюда - ошибка сборки. */
function shapeOf<T>(fields: { [K in keyof T]-?: Check }): Check {
  return shape(fields as Record<string, Check>);
}

/** Объект, у которого обязательно есть каждый ключ из keys (идентификаторы GPU, бенчмарков и т. п.), а значения подходят под c. */
function record(keys: readonly string[], c: Check): Check {
  return shape(Object.fromEntries(keys.map((k) => [k, c])));
}

/** Объект с любыми ключами, значения которого подходят под c (флаги, доли рынка). */
const dict =
  (c: Check): Check =>
  (v, p) => {
    if (!isRec(v)) return v === undefined ? { path: p, missing: true } : bad(p);
    for (const [key, value] of Object.entries(v)) {
      const r = c(value, join(p, key));
      if (r) return r;
    }
    return null;
  };

/** Ключи записи, перечисленные в типе: пропустить значение в Record<T, true> нельзя, поэтому список не отстанет от типа. */
const keysOf = <T extends string>(rec: Record<T, true>): T[] => Object.keys(rec) as T[];

const MAIL_KINDS = keysOf<Mail['kind']>({
  news: true,
  event: true,
  rival: true,
  research: true,
  training: true,
  contract: true,
  finance: true,
  benchmark: true,
});

const MODIFIER_KINDS = keysOf<ModifierKind>({
  rentPrice: true,
  rentCap: true,
  demand: true,
  researchCost: true,
  labBrand: true,
  rivalPrice: true,
  exposure: true,
  segBrand: true,
  subsDemand: true,
  apiHold: true,
});

const ARCHS = ['lstm', 'transformer'];

const trainingPlan = shapeOf<TrainingPlan>({
  name: str,
  paramsB: num,
  tokensB: num,
  mix: record(DOMAINS, num),
  benchShare: num,
  benchTargets: arrayOf(oneOf(BENCHMARK_IDS)),
  rlhf: bool,
  context: num,
  tier: oneOf(TIER_IDS),
  stolenData: optional(bool),
});

const trainingRun = shapeOf<TrainingRun>({
  id: str,
  failed: bool,
  plan: trainingPlan,
  arch: oneOf(ARCHS),
  algoLevel: num,
  techs: optional(arrayOf(oneOf(TECH_IDS))),
  flopTotal: num,
  flopDone: num,
  startedDay: num,
  failAtFraction: nullable(num),
  failPenalty: num,
});

const playerModel = shapeOf<PlayerModel>({
  id: str,
  name: str,
  plan: trainingPlan,
  arch: oneOf(ARCHS),
  algoLevel: num,
  techs: optional(arrayOf(oneOf(TECH_IDS))),
  trainedDay: num,
  releasedDay: nullable(num),
  caps: record(DOMAINS, num),
  overfit: dict(num),
  rlhf: bool,
  arenaElo: num,
  price: num,
  onApi: bool,
  exposed: bool,
  earned: num,
  onSubs: bool,
  subsPrice: num,
  review: oneOf(REVIEW_STATES),
  reviewEndDay: nullable(num),
  earnedSubs: num,
  stolenCaught: optional(bool),
});

const tender = shapeOf<Tender>({
  id: str,
  clientId: str,
  type: oneOf(['finetune', 'rlhf']),
  benchmark: oneOf(BENCHMARK_IDS),
  requirement: num,
  work: num,
  durationDays: num,
  payment: num,
  penalty: num,
  appearedDay: num,
  expiresDay: num,
  application: nullable(
    shapeOf<NonNullable<Tender['application']>>({ modelId: str, appliedDay: num, resolveDay: num, chance: num, auto: optional(bool), work: optional(num) }),
  ),
});

const contract = shapeOf<Contract>({
  id: str,
  tender,
  modelId: str,
  startedDay: num,
  deadlineDay: num,
  workDone: num,
  warned: optional(bool),
});

const mailChoice = shapeOf<MailChoice>({ label: str, hint: str, story: optional(str) });

const mail = shapeOf<Mail>({
  id: str,
  day: num,
  title: str,
  body: str,
  kind: oneOf(MAIL_KINDS),
  read: bool,
  eventId: optional(str),
  choices: optional(arrayOf(mailChoice)),
  chosen: optional(int),
  important: optional(bool),
  replyByDay: optional(num),
  defaultChoice: optional(int),
  deferred: optional(bool),
  autoChosen: optional(bool),
  outcome: optional(shapeOf<NonNullable<Mail['outcome']>>({ lucky: bool, text: str })),
  reward: optional(bool),
  from: optional(oneOf(LAB_IDS)),
});

const modifier = shapeOf<Modifier>({
  id: str,
  kind: oneOf(MODIFIER_KINDS),
  target: optional(str),
  mult: optional(num),
  add: optional(num),
  untilDay: num,
});

const income = shapeOf<Record<IncomeKind, number>>({ api: num, subs: num, contracts: num, investors: num });
const expense = shapeOf<Record<ExpenseKind, number>>({
  rent: num,
  overhead: num,
  labelers: num,
  penalties: num,
  review: num,
  capex: num,
  power: num,
});

const ledger = shapeOf<MonthLedger>({ income, expense });

const monthRecord = shapeOf<MonthRecord>({
  income,
  expense,
  year: num,
  month: num,
  cashEnd: num,
  marketShare: num,
  tokensPerDay: num,
  subscribers: num,
  eloMine: optional(num),
  eloRival: optional(num),
  placeEnd: optional(nullable(num)),
  prices: optional(dict(num)),
});

const labShares = record([...HYPE_OWNERS, 'none'], num);

const segmentShares = shapeOf<SegmentShares>({ shares: dict(num), labShares, total: num });

// Соперники с характерами: ходы, поправки к моделям соперников и память лабораторий (rivalry.ts).
const pendingMove = shapeOf<PendingMove>({
  id: str,
  lab: oneOf(LAB_IDS),
  move: oneOf(MOVE_IDS),
  fireDay: num,
  modelId: optional(str),
});

const activeMove = shapeOf<ActiveMove>({ lab: oneOf(LAB_IDS), move: oneOf(MOVE_IDS), untilDay: num });

const rivalOverride = shapeOf<RivalOverride>({
  dayShift: optional(num),
  eloAdd: optional(num),
  context: optional(num),
  price: optional(num),
});

const labMemory = shapeOf<LabMemory>({
  lastMove: nullable(oneOf(MOVE_IDS)),
  firedDay: num,
  shareBefore: num,
  priceBefore: num,
  worked: nullable(bool),
  priceMatched: bool,
});

const historyRow = shapeOf<HistoryRow>({ day: num, lab: oneOf(LAB_IDS), move: oneOf(MOVE_IDS), text: str });

const rivalry = shapeOf<RivalryState>({
  heat: record(LAB_IDS, num),
  cooldownUntil: record(LAB_IDS, num),
  moveCooldown: dict(num),
  pending: arrayOf(pendingMove),
  active: arrayOf(activeMove),
  overrides: dict(rivalOverride),
  extra: dict(num),
  extraCount: record(LAB_IDS, num),
  memory: record(LAB_IDS, labMemory),
  lever: nullable(oneOf(LEVERS)),
  choice: nullable(shape({ lab: oneOf(LAB_IDS), modelId: optional(str), team: optional(oneOf(TEAM_IDS)) })),
  history: arrayOf(historyRow),
  shareHigh: record(LAB_IDS, num),
});

// Свои дата-центры (datacenters.ts).
const dcOrder = shapeOf<DcOrder>({ gpu: oneOf(GPU_IDS), count: int, arriveDay: num });

const datacenter = shapeOf<Datacenter>({
  site: oneOf(DC_SITE_IDS),
  mw: num,
  startedDay: num,
  stage: int,
  stageEndDay: num,
  delayDays: num,
  stageDelay: num,
  paid: num,
  gpus: record(GPU_IDS, int),
  orders: arrayOf(dcOrder),
});

// Цели года, итоги и расписание случайных событий (sim/goals.ts, sim/randomEvents.ts).
const yearGoal = shapeOf<YearGoalState>({ id: str, done: bool, doneDay: nullable(num), base: num, target: optional(num), param: optional(str) });

const yearGoalResult = shapeOf<YearGoalResult>({ title: str, style: str, done: bool, text: str, miss: str, prize: str, penalty: str });

const yearReview = shapeOf<YearReview>({
  year: int,
  revenue: num,
  expense: num,
  models: int,
  bestRank: nullable(num),
  share: num,
  goalsDone: int,
  goalsTotal: int,
  cash: num,
  comment: str,
  seen: bool,
  results: optional(arrayOf(yearGoalResult)),
});

const yearly = shapeOf<YearlyState>({
  year: int,
  goals: arrayOf(yearGoal),
  reviews: arrayOf(yearReview),
  rng: int,
  nextEventDay: num,
  eventUnit: nonNeg,
  lastFired: dict(num),
});

// Поздняя игра: сделки и финальный квартал (lateState.ts). Поле необязательное: в старых сохранениях его нет.
const finalPush = shapeOf<FinalPush>({
  lab: oneOf(LAB_IDS),
  modelId: str,
  kind: oneOf(['update', 'release']),
  announceDay: num,
  fireDay: num,
  base: num,
  target: num,
  playerElo: num,
  fired: bool,
});

const late = shapeOf<LateState>({
  teams: arrayOf(shapeOf<StarTeam>({ id: oneOf(TEAM_IDS), since: num })),
  startups: arrayOf(
    shapeOf<StartupDeal>({ id: oneOf(STARTUP_IDS), status: oneOf(['bought', 'rival']), day: num, lab: optional(oneOf(LAB_IDS)) }),
  ),
  cloud: nullable(shapeOf<CloudDeal>({ id: oneOf(CLOUD_IDS), since: num, until: num, monthly: nonNeg, shortfall: nonNeg })),
  cloudPast: arrayOf(oneOf(CLOUD_IDS)),
  finale: shapeOf<FinaleState>({
    pushes: arrayOf(finalPush),
    announced: arrayOf(str),
    checks: int,
    update: nullable(shapeOf<FinalUpdate>({ modelId: str, startDay: num, endDay: num, gain: num, cost: nonNeg })),
    done: arrayOf(shapeOf<FinalUpdateDone>({ modelId: str, day: num, gain: num })),
  }),
});

// Личное соперничество (sim/duel.ts): счёт обгонов, главный соперник.
const duelLab = shapeOf<DuelLab>({ passedYou: int, youPassed: int, moves: int, lastDay: nullable(num), letters: int });

const staffRole = oneOf(['research', 'training', 'infra', 'sales']);
const staffTrait = nullable(oneOf(['fast', 'equity']));
const staffPotential = optional(oneOf(['low', 'mid', 'high']));
const staff = shapeOf<StaffState>({
  rng: int,
  people: arrayOf(
    shapeOf<StaffState['people'][number]>({
      id: str,
      name: str,
      role: staffRole,
      level: int,
      xp: num,
      salary: num,
      trait: staffTrait,
      potential: staffPotential,
      lastCourseDay: optional(int),
      startDay: int,
      readyDay: nullable(int),
      retainedUntil: optional(int),
      course: optional(nullable(shapeOf<NonNullable<StaffState['people'][number]['course']>>({ startDay: int, endDay: int, xp: num }))),
    }),
  ),
  candidates: arrayOf(
    shapeOf<StaffState['candidates'][number]>({ id: str, name: str, role: staffRole, level: int, salary: num, trait: staffTrait, potential: staffPotential, wait: int, expiresDay: int }),
  ),
  nextId: int,
  poach: nullable(shapeOf<NonNullable<StaffState['poach']>>({ employeeId: str, lab: str })),
  lastPoachDay: num,
});

const duel = shapeOf<DuelState>({
  labs: record(LAB_IDS, duelLab),
  main: nullable(oneOf(LAB_IDS)),
  mainSince: nullable(num),
  race: nullable(str),
  ahead: arrayOf(str),
  behind: arrayOf(str),
  letterDay: nullable(num),
  sig: str,
});

// Короткие задачи и выбор целей года (sim/tasks.ts, sim/goals.ts).
const task = shapeOf<TaskState>({
  id: str,
  kind: str,
  startDay: num,
  endDay: num,
  need: num,
  base: num,
  subject: str,
  status: oneOf(['active', 'done', 'failed']),
  closedDay: nullable(num),
  result: str,
});

const goalOffer = shapeOf<GoalOffer>({ year: int, goals: arrayOf(yearGoal), open: bool });

const quests = shapeOf<QuestState>({
  rng: int,
  tasks: arrayOf(task),
  nextTaskDay: num,
  nextTaskNum: posInt,
  done: int,
  failed: int,
  tendersWon: int,
  knownContracts: arrayOf(str),
  offer: nullable(goalOffer),
});

/** Каждое поле GameState обязано быть здесь: добавили поле в тип, не добавили проверку - tsc не даст собрать. */
const STATE: Record<keyof GameState, Check> = {
  version: literal(1),
  seed: num,
  rng: int,
  day: int,
  labName: str,
  founderName: str,
  outcome: nullable(oneOf(['victory', 'finished', 'bankrupt'])),
  cash: num,
  reputation: num,
  founderShare: num,
  lastRoundDay: nullable(num),
  round: optional(nullable(shapeOf<PendingRound>({ fraction: num, valuation: num, money: num, startDay: num, closeDay: num, emergency: bool }))),
  monthsFirst: int,
  hype: record(HYPE_OWNERS, num),
  compute: shapeOf<GameState['compute']>({
    rented: record(GPU_IDS, nonNeg),
    rentChangedDay: optional(num),
    incoming: optional(arrayOf(dcOrder)),
    alloc: shapeOf<GameState['compute']['alloc']>({ training: nonNeg, contracts: nonNeg, experiments: nonNeg, api: nonNeg, subs: nonNeg }),
  }),
  datacenters: shapeOf<GameState['datacenters']>({ unlockedDay: nullable(num), list: arrayOf(datacenter) }),
  research: shapeOf<GameState['research']>({
    current: nullable(oneOf(TECH_IDS)),
    points: record(TECH_IDS, num),
    done: arrayOf(oneOf(TECH_IDS)),
    algoLevel: num,
    contextLevel: num,
    queue: arrayOf(oneOf(TECH_IDS)),
    stopped: optional(bool),
  }),
  trainings: arrayOf(trainingRun),
  nextRunNum: posInt,
  bestFlop: num,
  nextModelNum: posInt,
  models: arrayOf(playerModel),
  rivalsReleased: arrayOf(str),
  benchmarks: shape(Object.fromEntries(BENCHMARK_IDS.map((id) => [id, shape({ introduced: bool, saturated: bool })]))),
  tenders: arrayOf(tender),
  contracts: arrayOf(contract),
  nextTenderNum: posInt,
  autoApply: bool,
  mail: arrayOf(mail),
  nextMailNum: posInt,
  firedEvents: arrayOf(str),
  modifiers: arrayOf(modifier),
  flags: dict(bool),
  finance: shapeOf<GameState['finance']>({
    month: ledger,
    history: arrayOf(monthRecord),
    revenueDaily: arrayOf(num),
    negativeDays: num,
  }),
  tutorial: shapeOf<GameState['tutorial']>({ step: int, active: bool }),
  difficulty: oneOf(DIFFICULTY_IDS),
  country: optional(oneOf(COUNTRY_IDS)),
  rivalry,
  yearly,
  late: optional(late),
  staff: optional(staff),
  duel: optional(duel),
  quests,
  market: shapeOf<GameState['market']>({
    shares: dict(num),
    labShares,
    playerTokens: num,
    lostFraction: num,
    totalTokens: num,
    playerSubs: num,
    totalSubs: num,
    lostApi: num,
    lostSubs: num,
    segments: record(SEGMENT_IDS, segmentShares),
    held: optional(dict(dict(num))),
    heldPrice: optional(dict(num)),
  }),
};

const WHOLE_STATE = shape(STATE);

/**
 * Письмо с выбором, на которое ещё не ответили, останавливает игру. Если события нет в этой версии, игру было бы не продолжить.
 * Ищем через findEvent: письма с выбором соперников (rival-*) лежат не в EVENTS, а в RIVALRY_EVENTS.
 */
function pendingChoiceProblem(mails: Mail[]): Problem | null {
  for (let i = 0; i < mails.length; i++) {
    const m = mails[i];
    if (!m.choices || m.chosen !== undefined) continue;
    const def = findEvent(m.eventId);
    if (!def?.choices || def.choices.length !== m.choices.length) return bad(`mail[${i}].choices`);
  }
  return null;
}

function problemText(p: Problem): string {
  return p.missing
    ? `Сохранение повреждено или от другой версии игры: в нём нет поля «${p.path}»`
    : `Сохранение повреждено или от другой версии игры: поле «${p.path}» имеет неверный вид`;
}

/** Технологии, добавленные после первой версии: в старых сохранениях очков по ним нет. */
const LATER_TECHS: readonly TechId[] = ['context', 'distill', 'moe', 'codetrain', 'instruct', 'cot', 'quant', 'multimodal', 'synthetic'];

/** Контекст и выручка моделей появились позже: старые сохранения получают 512 токенов, уровень 0 и выручку 0. */
function migrateContext(data: Record<string, unknown>): void {
  const plan = (p: unknown) => {
    if (isRec(p) && p.context === undefined) p.context = 512;
  };
  const research = data.research;
  if (isRec(research)) {
    if (research.contextLevel === undefined) research.contextLevel = 0;
    // Очередь исследований появилась позже: в старом сохранении она пуста.
    if (research.queue === undefined) research.queue = [];
    // Контекст и новые технологии появились позже: очков по ним в старом сохранении нет - 0.
    if (isRec(research.points)) for (const id of LATER_TECHS) if (research.points[id] === undefined) research.points[id] = 0;
  }
  if (isRec(data.training)) plan(data.training.plan);
  if (Array.isArray(data.trainings)) for (const run of data.trainings) if (isRec(run)) plan(run.plan);
  if (Array.isArray(data.models)) {
    for (const m of data.models) {
      if (!isRec(m)) continue;
      plan(m.plan);
      if (m.earned === undefined) m.earned = 0;
    }
  }
}

/**
 * Срок ответа появился позже: в старых сохранениях письмо с выбором без replyByDay не истекало никогда.
 * Такому письму (выбор есть, ответа нет) ставим срок от сегодняшнего дня игры (или дня письма, если он позже):
 * CHOICE_DAYS, для срыва обучения - FAIL_CHOICE_DAYS; вариант по умолчанию - последний, как в triggerEvent.
 */
function migrateChoices(data: Record<string, unknown>): void {
  if (!Array.isArray(data.mail) || typeof data.day !== 'number') return;
  for (const m of data.mail) {
    if (!isRec(m) || !Array.isArray(m.choices) || m.chosen !== undefined || m.replyByDay !== undefined) continue;
    const from = typeof m.day === 'number' ? Math.max(m.day, data.day) : data.day;
    m.replyByDay = from + (m.eventId === 'training-fail' ? FAIL_CHOICE_DAYS : CHOICE_DAYS);
    if (m.defaultChoice === undefined) m.defaultChoice = m.choices.length - 1;
  }
}

/** Уровень по размеру модели на день, если размер - число; иначе undefined (проверка формы отклонит сохранение сама). */
function tierFor(plan: unknown, day: unknown): Tier | undefined {
  if (!isRec(plan) || typeof plan.paramsB !== 'number' || !Number.isFinite(plan.paramsB)) return undefined;
  return tierOf(plan.paramsB, typeof day === 'number' && Number.isFinite(day) ? day : 0);
}

/**
 * Рынок v2 появился позже (подписки, сегменты, уровни моделей, параллельное обучение): старые сохранения получают
 * значения по умолчанию (design market-v2, раздел 9). Версия сохранения остаётся 1.
 * - alloc.inference → alloc.api, alloc.subs = 0;
 * - training → trainings: [проект с id 't1'; failed - есть неотвеченное письмо срыва], nextRunNum;
 * - plan.tier = tierOf(paramsB, день старта или обучения); модели без подписки и проверки;
 * - статьи subs/review в журнале, subscribers в истории, доли по сегментам в рынке.
 */
function migrateMarketV2(data: Record<string, unknown>): void {
  const compute = data.compute;
  if (isRec(compute) && isRec(compute.alloc)) {
    const alloc = compute.alloc;
    if (alloc.api === undefined && alloc.inference !== undefined) alloc.api = alloc.inference;
    delete alloc.inference;
    if (alloc.subs === undefined) alloc.subs = 0;
  }

  if (data.trainings === undefined) {
    const training = data.training;
    if (isRec(training)) {
      const failed = Array.isArray(data.mail)
        ? data.mail.some((m) => isRec(m) && m.eventId === 'training-fail' && Array.isArray(m.choices) && m.chosen === undefined)
        : false;
      data.trainings = [{ ...training, id: 't1', failed }];
      if (data.nextRunNum === undefined) data.nextRunNum = 2;
    } else {
      data.trainings = [];
      if (data.nextRunNum === undefined) data.nextRunNum = 1;
    }
  }
  delete data.training;
  if (data.nextRunNum === undefined) data.nextRunNum = Array.isArray(data.trainings) ? data.trainings.length + 1 : 1;
  if (Array.isArray(data.trainings)) {
    for (const run of data.trainings) {
      if (!isRec(run) || !isRec(run.plan)) continue;
      if (run.plan.tier === undefined) run.plan.tier = tierFor(run.plan, run.startedDay);
    }
  }

  if (Array.isArray(data.models)) {
    for (const m of data.models) {
      if (!isRec(m)) continue;
      if (isRec(m.plan) && m.plan.tier === undefined) m.plan.tier = tierFor(m.plan, m.trainedDay);
      if (m.onSubs === undefined) m.onSubs = false;
      if (m.subsPrice === undefined) {
        const tier = isRec(m.plan) ? (m.plan.tier as Tier | undefined) : undefined;
        m.subsPrice = tier !== undefined && tier in TIER_SUBS_PRICE ? TIER_SUBS_PRICE[tier] : TIER_SUBS_PRICE.mid;
      }
      if (m.review === undefined) m.review = 'none';
      // Проверка нужна только для подписок: до их открытия метки быть не должно.
      if (m.review === 'required' && typeof data.day === 'number' && data.day < dateToDay(CHAT_MOMENT_DATE)) m.review = 'none';
      if (m.reviewEndDay === undefined) m.reviewEndDay = null;
      if (m.earnedSubs === undefined) m.earnedSubs = 0;
    }
  }

  const ledger = (l: unknown): void => {
    if (!isRec(l)) return;
    if (isRec(l.income) && l.income.subs === undefined) l.income.subs = 0;
    if (isRec(l.expense) && l.expense.review === undefined) l.expense.review = 0;
    // Дата-центры появились позже: статьи стройки и электричества - нулями.
    if (isRec(l.expense) && l.expense.capex === undefined) l.expense.capex = 0;
    if (isRec(l.expense) && l.expense.power === undefined) l.expense.power = 0;
  };
  const finance = data.finance;
  if (isRec(finance)) {
    ledger(finance.month);
    if (Array.isArray(finance.history)) {
      for (const h of finance.history) {
        ledger(h);
        if (isRec(h) && h.subscribers === undefined) h.subscribers = 0;
      }
    }
  }

  const market = data.market;
  if (isRec(market)) {
    if (market.playerSubs === undefined) market.playerSubs = 0;
    if (market.totalSubs === undefined) market.totalSubs = 0;
    if (market.lostApi === undefined) market.lostApi = 0;
    if (market.lostSubs === undefined) market.lostSubs = 0;
    if (market.segments === undefined) market.segments = emptyMarket().segments;
    else if (isRec(market.segments)) {
      for (const id of SEGMENT_IDS) if (market.segments[id] === undefined) market.segments[id] = emptySegmentShares();
    }
  }
}

export function deserialize(json: string): { ok: true; state: GameState } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Сохранение повреждено' };
  }
  if (!isRec(data)) return { ok: false, error: 'Сохранение повреждено' };
  if (data.version !== 1) return { ok: false, error: 'Сохранение от другой версии игры' };
  // Поля, добавленные после первой версии: старые сохранения получают значения по умолчанию.
  if (data.founderName === undefined) data.founderName = '';
  if (data.tutorial === undefined) data.tutorial = { step: 0, active: false };
  if (data.monthsFirst === undefined) data.monthsFirst = 0; // месяцы на 1-м месте появились позже
  if (data.autoApply === undefined) data.autoApply = false; // автоподбор заявок на тендеры появился позже
  // Сложность и соперники с характерами появились позже: старые сохранения идут на Обычной, соперники спокойны, накал 0.
  if (data.difficulty === undefined) data.difficulty = 'normal';
  if (data.rivalry === undefined) data.rivalry = emptyRivalry();
  // Свои дата-центры появились позже: функция откроется по обычному правилу (datacenters.checkUnlock), построек нет.
  if (data.datacenters === undefined) data.datacenters = { unlockedDay: null, list: [] };
  // Цели года и случайные события появились позже: старое сохранение получает цели текущего года на ближайшем тике
  // и первое случайное письмо через 75 дней; свой поток случайных чисел берётся от зерна.
  if (data.yearly === undefined && typeof data.seed === 'number') data.yearly = emptyYearly(data.seed, typeof data.day === 'number' ? data.day : 0);
  // Короткие задачи и выбор целей появились позже: первая задача через 5 дней, цели текущего года остаются прежними.
  if (data.quests === undefined && typeof data.seed === 'number') {
    const q = emptyQuests(data.seed, typeof data.day === 'number' ? data.day : 0);
    // Идущие контракты выиграны до появления счётчика: засчитывать их как новые победы нельзя.
    if (Array.isArray(data.contracts)) q.knownContracts = data.contracts.map((c) => (isRec(c) && typeof c.id === 'string' ? c.id : '')).filter(Boolean);
    data.quests = q;
  }
  migrateContext(data);
  migrateMarketV2(data);
  migrateChoices(data);
  const problem = WHOLE_STATE(data, '') ?? pendingChoiceProblem(data.mail as Mail[]);
  if (problem) return { ok: false, error: problemText(problem) };
  return { ok: true, state: data as unknown as GameState };
}
