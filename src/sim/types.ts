// Общий контракт симуляции. Все модули sim/ и data/ используют эти типы.
// Состояние GameState целиком сериализуется в JSON (сохранения), поэтому здесь только данные.

// Сложность и состояние соперников живут в rivalry.ts; импорт только типов, чтобы не было цикла модулей.
import type { Difficulty, RivalryState } from './rivalry';
import type { DcSiteId } from '../data/datacenters';
import type { LateState } from './lateState';
import type { DuelState } from './duel';

export type DomainId = 'language' | 'code' | 'reasoning';
export const DOMAINS: readonly DomainId[] = ['language', 'code', 'reasoning'];

export type BenchmarkId = 'squad' | 'glue' | 'mmlu' | 'humaneval' | 'gsm8k' | 'gpqa' | 'swebench';
export const BENCHMARK_IDS: readonly BenchmarkId[] = ['squad', 'glue', 'mmlu', 'humaneval', 'gsm8k', 'gpqa', 'swebench'];

export type LabId = 'openbrain' | 'antropik' | 'gogle' | 'zhipo' | 'moonshoot' | 'deepcent' | 'alibabo';
export const LAB_IDS: readonly LabId[] = ['openbrain', 'antropik', 'gogle', 'zhipo', 'moonshoot', 'deepcent', 'alibabo'];
export type HypeOwner = LabId | 'player';

export type GpuId = 'p100' | 'v100' | 'a100' | 'h100' | 'h200';
export const GPU_IDS: readonly GpuId[] = ['p100', 'v100', 'a100', 'h100', 'h200'];

export type TechId =
  | 'attention'
  | 'scaling'
  | 'rlhf'
  | 'algo'
  | 'context'
  | 'distill'
  | 'moe'
  | 'codetrain'
  | 'instruct'
  | 'cot'
  | 'quant'
  | 'multimodal'
  | 'synthetic';
export const TECH_IDS: readonly TechId[] = [
  'attention',
  'scaling',
  'rlhf',
  'algo',
  'context',
  'distill',
  'moe',
  'codetrain',
  'instruct',
  'cot',
  'quant',
  'multimodal',
  'synthetic',
];
/** Исследования-цепочки с уровнями: «Алгоритмические улучшения» (без конца) и «Длинный контекст» (до последнего уровня). */
export type ChainTech = 'algo' | 'context';

export type Speed = 0 | 1 | 2 | 4;
export type Outcome = null | 'victory' | 'finished' | 'bankrupt';

export type Result = { ok: true } | { ok: false; error: string };

// ---------- Данные (src/data) ----------

export interface GpuDef {
  id: GpuId;
  name: string; // «Fermi V100»
  availableFrom: string; // YYYY-MM-DD
  h100e: number; // мощность в эквивалентах H100
  rentPerGpuHour: Record<number, number>; // год → $ за GPU-час (без модификаторов)
}

export interface BenchmarkDef {
  id: BenchmarkId;
  name: string; // игровое имя: «MMLO»
  realName: string; // «MMLU»
  domain: DomainId;
  introduced: string; // YYYY-MM-DD
  guess: number; // g, 0..1
  difficulty: number; // Dif
  spread: number; // S
  saturation: number; // порог насыщения в %
  description: string; // одна строка для интерфейса
}

export interface LabDef {
  id: LabId;
  name: string; // «OpenBrain»
  prototype: string; // «OpenAI»
  brand: number; // базовый бренд для рынка
  color: string; // цвет на графиках
  chinese: boolean; // для экспортных запретов
  defaultPricePer1M: Record<number, number>; // год → цена по умолчанию, если в каталоге пусто
}

export interface RivalModelDef {
  id: string; // 'gtp-3'
  lab: LabId;
  gameName: string; // 'GTP-3'
  realName: string; // 'GPT-3'
  released: string; // YYYY-MM-DD
  api: boolean;
  openWeights: boolean;
  chat: boolean; // чат/инструкционная модель (после RLHF)
  paramsB: number | null;
  priceIn: number | null; // $ за 1М входных токенов
  priceOut: number | null; // $ за 1М выходных токенов
  scores: Partial<Record<BenchmarkId, number>>; // реальные баллы, %
  arenaElo: number;
  arenaEstimated: boolean;
  contaminated: boolean; // были сообщения об утечке тестов
  context: number; // контекст на момент выхода, токенов
  announcedOnly?: boolean; // модель только показали (статья, демо): в продажу и на рынок она не выходила
  /** Уровень модели, если задан явно (шаблоны ответных моделей); иначе выводится из каталога (rivals.rivalTier). */
  tier?: Tier;
  notes?: string;
}

