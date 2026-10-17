// Все числа баланса среза. Формулы - в design.md, раздел «Формулы и баланс».
// Точки кривых: [дата 'YYYY-MM-DD', значение]; между точками - lerpByDate (линейно или в логарифме).

import type { Allocation, ChainTech, DomainId, HypeOwner, SegmentDef, SegmentId, TechId, Tier } from './types';

export const START_DATE = '2017-01-01';
export const END_DATE = '2024-12-31';
export const START_CASH = 3_000_000;
export const START_REPUTATION = 20;
/** «Навсегда»: untilDay модификаторов и перерывов ходов соперников. Живёт здесь, а не в events.ts, потому что
 * rivalry.ts читает его на верхнем уровне модуля внутри цикла sim/events → data/events → sim/rivalry → sim/events. */
export const FOREVER = Number.MAX_SAFE_INTEGER;
/** Чат-момент (ChatGTP): с этого дня открыт канал подписок; событие в data/events.ts берёт дату отсюда. */
export const CHAT_MOMENT_DATE = '2022-11-30';
// API 10 % с начала: выпущенная модель сразу продаётся (при 0 % выручка API была нулевой, игроки этого не замечали).
export const DEFAULT_ALLOC: Allocation = { training: 0.4, contracts: 0.2, experiments: 0.3, api: 0.1, subs: 0 };
/** Одновременно идущих проектов обучения не больше. */
export const MAX_TRAININGS = 2;

// Время (FR-1)
export const TICK_MS: Record<1 | 2 | 4, number> = { 1: 500, 2: 250, 4: 125 };
export const BANKRUPT_DAYS = 60;

// Вычисления
export const TRAIN_FLOP_PER_H100E_DAY = 989e12 * 0.4 * 86400;
export const INF_FLOP_PER_H100E_DAY = 989e12 * 0.15 * 86400;
/**
 * Накладные раннего обучения (лог-линейно по дате начала проекта): объём вычислений проекта × столько.
 * Незрелые фреймворки, FP32, медленные сети между картами: в 2017 году обучение идёт в разы дольше, к середине 2020 года - как на
 * зрелом стеке. На способности не влияет (они считаются от 6·N·D). Без накладных первая модель 2017 года на ~100 P100
 * обучалась за день, а боты обучали модели в 15 млрд параметров (в 2017 году в истории - 0,2 млрд, «Трансформер»).
 * Опоры: средняя модель по пресету на 100 P100 в январе 2017 года - 1-2 месяца; флагманы 2023-2024 годов - 3-6 месяцев.
 */
export const TRAIN_OVERHEAD: [string, number][] = [
  ['2017-01-01', 300], ['2018-01-01', 150], ['2019-01-01', 30], ['2019-07-01', 8], ['2020-06-11', 1], ['2024-12-31', 1],
];
export const RENT_CAP_2017 = 512; // на тип GPU, удваивается каждый год
// Мягкий лимит аренды: сверх обычного лимита карты дают по цене × RENT_OVER_CAP_MULT,
// но не больше RENT_HARD_CAP_MULT × лимит (жёсткий потолок).
export const RENT_OVER_CAP_MULT = 1.8;
export const RENT_HARD_CAP_MULT = 2;
export const MAX_TOKENS_B: Record<number, number> = {
  2017: 50, 2018: 100, 2019: 300, 2020: 1000, 2021: 2000, 2022: 5000, 2023: 10000, 2024: 20000,
};
export const PARAMS_B_MIN = 0.05;
export const PARAMS_B_MAX = 2000;
export const TOKENS_B_MIN = 0.5;

