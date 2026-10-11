// Сохранения: состояние целиком в JSON, включая генератор случайных чисел (FR-13).
// При загрузке форма состояния проверяется целиком, до самых вложенных полей: сохранение от старой версии игры
// или битый файл отклоняются понятной ошибкой, а не роняют тик и отрисовку позже (например, нет нового бенчмарка).

import { EVENTS } from '../data/events';
import { HYPE_OWNERS } from './constants';
import type {
  Contract,
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
  Tender,
  TrainingPlan,
  TrainingRun,
} from './types';
import { BENCHMARK_IDS, DOMAINS, GPU_IDS, TECH_IDS } from './types';

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
});

const trainingRun = shapeOf<TrainingRun>({
  plan: trainingPlan,
  arch: oneOf(ARCHS),
  algoLevel: num,
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
    shapeOf<NonNullable<Tender['application']>>({ modelId: str, appliedDay: num, resolveDay: num, chance: num }),
  ),
});

const contract = shapeOf<Contract>({
  id: str,
  tender,
  modelId: str,
  startedDay: num,
  deadlineDay: num,
  workDone: num,
});

const mailChoice = shapeOf<MailChoice>({ label: str, hint: str });

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
});

const modifier = shapeOf<Modifier>({
  id: str,
  kind: oneOf(MODIFIER_KINDS),
  target: optional(str),
  mult: optional(num),
  add: optional(num),
  untilDay: num,
});

const income = shapeOf<Record<IncomeKind, number>>({ api: num, contracts: num, investors: num });
const expense = shapeOf<Record<ExpenseKind, number>>({ rent: num, overhead: num, labelers: num, penalties: num });

const ledger = shapeOf<MonthLedger>({ income, expense });

const monthRecord = shapeOf<MonthRecord>({
  income,
  expense,
  year: num,
  month: num,
  cashEnd: num,
  marketShare: num,
  tokensPerDay: num,
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
  hype: record(HYPE_OWNERS, num),
  compute: shapeOf<GameState['compute']>({
    rented: record(GPU_IDS, nonNeg),
    alloc: shapeOf<GameState['compute']['alloc']>({ training: nonNeg, contracts: nonNeg, experiments: nonNeg, inference: nonNeg }),
  }),
  research: shapeOf<GameState['research']>({
    current: nullable(oneOf(TECH_IDS)),
    points: record(TECH_IDS, num),
    done: arrayOf(oneOf(TECH_IDS)),
    algoLevel: num,
    contextLevel: num,
  }),
  training: nullable(trainingRun),
  bestFlop: num,
  nextModelNum: posInt,
  models: arrayOf(playerModel),
  rivalsReleased: arrayOf(str),
  benchmarks: shape(Object.fromEntries(BENCHMARK_IDS.map((id) => [id, shape({ introduced: bool, saturated: bool })]))),
  tenders: arrayOf(tender),
  contracts: arrayOf(contract),
  nextTenderNum: posInt,
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
  market: shapeOf<GameState['market']>({
    shares: dict(num),
    labShares: record([...HYPE_OWNERS, 'none'], num),
    playerTokens: num,
    lostFraction: num,
    totalTokens: num,
  }),
};

const WHOLE_STATE = shape(STATE);

/** Письмо с выбором, на которое ещё не ответили, останавливает игру. Если события нет в этой версии, игру было бы не продолжить. */
function pendingChoiceProblem(mails: Mail[]): Problem | null {
  for (let i = 0; i < mails.length; i++) {
    const m = mails[i];
    if (!m.choices || m.chosen !== undefined) continue;
    const def = EVENTS.find((e) => e.id === m.eventId);
    if (!def?.choices || def.choices.length !== m.choices.length) return bad(`mail[${i}].choices`);
  }
  return null;
}

function problemText(p: Problem): string {
  return p.missing
    ? `Сохранение повреждено или от другой версии игры: в нём нет поля «${p.path}»`
    : `Сохранение повреждено или от другой версии игры: поле «${p.path}» имеет неверный вид`;
}

/** Контекст и выручка моделей появились позже: старые сохранения получают 512 токенов, уровень 0 и выручку 0. */
function migrateContext(data: Record<string, unknown>): void {
  const plan = (p: unknown) => {
    if (isRec(p) && p.context === undefined) p.context = 512;
  };
  const research = data.research;
  if (isRec(research)) {
    if (research.contextLevel === undefined) research.contextLevel = 0;
    if (isRec(research.points) && research.points.context === undefined) research.points.context = 0;
  }
  if (isRec(data.training)) plan(data.training.plan);
  if (Array.isArray(data.models)) {
    for (const m of data.models) {
      if (!isRec(m)) continue;
      plan(m.plan);
      if (m.earned === undefined) m.earned = 0;
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
  migrateContext(data);
  const problem = WHOLE_STATE(data, '') ?? pendingChoiceProblem(data.mail as Mail[]);
  if (problem) return { ok: false, error: problemText(problem) };
  return { ok: true, state: data as unknown as GameState };
}
