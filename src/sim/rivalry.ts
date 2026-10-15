// Соперники с характерами: накал, ходы, слухи, письма с выбором, ответные модели (срез «Соперники с характерами»).
// Спецификация - rival_spec.md, «Final spec». Модуль написан без правок существующих файлов: всё, что нужно
// подключить, перечислено ниже.
//
// ===================== ИНТЕГРАЦИЯ: что поменять в существующих файлах =====================
//
// 1. src/sim/types.ts
//    - ModifierKind: добавить 'rivalPrice' (target - LabId; mult - множитель цен лаборатории, add - доля опорной
//      цены как нижняя граница) и 'exposure' (target - id модели игрока или без target; mult к шансу разоблачения).
//    - GameState: добавить `difficulty: Difficulty` и `rivalry: RivalryState` (типы Difficulty, MoveId, Lever,
//      RivalOverride, LabMemory, PendingMove, ActiveMove, HistoryRow, RivalryState перенести в types.ts или
//      импортировать из './rivalry'). После этого RivalryGame совпадает с GameState; алиас можно оставить.
//
// 2. src/sim/save.ts
//    - MODIFIER_KINDS: rivalPrice: true, exposure: true.
//    - deserialize: `if (data.difficulty === undefined) data.difficulty = 'normal';`
//      `if (data.rivalry === undefined) data.rivalry = emptyRivalry();` (как monthsFirst). Старые сохранения
//      загружаются как Обычная сложность, соперники «спокойны», накал 0.
//    - STATE: difficulty: oneOf(DIFFICULTY_IDS); rivalry: shapeOf<RivalryState>({ heat: record(LAB_IDS, num),
//      cooldownUntil: record(LAB_IDS, num), moveCooldown: dict(num), pending: arrayOf(shapeOf<PendingMove>({ id: str,
//      lab: oneOf(LAB_IDS), move: oneOf(MOVE_IDS), fireDay: num, modelId: optional(str) })), active: arrayOf(shapeOf<
//      ActiveMove>({ lab: oneOf(LAB_IDS), move: oneOf(MOVE_IDS), untilDay: num })), overrides: dict(shapeOf<
//      RivalOverride>({ dayShift: optional(num), eloAdd: optional(num), context: optional(num), price: optional(num) })),
//      extra: dict(num), extraCount: record(LAB_IDS, num), memory: record(LAB_IDS, shapeOf<LabMemory>({ lastMove:
//      nullable(oneOf(MOVE_IDS)), firedDay: num, shareBefore: num, priceBefore: num, worked: nullable(bool),
//      priceMatched: bool })), lever: nullable(oneOf(LEVERS)), choice: nullable(shape({ lab: oneOf(LAB_IDS), modelId:
//      optional(str) })), history: arrayOf(shapeOf<HistoryRow>({ day: num, lab: oneOf(LAB_IDS), move: oneOf(MOVE_IDS),
//      text: str })), shareHigh: record(LAB_IDS, num) }).
//    - pendingChoiceProblem: искать событие через findEvent (п. 7), иначе письмо с выбором соперника отклонит сохранение.
//
// 3. src/sim/state.ts
//    - createInitialState(labName, seed, difficulty: Difficulty = 'normal'): поля `difficulty` и `rivalry: emptyRivalry()`.
//
// 4. src/sim/actions.ts
//    - newGame(labName, seed, difficulty: Difficulty = 'normal'): передать в createInitialState и вызвать
//      applyDifficultyModifiers(s) (два модификатора навсегда: rentPrice и exposure, только на Лёгкой и Сложной).
//
// 5. src/sim/tick.ts
//    - сразу после releaseDue(s): rivalryDay(s) - срабатывание слухов, память, истечение активных ходов.
//    - в блоке конца месяца после monthlyExposure(s) и до pruneModifiers(s): rivalryMonth(s) - рычаг, накал,
//      планирование. Единственное место модуля с nextRandom; до 2021 года и до первой модели игрока на API
//      розыгрышей нет, поэтому потоки случайных чисел 2017-2020 у существующих сидов не меняются.
//
// 6. src/sim/rivals.ts, market.ts, leaderboard.ts (доступ к моделям соперников)
//    - findRivalDef(id): искать и среди шаблонов - findRivalDefIn(id) из этого модуля (каталог, затем reactiveDefs();
//      карта шаблонов строится лениво, поэтому взаимный импорт rivals.ts ↔ rivalry.ts безопасен).
//      releaseDue шаблоны не выпускает: дополнительные модели добавляет в s.rivalsReleased сам rivalry.ts (releaseExtra),
//      там же письмо о выходе. Если выносить тело releaseDue в releaseRival(s, def), releaseExtra может вызывать его.
//    - вместо rivalDay(def) / def.arenaElo / def.context / rivalPrice(def, day) в leaderboard.entries(), bestElo(),
//      rivals.marketRivals() и market.marketSnapshot() использовать rivalDayIn / rivalEloIn / rivalContextIn /
//      rivalPriceIn (учитывают overrides, extra и модификатор rivalPrice). Чистые rivalDay/rivalPrice остаются
//      для rivals.test.ts; expectedLeaderElo не меняется (планка победы каталожная; подпись в интерфейсе:
//      «или выше, если соперники ускорятся»).
//    - письмо о выходе модели с overrides[id].dayShift < 0: добавить «на N дней раньше» (releaseShiftDays).
//
// 7. src/data/events.ts и src/sim/events.ts
//    - НЕ добавлять ...RIVALRY_EVENTS в массив EVENTS на верхнем уровне: модули зациклены
//      (sim/events → data/events → sim/rivalry → sim/events), и при первом импорте rivalry.ts массив ещё не
//      инициализирован (TDZ). Вместо этого в data/events.ts: `import { RIVALRY_EVENTS } from '../sim/rivalry'` и
//      `export function findEvent(id: string) { return EVENTS.find((e) => e.id === id) ?? RIVALRY_EVENTS.find((e) => e.id === id); }`;
//      в sim/events.ts triggerEvent/applyChoice и в save.ts pendingChoiceProblem использовать findEvent вместо EVENTS.find.
//      Сами письма с выбором запускает rivalry.ts (fireChoiceEvent, без EVENTS); fireDue их не трогает (repeatable).
//
// 8. src/sim/training.ts
//    - exposureChance: `return Math.min(EXPOSE_CAP_WITH_RIVALS, Math.min(EXPOSE_MAX, EXPOSE_PER_PP * gap + arena) * exposureMultIn(s, model.id));`
//      (базовый шанс по-прежнему не выше EXPOSE_MAX, а с множителем - не выше 0,6). Модификаторы exposure ставят сложность (newGame) и
//      выбор «Отрицать» в проверке баллов; штраф −20 репутации за позднее разоблачение после отрицания начисляет rivalryDay.
//
// 9. src/sim/bots.ts
//    - runBot(kind, seed, maxDays = 4000, difficulty: Difficulty = 'normal') → newGame('Бот', seed, difficulty).
//    - botAct: один рефлекс - botPriceReflex(s) (доля игрока за месяц упала на ≥ 25 % относительно → цена моделей
//      на API × 0,85, не ниже 2 × minPrice). Опоры баланса остаются на Обычной; сиды после 2021 года могут
//      потребовать перепривязки из-за новых розыгрышей.
//
// 10. Интерфейс
//    - MainMenu: три радиокнопки по DIFFICULTY_IDS с DIFFICULTY[d].name и description; store.newGame(labName, { difficulty }).
//    - MarketWindow, LabsTab / labRows: колонки «Характер» (personalityOf(lab).archetype, подсказка description),
//      «Настрой» (labStance(s, lab).label, подсказка hint), «Последний ход» (lastMove(s, lab): formatDateShort(day) +
//      text). Под таблицей «Последние ходы»: последние 10 строк rivalry.history (день, LABS.name, moveName(move), text).
//    - RatingsWindow: у строк соперников с overrides[id].eloAdd показывать «≈» (eloEstimated).
//    - Письма kind 'rival': слухи, исполнение хода, письма с выбором (important) - отдельного кода не нужно.
//
// ==========================================================================================

import type { EventDef } from '../data/events';
import { LABS } from '../data/labs';
import { personalityOf } from '../data/labPersonalities';
import { RIVAL_MODELS } from '../data/rivalModels';
import { RIVAL_REACTIVE } from '../data/rivalReactive';
import type { ReactiveTemplate } from '../data/rivalReactive';
import { ALGO_HISTORY_START, ALGO_LEVEL_DAYS, CHOICE_DAYS, FOREVER, MARKET_MAX_AGE_DAYS, OVERHEAD_MONTHLY } from './constants';
import { addMail, addModifier, mailChoices, modValue, pendingChoice } from './events';
import { spend } from './finance';
import { bestElo, marketArenaRank } from './leaderboard';
import { minPrice, refContext, refPrice } from './market';
import { contextLabel, yearsEarly } from './research';
import { findRivalDef, rivalDay, rivalPrice, rivalTier } from './rivals';
import { nextRandom } from './rng';
import { byYear, dateToDay, dayToDate, END_DAY, formatDate, yearOf } from './time';
import { modelScore } from './training';
import { LAB_IDS } from './types';
import type { BenchmarkId, GameState, HypeOwner, LabId, Modifier, ModifierKind, PlayerModel, RivalModelDef, SegmentId, Tier } from './types';
import { daysWord, endSentence } from './text';
import { TEAM_RETAIN_MONTHS, teamDef } from '../data/deals';
import { dropTeam } from './deals';
import type { TeamId } from './lateState';

// ---------- Типы ----------

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY_IDS: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export type MoveId =
  | 'priceCut'
  | 'priceWar'
  | 'flagship'
  | 'cheapShock'
  | 'hype'
  | 'freeTier'
  | 'openWeights'
  | 'context'
  | 'audit'
  | 'poach';
export const MOVE_IDS: readonly MoveId[] = [
  'priceCut',
  'priceWar',
  'flagship',
  'cheapShock',
  'hype',
  'freeTier',
  'openWeights',
  'context',
  'audit',
  'poach',
];

export type Lever = 'price' | 'elo' | 'hype' | 'context';
export const LEVERS: readonly Lever[] = ['price', 'elo', 'hype', 'context'];

/** Поправки к модели каталога или шаблона: сдвиг дня выхода (минус - раньше), прибавка Эло, контекст, цена ответной модели на день выхода. */
export interface RivalOverride {
  dayShift?: number;
  eloAdd?: number;
  context?: number;
  price?: number;
}

export interface LabMemory {
  lastMove: MoveId | null;
  firedDay: number;
  shareBefore: number; // доля игрока в день хода
  priceBefore: number; // самая низкая цена игрока в день хода
  worked: boolean | null; // null - ещё не оценено (через 60 дней)
  priceMatched: boolean; // игрок снизил цену вслед за ценовым ходом
}

export interface PendingMove {
  id: string;
  lab: LabId;
  move: MoveId;
  fireDay: number;
  modelId?: string; // flagship/context: модель каталога; audit: модель игрока
}

export interface ActiveMove {
  lab: LabId;
  move: MoveId;
  untilDay: number;
}

export interface HistoryRow {
  day: number;
  lab: LabId;
  move: MoveId;
  text: string;
}