// Исследования
/** Сколько технологий можно поставить в очередь исследований после текущей. */
export const RESEARCH_QUEUE_MAX = 3;
export const RP_BASE = 20; // было 10: в 2017-2018 годах первые исследования шли по 4-6 месяцев; на поздние почти не влияет. Больше 24 нельзя: одной базой команды «Механизм внимания» успевался бы до 12.06.2017
export const RP_K = 25;
export const TECH_COST: Record<Exclude<TechId, ChainTech>, number> = {
  attention: 4000,
  scaling: 15000,
  rlhf: 30000,
  distill: 8000,
  moe: 20000,
  codetrain: 12000,
  instruct: 14000,
  cot: 24000,
  quant: 16000,
  multimodal: 40000,
  synthetic: 45000,
};
export const TECH_REQUIRES: Record<TechId, TechId[]> = {
  attention: [],
  scaling: ['attention'],
  rlhf: ['attention'],
  algo: [],
  context: ['attention'],
  distill: ['attention'],
  moe: ['scaling'],
  codetrain: ['attention'],
  instruct: ['attention'],
  cot: ['instruct'],
  quant: ['distill'],
  multimodal: ['instruct'],
  synthetic: ['codetrain'],
};
export const ALGO_BASE_COST = 5000;
export const ALGO_COST_GROWTH = 1.6;
export const ALGO_MULT = 1.25;
export const ATTENTION_PAPER_DISCOUNT = 0.4;
// Исследование раньше своего исторического времени дороже (как в Processor Tycoon):
// цена × (1 + EARLY_PENALTY_PER_YEAR[tech] × лет до исторической даты).
export const TECH_HISTORY_DATE: Record<Exclude<TechId, ChainTech>, string> = {
  attention: '2017-06-12',
  scaling: '2020-01-23',
  rlhf: '2022-01-27',
  distill: '2019-10-02', // DistilBERT
  moe: '2021-01-11', // Switch Transformer
  codetrain: '2021-07-07', // Codex
  instruct: '2021-09-03', // FLAN
  cot: '2022-01-28', // цепочки рассуждений в подсказках
  quant: '2022-08-15', // LLM.int8()
  multimodal: '2023-03-14', // GTP-4 с изображениями
  synthetic: '2023-06-20', // «Учебников достаточно» (phi-1)
};
export const ALGO_HISTORY_START = '2017-01-01'; // уровень k «исторически» достигается через k × ALGO_LEVEL_DAYS дней
export const ALGO_LEVEL_DAYS = 243; // ≈ 1,5 уровня в год: 12-й уровень - к концу 2024 года
// Надбавка за год опережения по технологиям: RLHF - главный скачок Эло, поэтому раньше срока он много дороже.
export const EARLY_PENALTY_PER_YEAR: Record<TechId, number> = {
  attention: 2.5,
  scaling: 2.5,
  rlhf: 10, // было 6: с большой мощностью RLHF успевали на год раньше истории и забирали весь рынок 2021-2022 годов
  algo: 2.5,
  context: 2.5,
  distill: 2.5,
  moe: 2.5,
  codetrain: 2.5,
  instruct: 2.5,
  cot: 2.5,
  quant: 2.5,
  multimodal: 2.5,
  synthetic: 2.5,
};

// Эффекты новых технологий (по одному на технологию). «Снимок» - действует на модели, обучение которых началось
// после исследования (TrainingRun.techs); остальные действуют сразу.
// Размеры подобраны по опорам баланса (balance.test.ts): с большими прибавками «разумный» бот выходил на 1-е место
// и зарабатывал больше $2 млрд; эффект на обслуживание сильнее всего поднимает выручку.
export const INSTRUCT_ELO = 20; // снимок: +Эло на «Арене» у моделей без RLHF (RLHF его перекрывает)
export const CODE_TRAIN_CAP = 3; // снимок: +способность «Код»
export const COT_REASONING_CAP = 3; // снимок: +способность «Математика и наука»
export const DISTILL_LIGHT_CAP = 4; // снимок: +способность по всем областям у лёгких моделей
export const MOE_SERVING_MULT = 1.1; // снимок: токенов на один H100e при обслуживании × 1,1
export const MULTIMODAL_CONSUMER_UTILITY = 0.1; // снимок: + полезность у обычных пользователей
export const QUANT_SERVING_COST = 0.9; // сразу: мощность на обслуживание всех моделей × 0,9
export const SYNTHETIC_TOKENS_MULT = 1.5; // сразу: наибольший объём данных года × 1,5