// ---------- Рынок v2: уровни моделей, сегменты спроса, каналы продаж ----------

/** Уровень модели: лёгкая (дёшево и слабо), средняя, флагман. Задаётся в плане обучения относительно переднего края года. */
export type Tier = 'light' | 'mid' | 'flagship';
export const TIER_IDS: readonly Tier[] = ['light', 'mid', 'flagship'];
export const TIER_NAMES: Record<Tier, string> = { light: 'Лёгкая', mid: 'Средняя', flagship: 'Флагман' };

/** Сегменты спроса: обычные пользователи (подписка на чат), корпоративные клиенты (API), разработчики (API). */
export type SegmentId = 'consumers' | 'enterprise' | 'developers';
export const SEGMENT_IDS: readonly SegmentId[] = ['consumers', 'enterprise', 'developers'];

/** Канал продаж: API ($ за 1 млн токенов) или подписка ($ за пользователя в месяц). */
export type Channel = 'api' | 'subs';

/** Описание сегмента: канал, веса полезности и отношение к уровням моделей (таблица в constants.SEGMENT_DEF). */
export interface SegmentDef {
  name: string; // «Обычные», «Корпоративные», «Разработчики»
  channel: Channel;
  wQ: number; // вес воспринимаемого качества
  hypeMult: number; // множитель шумихи внутри качества
  wBrand: number; // вес бренда
  wPrice: number; // эластичность по цене
  wCtx: number; // вес контекста
  wCode: number; // вес уровня по коду
  exposedPenalty: number; // штраф разоблачённой модели игрока
  u0Offset: number; // прибавка к внешнему варианту
  tier: Record<Tier, number>; // прибавка за уровень модели
  values: string; // «что ценит» для интерфейса
}

/** Внешняя проверка сильной модели перед подпиской. */
export type ReviewState = 'none' | 'required' | 'pending' | 'passed';
export const REVIEW_STATES: readonly ReviewState[] = ['none', 'required', 'pending', 'passed'];

/** Доли сегмента после ограничения мощностью: по моделям, по лабораториям и спрос сегмента (токены в день или пользователи). */
export interface SegmentShares {
  shares: Record<string, number>;
  labShares: Record<HypeOwner | 'none', number>;
  total: number;
}

export interface ClientDef {
  id: string;
  name: string; // вымышленное название
  industry: string;
}

// ---------- Состояние ----------

export interface Allocation {
  training: number;
  contracts: number;
  experiments: number; // исследования (ключ не меняется)
  api: number; // обслуживание запросов по API
  subs: number; // обслуживание чата подписчиков
}

export interface TrainingPlan {
  name: string;
  paramsB: number; // параметры, млрд
  tokensB: number; // токены, млрд
  mix: Record<DomainId, number>; // доли, сумма 1
  benchShare: number; // 0..0.5
  benchTargets: BenchmarkId[]; // 0..3 целевых бенчмарка
  rlhf: boolean;
  context: number; // длина контекста, токенов (одно из CONTEXT_LEVELS)
  tier: Tier; // уровень модели; обязан совпадать с training.tierOf(paramsB, день старта)
}

export interface TrainingRun {
  id: string; // 't1', 't2'…
  failed: boolean; // случился срыв, ждёт решения игрока (письмо 'training-fail'); проект стоит
  plan: TrainingPlan;
  arch: 'lstm' | 'transformer';
  algoLevel: number; // снимок на старте
  /** Снимок изученных технологий на старте (те, что влияют на модель: training.MODEL_TECHS); нет поля - никаких. */
  techs?: TechId[];
  flopTotal: number;
  flopDone: number;
  startedDay: number;
  failAtFraction: number | null; // где случится срыв (0..1), null - без срыва
  failPenalty: number; // 0 или 3 после выбора «Продолжить»
}

export interface PlayerModel {
  id: string; // 'p1', 'p2'…
  name: string;
  plan: TrainingPlan;
  arch: 'lstm' | 'transformer';
  algoLevel: number;
  /** Технологии, с которыми модель обучена (снимок на старте проекта); нет поля - никаких. */
  techs?: TechId[];
  trainedDay: number;
  releasedDay: number | null;
  caps: Record<DomainId, number>; // настоящие способности
  overfit: Partial<Record<BenchmarkId, number>>; // прибавка к способности на целевых бенчмарках
  rlhf: boolean;
  arenaElo: number;
  price: number; // $ за 1М токенов
  onApi: boolean;
  exposed: boolean; // разоблачена подгонка
  earned: number; // выручка по обоим каналам с момента выпуска, $
  onSubs: boolean; // продаётся по подписке (чат)
  subsPrice: number; // $ за пользователя в месяц
  review: ReviewState; // внешняя проверка сильной модели перед подпиской
  reviewEndDay: number | null; // день окончания проверки (pending)
  earnedSubs: number; // из earned: выручка подписок, $
}