export interface RivalryState {
  heat: Record<LabId, number>; // 0..100
  cooldownUntil: Record<LabId, number>; // лаборатория не планирует ходов до этого дня
  moveCooldown: Record<string, number>; // `${lab}:${move}` или `global:${move}` → день, с которого ход снова доступен
  pending: PendingMove[];
  active: ActiveMove[];
  overrides: Record<string, RivalOverride>; // id модели каталога или шаблона → поправки
  extra: Record<string, number>; // id шаблона → день выхода ответной модели
  extraCount: Record<LabId, number>;
  memory: Record<LabId, LabMemory>;
  lever: Lever | null; // сильная сторона игрока по итогам месяца
  choice: { lab: LabId; modelId?: string; team?: TeamId } | null; // контекст последнего письма с выбором (team - кого переманивают)
  history: HistoryRow[]; // последние HISTORY_MAX ходов
  shareHigh: Record<LabId, number>; // наибольшая доля лаборатории (для условия «доля упала»)
}

/** Состояние игры с полями сложности и соперников. После интеграции совпадает с GameState. */
export type RivalryGame = GameState & { difficulty: Difficulty; rivalry: RivalryState };

function labRecord<T>(make: () => T): Record<LabId, T> {
  return Object.fromEntries(LAB_IDS.map((lab) => [lab, make()])) as Record<LabId, T>;
}

export function emptyMemory(): LabMemory {
  return { lastMove: null, firedDay: 0, shareBefore: 0, priceBefore: 0, worked: null, priceMatched: false };
}

export function emptyRivalry(): RivalryState {
  return {
    heat: labRecord(() => 0),
    cooldownUntil: labRecord(() => 0),
    moveCooldown: {},
    pending: [],
    active: [],
    overrides: {},
    extra: {},
    extraCount: labRecord(() => 0),
    memory: labRecord(emptyMemory),
    lever: null,
    choice: null,
    history: [],
    shareHigh: labRecord(() => 0),
  };
}

// ---------- Сложность ----------

export interface DifficultyDef {
  name: string; // «Обычная»
  description: string; // одна строка для главного меню
  gain: number; // множитель роста накала
  threshold: number; // накал, с которого лаборатория ходит
  delay: number; // дней от слуха до хода
  priceDelay: number; // то же для ценовых ходов
  cap: number; // pending + active, не больше
  k: number; // сила ходов
  dayShiftCap: number; // сдвиг дня выхода на модель, дней
  eloAddCap: number; // прибавка Эло на модель
  eloAddLabCap: number; // прибавка Эло на лабораторию за игру
  extraPerLab: number; // дополнительных моделей на лабораторию
  learning: 'none' | 'lever' | 'memory';
  shockGap: number; // дешёвая модель: на сколько Эло ниже лучшей
  shockShare: number; // дешёвая модель: доля игрока не ниже
  warFloor: number; // ценовая война: нижняя граница, доля опорной цены
  auditCooldown: number; // дней между проверками баллов (на всех)
  priceLabsAtOnce: number; // сколько лабораторий одновременно ведут ценовые ходы
  actorsPerMonth: number; // сколько лабораторий могут запланировать ход в один месяц
  rentPrice: number; // модификатор аренды навсегда
  exposure: number; // модификатор шанса разоблачения навсегда
}

export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
  easy: {
    name: 'Лёгкая',
    description: 'Соперники отвечают на ваши успехи редко. Аренда дешевле на 20 %, подгонку раскрывают реже.',
    gain: 0.6,
    threshold: 70,
    delay: 60,
    priceDelay: 60,
    cap: 1,
    k: 0.7,
    dayShiftCap: 0,
    eloAddCap: 0,
    eloAddLabCap: 0,
    extraPerLab: 1,
    learning: 'none',
    shockGap: 35,
    shockShare: 0.15,
    warFloor: 0.3,
    auditCooldown: 365,
    priceLabsAtOnce: 1,
    actorsPerMonth: 1,
    rentPrice: 0.8,
    exposure: 0.7,
  },
  normal: {
    name: 'Обычная',
    description: 'Соперники отвечают на ваши успехи. Аренда по обычной цене.',
    gain: 1.0,
    threshold: 50,
    delay: 30,
    priceDelay: 30,
    cap: 2,
    k: 1.0,
    dayShiftCap: 30,
    eloAddCap: 10,
    eloAddLabCap: 20,
    extraPerLab: 2,
    learning: 'lever',
    shockGap: 35,
    shockShare: 0.15,
    warFloor: 0.3,
    auditCooldown: 365,
    priceLabsAtOnce: 1,
    actorsPerMonth: 1,
    rentPrice: 1,
    exposure: 1,
  },
  hard: {
    name: 'Сложная',
    description: 'Соперники отвечают на ваши успехи быстро и часто. Аренда дороже на 60 %, подгонку раскрывают чаще.',
    gain: 1.4,
    threshold: 35,
    delay: 14,
    priceDelay: 7,
    cap: 3,
    k: 1.3,
    dayShiftCap: 60,
    eloAddCap: 20,
    eloAddLabCap: 40,
    extraPerLab: 3,
    learning: 'memory',
    shockGap: 20,
    shockShare: 0.1,
    warFloor: 0.2,
    auditCooldown: 240,
    priceLabsAtOnce: 2,
    actorsPerMonth: 2,
    rentPrice: 1.6,
    exposure: 1.3,
  },
};

// ---------- Числа модуля ----------

const RIVALRY_START = '2021-01-01'; // до этой даты соперники спят
const HEAT_GAIN = 30;
const HEAT_DECAY = 8;
const HEAT_SPEND = 40; // накал после планирования хода
const LAB_COOLDOWN = 180; // дней между ходами одной лаборатории
const MAX_MOVES_PER_YEAR = 8; // исполненных и запланированных ходов за скользящий год
const HISTORY_MAX = 20;
const MEMORY_DAYS = 60; // через сколько дней оценивается, сработал ли ход
const PRICE_MATCH_DAYS = 30; // окно, в котором снижение цены игрока считается ответом
const PRICE_MATCH_DROP = 0.15; // относительное снижение цены игрока
const WORKED_DROP = 0.15; // относительное падение доли игрока
const DEMAND_BOOST_MAX = 1.15; // суммарный множитель спроса от ходов соперников
const QUIET_END_DAYS = 90; // в последние дни игры нет прибавок Эло и дополнительных моделей
const LAB_DAYSHIFT_MAX = 90; // суммарный сдвиг дней выхода на лабораторию
const PREDECESSOR_GAP = 30; // модель не выходит раньше чем через столько дней после предыдущей модели лаборатории
const CHEAP_SHOCKS_PER_GAME = 4;
const FLAGSHIP_MIN_AHEAD = 60;
const FLAGSHIP_MAX_AHEAD = 240;
const CONTEXT_MAX_AHEAD = 180;
const CONTEXT_CAP = 1_000_000;
const PRICE_FLOOR_SHARE = 0.3; // снижение цен: не ниже 0,3 опорной цены
const FREE_TIER_SEG_BRAND = 0.3; // бесплатный чат: бренд у обычных пользователей (× k сложности) на время хода
const FREE_TIER_SUBS_DEMAND = 1.15; // бесплатный чат: рост спроса на подписки
const FREE_TIER_SHARE = 0.12; // бесплатный чат: доля игрока среди обычных пользователей не ниже
const BOT_SUBS_PRICE_MULT = 0.9; // рефлекс бота: цена подписки × 0,9, не ниже BOT_SUBS_PRICE_FLOOR
const BOT_SUBS_PRICE_FLOOR = 5;
const WAR_HYPE_PER_MONTH = 5;
const HYPE_CAMPAIGN_COST = 300_000;
const POACH_MONTHS = 3;
const DENIAL_REP = 20;
/** Потолок шанса разоблачения с модификаторами exposure (training.exposureChance после интеграции). */
export const EXPOSE_CAP_WITH_RIVALS = 0.6;
/** Рост цен за годы: расходы на кампании и зарплаты × YEAR_MULT[год]. */
const YEAR_MULT: Record<number, number> = { 2017: 1, 2019: 1.2, 2020: 1.5, 2021: 2, 2022: 3, 2023: 5, 2024: 8 };

/**
 * Ответ на господство (2021-2022 и позже): игрок держит не меньше DOMINANCE_SHARE рынка DOMINANCE_MONTHS закрытых
 * месяцев подряд - соперники снижают цены, даже если характер обычно не позволяет (как OpenBrain в сентябре 2022 года
 * снизила цены на GTP-3 втрое). Ход тот же - priceCut со слухом, но вес выше и снижение глубже.
 */
const DOMINANCE_SHARE = 0.7;
const DOMINANCE_MONTHS = 2;
const DOMINANCE_PRICE_WEIGHT = 4;
const DOMINANCE_CUT_MULT = 2;
/** При господстве игрока новая цена лаборатории - не выше этой доли самой дешёвой цены игрока. */
const DOMINANCE_UNDERCUT = 0.6;

/** Игрок держит рынок: общая доля не ниже 70 % на конец двух последних закрытых месяцев. */
export function playerDominates(s: GameState): boolean {
  const h = s.finance.history;
  if (h.length < DOMINANCE_MONTHS) return false;
  return h.slice(-DOMINANCE_MONTHS).every((r) => r.marketShare >= DOMINANCE_SHARE);
}

/** Сюжетные модели: их даты и Эло не меняются никогда (на них завязаны события data/events.ts и победа). */
export const STORY_LOCKED: ReadonlySet<string> = new Set(['gtp-2', 'gtp-2-full', 'gtp-3', 'chatgtp', 'gtp-4', 'q1-previow', 'q1']);

const LEVER_COUNTERS: Record<Lever, readonly MoveId[]> = {
  price: ['priceCut', 'priceWar', 'cheapShock'],
  elo: ['flagship', 'audit'],
  hype: ['hype', 'freeTier'],
  context: ['context'],
};

interface MoveDef {
  name: string; // для истории и интерфейса
  labCooldown: number; // дней после планирования (FOREVER - один раз за игру)
  activeDays: number; // сколько дней ход занимает место в active (0 - не занимает)
  price: boolean; // ценовой ход
  demand: number; // множитель спроса, который ход добавляет (1 - нет)
}

const MOVES: Record<MoveId, MoveDef> = {
  priceCut: { name: 'снижение цен', labCooldown: 270, activeDays: 120, price: true, demand: 1.05 },
  priceWar: { name: 'ценовая война', labCooldown: 365, activeDays: 90, price: true, demand: 1 },
  flagship: { name: 'ускорение флагмана', labCooldown: 180, activeDays: 30, price: false, demand: 1 },
  cheapShock: { name: 'дешёвая модель', labCooldown: 365, activeDays: 90, price: true, demand: 1.1 },
  hype: { name: 'рекламная кампания', labCooldown: 180, activeDays: 30, price: false, demand: 1 },
  freeTier: { name: 'бесплатный чат', labCooldown: FOREVER, activeDays: 180, price: false, demand: 1 }, // спрос API не трогает: растут подписки
  openWeights: { name: 'открытые веса', labCooldown: 365, activeDays: 90, price: false, demand: 1 },
  context: { name: 'длинный контекст', labCooldown: 365, activeDays: 30, price: false, demand: 1 },
  audit: { name: 'проверка баллов', labCooldown: 0, activeDays: 30, price: false, demand: 1 },
  poach: { name: 'переманивание', labCooldown: 365, activeDays: 30, price: false, demand: 1 },
};

export function moveName(move: MoveId): string {
  return MOVES[move].name;
}