// Длинный контекст: уровень → [токенов, дата, когда такой контекст появился в истории]
export const CONTEXT_LEVELS: [number, string][] = [
  [512, '2017-01-01'], // исходный «Трансформер»
  [1024, '2019-02-14'], // GTP-2
  [2048, '2020-06-11'], // GTP-3
  [4096, '2022-11-30'], // ChatGTP
  [8192, '2023-03-14'], // GTP-4
  [32768, '2023-05-11'], // GTP-4-32k, Clade 100k
  [128000, '2023-11-06'], // GTP-4 Turbo
  [1000000, '2024-02-15'], // Gemeni 1.5 Pro
];
export const CONTEXT_BASE_COST = 6000;
export const CONTEXT_COST_GROWTH = 1.7;
export const CONTEXT_FLOP_PER_DOUBLING = 0.05; // обучение дороже на 5 % за каждое удвоение контекста сверх 512
// Рынок: полезность + CONTEXT_MARKET_K × ln(контекст / обычный контекст на рынке), отношение в пределах [1/64; 8]
export const CONTEXT_MARKET_K = 0.25;
export const CONTEXT_RATIO_MIN = 1 / 64;
export const CONTEXT_RATIO_MAX = 8;
export const CONTEXT_REF: [string, number][] = [
  ['2017-01-01', 512], ['2019-02-14', 1024], ['2020-06-11', 2048], ['2022-11-30', 4096],
  ['2023-03-14', 8192], ['2023-11-06', 32000], ['2024-06-01', 128000], ['2024-12-31', 128000],
];

// Обучение
export const ARCH_MULT = { transformer: 1, lstm: 0.15 } as const;
export const CHIN_OPT_RATIO = 20;
export const CHIN_K = 0.2;
export const CAP_BASE_OFFSET = 18; // base = 10·(log10 E − 18)
export const MIX_K = 8;
export const BENCH_DATA_PENALTY = 15;
export const OVERFIT_K = 60;
export const BENCH_SHARE_MAX = 0.5;
export const MAX_BENCH_TARGETS = 3;
export const RLHF_FLOP_EXTRA = 0.1;
export const RLHF_LABELERS_BASE = 200_000;
export const RLHF_LABELERS_PER_B = 2_000;
export const RLHF_LANGUAGE_BONUS = 2;
export const FAIL_BASE = 0.04;
export const FAIL_BIG_JUMP = 0.08;
export const FAIL_JUMP_RATIO = 10;
export const FAIL_CONTINUE_PENALTY = 3;
export const FAIL_ROLLBACK = 0.25;

// Письма с выбором: сколько дней можно отложить ответ, потом выбирается вариант по умолчанию
export const CHOICE_DAYS = 30;
export const FAIL_CHOICE_DAYS = 14; // срыв обучения: проект стоит, пока нет ответа

// Арена
export const ELO_BASE = 553; // базовые модели без RLHF - плохие собеседники: «как GTP-3» ≈ 800, как в каталоге
export const ELO_PER_CAP = 5;
// RLHF - главный скачок качества на Арене, но ранний RLHF (2021-2022, низкий уровень алгоритмов) даёт меньше,
// чем поздний: было 210 + 13 × уровень, стало 165 + 21 × уровень (на 10-м уровне ≈375 вместо 340).
// Так «разумный» бот к концу игры занимает 2-4-е место; №1 - для сильной игры.
export const ELO_RLHF_BASE = 165;
export const ELO_RLHF_PER_ALGO = 21;
export const ARENA_WEIGHTS: Record<DomainId, number> = { language: 0.5, code: 0.25, reasoning: 0.25 };
export const ARENA_OPEN_DATE = '2023-05-03';

// Шумиха
export const HYPE_RANK_BONUS = [12, 6, 3];
export const HYPE_ARENA_TOP_BONUS = 10;
export const HYPE_MONTHLY_DECAY = 0.9;
// Шумиха в качестве: было 1,5 / 1 - вместе с брендом она давала игроку 90 % рынка даже при равном Эло.
export const HYPE_K_BEFORE_ARENA = 1;
export const HYPE_K_AFTER_ARENA = 0.7;
export const HYPE_LOST_DEMAND_K = 0.3;

