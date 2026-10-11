// Общий контракт симуляции. Все модули sim/ и data/ используют эти типы.
// Состояние GameState целиком сериализуется в JSON (сохранения), поэтому здесь только данные.

export type DomainId = 'language' | 'code' | 'reasoning';
export const DOMAINS: readonly DomainId[] = ['language', 'code', 'reasoning'];

export type BenchmarkId = 'squad' | 'glue' | 'mmlu' | 'humaneval' | 'gsm8k' | 'gpqa' | 'swebench';
export const BENCHMARK_IDS: readonly BenchmarkId[] = ['squad', 'glue', 'mmlu', 'humaneval', 'gsm8k', 'gpqa', 'swebench'];

export type LabId = 'openbrain' | 'antropik' | 'gogle' | 'zhipo' | 'moonshoot' | 'deepcent' | 'alibabo';
export const LAB_IDS: readonly LabId[] = ['openbrain', 'antropik', 'gogle', 'zhipo', 'moonshoot', 'deepcent', 'alibabo'];
export type HypeOwner = LabId | 'player';

export type GpuId = 'p100' | 'v100' | 'a100' | 'h100' | 'h200';
export const GPU_IDS: readonly GpuId[] = ['p100', 'v100', 'a100', 'h100', 'h200'];

export type TechId = 'attention' | 'scaling' | 'rlhf' | 'algo';
export const TECH_IDS: readonly TechId[] = ['attention', 'scaling', 'rlhf', 'algo'];

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
  notes?: string;
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
  experiments: number;
  inference: number;
}

export interface TrainingPlan {
  name: string;
  paramsB: number; // параметры, млрд
  tokensB: number; // токены, млрд
  mix: Record<DomainId, number>; // доли, сумма 1
  benchShare: number; // 0..0.5
  benchTargets: BenchmarkId[]; // 0..3 целевых бенчмарка
  rlhf: boolean;
}

export interface TrainingRun {
  plan: TrainingPlan;
  arch: 'lstm' | 'transformer';
  algoLevel: number; // снимок на старте
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
  trainedDay: number;
  releasedDay: number | null;
  caps: Record<DomainId, number>; // настоящие способности
  overfit: Partial<Record<BenchmarkId, number>>; // прибавка к способности на целевых бенчмарках
  rlhf: boolean;
  arenaElo: number;
  price: number; // $ за 1М токенов
  onApi: boolean;
  exposed: boolean; // разоблачена подгонка
}

// Ссылка на модель в рейтингах/рынке
export type ModelRef = { kind: 'player'; id: string } | { kind: 'rival'; id: string };

export interface Tender {
  id: string;
  clientId: string;
  type: 'finetune' | 'rlhf';
  benchmark: BenchmarkId;
  requirement: number; // минимальный балл, %
  work: number; // H100e-дней
  durationDays: number; // срок выполнения после победы
  payment: number;
  penalty: number;
  appearedDay: number;
  expiresDay: number; // исчезает, если нет заявки
  application: null | { modelId: string; appliedDay: number; resolveDay: number; chance: number };
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
}

export type ModifierKind = 'rentPrice' | 'rentCap' | 'demand' | 'researchCost' | 'labBrand';

export interface Modifier {
  id: string;
  kind: ModifierKind;
  target?: string; // GpuId / TechId / LabId - если модификатор не глобальный
  mult?: number;
  add?: number;
  untilDay: number; // включительно; Number.MAX_SAFE_INTEGER - навсегда
}

export type IncomeKind = 'api' | 'contracts' | 'investors';
export type ExpenseKind = 'rent' | 'overhead' | 'labelers' | 'penalties';

export interface MonthLedger {
  income: Record<IncomeKind, number>;
  expense: Record<ExpenseKind, number>;
}

export interface MonthRecord extends MonthLedger {
  year: number;
  month: number; // 1..12
  cashEnd: number;
  marketShare: number; // доля игрока в токенах за последний день месяца
  tokensPerDay: number; // обслуженные токены игрока в последний день
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
  hype: Record<HypeOwner, number>; // 0..100
  compute: { rented: Record<GpuId, number>; alloc: Allocation };
  research: { current: TechId | null; points: Record<TechId, number>; done: TechId[]; algoLevel: number };
  training: TrainingRun | null;
  bestFlop: number;
  nextModelNum: number;
  models: PlayerModel[];
  rivalsReleased: string[];
  benchmarks: Record<BenchmarkId, { introduced: boolean; saturated: boolean }>;
  tenders: Tender[];
  contracts: Contract[];
  nextTenderNum: number;
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
  market: {
    shares: Record<string, number>; // ключ: 'player:<id>' | 'rival:<id>' | 'none'
    labShares: Record<HypeOwner | 'none', number>;
    playerTokens: number; // обслужено вчера
    lostFraction: number;
    totalTokens: number;
  };
}