/** Общий для всех лабораторий перерыв хода, дней (0 - нет). */
function globalCooldown(move: MoveId, diff: DifficultyDef): number {
  if (move === 'audit') return diff.auditCooldown;
  if (move === 'poach') return 240;
  return 0;
}

const LAB_NAME = new Map<LabId, string>(LABS.map((l) => [l.id, l.name]));

function labName(lab: LabId): string {
  return LAB_NAME.get(lab) ?? lab;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

/** «$1,5 млн», «$300 тыс.», «$800». */
function fmtMoney(n: number): string {
  const dec = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
  if (n >= 1e9 - 5e4) return `$${dec(n / 1e9)} млрд`;
  if (n >= 1e6 - 500) return `$${dec(n / 1e6)} млн`;
  if (n >= 1e3 - 0.5) return `$${dec(n / 1e3)} тыс.`;
  return `$${Math.round(n)}`;
}

/** «$0,14», «$2», «$13,95». */
function fmtPrice(x: number): string {
  return `$${String(Number(x.toFixed(3))).replace('.', ',')}`;
}

export function yearMult(day: number): number {
  return byYear(YEAR_MULT, yearOf(day));
}

// ---------- Модификаторы новых видов ----------

/** Виды модификаторов этого среза; регистрируются в types.ts (ModifierKind) и save.ts (MODIFIER_KINDS) при интеграции. */
export type RivalModifierKind = 'rivalPrice' | 'exposure';

/** Пока вид не зарегистрирован в ModifierKind, приводим тип здесь, в одном месте. */
function asKind(kind: RivalModifierKind): ModifierKind {
  return kind as unknown as ModifierKind;
}

/** addModifier для видов rivalPrice и exposure. */
export function addRivalModifier(
  s: GameState,
  m: Omit<Modifier, 'id' | 'kind'> & { id: string; kind: RivalModifierKind },
): void {
  addModifier(s, { ...m, kind: asKind(m.kind) });
}

/** Множитель шанса разоблачения модели игрока: модификаторы exposure без target и с target = id модели. */
export function exposureMultIn(s: GameState, modelId: string): number {
  return modValue(s, asKind('exposure'), modelId).mult;
}

/** Модификаторы сложности навсегда: аренда и шанс разоблачения (только на Лёгкой и Сложной). Вызывает newGame. */
export function applyDifficultyModifiers(s: RivalryGame): void {
  const d = DIFFICULTY[s.difficulty];
  if (d.rentPrice !== 1) addModifier(s, { id: 'difficulty-rent', kind: 'rentPrice', mult: d.rentPrice, untilDay: FOREVER });
  if (d.exposure !== 1) addRivalModifier(s, { id: 'difficulty-exposure', kind: 'exposure', mult: d.exposure, untilDay: FOREVER });
}

// ---------- Шаблоны ответных моделей и доступ к моделям соперников ----------

/** Уровень ответной модели: дешёвая - лёгкая, открытые веса - средняя, длинный контекст - уровень базовой модели. */
function templateTier(t: ReactiveTemplate, base: RivalModelDef): Tier {
  if (t.openWeights) return 'mid';
  if (t.context !== undefined) return rivalTier(base);
  return 'light';
}

function templateDef(t: ReactiveTemplate): RivalModelDef {
  const base = findRivalDef(t.base);
  if (!base) throw new Error(`Шаблон ${t.id}: нет базовой модели ${t.base}`);
  return {
    id: t.id,
    lab: t.lab,
    gameName: t.gameName,
    realName: base.realName,
    released: t.notBefore,
    api: !t.openWeights,
    openWeights: t.openWeights === true,
    chat: base.chat,
    paramsB: null,
    priceIn: null,
    priceOut: null,
    scores: {},
    arenaElo: base.arenaElo,
    arenaEstimated: true,
    contaminated: false,
    context: t.context ?? base.context,
    tier: templateTier(t, base),
    notes: `Ответная модель на основе ${base.gameName}; Эло, цена и контекст заданы ходом соперника.`,
  };
}

let reactiveCache: Map<string, RivalModelDef> | null = null;

/**
 * Шаблоны как модели каталога: Эло, цена и контекст уточняются поправками (rivalry.overrides). Строятся при первом
 * обращении, а не при загрузке модуля: после интеграции rivals.ts импортирует этот модуль, и при обратном порядке
 * загрузки каталог rivals.ts ещё пуст.
 */
export function reactiveDefs(): ReadonlyMap<string, RivalModelDef> {
  if (!reactiveCache) reactiveCache = new Map(RIVAL_REACTIVE.map((t) => [t.id, templateDef(t)]));
  return reactiveCache;
}

function reactiveDef(id: string): RivalModelDef {
  const def = reactiveDefs().get(id);
  if (!def) throw new Error(`Нет шаблона ответной модели ${id}`);
  return def;
}

const TEMPLATE_BY_ID = new Map<string, ReactiveTemplate>(RIVAL_REACTIVE.map((t) => [t.id, t]));

/** Модель каталога или шаблона по id (для findRivalDef после интеграции). */
export function findRivalDefIn(id: string): RivalModelDef | undefined {
  return findRivalDef(id) ?? reactiveDefs().get(id);
}

/** День выхода с учётом сдвига (overrides.dayShift) или фактический день ответной модели (extra). */
export function rivalDayIn(s: RivalryGame, def: RivalModelDef): number {
  const extra = s.rivalry.extra[def.id];
  if (extra !== undefined) return extra;
  return rivalDay(def) + (s.rivalry.overrides[def.id]?.dayShift ?? 0);
}

export function rivalEloIn(s: RivalryGame, def: RivalModelDef): number {
  return def.arenaElo + (s.rivalry.overrides[def.id]?.eloAdd ?? 0);
}

export function rivalContextIn(s: RivalryGame, def: RivalModelDef): number {
  return s.rivalry.overrides[def.id]?.context ?? def.context;
}

/** Цена без модификатора rivalPrice: цена ответной модели (падает с рынком от дня выхода) или каталожная. */
function rivalBasePrice(s: RivalryGame, def: RivalModelDef): number {
  const price = s.rivalry.overrides[def.id]?.price;
  if (price !== undefined) {
    const decay = refPrice(s.day) / refPrice(rivalDayIn(s, def));
    return price * (Number.isFinite(decay) ? Math.min(1, decay) : 1);
  }
  return rivalPrice(def, s.day);
}

/**
 * Цена соперника $ за 1М токенов на сегодня: базовая × модификатор rivalPrice(target = lab).mult, но не ниже
 * нижней границы (add - доля опорной цены) и не ниже minPrice. Модель, которая и так дешевле границы, не дорожает.
 */
export function rivalPriceIn(s: RivalryGame, def: RivalModelDef): number {
  const base = rivalBasePrice(s, def);
  const floorMin = minPrice(s.day);
  const { mult, add } = modValue(s, asKind('rivalPrice'), def.lab);
  if (!(mult < 1)) return Math.max(floorMin, base);
  const floor = Math.max(floorMin, add * refPrice(s.day));
  return Math.max(floorMin, Math.max(base * mult, Math.min(base, floor)));
}

/** На сколько дней раньше каталога выходит модель (для письма о выходе: «на N дней раньше»); 0 - как в каталоге. */
export function releaseShiftDays(s: RivalryGame, def: RivalModelDef): number {
  return Math.max(0, -(s.rivalry.overrides[def.id]?.dayShift ?? 0));
}

interface LabModel {
  def: RivalModelDef;
  day: number;
  elo: number;
  price: number;
  context: number;
  api: boolean;
}

/** Выпущенные модели лаборатории (каталог и ответные), новые сверху. */
function releasedModels(s: RivalryGame, lab: LabId): LabModel[] {
  const out: LabModel[] = [];
  for (const id of s.rivalsReleased) {
    const def = findRivalDefIn(id);
    if (!def || def.lab !== lab) continue;
    out.push({
      def,
      day: rivalDayIn(s, def),
      elo: rivalEloIn(s, def),
      price: rivalPriceIn(s, def),
      context: rivalContextIn(s, def),
      api: def.api && !def.announcedOnly,
    });
  }
  out.sort((a, b) => b.day - a.day || b.elo - a.elo);
  return out;
}

/** Модели лаборатории на рынке: (api или openWeights), не только показанные, не старше MARKET_MAX_AGE_DAYS; новые сверху. */
function marketModels(s: RivalryGame, lab: LabId): LabModel[] {
  return releasedModels(s, lab).filter(
    (m) => (m.def.api || m.def.openWeights) && !m.def.announcedOnly && s.day - m.day <= MARKET_MAX_AGE_DAYS,
  );
}

function labHasMarketModel(s: RivalryGame, lab: LabId): boolean {
  return releasedModels(s, lab).some((m) => (m.def.api || m.def.openWeights) && !m.def.announcedOnly);
}

/** Лучший Эло среди выпущенных моделей лаборатории с поправками (0 - нет моделей). */
export function labBestEloIn(s: RivalryGame, lab: LabId): number {
  return releasedModels(s, lab).reduce((best, m) => Math.max(best, m.elo), 0);
}

/** Лучший каталожный Эло среди выпущенных моделей каталога (без поправок и ответных моделей). */
function labCatalogBestElo(s: RivalryGame, lab: LabId): number {
  let best = 0;
  for (const id of s.rivalsReleased) {
    const def = findRivalDef(id);
    if (def && def.lab === lab && def.arenaElo > best) best = def.arenaElo;
  }
  return best;
}

function labCatalogMaxContext(lab: LabId): number {
  return RIVAL_MODELS.filter((m) => m.lab === lab).reduce((best, m) => Math.max(best, m.context), 0);
}

/** Самая новая модель лаборатории с API на рынке. */
function labNewestApi(s: RivalryGame, lab: LabId): LabModel | null {
  return marketModels(s, lab).find((m) => m.api) ?? null;
}

function labCheapestApiPrice(s: RivalryGame, lab: LabId): number | null {
  let best: number | null = null;
  for (const m of marketModels(s, lab)) if (m.api && (best === null || m.price < best)) best = m.price;
  return best;
}

function labBestContext(s: RivalryGame, lab: LabId): number {
  return marketModels(s, lab).reduce((best, m) => Math.max(best, m.context), 0);
}

/** Ближайшая невышедшая модель каталога с API, не сюжетная, через minAhead..maxAhead дней (с учётом сдвигов). */
function nextCatalogModel(s: RivalryGame, lab: LabId, minAhead: number, maxAhead: number): RivalModelDef | null {
  const released = new Set(s.rivalsReleased);
  let best: { def: RivalModelDef; day: number } | null = null;
  for (const def of RIVAL_MODELS) {
    if (def.lab !== lab || !def.api || def.announcedOnly || STORY_LOCKED.has(def.id) || released.has(def.id)) continue;
    const day = rivalDayIn(s, def);
    if (day < s.day + minAhead || day > s.day + maxAhead) continue;
    if (!best || day < best.day) best = { def, day };
  }
  return best?.def ?? null;
}

/** День выхода последней выпущенной модели лаборатории с API (или −∞). */
function predecessorDay(s: RivalryGame, lab: LabId): number {
  return releasedModels(s, lab)
    .filter((m) => m.api)
    .reduce((best, m) => Math.max(best, m.day), Number.NEGATIVE_INFINITY);
}

function labDayShiftTotal(s: RivalryGame, lab: LabId): number {
  let total = 0;
  for (const [id, o] of Object.entries(s.rivalry.overrides)) {
    const def = findRivalDef(id);
    if (def && def.lab === lab && o.dayShift) total += Math.abs(o.dayShift);
  }
  return total;
}

function labEloAddTotal(s: RivalryGame, lab: LabId): number {
  let total = 0;
  for (const [id, o] of Object.entries(s.rivalry.overrides)) {
    const def = findRivalDef(id);
    if (def && def.lab === lab && o.eloAdd && o.eloAdd > 0) total += o.eloAdd;
  }
  return total;
}

type TemplateKind = 'cheap' | 'open' | 'context';

function templateKind(t: ReactiveTemplate): TemplateKind {
  if (t.openWeights) return 'open';
  if (t.context !== undefined) return 'context';
  return 'cheap';
}

/** Первый свободный шаблон лаборатории нужного вида: дата подошла, базовая модель вышла. */
function pickTemplate(s: RivalryGame, lab: LabId, kind: TemplateKind): ReactiveTemplate | null {
  for (const t of RIVAL_REACTIVE) {
    if (t.lab !== lab || templateKind(t) !== kind) continue;
    if (s.rivalry.extra[t.id] !== undefined) continue;
    if (s.day < dateToDay(t.notBefore)) continue;
    if (!s.rivalsReleased.includes(t.base)) continue;
    return t;
  }
  return null;
}

function cheapShockCount(s: RivalryGame): number {
  let n = 0;
  for (const id of Object.keys(s.rivalry.extra)) {
    const t = TEMPLATE_BY_ID.get(id);
    if (t && templateKind(t) === 'cheap') n++;
  }
  return n;
}

/** Можно ли выпустить ещё одну ответную модель: не в последние 90 дней игры, лимит на лабораторию не исчерпан. */
function extrasAllowed(s: RivalryGame, lab: LabId): boolean {
  return s.day <= END_DAY - QUIET_END_DAYS && s.rivalry.extraCount[lab] < DIFFICULTY[s.difficulty].extraPerLab;
}

/** Ответная модель выходит: день, поправки, rivalsReleased, счётчик. Письмо пишет вызывающий ход. */
function releaseExtra(s: RivalryGame, t: ReactiveTemplate, o: RivalOverride): RivalModelDef {
  s.rivalry.extra[t.id] = s.day;
  s.rivalry.overrides[t.id] = o;
  if (!s.rivalsReleased.includes(t.id)) s.rivalsReleased.push(t.id);
  s.rivalry.extraCount[t.lab] += 1;
  return reactiveDef(t.id);
}

// ---------- Игрок ----------

function playerApiModels(s: GameState): PlayerModel[] {
  return s.models.filter((m) => m.releasedDay !== null && m.onApi);
}

/** У игрока есть выпущенная модель в продаже по API: до неё соперники спят (спецификация: «first onApi model»). */
function playerOnApi(s: GameState): boolean {
  return s.models.some((m) => m.releasedDay !== null && m.onApi);
}

/** Лучший Эло среди моделей игрока в продаже по API (0 - нет таких). */
function playerBestApiElo(s: GameState): number {
  return playerApiModels(s).reduce((best, m) => Math.max(best, m.arenaElo), 0);
}

function playerCheapestPrice(s: GameState): number | null {
  let best: number | null = null;
  for (const m of playerApiModels(s)) if (Number.isFinite(m.price) && (best === null || m.price < best)) best = m.price;
  return best;
}

function playerMaxContext(s: GameState): number {
  return playerApiModels(s).reduce((best, m) => Math.max(best, m.plan.context), 0);
}

function playerShare(s: GameState): number {
  return s.market.labShares.player ?? 0;
}

/** Доля владельца в сегменте рынка после ограничения мощностью (s.market.segments); 0, если сегмента ещё нет. */
export function segShare(s: GameState, seg: SegmentId, owner: HypeOwner): number {
  return s.market.segments?.[seg]?.labShares[owner] ?? 0;
}

function playerBestApiRank(s: GameState): number | null {
  let best: number | null = null;
  for (const m of playerApiModels(s)) {
    const r = marketArenaRank(s, { kind: 'player', id: m.id });
    if (r !== null && (best === null || r < best)) best = r;
  }
  return best;
}

/** Самое большое завышение балла подгонкой (п.п.) по вышедшим ненасыщенным целевым бенчмаркам. */
function overfitGap(s: GameState, m: PlayerModel): number {
  let gap = 0;
  for (const bid of Object.keys(m.overfit) as BenchmarkId[]) {
    const st = s.benchmarks[bid];
    if (!st?.introduced || st.saturated) continue;
    gap = Math.max(gap, modelScore(m, bid, false) - modelScore(m, bid, true));
  }
  return gap;
}

/** Цель проверки баллов: модель игрока на API с завышением ≥ 6 п.п. и местом ≤ 3 среди моделей по API; самая завышенная. */
function auditTarget(s: RivalryGame): { model: PlayerModel; gap: number } | null {
  let best: { model: PlayerModel; gap: number } | null = null;
  for (const m of playerApiModels(s)) {
    if (m.exposed) continue;
    const gap = overfitGap(s, m);
    if (gap < 6) continue;
    const rank = marketArenaRank(s, { kind: 'player', id: m.id });
    if (rank === null || rank > 3) continue;
    if (!best || gap > best.gap) best = { model: m, gap };
  }
  return best;
}

/** Исторический уровень алгоритмов на день: уровень k достигается через k × ALGO_LEVEL_DAYS дней. */
function historicAlgoLevel(day: number): number {
  return Math.max(0, (day - dateToDay(ALGO_HISTORY_START)) / ALGO_LEVEL_DAYS);
}

// ---------- Угроза, рычаг, настрой ----------

export interface Threat {
  total: number; // 0..1
  share: number; // вклад доли
  elo: number; // вклад Эло
  price: number; // вклад цены
  rank: number; // вклад места на Арене
  hint: string; // главный сигнал: «вы дешевле на 40 %»
}

/** Доля рынка в процентах для подписи: до 10 % - с десятыми («0,4»), как в окнах. */
function sharePct(v: number): string {
  const p = v * 100;
  return p < 10 ? String(Math.round(p * 10) / 10).replace('.', ',') : String(Math.round(p));
}

/**
 * Угроза игрока для лаборатории: 0,35 × доля + 0,25 × Эло + 0,2 × [игрок дешевле новейшей модели на 30 %] +
 * 0,2 × [игрок в тройке на Арене среди моделей по API].
 */
export function threatOf(s: RivalryGame, lab: LabId): Threat {
  const shareP = playerShare(s);
  const shareL = s.market.labShares[lab] ?? 0;
  const share = 0.35 * clamp01((shareP - shareL + 0.05) / 0.2);
  const eloP = bestElo(s, 'player');
  const eloL = labBestEloIn(s, lab);
  const elo = 0.25 * clamp01((eloP - eloL + 30) / 60);
  const cheapest = playerCheapestPrice(s);
  const newest = labNewestApi(s, lab);
  const priceOk = cheapest !== null && newest !== null && cheapest <= 0.7 * newest.price;
  const price = priceOk ? 0.2 : 0;
  const bestRank = playerBestApiRank(s);
  const rank = bestRank !== null && bestRank <= 3 ? 0.2 : 0;
  const total = clamp01(share + elo + price + rank);

  let hint = 'угрозы не видит';
  const top = Math.max(share, elo, price, rank);
  if (top > 0) {
    if (top === share) hint = `ваша доля рынка ${sharePct(shareP)} % против их ${sharePct(shareL)} %`;
    else if (top === elo) hint = `ваше Эло выше на ${Math.max(1, Math.round(eloP - eloL))}`;
    else if (top === price && newest && cheapest !== null) hint = `вы дешевле на ${Math.round((1 - cheapest / newest.price) * 100)} %`;
    else hint = 'вы в тройке на «Арене»';
  }
  return { total, share, elo, price, rank, hint };
}

/** Сильная сторона игрока по итогам месяца: наибольший из выполненных запасов; null - ни одно условие не выполнено. */
export function computeLever(s: RivalryGame): Lever | null {
  const scores: { lever: Lever; margin: number }[] = [];

  const cheapest = playerCheapestPrice(s);
  const prices: number[] = [];
  for (const lab of LAB_IDS) for (const m of marketModels(s, lab)) if (m.api) prices.push(m.price);
  if (cheapest !== null && prices.length > 0) {
    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const limit = 0.7 * median;
    if (cheapest <= limit && limit > 0) scores.push({ lever: 'price', margin: (limit - cheapest) / limit });
  }

  const eloP = bestElo(s, 'player');
  let leader = 0;
  for (const lab of LAB_IDS) leader = Math.max(leader, labBestEloIn(s, lab));
  if (eloP > 0 && eloP >= leader - 10) scores.push({ lever: 'elo', margin: clamp01((eloP - leader + 10) / 60) });

  let maxHype = 0;
  for (const lab of LAB_IDS) maxHype = Math.max(maxHype, s.hype[lab] ?? 0);
  const hypeP = s.hype.player ?? 0;
  if (hypeP >= maxHype + 15) scores.push({ lever: 'hype', margin: clamp01((hypeP - maxHype - 15) / 50) });

  const ctx = playerMaxContext(s);
  const ref = refContext(s.day);
  if (ctx > 0 && ctx >= 4 * ref) scores.push({ lever: 'context', margin: clamp01(Math.log2(ctx / ref) / 6) });

  let best: { lever: Lever; margin: number } | null = null;
  for (const x of scores) if (!best || x.margin > best.margin) best = x;
  return best?.lever ?? null;
}

/** «Настрой» лаборатории для вкладки «Лаборатории»: подпись и подсказка с главным сигналом угрозы. */
export function labStance(s: RivalryGame, lab: LabId): { label: string; hint: string } {
  const r = s.rivalry;
  const special = r.active.find((a) => a.lab === lab && (a.move === 'priceWar' || a.move === 'hype' || a.move === 'audit'));
  if (special) {
    if (special.move === 'priceWar') return { label: 'ценовая война', hint: `держит цены низкими до ${formatDate(special.untilDay)}` };
    if (special.move === 'hype') return { label: 'кампания', hint: 'ведёт рекламную кампанию' };
    return { label: 'проверяет', hint: 'перепроверяет баллы вашей модели' };
  }
  const pending = r.pending.find((p) => p.lab === lab);
  if (pending) return { label: 'атакует', hint: `готовит ход: ${moveName(pending.move)}` };
  if (!labHasMarketModel(s, lab)) return { label: 'спокойна', hint: 'ещё не вышла на рынок' };
  if (!playerOnApi(s)) return { label: 'спокойна', hint: 'ждёт вашего выхода на рынок' };
  const heat = r.heat[lab] ?? 0;
  const hint = threatOf(s, lab).hint;
  if (heat >= 50) return { label: 'догоняет', hint };
  if (heat >= 25) return { label: 'присматривается', hint };
  return { label: 'спокойна', hint };
}

/** Последний исполненный ход лаборатории или null. */
export function lastMove(s: RivalryGame, lab: LabId): HistoryRow | null {
  for (let i = s.rivalry.history.length - 1; i >= 0; i--) if (s.rivalry.history[i].lab === lab) return s.rivalry.history[i];
  return null;
}

// ---------- Условия ходов ----------

const DEMAND_ID_PREFIX = 'rival-demand-';

/** Модификатор спроса хода: свой id на лабораторию и ход, чтобы ходы одной лаборатории не затирали друг друга. */
function demandId(lab: LabId, move: MoveId): string {
  return `${DEMAND_ID_PREFIX}${lab}-${move}`;
}

/** Суммарный множитель спроса от ходов соперников (все активные rival-demand-*) с учётом нового хода не выше DEMAND_BOOST_MAX. */
function demandRoom(s: RivalryGame, mult: number): boolean {
  if (mult <= 1) return true;
  let total = 1;
  for (const m of s.modifiers) {
    if (m.kind === 'demand' && m.id.startsWith(DEMAND_ID_PREFIX) && m.untilDay >= s.day && m.mult !== undefined) total *= m.mult;
  }
  return total * mult <= DEMAND_BOOST_MAX + 1e-9;
}

function priceMovesNow(s: RivalryGame): number {
  const labs = new Set<LabId>();
  for (const a of s.rivalry.active) if (MOVES[a.move].price && a.move !== 'cheapShock') labs.add(a.lab);
  for (const p of s.rivalry.pending) if (MOVES[p.move].price && p.move !== 'cheapShock') labs.add(p.lab);
  return labs.size;
}

function flagshipTarget(s: RivalryGame, lab: LabId): RivalModelDef | null {
  const diff = DIFFICULTY[s.difficulty];
  if (diff.dayShiftCap <= 0 && diff.eloAddCap <= 0) return null;
  const def = nextCatalogModel(s, lab, FLAGSHIP_MIN_AHEAD, FLAGSHIP_MAX_AHEAD);
  if (!def || s.rivalry.overrides[def.id]) return null;
  return def;
}

function contextTarget(s: RivalryGame, lab: LabId): { def: RivalModelDef; context: number } | null {
  const def = nextCatalogModel(s, lab, 1, CONTEXT_MAX_AHEAD);
  if (!def || s.rivalry.overrides[def.id]?.context !== undefined) return null;
  const cap = Math.min(CONTEXT_CAP, labCatalogMaxContext(lab));
  const context = Math.min(cap, def.context * 4);
  if (context <= def.context) return null;
  return { def, context };
}

/** Выполнено ли условие хода (без накала, перерывов и характера). */
export function triggerHolds(s: RivalryGame, lab: LabId, move: MoveId): boolean {
  const diff = DIFFICULTY[s.difficulty];
  const p = personalityOf(lab);
  const shareP = playerShare(s);
  const shareL = s.market.labShares[lab] ?? 0;
  const cheapest = playerCheapestPrice(s);
  const eloP = bestElo(s, 'player');
  const eloL = labBestEloIn(s, lab);
  switch (move) {
    case 'priceCut': {
      if (labNewestApi(s, lab) === null) return false;
      if (priceMovesNow(s) >= diff.priceLabsAtOnce) return false;
      if (!demandRoom(s, MOVES.priceCut.demand)) return false;
      const drop = p.gates.priceCutShareDrop;
      if (drop !== undefined && !playerDominates(s) && (s.rivalry.shareHigh[lab] ?? 0) - shareL < drop) return false;
      const labCheapest = labCheapestApiPrice(s, lab);
      return shareP >= shareL || (cheapest !== null && labCheapest !== null && cheapest <= 0.8 * labCheapest);
    }
    case 'priceWar':
      return s.rivalry.active.some((a) => a.lab === lab && a.move === 'priceCut') && s.rivalry.memory[lab].priceMatched;
    case 'flagship': {
      // Лучшая модель игрока в продаже по API против лучшей модели лаборатории на рынке.
      const apiP = playerBestApiElo(s);
      return apiP > 0 && apiP >= labMarketBestElo(s, lab) - 10 && flagshipTarget(s, lab) !== null;
    }
    case 'cheapShock':
      // Дешёвая модель бьёт по разработчикам: условие - доля игрока именно в этом сегменте.
      return (
        s.day >= dateToDay('2023-06-01') &&
        segShare(s, 'developers', 'player') >= diff.shockShare &&
        cheapest !== null &&
        cheapest >= 0.5 * refPrice(s.day) &&
        extrasAllowed(s, lab) &&
        cheapShockCount(s) < CHEAP_SHOCKS_PER_GAME &&
        demandRoom(s, MOVES.cheapShock.demand) &&
        pickTemplate(s, lab, 'cheap') !== null
      );
    case 'hype':
      return (s.hype.player ?? 0) >= (s.hype[lab] ?? 0) + 20 && eloL > 0 && eloL >= eloP - 50;
    case 'freeTier':
      // Бесплатный чат отвечает на успех игрока у обычных пользователей (подписки).
      return s.day >= dateToDay('2022-11-30') && segShare(s, 'consumers', 'player') >= FREE_TIER_SHARE;
    case 'openWeights':
      return (
        s.day >= dateToDay('2023-03-01') &&
        (eloL <= eloP - 30 || shareP > shareL) &&
        extrasAllowed(s, lab) &&
        pickTemplate(s, lab, 'open') !== null
      );
    case 'context': {
      const ctxP = playerMaxContext(s);
      const ctxL = labBestContext(s, lab);
      if (s.day < dateToDay('2023-05-01') || shareP < 0.05 || ctxP <= 0 || ctxL <= 0 || ctxP < 4 * ctxL) return false;
      return contextTarget(s, lab) !== null || (extrasAllowed(s, lab) && pickTemplate(s, lab, 'context') !== null);
    }
    case 'audit':
      return auditTarget(s) !== null;
    case 'poach': {
      // Звёздную команду (сделки 2023-2024) переманивают всегда, когда лаборатория готова к ходу.
      if (poachTeam(s) !== null) return true;
      const done = (t: 'rlhf' | 'scaling') => s.research.done.includes(t);
      const early = (done('rlhf') && yearsEarly(s, 'rlhf') > 1) || (done('scaling') && yearsEarly(s, 'scaling') > 1);
      return early || s.research.algoLevel >= 1.5 * Math.max(1, historicAlgoLevel(s.day));
    }
  }
}

/** Модель, к которой привязан ход (для pending.modelId). */
function moveModelId(s: RivalryGame, lab: LabId, move: MoveId): string | undefined {
  if (move === 'flagship') return flagshipTarget(s, lab)?.id;
  if (move === 'context') return contextTarget(s, lab)?.def.id;
  if (move === 'audit') return auditTarget(s)?.model.id;
  return undefined;
}

interface Candidate {
  move: MoveId;
  weight: number;
}

function candidateMoves(s: RivalryGame, lab: LabId): Candidate[] {
  const r = s.rivalry;
  const diff = DIFFICULTY[s.difficulty];
  const p = personalityOf(lab);
  const out: Candidate[] = [];
  for (const move of MOVE_IDS) {
    const base = p.weights[move] ?? 0;
    if (base <= 0 || p.never.includes(move)) continue;
    const from = p.gates.moveFrom?.[move];
    const dominance = move === 'priceCut' && playerDominates(s);
    if (from !== undefined && s.day < dateToDay(from) && !dominance) continue;
    if ((r.moveCooldown[`${lab}:${move}`] ?? 0) > s.day) continue;
    if ((r.moveCooldown[`global:${move}`] ?? 0) > s.day) continue;
    if (r.pending.some((x) => x.lab === lab && x.move === move)) continue;
    if (!triggerHolds(s, lab, move)) continue;
    let weight = base * (dominance ? DOMINANCE_PRICE_WEIGHT : 1);
    if (diff.learning !== 'none') {
      if (r.lever !== null && LEVER_COUNTERS[r.lever].includes(move)) weight *= 1.3;
      const mem = r.memory[lab];
      if (mem.lastMove === move && mem.worked === false) weight = 0;
      if (diff.learning === 'memory') {
        if (mem.lastMove === move && mem.worked === true) weight *= 1.25;
        if (mem.priceMatched && !MOVES[move].price) weight *= 2;
      }
    }
    if (weight > 0) out.push({ move, weight });
  }
  return out;
}

/** Один взвешенный розыгрыш (единственное обращение к nextRandom в модуле). */
function drawMove(s: RivalryGame, cands: Candidate[]): MoveId {
  const total = cands.reduce((a, c) => a + c.weight, 0);
  let x = nextRandom(s) * total;
  for (const c of cands) {
    x -= c.weight;
    if (x < 0) return c.move;
  }
  return cands[cands.length - 1].move;
}

// ---------- Слухи ----------

function rumourTitle(lab: LabId, move: MoveId): string {
  const name = labName(lab);
  switch (move) {
    case 'priceCut':
      return `Слухи: ${name} готовит снижение цен`;
    case 'priceWar':
      return `Слухи: ${name} ответит на ваши цены`;
    case 'flagship':
      return `Слухи: ${name} ускоряет новую модель`;
    case 'cheapShock':
      return `Слухи: ${name} готовит дешёвую модель`;
    case 'hype':
      return `Слухи: ${name} готовит рекламную кампанию`;
    case 'freeTier':
      return `Слухи: ${name} сделает чат бесплатным`;
    case 'openWeights':
      return `Слухи: ${name} откроет веса модели`;
    case 'context':
      return `Слухи: ${name} работает над длинным контекстом`;
    case 'audit':
      return `Слухи: ${name} проверяет баллы вашей модели`;
    case 'poach':
      return `Слухи: ${name} присматривается к вашим исследователям`;
  }
}

function rumourBody(s: RivalryGame, lab: LabId, move: MoveId, days: number, modelId?: string): string {
  const name = labName(lab);
  const when = `Ожидается примерно через ${daysWord(days)}.`;
  switch (move) {
    case 'priceCut':
      return playerDominates(s)
        ? `По данным клиентов, ${name} готовит глубокое снижение цен на API: ваша доля рынка - ${Math.round(playerShare(s) * 100)} %, и соперники отвечают ценой. ${when}`
        : `По данным клиентов, ${name} обсуждает с партнёрами новые, более низкие цены на API. ${when}`;
    case 'priceWar':
      return `${name} заметила, что вы снизили цены вслед за ней, и готовит ещё одно снижение. ${when} Каждый месяц ценовой войны отнимает шумиху у самой ${name}.`;
    case 'flagship': {
      const def = modelId ? findRivalDef(modelId) : undefined;
      const what = def ? `выход ${def.gameName}` : 'выход новой модели';
      return `Сотрудники ${name} сообщают, что ${what} перенесён на более ранний срок, а планка качества поднята. ${when} Модель, которая на выпуске займёт первое место, получит больше шумихи.`;
    }
    case 'cheapShock':
      return `${name} испытывает облегчённую модель с ценой в несколько раз ниже рынка. ${when} Ответить можно своей дешёвой моделью или уйти в дорогой сегмент.`;
    case 'hype':
      return `${name} закупает рекламу и готовит громкие анонсы. ${when}`;
    case 'freeTier':
      return `${name} готовит бесплатный доступ к своему чату для всех. ${when} Рынок подписок вырастет, но бренд ${name} у обычных пользователей станет сильнее: удержать подписчиков помогут цена подписки и контекст.`;
    case 'openWeights':
      return `${name} готовит публикацию весов одной из моделей. ${when} Открытые веса удешевляют исследования всем, включая вас.`;
    case 'context':
      return `${name} отвечает на ваш длинный контекст: следующая модель получит контекст в несколько раз больше. ${when}`;
    case 'audit': {
      const m = modelId ? s.models.find((x) => x.id === modelId) : undefined;
      const what = m ? `модели «${m.name}»` : 'вашей модели';
      return `Исследователи ${name} перепроверяют баллы ${what} на свежих вопросах. Результаты ожидаются примерно через ${daysWord(days)}.`;
    }
    case 'poach': {
      const team = poachTeam(s);
      const who = team ? `команде ${teamDef(team).leader}` : 'вашим исследователям';
      return `Рекрутеры ${name} пишут ${who}. Предложения ожидаются примерно через ${daysWord(days)}.`;
    }
  }
}

/** Ходов за скользящий год: исполненные (история) плюс запланированные. */
function movesLastYear(s: RivalryGame): number {
  return s.rivalry.history.filter((h) => h.day > s.day - 365).length + s.rivalry.pending.length;
}

function schedule(s: RivalryGame, lab: LabId, move: MoveId): void {
  const r = s.rivalry;
  const diff = DIFFICULTY[s.difficulty];
  const p = personalityOf(lab);
  const days = Math.max(1, Math.round((MOVES[move].price ? diff.priceDelay : diff.delay) * p.delayMult));
  const modelId = moveModelId(s, lab, move);
  r.heat[lab] = Math.max(0, r.heat[lab] - HEAT_SPEND);
  r.pending.push({ id: `${lab}:${move}:${s.day}`, lab, move, fireDay: s.day + days, modelId });
  r.cooldownUntil[lab] = s.day + LAB_COOLDOWN;
  const cd = MOVES[move].labCooldown;
  if (cd > 0) r.moveCooldown[`${lab}:${move}`] = cd === FOREVER ? FOREVER : s.day + cd;
  const gcd = globalCooldown(move, diff);
  if (gcd > 0) r.moveCooldown[`global:${move}`] = s.day + gcd;
  addMail(s, { kind: 'rival', title: rumourTitle(lab, move), body: rumourBody(s, lab, move, days, modelId) });
}

// ---------- Конец месяца ----------

/** Соперники спят (накал 0): до 2021 года и пока у игрока нет модели в продаже по API. */
function globallyDormant(s: RivalryGame): boolean {
  return s.day < dateToDay(RIVALRY_START) || !playerOnApi(s);
}

/** Лучший Эло моделей лаборатории на рынке (0 - нет моделей). */
function labMarketBestElo(s: RivalryGame, lab: LabId): number {
  return marketModels(s, lab).reduce((best, m) => Math.max(best, m.elo), 0);
}

/** Лаборатория спит: нет модели на рынке, не наступила дата активности, доля игрока ниже порога характера. */
function labDormant(s: RivalryGame, lab: LabId): boolean {
  const g = personalityOf(lab).gates;
  if (!labHasMarketModel(s, lab)) return true;
  if (g.activeFrom !== undefined && s.day < dateToDay(g.activeFrom)) return true;
  if (g.minPlayerShare !== undefined && playerShare(s) < g.minPlayerShare) return true;
  return false;
}

/**
 * Конец месяца (после monthlyExposure, до pruneModifiers): шумиха воюющих лабораторий, рычаг игрока, накал каждой
 * лаборатории и планирование ходов. Лаборатории идут в порядке LAB_IDS; случайность - только в выборе хода.
 * Пока ждёт ответа письмо с выбором, месяц пропускается целиком: ни накала, ни розыгрышей (накал не сбрасывается).
 * Ценовая война - продолжение собственного снижения цен, поэтому её можно запланировать и во время перерыва
 * лаборатории (cooldownUntil); остальные условия (накал, лимит ходов, перерыв самого хода) действуют как обычно.
 */
export function rivalryMonth(s: RivalryGame): void {
  const r = s.rivalry;
  const diff = DIFFICULTY[s.difficulty];
  for (const a of r.active) {
    if (a.move === 'priceWar') s.hype[a.lab] = Math.max(0, (s.hype[a.lab] ?? 0) - WAR_HYPE_PER_MONTH);
  }
  if (pendingChoice(s) !== null) return;
  if (globallyDormant(s)) {
    for (const lab of LAB_IDS) r.heat[lab] = 0;
    return;
  }
  r.lever = diff.learning === 'none' ? null : computeLever(s);
  let acted = 0;
  for (const lab of LAB_IDS) {
    if (labDormant(s, lab)) {
      r.heat[lab] = 0;
      continue;
    }
    r.shareHigh[lab] = Math.max(r.shareHigh[lab] ?? 0, s.market.labShares[lab] ?? 0);
    const threat = threatOf(s, lab).total;
    const gain = personalityOf(lab).gain;
    r.heat[lab] = clamp((r.heat[lab] ?? 0) + HEAT_GAIN * threat * gain * diff.gain - HEAT_DECAY, 0, 100);
    if (acted >= diff.actorsPerMonth) continue;
    if (r.heat[lab] < diff.threshold) continue;
    if (r.pending.length + r.active.length >= diff.cap) continue;
    if (movesLastYear(s) >= MAX_MOVES_PER_YEAR) continue;
    let cands = candidateMoves(s, lab);
    if (r.cooldownUntil[lab] > s.day) cands = cands.filter((c) => c.move === 'priceWar');
    if (cands.length === 0) continue;
    schedule(s, lab, drawMove(s, cands));
    acted += 1;
  }
}

/** Ходы, которые лаборатория могла бы запланировать сегодня (условия, перерывы ходов, характер); без накала и лимитов. */
export function availableMoves(s: RivalryGame, lab: LabId): MoveId[] {
  return candidateMoves(s, lab).map((c) => c.move);
}

// ---------- Исполнение ходов ----------

function pushActive(s: RivalryGame, lab: LabId, move: MoveId): void {
  const days = MOVES[move].activeDays;
  if (days <= 0) return;
  s.rivalry.active.push({ lab, move, untilDay: s.day + days });
}

/** Поправка дня выхода модели: не больше лимита, суммарного лимита лаборатории, не раньше предшественницы + 30 и завтрашнего дня. */
function allowedShift(s: RivalryGame, def: RivalModelDef, wanted: number): number {
  const diff = DIFFICULTY[s.difficulty];
  const day = rivalDayIn(s, def);
  const pred = predecessorDay(s, def.lab);
  let shift = Math.min(Math.round(wanted), diff.dayShiftCap, LAB_DAYSHIFT_MAX - labDayShiftTotal(s, def.lab), day - (s.day + 1));
  if (Number.isFinite(pred)) shift = Math.min(shift, day - (pred + PREDECESSOR_GAP));
  return Math.max(0, shift);
}

/** Прибавка Эло модели каталога: лимиты на модель и на лабораторию, ноль в последние 90 дней игры. */
function allowedEloAdd(s: RivalryGame, def: RivalModelDef, wanted: number, releaseDay: number): number {
  const diff = DIFFICULTY[s.difficulty];
  if (releaseDay > END_DAY - QUIET_END_DAYS) return 0;
  return Math.max(0, Math.min(Math.round(wanted), diff.eloAddCap, diff.eloAddLabCap - labEloAddTotal(s, def.lab)));
}

function execPriceCut(s: RivalryGame, lab: LabId): string | null {
  const diff = DIFFICULTY[s.difficulty];
  const p = personalityOf(lab);
  if (labNewestApi(s, lab) === null) return null;
  let mult = clamp(1 - 0.3 * diff.k * p.priceCutMult * (playerDominates(s) ? DOMINANCE_CUT_MULT : 1), 0.05, 0.99);
  // Ответ на господство: цена новейшей модели лаборатории ниже самой дешёвой цены игрока (иначе снижение ничего не меняет).
  const newest = labNewestApi(s, lab);
  const mine = playerCheapestPrice(s);
  if (playerDominates(s) && newest && mine !== null && newest.price > 0) {
    mult = clamp(Math.min(mult, (DOMINANCE_UNDERCUT * mine) / newest.price), 0.05, 0.99);
  }
  const until = s.day + MOVES.priceCut.activeDays;
  addRivalModifier(s, { id: `rivalprice-${lab}`, kind: 'rivalPrice', target: lab, mult, add: PRICE_FLOOR_SHARE, untilDay: until });
  addModifier(s, { id: demandId(lab, 'priceCut'), kind: 'demand', mult: MOVES.priceCut.demand, untilDay: until });
  pushActive(s, lab, 'priceCut');
  const pct = Math.round((1 - mult) * 100);
  addMail(s, {
    kind: 'rival',
    title: `${labName(lab)} снизила цены на API`,
    body:
      `Цены на модели ${labName(lab)} ниже на ${pct} % в течение ${MOVES.priceCut.activeDays} дней (не ниже ${fmtPrice(Math.max(minPrice(s.day), PRICE_FLOOR_SHARE * refPrice(s.day)))} за 1 млн токенов). ` +
      'Спрос на рынке вырос на 5 %. Цены своих моделей меняются в окне «Модели».',
  });
  return `снизила цены на API на ${pct} %`;
}

function execPriceWar(s: RivalryGame, lab: LabId): string | null {
  const diff = DIFFICULTY[s.difficulty];
  if (labNewestApi(s, lab) === null) return null;
  const until = s.day + MOVES.priceWar.activeDays;
  addRivalModifier(s, { id: `rivalprice-${lab}`, kind: 'rivalPrice', target: lab, mult: 0.5, add: diff.warFloor, untilDay: until });
  s.rivalry.active = s.rivalry.active.filter((a) => !(a.lab === lab && a.move === 'priceCut'));
  pushActive(s, lab, 'priceWar');
  const floor = Math.max(minPrice(s.day), diff.warFloor * refPrice(s.day));
  addMail(s, {
    kind: 'rival',
    title: `${labName(lab)}: цены ещё ниже`,
    body:
      `${labName(lab)} снизила цены вдвое от прежних и держит их ${MOVES.priceWar.activeDays} дней, но не ниже ${fmtPrice(floor)} за 1 млн токенов. ` +
      `Каждый месяц войны стоит ${labName(lab)} ${WAR_HYPE_PER_MONTH} шумихи.`,
  });
  return 'снизила цены вдвое';
}

function execFlagship(s: RivalryGame, lab: LabId, modelId?: string): string | null {
  const diff = DIFFICULTY[s.difficulty];
  const def = modelId ? findRivalDef(modelId) : flagshipTarget(s, lab);
  if (!def || def.lab !== lab || STORY_LOCKED.has(def.id) || s.rivalsReleased.includes(def.id)) return null;
  if (s.rivalry.overrides[def.id]) return null;
  const shift = allowedShift(s, def, 30 * diff.k);
  const newDay = rivalDayIn(s, def) - shift;
  const add = allowedEloAdd(s, def, 10 * diff.k, newDay);
  if (shift === 0 && add === 0) return null;
  const o: RivalOverride = {};
  if (shift > 0) o.dayShift = -shift;
  if (add > 0) o.eloAdd = add;
  s.rivalry.overrides[def.id] = o;
  pushActive(s, lab, 'flagship');
  const parts: string[] = [];
  if (shift > 0) parts.push(`выйдет на ${daysWord(shift)} раньше, ${formatDate(newDay)}`);
  if (add > 0) parts.push(`примерно на ${add} Эло сильнее, чем ожидалось`);
  addMail(s, {
    kind: 'rival',
    title: `${labName(lab)} ускорила выпуск ${def.gameName}`,
    body: `${def.gameName} ${parts.join(' и ')}. Модель, которая на выпуске займёт первое место, получит больше шумихи.`,
  });
  return `ускорила ${def.gameName}${shift > 0 ? ` на ${daysWord(shift)}` : ''}`;
}

function execCheapShock(s: RivalryGame, lab: LabId): string | null {
  const diff = DIFFICULTY[s.difficulty];
  if (!extrasAllowed(s, lab) || cheapShockCount(s) >= CHEAP_SHOCKS_PER_GAME) return null;
  const t = pickTemplate(s, lab, 'cheap');
  if (!t) return null;
  const catalogBest = labCatalogBestElo(s, lab);
  if (catalogBest <= 0) return null;
  const elo = Math.min(labBestEloIn(s, lab) - diff.shockGap, catalogBest - 20);
  const newest = labNewestApi(s, lab);
  const labDefault = rivalPrice(reactiveDef(t.id), s.day);
  const basePrice = newest ? rivalBasePrice(s, newest.def) : labDefault;
  const price = Math.max(minPrice(s.day), basePrice * 0.3);
  const latest = marketModels(s, lab)[0];
  const context = latest ? latest.context : (reactiveDef(t.id)).context;
  const def = releaseExtra(s, t, { eloAdd: elo - (reactiveDef(t.id)).arenaElo, price, context });
  s.hype[lab] = Math.min(100, (s.hype[lab] ?? 0) + 10);
  addModifier(s, { id: demandId(lab, 'cheapShock'), kind: 'demand', mult: MOVES.cheapShock.demand, untilDay: s.day + MOVES.cheapShock.activeDays });
  pushActive(s, lab, 'cheapShock');
  addMail(s, {
    kind: 'rival',
    title: `${labName(lab)} выпустила ${def.gameName}: втрое дешевле`,
    body:
      `${def.gameName}: Эло на «Арене» около ${Math.round(elo)}, цена ${fmtPrice(price)} за 1 млн токенов, контекст ${contextLabel(context)} токенов. ` +
      `Шумиха ${labName(lab)} +10, спрос на рынке +10 % на ${MOVES.cheapShock.activeDays} дней. Ответить можно своей дешёвой моделью или уйти в дорогой сегмент.`,
  });
  return `выпустила дешёвую ${def.gameName}`;
}

function execOpenWeights(s: RivalryGame, lab: LabId): string | null {
  if (!extrasAllowed(s, lab)) return null;
  const t = pickTemplate(s, lab, 'open');
  if (!t) return null;
  const best = labBestEloIn(s, lab);
  if (best <= 0) return null;
  const elo = best - 50;
  const latest = marketModels(s, lab)[0];
  const tdef = reactiveDef(t.id);
  const def = releaseExtra(s, t, { eloAdd: elo - tdef.arenaElo, context: latest ? latest.context : tdef.context });
  addModifier(s, { id: `rival-openweights-brand-${lab}`, kind: 'labBrand', target: lab, add: 0.1, untilDay: s.day + 365 });
  addModifier(s, { id: `rival-openweights-research-${lab}`, kind: 'researchCost', mult: 0.9, untilDay: s.day + 90 });
  pushActive(s, lab, 'openWeights');
  addMail(s, {
    kind: 'rival',
    title: `${labName(lab)} открыла веса ${def.gameName}`,
    body:
      `${def.gameName}: Эло на «Арене» около ${Math.round(elo)}, веса открыты. Бренд ${labName(lab)} сильнее на год. ` +
      'Ваши исследования дешевле на 10 % в течение 90 дней: открытые веса помогают всем.',
  });
  return `открыла веса ${def.gameName}`;
}

function execContext(s: RivalryGame, lab: LabId, modelId?: string): string | null {
  const diff = DIFFICULTY[s.difficulty];
  const target = modelId ? (findRivalDef(modelId) ?? null) : contextTarget(s, lab)?.def ?? null;
  if (target && target.lab === lab && !STORY_LOCKED.has(target.id) && !s.rivalsReleased.includes(target.id)) {
    const cap = Math.min(CONTEXT_CAP, labCatalogMaxContext(lab));
    const context = Math.min(cap, target.context * 4);
    if (context > target.context && s.rivalry.overrides[target.id]?.context === undefined) {
      const shift = allowedShift(s, target, 15 * diff.k);
      const o: RivalOverride = { ...(s.rivalry.overrides[target.id] ?? {}), context };
      if (shift > 0) o.dayShift = (o.dayShift ?? 0) - shift;
      s.rivalry.overrides[target.id] = o;
      pushActive(s, lab, 'context');
      addMail(s, {
        kind: 'rival',
        title: `${labName(lab)} ответила длинным контекстом`,
        body: `${target.gameName} выйдет с контекстом ${contextLabel(context)} токенов${shift > 0 ? ` и на ${daysWord(shift)} раньше, ${formatDate(rivalDayIn(s, target))}` : ''}.`,
      });
      return `даст ${target.gameName} контекст ${contextLabel(context)}`;
    }
  }
  if (!extrasAllowed(s, lab)) return null;
  const t = pickTemplate(s, lab, 'context');
  if (!t) return null;
  const base = findRivalDef(t.base);
  if (!base) return null;
  const context = Math.min(CONTEXT_CAP, t.context ?? base.context);
  const price = base.api ? rivalBasePrice(s, base) * 1.2 : rivalPrice(reactiveDef(t.id), s.day);
  // На 10 Эло слабее базовой и, как любая ответная модель, не ближе 20 Эло к лучшей модели лаборатории.
  const elo = Math.min(base.arenaElo - 10, labBestEloIn(s, lab) - 20);
  const def = releaseExtra(s, t, { eloAdd: elo - base.arenaElo, context, price: Math.max(minPrice(s.day), price) });
  pushActive(s, lab, 'context');
  addMail(s, {
    kind: 'rival',
    title: `${labName(lab)} ответила длинным контекстом`,
    body: `${def.gameName}: контекст ${contextLabel(context)} токенов, Эло на «Арене» около ${Math.round(rivalEloIn(s, def))}, цена ${fmtPrice(rivalPriceIn(s, def))} за 1 млн токенов.`,
  });
  return `выпустила ${def.gameName}`;
}

/** Письмо с выбором: как triggerEvent для повторяемого события, но без поиска в EVENTS (регистрация - при интеграции). */
function fireChoiceEvent(s: RivalryGame, def: EventDef): void {
  const mail = def.mail(s);
  def.onFire?.(s);
  const choices = def.choices ?? [];
  const added = addMail(s, {
    ...mail,
    eventId: def.id,
    choices: mailChoices(s, def) ?? [],
    important: true,
  });
  added.replyByDay = s.day + (def.choiceDays ?? CHOICE_DAYS);
  added.defaultChoice = def.defaultChoice ?? choices.length - 1;
}

function execHype(s: RivalryGame, lab: LabId): string | null {
  const diff = DIFFICULTY[s.difficulty];
  const add = Math.round(20 * diff.k);
  s.hype[lab] = Math.min(100, (s.hype[lab] ?? 0) + add);
  // modelId сохраняем: письмо проверки баллов могло ещё ждать ответа.
  s.rivalry.choice = { lab, modelId: s.rivalry.choice?.modelId };
  fireChoiceEvent(s, HYPE_EVENT);
  pushActive(s, lab, 'hype');
  return `запустила рекламную кампанию (+${add} шумихи)`;
}

function execFreeTier(s: RivalryGame, lab: LabId): string | null {
  const diff = DIFFICULTY[s.difficulty];
  const until = s.day + MOVES.freeTier.activeDays;
  // Бренд растёт только у обычных пользователей (сегмент подписок), спрос - на подписки, а не на API.
  addModifier(s, { id: `rival-freetier-${lab}`, kind: 'segBrand', target: `${lab}:consumers`, add: FREE_TIER_SEG_BRAND * diff.k, untilDay: until });
  addModifier(s, { id: `rival-subsdemand-${lab}`, kind: 'subsDemand', mult: FREE_TIER_SUBS_DEMAND, untilDay: until });
  pushActive(s, lab, 'freeTier');
  const pct = Math.round((FREE_TIER_SUBS_DEMAND - 1) * 100);
  addMail(s, {
    kind: 'rival',
    title: `${labName(lab)} сделала чат бесплатным`,
    body: `Бренд ${labName(lab)} у обычных пользователей сильнее в течение ${MOVES.freeTier.activeDays} дней, спрос на подписки вырос на ${pct} %. Удержать подписчиков помогут цена подписки и контекст.`,
  });
  return 'сделала чат бесплатным';
}

function execAudit(s: RivalryGame, lab: LabId, modelId?: string): string | null {
  const model = modelId ? s.models.find((m) => m.id === modelId) : auditTarget(s)?.model;
  // Чистую модель не проверяют, даже если слух уже был (подгонка могла раскрыться сама или модель снята с продажи).
  if (!model || model.exposed || !model.onApi || model.releasedDay === null || overfitGap(s, model) < 6) return null;
  s.rivalry.choice = { lab, modelId: model.id };
  fireChoiceEvent(s, AUDIT_EVENT);
  pushActive(s, lab, 'audit');
  return `усомнилась в баллах «${model.name}»`;
}

/** Команду с самой большой зарплатой переманивают первой; null - звёздных команд нет. */
function poachTeam(s: GameState): TeamId | null {
  let best: TeamId | null = null;
  for (const t of s.late?.teams ?? []) if (best === null || teamDef(t.id).salary > teamDef(best).salary) best = t.id;
  return best;
}

function execPoach(s: RivalryGame, lab: LabId): string | null {
  const team = poachTeam(s);
  if (team) {
    s.rivalry.choice = { lab, modelId: s.rivalry.choice?.modelId, team };
    fireChoiceEvent(s, TEAM_POACH_EVENT);
    pushActive(s, lab, 'poach');
    return `переманивает: ${teamDef(team).name.toLowerCase()}`;
  }
  s.rivalry.choice = { lab, modelId: s.rivalry.choice?.modelId };
  fireChoiceEvent(s, POACH_EVENT);
  pushActive(s, lab, 'poach');
  return 'переманивает исследователей';
}

/** Исполнить ход: эффекты и письмо. Возвращает короткий текст для истории или null, если ход не состоялся. */
export function executeMove(s: RivalryGame, p: PendingMove): string | null {
  switch (p.move) {
    case 'priceCut':
      return execPriceCut(s, p.lab);
    case 'priceWar':
      return execPriceWar(s, p.lab);
    case 'flagship':
      return execFlagship(s, p.lab, p.modelId);
    case 'cheapShock':
      return execCheapShock(s, p.lab);
    case 'hype':
      return execHype(s, p.lab);
    case 'freeTier':
      return execFreeTier(s, p.lab);
    case 'openWeights':
      return execOpenWeights(s, p.lab);
    case 'context':
      return execContext(s, p.lab, p.modelId);
    case 'audit':
      return execAudit(s, p.lab, p.modelId);
    case 'poach':
      return execPoach(s, p.lab);
  }
}

function fireMove(s: RivalryGame, p: PendingMove): void {
  const r = s.rivalry;
  const text = executeMove(s, p);
  if (text === null) {
    addMail(s, {
      kind: 'rival',
      title: `Слухи ${/^[aeiouаеёиоуыэюя]/i.test(labName(p.lab)) ? 'об' : 'о'} ${labName(p.lab)} не подтвердились`,
      body: `${labName(p.lab)} отказалась от хода «${moveName(p.move)}»: обстоятельства изменились.`,
    });
    return;
  }
  r.memory[p.lab] = {
    lastMove: p.move,
    firedDay: s.day,
    shareBefore: playerShare(s),
    priceBefore: playerCheapestPrice(s) ?? 0,
    worked: null,
    priceMatched: false,
  };
  r.history.push({ day: s.day, lab: p.lab, move: p.move, text });
  if (r.history.length > HISTORY_MAX) r.history.splice(0, r.history.length - HISTORY_MAX);
}

const DENIED_FLAG = 'rivalDenied:';

/**
 * Ежедневно (сразу после releaseDue): срабатывание слухов с fireDay ≤ day, оценка памяти (через 60 дней - сработал
 * ли ход; 30 дней - ответил ли игрок ценой), истечение активных ходов, штраф за отрицание проверки баллов.
 */
export function rivalryDay(s: RivalryGame): void {
  const r = s.rivalry;
  if (r.pending.length > 0) {
    const due = r.pending.filter((p) => p.fireDay <= s.day);
    if (due.length > 0) {
      r.pending = r.pending.filter((p) => p.fireDay > s.day);
      for (const p of due) fireMove(s, p);
    }
  }
  const share = playerShare(s);
  const cheapest = playerCheapestPrice(s);
  for (const lab of LAB_IDS) {
    const mem = r.memory[lab];
    if (mem.lastMove === null) continue;
    if (mem.worked === null && s.day >= mem.firedDay + MEMORY_DAYS) {
      mem.worked = mem.shareBefore > 0 && share <= mem.shareBefore * (1 - WORKED_DROP);
    }
    if (!mem.priceMatched && MOVES[mem.lastMove].price && s.day <= mem.firedDay + PRICE_MATCH_DAYS) {
      if (mem.priceBefore > 0 && cheapest !== null && cheapest <= mem.priceBefore * (1 - PRICE_MATCH_DROP)) mem.priceMatched = true;
    }
  }
  if (r.active.length > 0) r.active = r.active.filter((a) => a.untilDay >= s.day);
  for (const key of Object.keys(s.flags)) {
    if (!key.startsWith(DENIED_FLAG) || !s.flags[key]) continue;
    const id = key.slice(DENIED_FLAG.length);
    const m = s.models.find((x) => x.id === id);
    if (!m) {
      delete s.flags[key];
      continue;
    }
    if (!m.exposed) continue;
    delete s.flags[key];
    s.reputation = clamp(s.reputation - DENIAL_REP, 0, 100);
    addMail(s, {
      kind: 'news',
      title: `Отрицание обернулось против лаборатории: ${m.name}`,
      important: true,
      body: `Лаборатория отрицала сомнения в баллах «${m.name}», и теперь подгонка раскрыта. Репутация упала ещё на ${DENIAL_REP}.`,
    });
  }
}

// ---------- Письма с выбором (EventDef; регистрация через findEvent при интеграции) ----------

function choiceLab(s: GameState): LabId {
  return (s as RivalryGame).rivalry.choice?.lab ?? 'openbrain';
}

function choiceModel(s: GameState): PlayerModel | undefined {
  const id = (s as RivalryGame).rivalry.choice?.modelId;
  return id ? s.models.find((m) => m.id === id) : undefined;
}

const HYPE_EVENT: EventDef = {
  id: 'rival-hype',
  repeatable: true,
  when: { check: () => false },
  defaultChoice: 1,
  mail: (s) => {
    const lab = labName(choiceLab(s));
    const cost = HYPE_CAMPAIGN_COST * yearMult(s.day);
    return {
      kind: 'rival',
      title: `${lab} запустила рекламную кампанию`,
      body: `${lab} закупила рекламу и выступает с громкими анонсами: её шумиха выросла. Клиенты, которые выбирают модель, видят рекламу ${lab} чаще вашей. Ответная кампания стоит ${endSentence(fmtMoney(cost))}`,
    };
  },
  choices: [
    {
      label: 'Ответная кампания',
      story: 'Своя реклама вернёт внимание к вашим моделям',
      hint: '',
      hintFn: (s) => `-${fmtMoney(HYPE_CAMPAIGN_COST * yearMult(s.day))}, +15 шумихи`,
      apply: (s) => {
        spend(s, 'overhead', HYPE_CAMPAIGN_COST * yearMult(s.day));
        s.hype.player = Math.min(100, s.hype.player + 15);
      },
    },
    { label: 'Не отвечать', story: 'Кампания соперника пройдёт без ответа', hint: 'без изменений', apply: () => {} },
  ],
};

const AUDIT_EVENT: EventDef = {
  id: 'rival-audit',
  repeatable: true,
  when: { check: () => false },
  defaultChoice: 2,
  mail: (s) => {
    const lab = labName(choiceLab(s));
    const m = choiceModel(s);
    const name = m ? m.name : 'вашей модели';
    const gap = m ? Math.round(overfitGap(s, m)) : 0;
    return {
      kind: 'rival',
      title: `${lab} сомневается в баллах модели «${name}»`,
      body:
        `Исследователи ${lab} проверили «${name}» на свежих вопросах: на целевых бенчмарках баллы завышены примерно на ${gap} п.п. ` +
        'Статью о проверке они готовят к публикации.',
    };
  },
  choices: [
    {
      label: 'Опубликовать честные баллы',
      story: 'Модель признают подогнанной, но скандала не будет',
      hint: 'модель разоблачена, -5 репутации, шумиха -20 %',
      apply: (s) => {
        const m = choiceModel(s);
        if (m) m.exposed = true;
        s.reputation = clamp(s.reputation - 5, 0, 100);
        s.hype.player *= 0.8;
      },
    },
    {
      label: 'Снять с продажи',
      story: 'Модель уйдёт с рынка до конца проверки',
      hint: 'модель снята с API, -10 шумихи',
      apply: (s) => {
        const m = choiceModel(s);
        if (m) m.onApi = false;
        s.hype.player = Math.max(0, s.hype.player - 10);
      },
    },
    {
      label: 'Отрицать',
      story: 'Соперник продолжит проверку, позднее разоблачение ударит сильнее',
      hint: 'шанс разоблачения ×2 на 180 дней; если разоблачат, ещё -20 репутации',
      apply: (s) => {
        const m = choiceModel(s);
        if (!m) return;
        addRivalModifier(s, { id: `rival-exposure-${m.id}`, kind: 'exposure', target: m.id, mult: 2, untilDay: s.day + 180 });
        s.flags[`${DENIED_FLAG}${m.id}`] = true;
      },
    },
  ],
};

const POACH_EVENT: EventDef = {
  id: 'rival-poach',
  repeatable: true,
  when: { check: () => false },
  defaultChoice: 1,
  mail: (s) => {
    const lab = labName(choiceLab(s));
    const cost = POACH_MONTHS * OVERHEAD_MONTHLY * yearMult(s.day);
    return {
      kind: 'rival',
      title: `${lab} переманивает исследователей`,
      body: `${lab} предлагает вашим ведущим исследователям зарплаты выше рыночных. Двое уже сходили на собеседование. Удержать людей стоит ${endSentence(fmtMoney(cost))}`,
    };
  },
  choices: [
    {
      label: 'Поднять зарплаты',
      story: 'Исследователи остаются, соперник уходит ни с чем',
      hint: '',
      hintFn: (s) => `-${fmtMoney(POACH_MONTHS * OVERHEAD_MONTHLY * yearMult(s.day))}`,
      apply: (s) => {
        spend(s, 'overhead', POACH_MONTHS * OVERHEAD_MONTHLY * yearMult(s.day));
      },
    },
    {
      label: 'Отпустить',
      story: 'Ведущие исследователи уходят к соперникам',
      hint: 'исследования дороже на 25 % на 180 дней',
      apply: (s) => {
        addModifier(s, { id: `rival-poach-${choiceLab(s)}`, kind: 'researchCost', mult: 1.25, untilDay: s.day + 180 });
      },
    },
  ],
};

function choiceTeam(s: GameState): TeamId | null {
  const team = (s as RivalryGame).rivalry.choice?.team;
  return team && s.late?.teams.some((t) => t.id === team) ? team : null;
}

function retainCost(team: TeamId | null): number {
  return team ? TEAM_RETAIN_MONTHS * teamDef(team).salary : 0;
}

/** Переманивают звёздную команду: удержать за полгода зарплаты или отпустить вместе с её эффектом. */
const TEAM_POACH_EVENT: EventDef = {
  id: 'rival-poach-team',
  repeatable: true,
  when: { check: () => false },
  defaultChoice: 1,
  mail: (s) => {
    const lab = labName(choiceLab(s));
    const team = choiceTeam(s);
    if (!team) return { kind: 'rival', title: `${lab} переманивает команду`, body: 'Команды уже нет в лаборатории.' };
    const def = teamDef(team);
    return {
      kind: 'rival',
      title: `${lab} переманивает команду: ${def.leader}`,
      body:
        `${lab} предлагает команде ${def.leader} («${def.name}») вдвое больше денег. Удержать команду стоит ${fmtMoney(retainCost(team))} ` +
        `(зарплата за ${TEAM_RETAIN_MONTHS} месяцев). Если отпустить, пропадёт эффект: ${def.effect.charAt(0).toLowerCase()}${def.effect.slice(1)}.`,
    };
  },
  choices: [
    {
      label: 'Удержать команду',
      story: 'Команда остаётся и продолжает работу, но обходится дороже',
      hint: 'полгода зарплаты команды',
      hintFn: (s) => `${fmtMoney(retainCost(choiceTeam(s)))}, команда остаётся`,
      apply: (s) => {
        spend(s, 'overhead', retainCost(choiceTeam(s)));
      },
    },
    {
      label: 'Отпустить',
      story: 'Команда уходит к сопернику вместе со своими наработками',
      hint: 'команда уходит, её эффект пропадает',
      apply: (s) => {
        const team = choiceTeam(s);
        if (team) dropTeam(s, team);
      },
    },
  ],
};

/** Письма с выбором соперников. Вариант 0 - умеренный (боты выбирают его), defaultChoice - пассивный. */
export const RIVALRY_EVENTS: EventDef[] = [HYPE_EVENT, AUDIT_EVENT, POACH_EVENT, TEAM_POACH_EVENT];

// ---------- Боты ----------

/**
 * Рефлекс бота (раз в месяц, в первую неделю): доля игрока за месяц упала на ≥ 25 % относительно - цена моделей
 * на API × 0,85, не ниже 2 × minPrice; цена подписки моделей с onSubs × 0,9, не ниже $5. true - цены снижены.
 */
export function botPriceReflex(s: GameState): boolean {
  if (dayToDate(s.day).day > 7) return false;
  const h = s.finance.history;
  if (h.length < 2) return false;
  const now = h[h.length - 1].marketShare;
  const before = h[h.length - 2].marketShare;
  if (!(before > 0) || now > before * 0.75) return false;
  const floor = 2 * minPrice(s.day);
  let changed = false;
  for (const m of playerApiModels(s)) {
    const price = Math.max(floor, m.price * 0.85);
    if (price < m.price) {
      m.price = price;
      changed = true;
    }
  }
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onSubs) continue;
    const price = Math.max(BOT_SUBS_PRICE_FLOOR, Math.round(m.subsPrice * BOT_SUBS_PRICE_MULT * 100) / 100);
    if (price < m.subsPrice) {
      m.subsPrice = price;
      changed = true;
    }
  }
  return changed;
}