// Ссылка на модель в рейтингах/рынке
export type ModelRef = { kind: 'player'; id: string } | { kind: 'rival'; id: string };

export interface Tender {
  id: string;
  clientId: string;
  type: 'finetune' | 'rlhf';
  benchmark: BenchmarkId;
  requirement: number; // минимальный балл, %
  work: number; // H100e-дней; в тендере - для модели эталонного размера, в контракте - уже с учётом модели
  durationDays: number; // срок выполнения после победы
  payment: number;
  penalty: number;
  appearedDay: number;
  expiresDay: number; // исчезает, если нет заявки
  /** auto - заявку подала сама лаборатория в начале месяца (включён автоподбор): о проигрыше письма не будет. */
  application: null | { modelId: string; appliedDay: number; resolveDay: number; chance: number; auto?: boolean; work?: number };
}

export interface Contract {
  id: string;
  tender: Tender;
  modelId: string;
  startedDay: number;
  deadlineDay: number;
  workDone: number;
}

export interface MailChoice {
  label: string;
  hint: string;
  /** Что будет, словами: «Он остаётся, команда видит, что её ценят». Числа - в hint. */
  story?: string;
}

export interface Mail {
  id: string;
  day: number;
  title: string;
  body: string;
  kind: 'news' | 'event' | 'rival' | 'research' | 'training' | 'contract' | 'finance' | 'benchmark';
  read: boolean;
  eventId?: string; // для писем с выбором
  choices?: MailChoice[];
  chosen?: number; // индекс сделанного выбора
  important?: boolean; // важное письмо: интерфейс ставит игру на паузу, когда оно приходит
  replyByDay?: number; // письмо с выбором: последний день для ответа
  defaultChoice?: number; // вариант, который выберется сам, если не ответить до replyByDay
  deferred?: boolean; // игрок отложил решение: игра идёт, письмо ждёт ответа в «Почте»
  autoChosen?: boolean; // вариант выбран сам, потому что срок ответа истёк
  /** Исход выбора со случайностью: повезло или нет и что изменилось («-$10 тыс., -5 репутации»). */
  outcome?: { lucky: boolean; text: string };
  /** Награда (цель, оплата, победа в тендере, готовое исследование): уведомление крупнее и дольше. */
  reward?: boolean;
  /** Письмо лично от лаборатории-соперника (sim/duel.ts): в «Почте» вместо значка - её эмблема. */
  from?: LabId;
}

/**
 * rivalPrice: target - LabId; mult - множитель цен лаборатории, add - доля опорной цены как нижняя граница.
 * exposure: target - id модели игрока или без target; mult к шансу разоблачения.
 * segBrand: target - `${lab | 'player'}:${SegmentId}`; add к бренду в одном сегменте.
 * subsDemand: mult к спросу на подписки (SUBS_USERS); demand по-прежнему множит только спрос API.
 */
export type ModifierKind =
  | 'rentPrice'
  | 'rentCap'
  | 'demand'
  | 'researchCost'
  | 'labBrand'
  | 'rivalPrice'
  | 'exposure'
  | 'segBrand'
  | 'subsDemand';

export interface Modifier {
  id: string;
  kind: ModifierKind;
  target?: string; // GpuId / TechId / LabId / id модели игрока - если модификатор не глобальный
  mult?: number;
  add?: number;
  untilDay: number; // включительно; Number.MAX_SAFE_INTEGER - навсегда
}

export type IncomeKind = 'api' | 'subs' | 'contracts' | 'investors';
/** capex - стройка дата-центров и покупка карт; power - электричество и обслуживание своих дата-центров. */
export type ExpenseKind = 'rent' | 'overhead' | 'labelers' | 'penalties' | 'review' | 'capex' | 'power';

export interface MonthLedger {
  income: Record<IncomeKind, number>;
  expense: Record<ExpenseKind, number>;
}