// Рынок
export const PRICE_ELASTICITY = 1.2;
export const TOKENS_PER_USER_DAY = 10_000; // для оценки числа пользователей модели
export const MARKET_MODELS_PER_LAB = 3;
export const MARKET_MAX_AGE_DAYS = 365 * 3;
export const DEMAND_TOKENS: [string, number][] = [
  // 2017-2022 подняты (×2 до середины 2020 года, ×1,4 до ChatGTP): плейтест 15.10 - API не окупал аренду ни в один год до 2023-го,
  // лаборатория жила только раундами инвесторов. Скачок ChatGTP (30.11.2022) и 2023-2024 годы прежние.
  ['2017-01-01', 1e8], ['2019-01-01', 4e8], ['2020-06-10', 5e8], ['2020-06-11', 2.8e9],
  ['2022-11-29', 5.6e9], ['2022-11-30', 2e10], ['2023-06-01', 3e11], ['2024-12-31', 3e12],
];
export const REF_PRICE: [string, number][] = [
  ['2017-01-01', 100], ['2020-01-01', 60], ['2022-01-01', 20], ['2023-01-01', 10], ['2024-01-01', 3], ['2024-12-31', 2.5],
];
// Внешний вариант: с выходом ChatGTP (30.11.2022) клиенты сравнивают любой API с бесплатным чат-ботом - скачок до 1080.
export const REF_QUALITY: [string, number][] = [
  ['2017-01-01', 900], ['2020-01-01', 950], ['2022-11-29', 1010], ['2022-11-30', 1080], ['2024-01-01', 1150], ['2024-12-31', 1180],
];
export const PLAYER_BRAND_K = 0.4; // было 0,6: репутация 100 давала +0,6 полезности - больше, чем 60 Эло
export const CHAT_MOMENT_BRAND = 0.5;
export const EXPORT_CONTROL_BRAND = -0.2;

// Рынок v2: сегменты спроса (design market-v2, раздел 2). Средневзвешенные веса API-сегментов
// (0,45 корпоративные / 0,55 разработчики в 2024 году) близки к прежним 1,0 (качество) и 1,2 (цена).
export const SEGMENT_DEF: Record<SegmentId, SegmentDef> = {
  consumers: {
    name: 'Обычные',
    channel: 'subs',
    wQ: 1.0,
    hypeMult: 1.5,
    wBrand: 1.2,
    wPrice: 0.8,
    wCtx: 0.25,
    wCode: 0,
    exposedPenalty: 0.2,
    u0Offset: 0.5,
    tier: { light: -0.3, mid: 0, flagship: 0.1 },
    values: 'известность, цена подписки, длинный контекст',
  },
  enterprise: {
    name: 'Корпоративные',
    channel: 'api',
    wQ: 1.2,
    hypeMult: 0.7,
    wBrand: 0.8,
    wPrice: 0.6,
    wCtx: 0.35,
    wCode: 0.3,
    exposedPenalty: 0.8,
    u0Offset: 0,
    tier: { light: -0.4, mid: 0, flagship: 0.2 },
    values: 'Эло, контекст, отсутствие подгонки, флагманы',
  },
  developers: {
    name: 'Разработчики',
    channel: 'api',
    wQ: 0.8,
    hypeMult: 1.0,
    wBrand: 0.5,
    wPrice: 1.6,
    wCtx: 0.25,
    wCode: 0.6,
    exposedPenalty: 0.3,
    u0Offset: -0.3,
    tier: { light: 0.2, mid: 0, flagship: -0.2 },
    values: 'цена за токен, баллы по коду, лёгкие модели',
  },
};
/** Доля разработчиков в спросе API (линейно); остальное - корпоративные клиенты. */
export const DEV_SHARE_OF_API: [string, number][] = [
  ['2017-01-01', 0.8], ['2020-06-11', 0.7], ['2022-11-30', 0.6], ['2024-12-31', 0.45],
];
/**
 * Платёжеспособных пользователей чата (лог-линейно); канал открыт с CHAT_MOMENT_DATE.
 * Было 1e3 … 1,5e7 (подписки $3,6 млрд в год на конец 2024 года); × 0,75 - $2,7 млрд, как у OpenAI в 2024 году:
 * с большим рынком «разумный» бот (balance.test.ts) побеждал на всех зёрнах. Потенциал подписок / API = 1,0.
 */
