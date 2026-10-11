// Все числа баланса среза. Формулы - в design.md, раздел «Формулы и баланс».
// Точки кривых: [дата 'YYYY-MM-DD', значение]; между точками - lerpByDate (линейно или в логарифме).

import type { Allocation, ChainTech, DomainId, HypeOwner, TechId } from './types';

export const START_DATE = '2017-01-01';
export const END_DATE = '2024-12-31';
export const START_CASH = 3_000_000;
export const START_REPUTATION = 20;
export const DEFAULT_ALLOC: Allocation = { training: 0.4, contracts: 0.2, experiments: 0.4, inference: 0 };

// Время (FR-1)
export const TICK_MS: Record<1 | 2 | 4, number> = { 1: 500, 2: 250, 4: 125 };
export const BANKRUPT_DAYS = 60;

// Вычисления
export const TRAIN_FLOP_PER_H100E_DAY = 989e12 * 0.4 * 86400;
export const INF_FLOP_PER_H100E_DAY = 989e12 * 0.15 * 86400;
export const RENT_CAP_2017 = 512; // на тип GPU, удваивается каждый год
export const MAX_TOKENS_B: Record<number, number> = {
  2017: 50, 2018: 100, 2019: 300, 2020: 1000, 2021: 2000, 2022: 5000, 2023: 10000, 2024: 20000,
};
export const PARAMS_B_MIN = 0.05;
export const PARAMS_B_MAX = 2000;
export const TOKENS_B_MIN = 0.5;

// Исследования
export const RP_BASE = 10;
export const RP_K = 25;
export const TECH_COST: Record<Exclude<TechId, ChainTech>, number> = { attention: 4000, scaling: 15000, rlhf: 30000 };
export const TECH_REQUIRES: Record<TechId, TechId[]> = {
  attention: [],
  scaling: ['attention'],
  rlhf: ['attention'],
  algo: [],
  context: ['attention'],
};
export const ALGO_BASE_COST = 5000;
export const ALGO_COST_GROWTH = 1.6;
export const ALGO_MULT = 1.25;
export const ATTENTION_PAPER_DISCOUNT = 0.4;
// Исследование раньше своего исторического времени дороже (как в Processor Tycoon):
// цена × (1 + EARLY_PENALTY_PER_YEAR × лет до исторической даты).
export const TECH_HISTORY_DATE: Record<Exclude<TechId, ChainTech>, string> = {
  attention: '2017-06-12',
  scaling: '2020-01-23',
  rlhf: '2022-01-27',
};
export const ALGO_HISTORY_START = '2017-01-01'; // уровень k «исторически» достигается через k × ALGO_LEVEL_DAYS дней
export const ALGO_LEVEL_DAYS = 243; // ≈ 1,5 уровня в год: 12-й уровень - к концу 2024 года
export const EARLY_PENALTY_PER_YEAR = 2.5;

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
export const ELO_RLHF_BASE = 210; // RLHF - главный скачок качества на Арене (у моделей с RLHF Эло прежнее: 553 + 210 = 693 + 70)
export const ELO_RLHF_PER_ALGO = 13; // было 12: «разумный» бот - около 3-го места, №1 - для сильной игры
export const ARENA_WEIGHTS: Record<DomainId, number> = { language: 0.5, code: 0.25, reasoning: 0.25 };
export const ARENA_OPEN_DATE = '2023-05-03';

// Шумиха
export const HYPE_RANK_BONUS = [12, 6, 3];
export const HYPE_ARENA_TOP_BONUS = 10;
export const HYPE_MONTHLY_DECAY = 0.9;
export const HYPE_K_BEFORE_ARENA = 3;
export const HYPE_K_AFTER_ARENA = 1.5;
export const HYPE_LOST_DEMAND_K = 0.3;

// Рынок
export const PRICE_ELASTICITY = 1.2;
export const TOKENS_PER_USER_DAY = 10_000; // для оценки числа пользователей модели
export const MARKET_MODELS_PER_LAB = 3;
export const MARKET_MAX_AGE_DAYS = 365 * 3;
export const DEMAND_TOKENS: [string, number][] = [
  ['2017-01-01', 5e7], ['2019-01-01', 2e8], ['2020-06-10', 3e8], ['2020-06-11', 2e9],
  ['2022-11-29', 4e9], ['2022-11-30', 2e10], ['2023-06-01', 3e11], ['2024-12-31', 3e12],
];
export const REF_PRICE: [string, number][] = [
  ['2017-01-01', 100], ['2020-01-01', 60], ['2022-01-01', 20], ['2023-01-01', 10], ['2024-01-01', 3], ['2024-12-31', 2.5],
];
export const REF_QUALITY: [string, number][] = [
  ['2017-01-01', 900], ['2020-01-01', 950], ['2023-01-01', 1050], ['2024-01-01', 1150], ['2024-12-31', 1180],
];
export const PLAYER_BRAND_K = 0.6;
export const CHAT_MOMENT_BRAND = 0.5;
export const EXPORT_CONTROL_BRAND = -0.2;

// Тендеры
export const TENDERS_PER_MONTH: Record<number, number> = {
  2017: 2, 2018: 2, 2019: 2, 2020: 3, 2021: 3, 2022: 3, 2023: 4, 2024: 4,
};
export const CAP_LEVEL: Record<number, number> = {
  2017: 0, 2018: 15, 2019: 30, 2020: 45, 2021: 55, 2022: 62, 2023: 72, 2024: 80,
};
export const WORK_BASE: [string, number][] = [
  ['2017-01-01', 20], ['2020-01-01', 200], ['2023-01-01', 2000], ['2024-12-31', 10000],
];
export const TENDER_APPLY_DAYS = 20;
export const TENDER_EXPIRE_DAYS = 30;
export const TENDER_PENALTY = 0.3;
export const RLHF_TENDER_PAY_MULT = 1.6;
export const RLHF_TENDER_LABELERS = 0.25;
export const REP_CONTRACT_OK = 3;
export const REP_CONTRACT_FAIL = -8;

// Инвесторы
export const VALUATION_FLOOR = 10_000_000;
export const MANIA: [string, number][] = [
  ['2017-01-01', 50e6], ['2019-01-01', 100e6], ['2020-01-01', 300e6], ['2021-01-01', 500e6],
  ['2022-01-01', 0.6e9], ['2023-01-01', 3e9], ['2024-01-01', 8e9], ['2024-12-31', 10e9],
];
export const REV_MULT: Record<number, number> = {
  2017: 15, 2018: 15, 2019: 15, 2020: 15, 2021: 15, 2022: 20, 2023: 30, 2024: 35,
};
export const ROUND_FRACTIONS = [0.1, 0.2, 0.3] as const;
export const ROUND_COOLDOWN_DAYS = 180;

// Финансы
export const OVERHEAD_MONTHLY = 100_000;
export const OVERHEAD_REVENUE_SHARE = 0.03;

// Разоблачение
export const EXPOSE_PER_PP = 0.006;
export const EXPOSE_ARENA_BONUS = 0.02;
export const EXPOSE_MAX = 0.35;
export const EXPOSE_REP = -15;
export const EXPOSE_HYPE_MULT = 0.5;

export const HYPE_OWNERS: readonly HypeOwner[] = ['player', 'openbrain', 'antropik', 'gogle', 'zhipo', 'moonshoot', 'deepcent', 'alibabo'];