export interface MonthRecord extends MonthLedger {
  year: number;
  month: number; // 1..12
  cashEnd: number;
  marketShare: number; // общая доля игрока (взвешенная по сегментам) за последний день месяца
  tokensPerDay: number; // обслуженные токены API игрока в последний день
  subscribers: number; // обслуженные подписчики игрока в последний день
  /** Для истории партии (нет в старых сохранениях): Эло лучшей модели игрока и лучшей модели соперников на конец месяца. */
  eloMine?: number;
  eloRival?: number;
  /** Место на «Арене» среди моделей в продаже на конец месяца; null - соперники ещё не продают по API. */
  placeEnd?: number | null;
  /** Цена за 1 млн токенов самой сильной модели в продаже по API: лаборатория (или 'player') → $. */
  prices?: Record<string, number>;
}

/** Заказ карт в свой дата-центр: приедут в день arriveDay. */
export interface DcOrder {
  gpu: GpuId;
  count: number;
  arriveDay: number;
}

/** Свой дата-центр (datacenters.ts). stage 0..3 - идёт этап стройки, 4 - готов. */
export interface Datacenter {
  site: DcSiteId;
  mw: number;
  startedDay: number;
  stage: number;
  stageEndDay: number; // день окончания текущего этапа (для готового - день готовности)
  delayDays: number; // сколько дней задержки за всю стройку
  stageDelay: number; // из них - задержка текущего этапа (входит в stageEndDay)
  paid: number; // уплачено за стройку, $
  gpus: Record<GpuId, number>;
  orders: DcOrder[];
}

/** Цель года: состояние (описание, награда и проверка - в data/goals.ts). */
export interface YearGoalState {
  id: string;
  done: boolean;
  doneDay: number | null;
  /** Значение показателя на начало года (число выпущенных моделей и т. п.), от него считается «за год». */
  base: number;
  /** Цели с выбором (с 15.10.2026): порог и предмет цели (модель соперника, технология, тест). В старых сохранениях нет. */
  target?: number;
  param?: string;
}

/** Итог одной цели года для окна «Итоги года»: тексты сняты 31 декабря, позже показатели меняются. */
export interface YearGoalResult {
  title: string;
  style: string; // стиль цели (data/goals.ts GoalStyle) или '' у старых целей
  done: boolean;
  text: string; // показатель на конец года: «Выручка за год: $2,7 млн из $3 млн»
  miss: string; // сколько не хватило: «не хватило $300 тыс.»; '' - выполнена
  prize: string; // награда: «+$150 тыс.» - получена или была обещана
  penalty: string; // штраф рискованной цели, если она не выполнена; '' - штрафа нет
}

/** Выбор целей года: пять целей разного стиля, игрок берёт три. Пока выбор открыт, время в интерфейсе стоит. */
export interface GoalOffer {
  year: number;
  goals: YearGoalState[];
  open: boolean;
}

/** Короткая задача (sim/tasks.ts, data/tasks.ts): одна-две сразу, срок 1-4 месяца, награда при выполнении. */
export interface TaskState {
  id: string; // 'q1', 'q2'…
  kind: string; // вид задачи (data/tasks.ts TaskKind)
  startDay: number;
  endDay: number; // последний день срока (включительно)
  need: number; // порог: сколько нужно (деньги, доля, число побед)
  base: number; // показатель на старте задачи
  subject: string; // предмет задачи: модель соперника, технология, контракт; '' - нет
  status: 'active' | 'done' | 'failed';
  closedDay: number | null;
  /** Итог для интерфейса: прогресс на момент закрытия («$1,1 млн из $1,2 млн», «не хватило $80 тыс.»). */
  result: string;
}

/** Задачи, выбор целей года и счётчики для них. Свой поток случайных чисел: основной поток игры не сдвигается. */
export interface QuestState {
  rng: number;
  tasks: TaskState[]; // идущие и недавно закрытые (для отклика в интерфейсе)
  nextTaskDay: number; // раньше этого дня новая задача не появится
  nextTaskNum: number;
  done: number; // выполнено задач за партию
  failed: number; // не выполнено задач за партию
  tendersWon: number; // выиграно тендеров за партию (для задач и целей «выиграть тендер»)
  knownContracts: string[]; // контракты, которые уже засчитаны в tendersWon
  offer: GoalOffer | null;
}

/** Итоги года: цифры считаются в последний день года, окно показывается один раз. */
export interface YearReview {
  year: number;
  revenue: number; // API + подписки + контракты за год, $
  expense: number; // все расходы за год, $
  models: number; // моделей выпущено за год
  bestRank: number | null; // лучшее место среди моделей в продаже на конец года
  share: number; // общая доля рынка игрока на конец года, 0..1
  goalsDone: number;
  goalsTotal: number;
  cash: number;
  comment: string;
  seen: boolean;
  /** Итоги каждой цели года («почти получилось»); в старых сохранениях нет. */
  results?: YearGoalResult[];
}