export const SUBS_USERS: [string, number][] = [
  ['2017-01-01', 7.5e2], ['2020-06-11', 1.5e4], ['2022-11-29', 7.5e4], ['2022-11-30', 3.75e5],
  ['2023-02-10', 1.125e6], ['2023-06-01', 2.25e6], ['2024-01-01', 5.25e6], ['2024-12-31', 1.125e7],
];
export const SUBS_REF_PRICE = 20; // $ в месяц, опорная цена подписки (ChatGTP Plus)
export const SUBS_PRICE_MIN = 1;
export const SUBS_PRICE_MAX = 200;
export const SUBS_PRICE_RATIO_MIN = 1 / 4;
export const SUBS_PRICE_RATIO_MAX = 4;
/** Уровень по коду: +10 очков над уровнем года (CAP_LEVEL) дают разработчикам +0,6 полезности; разница зажата в ±20. */
export const CODE_UTILITY_SCALE = 10;
export const CODE_DIFF_CAP = 20;

// Уровни моделей (design market-v2, раздел 3): передний край по параметрам, млрд (лог-линейно).
export const FRONTIER_PARAMS_B: [string, number][] = [
  ['2017-01-01', 1], ['2019-02-14', 1.5], ['2020-06-11', 175], ['2022-04-04', 540], ['2023-03-14', 1800], ['2024-12-31', 2000],
];
/** Доли переднего края [от, до) для каждого уровня; у лёгких нижняя граница - PARAMS_B_MIN. */
export const TIER_PARAMS_RATIO: Record<Tier, [number, number]> = { light: [0, 0.08], mid: [0.08, 0.35], flagship: [0.35, 1.5] };
export const TIER_PRESET_RATIO: Record<Tier, number> = { light: 0.04, mid: 0.17, flagship: 0.4 };
/** Цена API по умолчанию при выпуске: множитель к опорной цене. */
export const TIER_API_PRICE_MULT: Record<Tier, number> = { light: 0.25, mid: 1, flagship: 3 };
/** Цена подписки по умолчанию, $ в месяц. */
export const TIER_SUBS_PRICE: Record<Tier, number> = { light: 10, mid: 20, flagship: 20 };
/** Уровень соперника по цене каталога / опорной: ≥ flagship - флагман, ≥ mid - средняя, иначе лёгкая. */
export const RIVAL_TIER_PRICE_RATIO = { flagship: 2.5, mid: 0.4 };
/** Уровень чата без API и цен: Эло не ниже лучшего каталожного на день выхода минус столько - флагман. */
export const RIVAL_TIER_ELO_GAP = 30;

// Внешняя проверка сильной модели перед подпиской (design market-v2, раздел 4.2).
export const REVIEW_ELO_GAP = 10; // Эло не ниже лучшего соперника минус столько
export const REVIEW_CODE_GAP = 5; // уровень по коду выше лучшего соперника на столько
export const REVIEW_DAYS_MIN = 20; // было 30: меньше ожидания перед подпиской
export const REVIEW_DAYS_EXTRA = 10; // × min(1, paramsB / передний край): 20…30 дней (было 30…45)
export const REVIEW_COST_BASE = 300_000;
export const REVIEW_COST_PER_B = 2_000; // $ за миллиард параметров

// Тендеры: немного, но крупных - TENDERS_PER_MONTH + 0…1 в месяц, работа и оплата в пять раз больше прежних.
export const TENDERS_PER_MONTH: Record<number, number> = {
  2017: 1, 2018: 1, 2019: 1, 2020: 1, 2021: 1, 2022: 1, 2023: 1, 2024: 1,
};
export const CAP_LEVEL: Record<number, number> = {
  2017: 0, 2018: 15, 2019: 30, 2020: 45, 2021: 55, 2022: 62, 2023: 72, 2024: 80,
};
// Было 10 000 на 2023 год и 50 000 на конец 2024 года: с короткими сроками контрактов (45…150 дней) и быстрыми
// тендерами (20 дней) «разумный» бот зарабатывал больше  млрд за игру (опора balance.test.ts - до  млрд).
export const WORK_BASE: [string, number][] = [
  ['2017-01-01', 100], ['2020-01-01', 1000], ['2023-01-01', 7500], ['2024-12-31', 25000],
];
// Объём контракта зависит от размера выбранной модели: work × (параметры / эталон)^EXP, где эталон - 0,17 переднего края.
export const WORK_SIZE_REF = 0.17;
export const WORK_SIZE_EXP = 0.5;
export const WORK_SIZE_MIN = 0.4;
export const WORK_SIZE_MAX = 2.5;
export const TENDER_EXPIRE_DAYS = 20; // было 30: решение по заявке приходит быстрее
export const TENDER_PENALTY = 0.3;
export const RLHF_TENDER_PAY_MULT = 1.6;
export const RLHF_TENDER_LABELERS = 0.25;
export const REP_CONTRACT_OK = 3;
export const REP_CONTRACT_FAIL = -8;

// Инвесторы. Деньги инвесторов за игру - не больше ~1,5 выручки (API + контракты): мания и множители
// выручки снижены ещё в 3-4 раза, раунд - раз в год. Иначе раунды кормили аренду в десятки раз больше рынка.
export const VALUATION_FLOOR = 6_000_000; // было 4 млн: посевной раунд до первой модели заметнее
export const MANIA: [string, number][] = [
  ['2017-01-01', 10e6], ['2019-01-01', 20e6], ['2020-01-01', 50e6], ['2021-01-01', 80e6],
  ['2022-01-01', 100e6], ['2023-01-01', 0.2e9], ['2024-01-01', 0.5e9], ['2024-12-31', 0.7e9],
];
export const REV_MULT: Record<number, number> = {
  2017: 1.5, 2018: 1.5, 2019: 1.5, 2020: 1.5, 2021: 1.5, 2022: 1.5, 2023: 1.5, 2024: 2,
};
export const ROUND_FRACTIONS = [0.1, 0.2, 0.3] as const;
export const ROUND_COOLDOWN_DAYS = 365;
/** Экстренный раунд: деньги в минусе - раунд доступен до конца перерыва, но оценка ниже (×0,6). */
export const EMERGENCY_VALUATION_MULT = 0.6;
/** Переговоры экстренного раунда, дней: короче обычных 30-60, чтобы деньги пришли раньше банкротства (BANKRUPT_DAYS). */
export const EMERGENCY_ROUND_DAYS = 14;
// Доля основателя: ниже FOUNDER_BOARD_SHARE совет директоров берёт управление (событие 'board-control'),
// ниже FOUNDER_WARN_SHARE приходит важное письмо-предупреждение (один раз).
export const FOUNDER_BOARD_SHARE = 0.5;
export const FOUNDER_WARN_SHARE = 0.25;
// Событие 'board-control': принять план совета - шумиха +BOARD_PLAN_HYPE, оценка следующего раунда × BOARD_PLAN_VALUATION_MULT;
// отстоять свой план - репутация BOARD_DEFEND_REP; выкупить BOARD_BUYBACK_SHARE компании по текущей оценке × BOARD_BUYBACK_PREMIUM.
export const BOARD_PLAN_HYPE = 20;
export const BOARD_PLAN_VALUATION_MULT = 0.7;
export const BOARD_DEFEND_REP = -10;
export const BOARD_BUYBACK_SHARE = 0.1;
export const BOARD_BUYBACK_PREMIUM = 1.25;

// Финансы
export const OVERHEAD_MONTHLY = 100_000;
export const OVERHEAD_REVENUE_SHARE = 0.03;

// Разоблачение
// Было 0,006 и −15: «подгонщик» (bots.ts) терял репутацию до нуля после 10-12 разоблачений и падал на 20-30-е место;
// теперь он на 6-9-м месте (зёрна 1-5), заметно ниже «разумного», но не на дне.
export const EXPOSE_PER_PP = 0.004;
export const EXPOSE_ARENA_BONUS = 0.02;
export const EXPOSE_MAX = 0.35;
export const EXPOSE_REP = -5;
export const EXPOSE_HYPE_MULT = 0.5;

export const HYPE_OWNERS: readonly HypeOwner[] = ['player', 'openbrain', 'antropik', 'gogle', 'zhipo', 'moonshoot', 'deepcent', 'alibabo'];