/** Цели года, итоги и случайные события с выбором. Свой поток случайных чисел: основной поток игры не сдвигается. */
export interface YearlyState {
  year: number; // год текущих целей; 0 - целей ещё нет
  goals: YearGoalState[];
  reviews: YearReview[];
  rng: number; // состояние mulberry32 случайных событий
  nextEventDay: number; // день, начиная с которого может прийти следующее случайное письмо с выбором
  eventUnit: number; // денежная единица последнего случайного письма: $ за 1 «u» в подсказках и эффектах
  lastFired: Record<string, number>; // id случайного события -> день последнего письма
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number; // состояние mulberry32
  day: number;
  labName: string;
  founderName: string;
  outcome: Outcome;
  cash: number;
  reputation: number; // 0..100
  founderShare: number; // 0..1
  lastRoundDay: number | null;
  /** Сколько закрытых месяцев лучшая модель игрока была №1 на «Арене» среди моделей, доступных по API. */
  monthsFirst: number;
  hype: Record<HypeOwner, number>; // 0..100
  /** rentChangedDay - день последнего изменения аренды (для мягкого предупреждения о простое); в старых сохранениях нет. */
  compute: { rented: Record<GpuId, number>; alloc: Allocation; rentChangedDay?: number };
  /** Свои дата-центры: день открытия функции (null - ещё закрыта) и список построек. */
  datacenters: { unlockedDay: number | null; list: Datacenter[] };
  research: {
    current: TechId | null;
    points: Record<TechId, number>;
    done: TechId[];
    algoLevel: number;
    contextLevel: number;
    /** Очередь: что исследовать дальше (до RESEARCH_QUEUE_MAX), когда текущее закончится. */
    queue: TechId[];
  };
  /** Идущие проекты обучения (не больше MAX_TRAININGS); доля «Обучение» делится между ними поровну. */
  trainings: TrainingRun[];
  nextRunNum: number; // номер следующего проекта: id `t${n}`
  bestFlop: number;
  nextModelNum: number;
  models: PlayerModel[];
  rivalsReleased: string[];
  benchmarks: Record<BenchmarkId, { introduced: boolean; saturated: boolean }>;
  tenders: Tender[];
  contracts: Contract[];
  nextTenderNum: number;
  /** Заявки на новые тендеры подаются сами в начале месяца лучшей подходящей моделью. */
  autoApply: boolean;
  mail: Mail[];
  nextMailNum: number;
  firedEvents: string[];
  modifiers: Modifier[];
  flags: Record<string, boolean>;
  finance: {
    month: MonthLedger;
    history: MonthRecord[];
    revenueDaily: number[]; // выручка за последние 90 дней (api + contracts)
    negativeDays: number;
  };
  /** Обучение для новичков: номер текущего шага (с 0) и включено ли оно. */
  tutorial: { step: number; active: boolean };
  /** Сложность выбирается в главном меню и не меняется за игру (rivalry.DIFFICULTY). */
  difficulty: Difficulty;
  /** Соперники с характерами: накал, ходы, поправки к моделям, память (rivalry.ts). */
  rivalry: RivalryState;
  /** Цели года, итоги года и расписание случайных событий (sim/goals.ts, sim/randomEvents.ts). */
  yearly: YearlyState;
  /** Поздняя игра: сделки 2023-2024 и финальный квартал (sim/lateState.ts). Нет в старых сохранениях и до первой сделки. */
  late?: LateState;
  /** Личное соперничество: счёт обгонов, главный соперник, письма соперников (sim/duel.ts). Нет в старых сохранениях. */
  duel?: DuelState;
  /** Короткие задачи и выбор целей года (sim/tasks.ts, sim/goals.ts); старые сохранения получают пустое состояние. */
  quests: QuestState;
  market: {
    shares: Record<string, number>; // ключ: 'player:<id>' | 'rival:<id>' | 'none'; общие доли (взвешенные по выручке сегментов), после ограничения мощностью
    labShares: Record<HypeOwner | 'none', number>; // общие, после ограничения мощностью
    playerTokens: number; // токены API игрока, обслуженные вчера
    lostFraction: number; // взвешенная по выручке потеря спроса (API и подписки)
    totalTokens: number; // T(t) с модификаторами
    playerSubs: number; // подписчиков обслужено вчера
    totalSubs: number; // SUBS_USERS(t) с модификаторами
    lostApi: number; // потерянная доля спроса API (0, если нечего обслуживать)
    lostSubs: number; // то же для подписок
    segments: Record<SegmentId, SegmentShares>; // доли по сегментам после ограничения мощностью
  };
}
