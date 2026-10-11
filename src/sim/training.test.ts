// Тесты обучения (TSK-005): формулы, опорные точки баланса, проекты, срыв, подгонка и разоблачение.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { benchScore } from './benchmarks';
import {
  ALGO_MULT,
  ARENA_OPEN_DATE,
  ELO_BASE,
  ELO_PER_CAP,
  ELO_RLHF_BASE,
  ELO_RLHF_PER_ALGO,
  EXPOSE_ARENA_BONUS,
  EXPOSE_HYPE_MULT,
  EXPOSE_MAX,
  EXPOSE_PER_PP,
  EXPOSE_REP,
  FAIL_BASE,
  FAIL_BIG_JUMP,
  FAIL_CONTINUE_PENALTY,
  FAIL_ROLLBACK,
  MAX_TOKENS_B,
  OVERFIT_K,
  RLHF_LABELERS_BASE,
  RLHF_LABELERS_PER_B,
  RLHF_LANGUAGE_BONUS,
  TRAIN_FLOP_PER_H100E_DAY,
} from './constants';
import { nextRandom } from './rng';
import { createInitialState } from './state';
import { dateToDay } from './time';
import {
  applyFailChoice,
  archFor,
  arenaElo,
  baseLevel,
  cancelTraining,
  capsFromPlan,
  chinchillaFactor,
  contextFlopMult,
  effectiveCompute,
  estimate,
  exposureChance,
  labelersCost,
  modelScore,
  monthlyExposure,
  overfitFromPlan,
  planFlop,
  progressDay,
  startTraining,
  validatePlan,
} from './training';
import type { GameState, Mail, PlayerModel, TrainingPlan } from './types';
import { BENCHMARK_IDS } from './types';

const { triggerEvent } = vi.hoisted(() => ({ triggerEvent: vi.fn() }));

// Мощность считаем просто: H100e = число арендованных H100 × доля. Почту и события подменяем.
vi.mock('./compute', () => ({
  pool: (s: GameState, kind: keyof GameState['compute']['alloc']) => s.compute.rented.h100 * s.compute.alloc[kind],
  rentPerDay: () => 0,
}));
vi.mock('./events', () => ({
  addMail: (s: GameState, m: Omit<Mail, 'id' | 'day' | 'read'>) => {
    const mail = { id: `m${s.nextMailNum++}`, day: s.day, read: false, ...m } as Mail;
    s.mail.push(mail);
    return mail;
  },
  // Мок triggerEvent писем не создаёт, поэтому ждать ответа не на что.
  awaitingEvent: (s: GameState, eventId: string) => s.mail.some((m) => m.eventId === eventId && m.choices && m.chosen === undefined),
  dropChoices: () => {},
  triggerEvent,
}));

beforeEach(() => triggerEvent.mockClear());

// ---------- Помощники ----------

const BALANCED = { language: 1 / 3, code: 1 / 3, reasoning: 1 / 3 };

function plan(over: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    name: 'Тест-1',
    paramsB: 10,
    tokensB: 200,
    mix: { ...BALANCED },
    benchShare: 0,
    benchTargets: [],
    rlhf: false,
    context: 512,
    ...over,
  };
}

/** План по Шиншилле (D = 20·N) с заданным базовым уровнем при данном algoLevel. */
function planForBase(base: number, algoLevel: number, over: Partial<TrainingPlan> = {}): TrainingPlan {
  const effective = 10 ** (18 + base / 10);
  const n = Math.sqrt(effective / ALGO_MULT ** algoLevel / 120);
  return plan({ paramsB: n / 1e9, tokensB: (20 * n) / 1e9, ...over });
}

/** Состояние поздней игры: все бенчмарки вышли, «Внимание» изучено, 1000 H100 (400 H100e на обучение). */
function lateState(seed = 1): GameState {
  const s = createInitialState('Тест', seed);
  s.day = dateToDay('2024-06-01');
  for (const id of BENCHMARK_IDS) s.benchmarks[id].introduced = true;
  s.research.done = ['attention'];
  s.compute.rented.h100 = 1000;
  return s;
}

function playerModel(over: Partial<PlayerModel> = {}): PlayerModel {
  const p = plan();
  return {
    id: 'p1',
    name: 'Тест-1',
    plan: p,
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 0,
    releasedDay: 100,
    caps: capsFromPlan(p, 0, 'transformer'),
    overfit: {},
    rlhf: false,
    arenaElo: 1000,
    price: 10,
    onApi: true,
    exposed: false,
    earned: 0,
    ...over,
  };
}

/** Довести идущий проект до конца (с запасом дней). */
function runToEnd(s: GameState, maxDays = 2000): void {
  for (let i = 0; i < maxDays && s.training; i++) progressDay(s);
}

// ---------- Формулы ----------

describe('planFlop / chinchillaFactor / effectiveCompute', () => {
  it('planFlop = 6·N·D, с RLHF на 10 % больше', () => {
    expect(planFlop(plan({ paramsB: 175, tokensB: 300 }))).toBeCloseTo(3.15e23, -18);
    expect(planFlop(plan({ paramsB: 175, tokensB: 300, rlhf: true }))).toBeCloseTo(3.15e23 * 1.1, -18);
  });

  it('chin = 1 при 20 токенах на параметр и меньше при любом другом соотношении', () => {
    expect(chinchillaFactor(10, 200)).toBeCloseTo(1, 12);
    expect(chinchillaFactor(10, 20)).toBeLessThan(1);
    expect(chinchillaFactor(10, 2000)).toBeLessThan(1);
    // симметрия в логарифме
    expect(chinchillaFactor(10, 20)).toBeCloseTo(chinchillaFactor(10, 2000), 12);
    // GTP-3: 300/175 токенов на параметр
    expect(chinchillaFactor(175, 300)).toBeCloseTo(0.2987, 3);
  });

  it('chin = 0 для нулевых размеров', () => {
    expect(chinchillaFactor(0, 100)).toBe(0);
    expect(chinchillaFactor(10, 0)).toBe(0);
  });

  it('E учитывает долю под бенчмарки, архитектуру и алгоритмы, но не надбавку RLHF', () => {
    const p = plan({ paramsB: 10, tokensB: 200 });
    const e0 = effectiveCompute(p, 0, 'transformer');
    expect(e0).toBeCloseTo(6 * 10e9 * 200e9, -15);
    expect(effectiveCompute(plan({ benchShare: 0.2 }), 0, 'transformer')).toBeCloseTo(e0 * 0.8, -12);
    expect(effectiveCompute(p, 0, 'lstm')).toBeCloseTo(e0 * 0.15, -12);
    expect(effectiveCompute(p, 3, 'transformer')).toBeCloseTo(e0 * ALGO_MULT ** 3, -12);
    expect(effectiveCompute(plan({ rlhf: true }), 0, 'transformer')).toBeCloseTo(e0, -12);
  });

  it('baseLevel = 10·(log10 E − 18)', () => {
    expect(baseLevel(1e18)).toBeCloseTo(0, 9);
    expect(baseLevel(1e19)).toBeCloseTo(10, 9);
    expect(baseLevel(1e25)).toBeCloseTo(70, 9);
    expect(Number.isFinite(baseLevel(0))).toBe(true);
  });
});

describe('capsFromPlan', () => {
  it('при ровном миксе все способности равны базовому уровню', () => {
    const p = plan({ paramsB: 175, tokensB: 300 });
    const caps = capsFromPlan(p, 0, 'transformer');
    const base = baseLevel(effectiveCompute(p, 0, 'transformer'));
    expect(caps.language).toBeCloseTo(base, 9);
    expect(caps.code).toBeCloseTo(base, 9);
    expect(caps.reasoning).toBeCloseTo(base, 9);
  });

  it('микс сдвигает способности на 8·(3m − 1)', () => {
    const p = plan({ mix: { language: 0.6, code: 0.3, reasoning: 0.1 } });
    const base = baseLevel(effectiveCompute(p, 0, 'transformer'));
    const caps = capsFromPlan(p, 0, 'transformer');
    expect(caps.language).toBeCloseTo(base + 8 * (3 * 0.6 - 1), 9);
    expect(caps.code).toBeCloseTo(base + 8 * (3 * 0.3 - 1), 9);
    expect(caps.reasoning).toBeCloseTo(base + 8 * (3 * 0.1 - 1), 9);
  });

  it('RLHF прибавляет языку RLHF_LANGUAGE_BONUS, остальным ничего', () => {
    const plain = capsFromPlan(plan(), 0, 'transformer');
    const rlhf = capsFromPlan(plan({ rlhf: true }), 0, 'transformer');
    expect(rlhf.language - plain.language).toBeCloseTo(RLHF_LANGUAGE_BONUS, 9);
    expect(rlhf.code).toBeCloseTo(plain.code, 9);
    expect(rlhf.reasoning).toBeCloseTo(plain.reasoning, 9);
  });

  it('доля под бенчмарки снижает способности (меньше E и штраф 15·b), штраф срыва вычитается', () => {
    const plain = capsFromPlan(plan(), 0, 'transformer');
    const b = 0.2;
    const fit = capsFromPlan(plan({ benchShare: b }), 0, 'transformer');
    const expected = plain.code + 10 * Math.log10(1 - b) - 15 * b;
    expect(fit.code).toBeCloseTo(expected, 9);
    expect(fit.code).toBeLessThan(plain.code);
    const failed = capsFromPlan(plan(), 0, 'transformer', FAIL_CONTINUE_PENALTY);
    expect(failed.language).toBeCloseTo(plain.language - FAIL_CONTINUE_PENALTY, 9);
  });
});

describe('overfitFromPlan', () => {
  it('пуст без доли данных или без целей', () => {
    expect(overfitFromPlan(plan({ benchShare: 0, benchTargets: ['mmlu'] }))).toEqual({});
    expect(overfitFromPlan(plan({ benchShare: 0.3, benchTargets: [] }))).toEqual({});
  });

  it('одна цель получает 60·b', () => {
    expect(overfitFromPlan(plan({ benchShare: 0.2, benchTargets: ['mmlu'] }))).toEqual({ mmlu: OVERFIT_K * 0.2 });
  });

  it('несколько целей делят подгонку на sqrt(n)', () => {
    const o = overfitFromPlan(plan({ benchShare: 0.3, benchTargets: ['mmlu', 'humaneval', 'gsm8k'] }));
    const each = (OVERFIT_K * 0.3) / Math.sqrt(3);
    expect(Object.keys(o).sort()).toEqual(['gsm8k', 'humaneval', 'mmlu']);
    for (const v of Object.values(o)) expect(v).toBeCloseTo(each, 9);
    const two = overfitFromPlan(plan({ benchShare: 0.3, benchTargets: ['mmlu', 'gsm8k'] }));
    expect(two.mmlu).toBeCloseTo((OVERFIT_K * 0.3) / Math.sqrt(2), 9);
  });

  it('повторы в целях не считаются дважды', () => {
    const o = overfitFromPlan(plan({ benchShare: 0.2, benchTargets: ['mmlu', 'mmlu'] }));
    expect(o).toEqual({ mmlu: OVERFIT_K * 0.2 });
  });
});

describe('arenaElo', () => {
  it('Elo = 693 + 5·capA (+ RLHF)', () => {
    const caps = { language: 50, code: 40, reasoning: 30 };
    const capA = 0.5 * 50 + 0.25 * 40 + 0.25 * 30;
    expect(arenaElo(caps, false, 0)).toBeCloseTo(ELO_BASE + ELO_PER_CAP * capA, 9);
    expect(arenaElo(caps, false, 5)).toBeCloseTo(ELO_BASE + ELO_PER_CAP * capA, 9);
    expect(arenaElo(caps, true, 3)).toBeCloseTo(ELO_BASE + ELO_PER_CAP * capA + ELO_RLHF_BASE + ELO_RLHF_PER_ALGO * 3, 9);
  });
});

describe('modelScore', () => {
  const overfit = { mmlu: 12 };

  it('честный балл не использует подгонку', () => {
    const m = playerModel({ overfit });
    expect(modelScore(m, 'mmlu', true)).toBeCloseTo(benchScore('mmlu', m.caps.language), 9);
  });

  it('показанный балл включает подгонку, пока модель не разоблачена', () => {
    const m = playerModel({ overfit });
    expect(modelScore(m, 'mmlu', false)).toBeCloseTo(benchScore('mmlu', m.caps.language, 12), 9);
    expect(modelScore(m, 'mmlu', false)).toBeGreaterThan(modelScore(m, 'mmlu', true));
    // на нецелевом бенчмарке разницы нет
    expect(modelScore(m, 'humaneval', false)).toBeCloseTo(modelScore(m, 'humaneval', true), 9);
  });

  it('у разоблачённой модели показанный балл равен честному', () => {
    const m = playerModel({ overfit, exposed: true });
    expect(modelScore(m, 'mmlu', false)).toBeCloseTo(modelScore(m, 'mmlu', true), 9);
  });
});

describe('arch и разметчики', () => {
  it('archFor: трансформер только после «Механизма внимания»', () => {
    const s = createInitialState('Тест', 1);
    expect(archFor(s)).toBe('lstm');
    s.research.done = ['scaling'];
    expect(archFor(s)).toBe('lstm');
    s.research.done = ['attention'];
    expect(archFor(s)).toBe('transformer');
  });

  it('labelersCost: только для RLHF, $200 тыс. + $2 тыс. за млрд параметров', () => {
    expect(labelersCost(plan({ paramsB: 100 }))).toBe(0);
    expect(labelersCost(plan({ paramsB: 100, rlhf: true }))).toBe(RLHF_LABELERS_BASE + RLHF_LABELERS_PER_B * 100);
  });
});

// ---------- Опорные точки баланса (design.md) ----------

describe('опорные точки: способности и баллы', () => {
  const score = (bid: Parameters<typeof benchScore>[0], caps: ReturnType<typeof capsFromPlan>) =>
    benchScore(bid, caps[bid === 'mmlu' ? 'language' : bid === 'humaneval' || bid === 'swebench' ? 'code' : 'reasoning']);

  it('planForBase действительно даёт нужный базовый уровень', () => {
    for (const [base, algo] of [[60, 2], [77, 4], [85, 8]]) {
      const p = planForBase(base, algo);
      expect(baseLevel(effectiveCompute(p, algo, 'transformer'))).toBeCloseTo(base, 6);
    }
  });

  it('«как GTP-3»: 175 млрд параметров, 300 млрд токенов → MMLO 40-48 %, HumanEvol < 5 %, Elo 760-840 (как GTP-3 в каталоге)', () => {
    const caps = capsFromPlan(plan({ paramsB: 175, tokensB: 300 }), 0, 'transformer');
    expect(score('mmlu', caps)).toBeGreaterThanOrEqual(40);
    expect(score('mmlu', caps)).toBeLessThanOrEqual(48);
    expect(score('humaneval', caps)).toBeLessThan(5);
    const elo = arenaElo(caps, false, 0);
    expect(elo).toBeGreaterThanOrEqual(760);
    expect(elo).toBeLessThanOrEqual(840);
  });

  it('«как GTP-3.5»: base ≈ 60, RLHF, algo 2 → Elo 1080-1140', () => {
    const caps = capsFromPlan(planForBase(60, 2, { rlhf: true }), 2, 'transformer');
    const elo = arenaElo(caps, true, 2);
    expect(elo).toBeGreaterThanOrEqual(1080);
    expect(elo).toBeLessThanOrEqual(1140);
  });

  it('«как GTP-4»: base ≈ 77, RLHF, algo 4 → MMLO 83-89, HumanEvol 60-72, GSM8C 88-95, Elo 1160-1220', () => {
    const caps = capsFromPlan(planForBase(77, 4, { rlhf: true }), 4, 'transformer');
    expect(score('mmlu', caps)).toBeGreaterThanOrEqual(83);
    expect(score('mmlu', caps)).toBeLessThanOrEqual(89);
    expect(score('humaneval', caps)).toBeGreaterThanOrEqual(60);
    expect(score('humaneval', caps)).toBeLessThanOrEqual(72);
    expect(score('gsm8k', caps)).toBeGreaterThanOrEqual(88);
    expect(score('gsm8k', caps)).toBeLessThanOrEqual(95);
    const elo = arenaElo(caps, true, 4);
    expect(elo).toBeGreaterThanOrEqual(1160);
    expect(elo).toBeLessThanOrEqual(1220);
  });

  it('фронтир 2024: base ≈ 85, RLHF, algo 8 → MMLO 88-94, GPQE 55-70, SWE-banch 30-55', () => {
    const caps = capsFromPlan(planForBase(85, 8, { rlhf: true }), 8, 'transformer');
    expect(score('mmlu', caps)).toBeGreaterThanOrEqual(88);
    expect(score('mmlu', caps)).toBeLessThanOrEqual(94);
    expect(score('gpqa', caps)).toBeGreaterThanOrEqual(55);
    expect(score('gpqa', caps)).toBeLessThanOrEqual(70);
    expect(score('swebench', caps)).toBeGreaterThanOrEqual(30);
    expect(score('swebench', caps)).toBeLessThanOrEqual(55);
  });

  it('якоря выдерживают небольшой разброс базового уровня (±1)', () => {
    for (const d of [-1, 1]) {
      const g4 = capsFromPlan(planForBase(77 + d, 4, { rlhf: true }), 4, 'transformer');
      expect(score('mmlu', g4)).toBeGreaterThan(80);
      expect(score('mmlu', g4)).toBeLessThan(92);
      const elo = arenaElo(g4, true, 4);
      expect(elo).toBeGreaterThan(1150);
      expect(elo).toBeLessThan(1230);
      // «как GTP-3.5» остаётся в своём окне Elo при сдвиге базового уровня на ±1
      const g35 = arenaElo(capsFromPlan(planForBase(60 + d, 2, { rlhf: true }), 2, 'transformer'), true, 2);
      expect(g35).toBeGreaterThanOrEqual(1080);
      expect(g35).toBeLessThanOrEqual(1140);
    }
  });

  it('без «Механизма внимания» (LSTM) модель того же размера в разы слабее', () => {
    const p = plan({ paramsB: 175, tokensB: 300 });
    const lstm = capsFromPlan(p, 0, 'lstm');
    const tr = capsFromPlan(p, 0, 'transformer');
    expect(tr.language - lstm.language).toBeCloseTo(-10 * Math.log10(0.15), 9);
  });
});

describe('подгонка под бенчмарки', () => {
  const targets = plan({ benchShare: 0.2, benchTargets: ['mmlu'] });

  it('поднимает показанный балл цели сильнее, чем нецелевых, а честные способности чуть снижает', () => {
    const honestPlan = plan();
    const honestCaps = capsFromPlan(honestPlan, 0, 'transformer');
    const caps = capsFromPlan(targets, 0, 'transformer');
    const overfit = overfitFromPlan(targets);
    const shownTarget = benchScore('mmlu', caps.language, overfit.mmlu ?? 0);
    const shownOther = benchScore('glue', caps.language, overfit.glue ?? 0);
    const baseTarget = benchScore('mmlu', honestCaps.language);
    const baseOther = benchScore('glue', honestCaps.language);
    // цель выросла, нецелевой бенчмарк того же домена упал
    expect(shownTarget).toBeGreaterThan(baseTarget);
    expect(shownOther).toBeLessThan(baseOther);
    expect(shownTarget - baseTarget).toBeGreaterThan(shownOther - baseOther);
    // честные способности упали
    expect(caps.language).toBeLessThan(honestCaps.language);
  });

  it('не меняет Elo: цели не влияют, а Elo считается только по честным способностям', () => {
    const noTargets = plan({ benchShare: 0.2, benchTargets: [] });
    const eloA = arenaElo(capsFromPlan(targets, 0, 'transformer'), false, 0);
    const eloB = arenaElo(capsFromPlan(noTargets, 0, 'transformer'), false, 0);
    expect(eloA).toBeCloseTo(eloB, 9);
    // сама доля данных под тесты Elo только снижает
    const eloClean = arenaElo(capsFromPlan(plan(), 0, 'transformer'), false, 0);
    expect(eloA).toBeLessThan(eloClean);
  });

  it('готовая модель хранит подгонку отдельно от способностей и Elo', () => {
    const s = lateState();
    s.compute.rented.h100 = 1e7;
    expect(startTraining(s, targets)).toEqual({ ok: true });
    runToEnd(s);
    const m = s.models[0];
    expect(m.overfit).toEqual({ mmlu: OVERFIT_K * 0.2 });
    expect(m.arenaElo).toBeCloseTo(arenaElo(m.caps, false, 0), 9);
    expect(modelScore(m, 'mmlu', false)).toBeGreaterThan(modelScore(m, 'mmlu', true));
  });
});

// ---------- Проверка и оценка ----------

describe('validatePlan', () => {
  it('принимает нормальный план', () => {
    expect(validatePlan(lateState(), plan())).toBeNull();
  });

  it('отклоняет пустое название', () => {
    expect(validatePlan(lateState(), plan({ name: '   ' }))).toMatch(/названи/i);
  });

  it('отклоняет размеры вне границ', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ paramsB: 0.01 }))).toMatch(/параметр/);
    expect(validatePlan(s, plan({ paramsB: 5000 }))).toMatch(/параметр/);
    expect(validatePlan(s, plan({ paramsB: Number.NaN }))).toMatch(/параметр/);
    expect(validatePlan(s, plan({ tokensB: 0.1 }))).toMatch(/токен/);
  });

  it('ограничивает данные по годам', () => {
    const s = lateState();
    s.day = dateToDay('2017-06-01');
    expect(validatePlan(s, plan({ tokensB: MAX_TOKENS_B[2017] }))).toBeNull();
    expect(validatePlan(s, plan({ tokensB: MAX_TOKENS_B[2017] + 1 }))).toMatch(/2017/);
    s.day = dateToDay('2024-06-01');
    expect(validatePlan(s, plan({ tokensB: MAX_TOKENS_B[2024] }))).toBeNull();
    expect(validatePlan(s, plan({ tokensB: MAX_TOKENS_B[2024] + 1 }))).toMatch(/2024/);
  });

  it('требует микс из долей с суммой 1', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ mix: { language: 0.5, code: 0.5, reasoning: 0 } }))).toBeNull();
    expect(validatePlan(s, plan({ mix: { language: 0.5, code: 0.5, reasoning: 0.5 } }))).toMatch(/100 %/);
    expect(validatePlan(s, plan({ mix: { language: 1.2, code: -0.2, reasoning: 0 } }))).toMatch(/100 %/);
  });

  it('проверяет долю под бенчмарки и цели', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ benchShare: 0.5 }))).toBeNull();
    expect(validatePlan(s, plan({ benchShare: 0.51 }))).toMatch(/бенчмарк/);
    expect(validatePlan(s, plan({ benchShare: -0.1 }))).toMatch(/бенчмарк/);
    expect(validatePlan(s, plan({ benchShare: 0.1, benchTargets: ['mmlu', 'gsm8k', 'gpqa'] }))).toBeNull();
    expect(validatePlan(s, plan({ benchShare: 0.1, benchTargets: ['mmlu', 'gsm8k', 'gpqa', 'swebench'] }))).toMatch(/не больше 3/);
  });

  it('цели - только вышедшие бенчмарки', () => {
    const s = lateState();
    s.benchmarks.gpqa.introduced = false;
    expect(validatePlan(s, plan({ benchShare: 0.1, benchTargets: ['gpqa'] }))).toMatch(/не вышел/);
    expect(validatePlan(s, plan({ benchShare: 0.1, benchTargets: ['mmlu'] }))).toBeNull();
  });

  it('RLHF - только после исследования', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ rlhf: true }))).toMatch(/RLHF/);
    s.research.done = ['attention', 'rlhf'];
    expect(validatePlan(s, plan({ rlhf: true }))).toBeNull();
  });

  it('проверяет деньги на разметчиков', () => {
    const s = lateState();
    s.research.done = ['attention', 'rlhf'];
    const p = plan({ paramsB: 100, rlhf: true });
    s.cash = labelersCost(p) - 1;
    expect(validatePlan(s, p)).toMatch(/разметчик/);
    s.cash = labelersCost(p);
    expect(validatePlan(s, p)).toBeNull();
    // без RLHF разметчики не нужны
    s.cash = 0;
    expect(validatePlan(s, plan())).toBeNull();
  });

  it('не даёт начать второй проект', () => {
    const s = lateState();
    expect(startTraining(s, plan())).toEqual({ ok: true });
    expect(validatePlan(s, plan({ name: 'Второй' }))).toMatch(/проект/);
  });
});

describe('validatePlan: минус на счету', () => {
  it('проект без RLHF можно начать, даже если на счету минус (разметчики стоят $0)', () => {
    const s = lateState();
    s.cash = -250_000;
    expect(validatePlan(s, plan())).toBeNull();
    expect(estimate(s, plan()).error).toBeNull();
    expect(startTraining(s, plan())).toEqual({ ok: true });
    expect(s.training).not.toBeNull();
    expect(s.cash).toBe(-250_000); // ничего не списано
  });

  it('минус в один доллар тоже не мешает проекту без RLHF', () => {
    const s = lateState();
    s.cash = -1;
    expect(validatePlan(s, plan())).toBeNull();
  });

  it('проект с RLHF при минусе на счету отклоняется: разметчикам нечем платить', () => {
    const s = lateState();
    s.research.done = ['attention', 'rlhf'];
    s.cash = -250_000;
    const p = plan({ paramsB: 100, rlhf: true });
    const error = validatePlan(s, p);
    expect(error).toMatch(/разметчик/);
    expect(error).toContain('нужно $400 тыс.');
    expect(error).toContain('на счету −$250 тыс.');
    expect(startTraining(s, p)).toMatchObject({ ok: false });
    expect(s.training).toBeNull();
  });

  it('в тексте ошибки про разметчиков нет двойной точки после «тыс.»', () => {
    const s = lateState();
    s.research.done = ['attention', 'rlhf'];
    const p = plan({ paramsB: 100, rlhf: true });
    for (const cash of [0, 12_345, 250_000, -250_000, 399_999]) {
      s.cash = cash;
      const error = validatePlan(s, p)!;
      expect(error, `cash = ${cash}`).not.toMatch(/\.\./);
      expect(error.endsWith('.'), `cash = ${cash}`).toBe(true);
    }
    // суммы в миллионах и в долларах без сокращения тоже заканчиваются одной точкой
    s.cash = 150;
    expect(validatePlan(s, p)).toMatch(/на счету \$150\.$/);
    s.cash = -2_000_000;
    expect(validatePlan(s, p)).toMatch(/на счету −\$2 млн\.$/);
  });
});

describe('estimate', () => {
  it('без «Законов масштабирования» нет прогноза и подсказки', () => {
    const s = lateState();
    const est = estimate(s, plan({ paramsB: 175, tokensB: 300 }));
    expect(est.forecast).toBeNull();
    expect(est.optimal).toBeNull();
    expect(est.flop).toBeCloseTo(3.15e23, -18);
    expect(est.arch).toBe('transformer');
    expect(est.error).toBeNull();
  });

  it('срок = FLOP / (мощность обучения × пропускная способность), с округлением вверх', () => {
    const s = lateState();
    const p = plan({ paramsB: 175, tokensB: 300 });
    const perDay = 400 * TRAIN_FLOP_PER_H100E_DAY;
    expect(estimate(s, p).days).toBe(Math.ceil(planFlop(p) / perDay));
  });

  it('при нулевой доле «Обучение» срок неизвестен', () => {
    const s = lateState();
    s.compute.alloc = { training: 0, contracts: 0.2, experiments: 0.4, inference: 0.4 };
    expect(estimate(s, plan()).days).toBeNull();
  });

  it('показывает разметчиков и ошибку проверки', () => {
    const s = lateState();
    s.research.done = ['attention', 'rlhf'];
    s.cash = 0;
    const p = plan({ paramsB: 50, rlhf: true });
    const est = estimate(s, p);
    expect(est.labelers).toBe(RLHF_LABELERS_BASE + RLHF_LABELERS_PER_B * 50);
    expect(est.error).toMatch(/разметчик/);
  });

  it('до «Механизма внимания» архитектура - LSTM', () => {
    const s = lateState();
    s.research.done = [];
    expect(estimate(s, plan()).arch).toBe('lstm');
  });

  it('со «Законами масштабирования» даёт прогноз по вышедшим бенчмаркам и Elo', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling'];
    s.benchmarks.swebench.introduced = false;
    s.benchmarks.gpqa.introduced = false;
    const p = plan({ paramsB: 175, tokensB: 300, benchShare: 0.2, benchTargets: ['mmlu'] });
    const est = estimate(s, p);
    expect(est.forecast).not.toBeNull();
    const f = est.forecast!;
    const caps = capsFromPlan(p, 0, 'transformer', 0);
    expect(f.caps.language).toBeCloseTo(caps.language, 9);
    expect(Object.keys(f.scores).sort()).toEqual(['glue', 'gsm8k', 'humaneval', 'mmlu', 'squad']);
    // прогноз - показанные баллы, то есть с подгонкой
    expect(f.scores.mmlu).toBeCloseTo(benchScore('mmlu', caps.language, OVERFIT_K * 0.2), 9);
    expect(f.scores.glue).toBeCloseTo(benchScore('glue', caps.language), 9);
    expect(f.elo).toBeCloseTo(arenaElo(caps, false, 0), 9);
  });

  it('прогноз учитывает уровень алгоритмов и RLHF', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling', 'rlhf'];
    s.research.algoLevel = 3;
    const p = plan({ rlhf: true });
    const f = estimate(s, p).forecast!;
    const caps = capsFromPlan(p, 3, 'transformer', 0);
    expect(f.caps.language).toBeCloseTo(caps.language, 9);
    expect(f.elo).toBeCloseTo(arenaElo(caps, true, 3), 9);
  });

  it('подсказка по Шиншилле: N = sqrt(FLOP/120), D = 20·N, тот же объём вычислений', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling'];
    const p = plan({ paramsB: 175, tokensB: 300 });
    const est = estimate(s, p);
    const n = Math.sqrt(est.flop / 120) / 1e9;
    expect(est.optimal!.paramsB).toBeCloseTo(n, 6);
    expect(est.optimal!.tokensB).toBeCloseTo(20 * n, 6);
    expect(planFlop(plan({ ...est.optimal! }))).toBeCloseTo(est.flop, -15);
    // а сама подсказка лучше исходного плана
    const better = capsFromPlan(plan({ ...est.optimal! }), 0, 'transformer');
    expect(better.language).toBeGreaterThan(capsFromPlan(p, 0, 'transformer').language);
  });

  it('подсказка сохраняет полный FLOP и для RLHF-проекта', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling', 'rlhf'];
    const p = plan({ paramsB: 100, tokensB: 500, rlhf: true });
    const est = estimate(s, p);
    expect(planFlop(plan({ ...est.optimal!, rlhf: true }))).toBeCloseTo(est.flop, -15);
  });

  it('для нулевых размеров не падает и не даёт прогноза', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling'];
    const est = estimate(s, plan({ paramsB: 0, tokensB: 0 }));
    expect(est.forecast).toBeNull();
    expect(est.optimal).toBeNull();
    expect(est.days).toBeNull();
    expect(est.error).not.toBeNull();
  });
});

// ---------- Проект: старт, отмена, прогресс ----------

describe('startTraining / cancelTraining', () => {
  it('создаёт проект со снимком уровня алгоритмов и архитектуры', () => {
    const s = lateState();
    s.research.algoLevel = 2;
    s.day = dateToDay('2024-03-05');
    const p = plan({ name: '  Альфа  ', paramsB: 20, tokensB: 400 });
    expect(startTraining(s, p)).toEqual({ ok: true });
    const t = s.training!;
    expect(t.plan.name).toBe('Альфа');
    expect(t.plan).not.toBe(p);
    expect(t.plan.mix).not.toBe(p.mix);
    expect(t.arch).toBe('transformer');
    expect(t.algoLevel).toBe(2);
    expect(t.flopTotal).toBeCloseTo(planFlop(p), -12);
    expect(t.flopDone).toBe(0);
    expect(t.startedDay).toBe(s.day);
    expect(t.failPenalty).toBe(0);
    expect(t.failAtFraction === null || (t.failAtFraction >= 0.2 && t.failAtFraction < 0.8)).toBe(true);
  });

  it('списывает разметчиков только для RLHF', () => {
    const s = lateState();
    s.research.done = ['attention', 'rlhf'];
    const cash = s.cash;
    expect(startTraining(s, plan({ paramsB: 100 }))).toEqual({ ok: true });
    expect(s.cash).toBe(cash);
    cancelTraining(s);
    expect(startTraining(s, plan({ paramsB: 100, rlhf: true }))).toEqual({ ok: true });
    const cost = RLHF_LABELERS_BASE + RLHF_LABELERS_PER_B * 100;
    expect(s.cash).toBe(cash - cost);
    expect(s.finance.month.expense.labelers).toBe(cost);
  });

  it('при ошибке ничего не меняет и возвращает текст', () => {
    const s = lateState();
    const before = JSON.stringify(s);
    const r = startTraining(s, plan({ name: '' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/названи/i);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('нельзя начать второй проект', () => {
    const s = lateState();
    expect(startTraining(s, plan())).toEqual({ ok: true });
    const r = startTraining(s, plan({ name: 'Второй' }));
    expect(r.ok).toBe(false);
  });

  it('cancelTraining снимает проект; без проекта - ошибка', () => {
    const s = lateState();
    expect(cancelTraining(s).ok).toBe(false);
    startTraining(s, plan());
    expect(cancelTraining(s)).toEqual({ ok: true });
    expect(s.training).toBeNull();
    expect(s.models).toHaveLength(0);
  });

  describe('шанс срыва', () => {
    const trials = 3000;
    const failRate = (setup: (s: GameState) => void, p: TrainingPlan): number => {
      let fails = 0;
      for (let seed = 1; seed <= trials; seed++) {
        const s = lateState(seed);
        setup(s);
        startTraining(s, p);
        if (s.training!.failAtFraction !== null) fails++;
      }
      return fails / trials;
    };

    it('около 4 % у обычного проекта', () => {
      const rate = failRate(() => {}, plan());
      expect(rate).toBeGreaterThan(FAIL_BASE - 0.015);
      expect(rate).toBeLessThan(FAIL_BASE + 0.015);
    });

    it('около 12 % при скачке FLOP более чем в 10 раз от лучшего прошлого проекта', () => {
      const p = plan();
      const rate = failRate((s) => (s.bestFlop = planFlop(p) / 11), p);
      expect(rate).toBeGreaterThan(FAIL_BASE + FAIL_BIG_JUMP - 0.025);
      expect(rate).toBeLessThan(FAIL_BASE + FAIL_BIG_JUMP + 0.025);
    });

    it('скачок не считается, если прошлых проектов не было или рост не больше 10×', () => {
      const p = plan();
      expect(failRate(() => {}, p)).toBeLessThan(FAIL_BASE + 0.015);
      expect(failRate((s) => (s.bestFlop = planFlop(p) / 9), p)).toBeLessThan(FAIL_BASE + 0.015);
    });

    it('точка срыва лежит в диапазоне 20-80 %', () => {
      let seen = 0;
      for (let seed = 1; seed <= trials; seed++) {
        const s = lateState(seed);
        startTraining(s, plan());
        const f = s.training!.failAtFraction;
        if (f === null) continue;
        seen++;
        expect(f).toBeGreaterThanOrEqual(0.2);
        expect(f).toBeLessThan(0.8);
      }
      expect(seen).toBeGreaterThan(50);
    });
  });
});

describe('progressDay', () => {
  /** Подобрать мощность так, чтобы за день проект проходил долю fraction от всего FLOP. */
  function setDailyFraction(s: GameState, fraction: number): void {
    const t = s.training!;
    s.compute.rented.h100 = (fraction * t.flopTotal) / (s.compute.alloc.training * TRAIN_FLOP_PER_H100E_DAY);
  }

  it('ничего не делает без проекта', () => {
    const s = lateState();
    const before = JSON.stringify(s);
    progressDay(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(triggerEvent).not.toHaveBeenCalled();
  });

  it('прибавляет в день мощность доли «Обучение» × пропускную способность', () => {
    const s = lateState();
    startTraining(s, plan({ paramsB: 175, tokensB: 300 }));
    s.training!.failAtFraction = null;
    progressDay(s);
    expect(s.training!.flopDone).toBeCloseTo(400 * TRAIN_FLOP_PER_H100E_DAY, -10);
    progressDay(s);
    expect(s.training!.flopDone).toBeCloseTo(2 * 400 * TRAIN_FLOP_PER_H100E_DAY, -10);
  });

  it('без мощности на обучение проект стоит', () => {
    const s = lateState();
    s.compute.alloc = { training: 0, contracts: 0.3, experiments: 0.4, inference: 0.3 };
    startTraining(s, plan());
    for (let i = 0; i < 10; i++) progressDay(s);
    expect(s.training!.flopDone).toBe(0);
  });

  it('по завершении создаёт модель, обновляет bestFlop и пишет письмо', () => {
    const s = lateState();
    s.research.done = ['attention', 'rlhf'];
    s.research.algoLevel = 2;
    s.day = dateToDay('2024-02-10');
    const p = plan({ name: 'Орион', paramsB: 30, tokensB: 600, rlhf: true });
    startTraining(s, p);
    const t = s.training!;
    t.failAtFraction = null;
    setDailyFraction(s, 0.4);
    progressDay(s);
    progressDay(s);
    expect(s.models).toHaveLength(0);
    progressDay(s);
    expect(s.training).toBeNull();
    expect(s.models).toHaveLength(1);
    const m = s.models[0];
    expect(m.id).toBe('p1');
    expect(m.name).toBe('Орион');
    expect(m.releasedDay).toBeNull();
    expect(m.onApi).toBe(false);
    expect(m.exposed).toBe(false);
    expect(m.price).toBe(0);
    expect(m.trainedDay).toBe(s.day);
    expect(m.rlhf).toBe(true);
    expect(m.algoLevel).toBe(2);
    expect(m.arch).toBe('transformer');
    expect(m.plan.name).toBe('Орион');
    const caps = capsFromPlan(p, 2, 'transformer', 0);
    expect(m.caps.language).toBeCloseTo(caps.language, 9);
    expect(m.caps.code).toBeCloseTo(caps.code, 9);
    expect(m.arenaElo).toBeCloseTo(arenaElo(caps, true, 2), 9);
    expect(s.bestFlop).toBeCloseTo(planFlop(p), -12);
    expect(s.nextModelNum).toBe(2);

    const mail = s.mail[s.mail.length - 1];
    expect(mail.kind).toBe('training');
    expect(mail.title).toContain('Орион');
    expect(mail.body).toMatch(/MMLO \d+,\d %/);
    expect(mail.body).toContain('Эло');
  });

  it('bestFlop не уменьшается после меньшего проекта, номера моделей растут', () => {
    const s = lateState();
    s.compute.rented.h100 = 1e7;
    startTraining(s, plan({ name: 'Большая', paramsB: 100, tokensB: 2000 }));
    runToEnd(s);
    const big = s.bestFlop;
    startTraining(s, plan({ name: 'Малая', paramsB: 1, tokensB: 20 }));
    runToEnd(s);
    expect(s.bestFlop).toBe(big);
    expect(s.models.map((m) => m.id)).toEqual(['p1', 'p2']);
    expect(s.nextModelNum).toBe(3);
  });

  it('до «Внимания» модель - LSTM и заметно слабее', () => {
    const lstm = lateState();
    lstm.research.done = [];
    lstm.compute.rented.h100 = 1e7;
    startTraining(lstm, plan());
    runToEnd(lstm);
    const tr = lateState();
    tr.compute.rented.h100 = 1e7;
    startTraining(tr, plan());
    runToEnd(tr);
    expect(lstm.models[0].arch).toBe('lstm');
    expect(tr.models[0].arch).toBe('transformer');
    expect(lstm.models[0].caps.language).toBeLessThan(tr.models[0].caps.language - 5);
  });

  it('срыв: в точке отказа проект замирает, событие запускается один раз', () => {
    const s = lateState();
    startTraining(s, plan());
    const t = s.training!;
    t.failAtFraction = 0.5;
    setDailyFraction(s, 0.3);
    progressDay(s);
    expect(triggerEvent).not.toHaveBeenCalled();
    expect(t.flopDone / t.flopTotal).toBeCloseTo(0.3, 9);
    progressDay(s);
    expect(triggerEvent).toHaveBeenCalledTimes(1);
    expect(triggerEvent).toHaveBeenCalledWith(s, 'training-fail');
    expect(t.failAtFraction).toBeNull();
    expect(t.flopDone / t.flopTotal).toBeCloseTo(0.5, 9);
    // дальше проект идёт и достраивается без нового срыва
    progressDay(s);
    expect(t.flopDone / t.flopTotal).toBeCloseTo(0.8, 9);
    progressDay(s);
    expect(s.training).toBeNull();
    expect(s.models).toHaveLength(1);
    expect(triggerEvent).toHaveBeenCalledTimes(1);
  });

  it('срыв не даёт проекту закончиться в тот же день, даже при огромной мощности', () => {
    const s = lateState();
    startTraining(s, plan());
    s.training!.failAtFraction = 0.3;
    setDailyFraction(s, 5);
    progressDay(s);
    expect(s.training).not.toBeNull();
    expect(s.models).toHaveLength(0);
    expect(triggerEvent).toHaveBeenCalledTimes(1);
    progressDay(s);
    expect(s.training).toBeNull();
    expect(s.models).toHaveLength(1);
  });
});

describe('applyFailChoice', () => {
  it('«Откат» отнимает 25 % всего объёма, но не уходит ниже нуля', () => {
    const s = lateState();
    startTraining(s, plan());
    const t = s.training!;
    t.flopDone = 0.5 * t.flopTotal;
    applyFailChoice(s, 'rollback');
    expect(t.flopDone).toBeCloseTo((0.5 - FAIL_ROLLBACK) * t.flopTotal, 6);
    expect(t.failPenalty).toBe(0);
    t.flopDone = 0.1 * t.flopTotal;
    applyFailChoice(s, 'rollback');
    expect(t.flopDone).toBe(0);
  });

  it('«Продолжить» даёт штраф к способностям готовой модели', () => {
    const run = (choice: 'rollback' | 'continue' | null): PlayerModel => {
      const s = lateState();
      s.compute.rented.h100 = 1e7;
      startTraining(s, plan());
      s.training!.failAtFraction = null;
      if (choice) applyFailChoice(s, choice);
      runToEnd(s);
      return s.models[0];
    };
    const clean = run(null);
    const penalised = run('continue');
    expect(penalised.caps.language).toBeCloseTo(clean.caps.language - FAIL_CONTINUE_PENALTY, 9);
    expect(penalised.caps.code).toBeCloseTo(clean.caps.code - FAIL_CONTINUE_PENALTY, 9);
    expect(penalised.arenaElo).toBeLessThan(clean.arenaElo);
    // откат на способности не влияет
    expect(run('rollback').caps.language).toBeCloseTo(clean.caps.language, 9);
  });

  it('без проекта ничего не делает', () => {
    const s = lateState();
    const before = JSON.stringify(s);
    applyFailChoice(s, 'rollback');
    applyFailChoice(s, 'continue');
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ---------- Разоблачение ----------

describe('exposureChance', () => {
  const gap = (m: PlayerModel, bid: Parameters<typeof modelScore>[1]) => modelScore(m, bid, false) - modelScore(m, bid, true);

  function released(over: Partial<PlayerModel> = {}): PlayerModel {
    return playerModel({ overfit: { mmlu: 12 }, ...over });
  }

  it('= 0,006 × разрыв в п.п. до открытия Арены', () => {
    const s = lateState();
    s.day = dateToDay(ARENA_OPEN_DATE) - 1;
    const m = released();
    expect(exposureChance(s, m)).toBeCloseTo(EXPOSE_PER_PP * gap(m, 'mmlu'), 9);
    expect(exposureChance(s, m)).toBeGreaterThan(0);
  });

  it('после открытия Арены прибавляется бонус', () => {
    const s = lateState();
    const m = released();
    s.day = dateToDay(ARENA_OPEN_DATE) - 1;
    const before = exposureChance(s, m);
    s.day = dateToDay(ARENA_OPEN_DATE);
    expect(exposureChance(s, m)).toBeCloseTo(before + EXPOSE_ARENA_BONUS, 9);
  });

  it('берёт самый большой разрыв по целям и не превышает потолок', () => {
    const s = lateState();
    s.day = 0;
    for (const id of BENCHMARK_IDS) s.benchmarks[id].introduced = true;
    const m = released({ overfit: { mmlu: 3, humaneval: 60 }, caps: { language: 50, code: 63.4, reasoning: 50 } });
    expect(gap(m, 'humaneval')).toBeGreaterThan(gap(m, 'mmlu'));
    expect(exposureChance(s, m)).toBe(EXPOSE_MAX);
    const small = released({ overfit: { mmlu: 3, humaneval: 1 } });
    expect(exposureChance(s, small)).toBeCloseTo(EXPOSE_PER_PP * Math.max(gap(small, 'mmlu'), gap(small, 'humaneval')), 9);
  });

  it('игнорирует цели, которые не вышли или насыщены', () => {
    const s = lateState();
    s.day = dateToDay('2023-06-01');
    const m = released({ overfit: { mmlu: 12, gpqa: 12 } });
    s.benchmarks.mmlu.saturated = true;
    s.benchmarks.gpqa.introduced = false;
    expect(exposureChance(s, m)).toBe(0);
    s.benchmarks.gpqa.introduced = true;
    expect(exposureChance(s, m)).toBeGreaterThan(0);
  });

  it('равен нулю для невыпущенных, разоблачённых и неподогнанных моделей', () => {
    const s = lateState();
    expect(exposureChance(s, released({ releasedDay: null }))).toBe(0);
    expect(exposureChance(s, released({ exposed: true }))).toBe(0);
    expect(exposureChance(s, released({ overfit: {} }))).toBe(0);
  });
});

describe('monthlyExposure', () => {
  function setup(seed: number, over: Partial<PlayerModel> = {}): GameState {
    const s = lateState(seed);
    s.day = dateToDay('2023-09-01');
    s.reputation = 60;
    s.hype.player = 40;
    s.models.push(playerModel({ overfit: { mmlu: 12 }, ...over }));
    return s;
  }

  it('частота разоблачений совпадает с расчётным шансом', () => {
    const trials = 3000;
    let hits = 0;
    let p = 0;
    for (let seed = 1; seed <= trials; seed++) {
      const s = setup(seed);
      p = exposureChance(s, s.models[0]);
      monthlyExposure(s);
      if (s.models[0].exposed) hits++;
    }
    expect(p).toBeGreaterThan(0.05);
    expect(hits / trials).toBeGreaterThan(p - 0.03);
    expect(hits / trials).toBeLessThan(p + 0.03);
  });

  it('при разоблачении: репутация, шумиха, пометка и письмо', () => {
    let s: GameState | null = null;
    for (let seed = 1; seed <= 500 && !s; seed++) {
      const t = setup(seed);
      monthlyExposure(t);
      if (t.models[0].exposed) s = t;
    }
    expect(s).not.toBeNull();
    expect(s!.reputation).toBe(60 + EXPOSE_REP);
    expect(s!.hype.player).toBeCloseTo(40 * EXPOSE_HYPE_MULT, 9);
    expect(modelScore(s!.models[0], 'mmlu', false)).toBeCloseTo(modelScore(s!.models[0], 'mmlu', true), 9);
    const mail = s!.mail[s!.mail.length - 1];
    expect(mail.title).toContain('Тест-1');
    expect(mail.body).toContain('свежих вопросах');
    expect(mail.body).toContain('MMLO');
  });

  it('репутация не уходит ниже нуля', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const s = setup(seed);
      s.reputation = 5;
      monthlyExposure(s);
      if (s.models[0].exposed) {
        expect(s.reputation).toBe(0);
        return;
      }
    }
    throw new Error('разоблачение не случилось ни на одном зерне');
  });

  it('второй раз ту же модель не разоблачают и письмо не дублируется', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const s = setup(seed);
      monthlyExposure(s);
      if (!s.models[0].exposed) continue;
      const mails = s.mail.length;
      const rep = s.reputation;
      for (let i = 0; i < 50; i++) monthlyExposure(s);
      expect(s.mail).toHaveLength(mails);
      expect(s.reputation).toBe(rep);
      return;
    }
    throw new Error('разоблачение не случилось ни на одном зерне');
  });

  it('не трогает невыпущенные и неподогнанные модели и не тратит случайные числа зря', () => {
    const s = setup(5, { releasedDay: null });
    s.models.push(playerModel({ id: 'p2', overfit: {} }));
    const rng = s.rng;
    monthlyExposure(s);
    expect(s.rng).toBe(rng);
    expect(s.models.every((m) => !m.exposed)).toBe(true);
    expect(s.mail).toHaveLength(0);
  });
});

// ---------- Дополнительные проверки (ревью TSK-005) ----------

describe('validatePlan: границы и странные значения', () => {
  it('название ровно в 40 символов проходит, в 41 - нет', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ name: 'а'.repeat(40) }))).toBeNull();
    expect(validatePlan(s, plan({ name: 'а'.repeat(41) }))).toMatch(/40/);
    // пробелы по краям не считаются
    expect(validatePlan(s, plan({ name: `  ${'а'.repeat(40)}  ` }))).toBeNull();
  });

  it('микс: допуск 1 %, NaN отклоняется', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ mix: { language: 0.5, code: 0.3, reasoning: 0.205 } }))).toBeNull();
    expect(validatePlan(s, plan({ mix: { language: 0.5, code: 0.3, reasoning: 0.18 } }))).toMatch(/100 %/);
    expect(validatePlan(s, plan({ mix: { language: Number.NaN, code: 0.5, reasoning: 0.5 } }))).toMatch(/100 %/);
  });

  it('бесконечные и NaN-размеры отклоняются', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ paramsB: Number.POSITIVE_INFINITY }))).toMatch(/параметр/);
    expect(validatePlan(s, plan({ tokensB: Number.NaN }))).toMatch(/токен/);
    expect(validatePlan(s, plan({ tokensB: Number.POSITIVE_INFINITY }))).toMatch(/токен/);
    expect(validatePlan(s, plan({ benchShare: Number.NaN }))).toMatch(/бенчмарк/);
  });

  it('повторы в целях считаются один раз; неизвестная цель отклоняется', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ benchShare: 0.1, benchTargets: ['mmlu', 'mmlu', 'mmlu', 'mmlu'] }))).toBeNull();
    expect(validatePlan(s, plan({ benchShare: 0.1, benchTargets: ['nope' as never] }))).toMatch(/не вышел/);
  });

  it('доля под бенчмарки без целей разрешена: она только съедает данные', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ benchShare: 0.3, benchTargets: [] }))).toBeNull();
    s.compute.rented.h100 = 1e7;
    expect(startTraining(s, plan({ benchShare: 0.3, benchTargets: [] }))).toEqual({ ok: true });
    runToEnd(s);
    const m = s.models[0];
    expect(m.overfit).toEqual({});
    expect(m.caps.language).toBeLessThan(capsFromPlan(plan(), 0, 'transformer').language);
    expect(exposureChance(s, { ...m, releasedDay: 1 })).toBe(0);
  });
});

describe('estimate: крайние случаи', () => {
  it('срок считается и для плана с ошибкой (чтобы форма показывала его), но не для бесконечного FLOP', () => {
    const s = lateState();
    const bad = estimate(s, plan({ name: '' }));
    expect(bad.error).not.toBeNull();
    expect(bad.days).toBe(Math.ceil(planFlop(plan()) / (400 * TRAIN_FLOP_PER_H100E_DAY)));

    const huge = estimate(s, plan({ paramsB: 1e300, tokensB: 1e300 }));
    expect(huge.error).not.toBeNull();
    expect(huge.days).toBeNull();
    expect(huge.forecast).toBeNull();
    expect(huge.optimal).toBeNull();
  });

  it('с NaN в миксе или доле под бенчмарки прогноза нет (в форме не будет NaN)', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling'];
    const badMix = estimate(s, plan({ mix: { language: Number.NaN, code: 0.5, reasoning: 0.5 } }));
    expect(badMix.forecast).toBeNull();
    expect(badMix.optimal).toBeNull();
    expect(badMix.error).not.toBeNull();
    expect(estimate(s, plan({ benchShare: Number.NaN })).forecast).toBeNull();
    // а нормальный план прогноз получает, и в нём нет NaN
    const ok = estimate(s, plan()).forecast!;
    expect(Number.isFinite(ok.elo)).toBe(true);
    for (const v of Object.values(ok.scores)) expect(Number.isFinite(v)).toBe(true);
  });

  it('срок не меньше одного дня даже у крошечного проекта', () => {
    const s = lateState();
    expect(estimate(s, plan({ paramsB: 0.05, tokensB: 0.5 })).days).toBe(1);
  });

  it('прогноз включает и насыщенные бенчмарки', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling'];
    s.benchmarks.squad.saturated = true;
    s.benchmarks.mmlu.saturated = true;
    const f = estimate(s, plan()).forecast!;
    expect(Object.keys(f.scores).sort()).toEqual([...BENCHMARK_IDS].sort());
  });

  it('оценка ничего не меняет в состоянии', () => {
    const s = lateState();
    s.research.done = ['attention', 'scaling', 'rlhf'];
    const before = JSON.stringify(s);
    estimate(s, plan({ rlhf: true, benchShare: 0.2, benchTargets: ['mmlu'] }));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('startTraining: расход случайных чисел', () => {
  it('без срыва тратит одно число, со срывом - два; точка срыва берётся из второго', () => {
    let calm = 0;
    let broken = 0;
    for (let seed = 1; seed <= 2000 && (calm < 5 || broken < 5); seed++) {
      const s = lateState(seed);
      const ref = { rng: s.rng };
      const failed = nextRandom(ref) < FAIL_BASE;
      const expectedAt = failed ? 0.2 + nextRandom(ref) * (0.8 - 0.2) : null;
      startTraining(s, plan());
      if (expectedAt === null) {
        expect(s.training!.failAtFraction).toBeNull();
        calm++;
      } else {
        expect(s.training!.failAtFraction).toBeCloseTo(expectedAt, 12);
        broken++;
      }
      expect(s.rng).toBe(ref.rng);
    }
    expect(calm).toBeGreaterThanOrEqual(5);
    expect(broken).toBeGreaterThanOrEqual(5);
  });

  it('порог скачка: при росте меньше 10× шанс обычный, больше - повышенный', () => {
    // Берём зерно, у которого первое случайное число между 4 % и 12 %: срыв только при скачке.
    let seed = 1;
    for (; seed < 5000; seed++) {
      const r = nextRandom({ rng: seed });
      if (r >= FAIL_BASE && r < FAIL_BASE + FAIL_BIG_JUMP) break;
    }
    expect(seed).toBeLessThan(5000);
    const p = plan();
    const at = (ratio: number): number | null => {
      const s = lateState(seed);
      s.bestFlop = planFlop(p) / ratio;
      startTraining(s, p);
      return s.training!.failAtFraction;
    };
    expect(at(9.9)).toBeNull();
    expect(at(10.1)).not.toBeNull();
    // без прошлых проектов (bestFlop = 0) скачка нет
    const first = lateState(seed);
    startTraining(first, p);
    expect(first.training!.failAtFraction).toBeNull();
  });

  it('копия плана не зависит от исходного объекта (повторы целей убраны)', () => {
    const s = lateState();
    const p = plan({ benchShare: 0.2, benchTargets: ['mmlu', 'mmlu', 'gsm8k'] });
    startTraining(s, p);
    p.mix.language = 0.9;
    p.benchTargets.push('humaneval');
    p.paramsB = 999;
    const t = s.training!;
    expect(t.plan.benchTargets).toEqual(['mmlu', 'gsm8k']);
    expect(t.plan.mix.language).toBeCloseTo(1 / 3, 9);
    expect(t.plan.paramsB).toBe(10);
  });

  it('отмена не возвращает деньги разметчикам', () => {
    const s = lateState();
    s.research.done = ['attention', 'rlhf'];
    const cash = s.cash;
    const p = plan({ paramsB: 100, rlhf: true });
    startTraining(s, p);
    cancelTraining(s);
    expect(s.cash).toBe(cash - labelersCost(p));
    expect(s.finance.month.expense.labelers).toBe(labelersCost(p));
  });
});

describe('срыв: полный цикл', () => {
  function runningWithFail(at: number): GameState {
    const s = lateState();
    startTraining(s, plan());
    s.training!.failAtFraction = at;
    const t = s.training!;
    // 30 % всего объёма в день
    s.compute.rented.h100 = (0.3 * t.flopTotal) / (s.compute.alloc.training * TRAIN_FLOP_PER_H100E_DAY);
    return s;
  }

  it('откат: проект теряет 25 %, идёт дальше без нового срыва и завершается без штрафа', () => {
    const s = runningWithFail(0.5);
    const t = s.training!;
    progressDay(s);
    progressDay(s); // 60 % > 50 %: срыв в точке 50 %
    expect(triggerEvent).toHaveBeenCalledTimes(1);
    expect(t.flopDone / t.flopTotal).toBeCloseTo(0.5, 9);
    applyFailChoice(s, 'rollback');
    expect(t.flopDone / t.flopTotal).toBeCloseTo(0.5 - FAIL_ROLLBACK, 9);
    progressDay(s); // 55 %
    progressDay(s); // 85 %
    expect(s.training).not.toBeNull();
    progressDay(s); // 115 %
    expect(s.training).toBeNull();
    expect(triggerEvent).toHaveBeenCalledTimes(1);
    const clean = capsFromPlan(plan(), 0, 'transformer');
    expect(s.models[0].caps.language).toBeCloseTo(clean.language, 9);
  });

  it('«Продолжить»: модель слабее на штраф, а в письме об этом сказано', () => {
    const s = runningWithFail(0.4);
    progressDay(s);
    progressDay(s);
    applyFailChoice(s, 'continue');
    progressDay(s);
    progressDay(s);
    expect(s.training).toBeNull();
    const m = s.models[0];
    const clean = capsFromPlan(plan(), 0, 'transformer');
    expect(m.caps.code).toBeCloseTo(clean.code - FAIL_CONTINUE_PENALTY, 9);
    // штраф к способностям съедает Elo ровно на ELO_PER_CAP × штраф
    expect(m.arenaElo).toBeCloseTo(arenaElo(clean, false, 0) - ELO_PER_CAP * FAIL_CONTINUE_PENALTY, 9);
    expect(s.mail[s.mail.length - 1].body).toContain('Из-за срыва обучения');
  });

  it('повторный выбор «Продолжить» штраф не удваивает', () => {
    const s = lateState();
    startTraining(s, plan());
    applyFailChoice(s, 'continue');
    applyFailChoice(s, 'continue');
    expect(s.training!.failPenalty).toBe(FAIL_CONTINUE_PENALTY);
  });

  it('если срыв был, но проект отменён, выбор в письме ничего не ломает', () => {
    const s = runningWithFail(0.3);
    progressDay(s);
    expect(triggerEvent).toHaveBeenCalledTimes(1);
    cancelTraining(s);
    expect(() => applyFailChoice(s, 'rollback')).not.toThrow();
    expect(() => applyFailChoice(s, 'continue')).not.toThrow();
    expect(s.training).toBeNull();
  });

  it('пока на письмо о срыве нет ответа (даже отложенное), проект стоит', () => {
    const s = runningWithFail(0.3);
    progressDay(s);
    const stuck = s.training!.flopDone;
    s.mail.push({ id: 'mf', day: s.day, title: 'Срыв', body: '', kind: 'training', read: true, eventId: 'training-fail', choices: [{ label: 'a', hint: 'b' }], deferred: true });
    progressDay(s);
    expect(s.training!.flopDone).toBe(stuck);
    s.mail[s.mail.length - 1].chosen = 0;
    progressDay(s);
    expect(s.training === null || s.training.flopDone > stuck).toBe(true);
  });

  it('проект без срыва может закончиться за один день при огромной мощности', () => {
    const s = lateState();
    startTraining(s, plan());
    s.training!.failAtFraction = null;
    s.compute.rented.h100 = 1e12;
    progressDay(s);
    expect(s.training).toBeNull();
    expect(s.models).toHaveLength(1);
    expect(triggerEvent).not.toHaveBeenCalled();
  });
});

describe('письмо о готовой модели', () => {
  function finished(
    over: Partial<TrainingPlan> = {},
    setup: (s: GameState) => void = () => {},
  ): { s: GameState; body: string; title: string } {
    const s = lateState();
    s.compute.rented.h100 = 1e7;
    setup(s);
    expect(startTraining(s, plan({ name: 'Альфа', ...over }))).toEqual({ ok: true });
    s.training!.failAtFraction = null;
    runToEnd(s);
    const mail = s.mail[s.mail.length - 1];
    return { s, body: mail.body, title: mail.title };
  }

  it('без подгонки и срыва - только баллы, Эло и подсказка выпустить', () => {
    const { s, body, title } = finished();
    expect(title).toBe('Модель «Альфа» готова');
    expect(body).not.toContain('подгонк');
    expect(body).not.toContain('срыва');
    expect(body).toContain('после выпуска');
    expect(body).toMatch(/около \d[\d ]* Эло/);
    // баллы совпадают с таблицей модели
    const m = s.models[0];
    expect(body).toContain(`MMLO ${modelScore(m, 'mmlu', false).toFixed(1).replace('.', ',')} %`);
  });

  it('с подгонкой предупреждает, что баллы завышены, а Арене это не помогает', () => {
    const { body } = finished({ benchShare: 0.2, benchTargets: ['mmlu'] });
    expect(body).toContain('завышены подгонкой');
  });

  it('насыщенные бенчмарки в письме пропускаются, а если насыщены все - показываются все', () => {
    const some = finished({}, (s) => {
      s.benchmarks.squad.saturated = true;
    });
    expect(some.body).not.toContain('SQuAT');
    expect(some.body).toContain('MMLO');
    const all = finished({}, (s) => {
      for (const id of BENCHMARK_IDS) s.benchmarks[id].saturated = true;
    });
    expect(all.body).toContain('SQuAT');
    expect(all.body).toContain('SWE-banch');
  });

  it('письмо «Модель готова» важное: игра встаёт на паузу', () => {
    const s = lateState();
    s.compute.rented.h100 = 1e7;
    startTraining(s, plan({ name: 'Альфа' }));
    s.training!.failAtFraction = null;
    runToEnd(s);
    const mail = s.mail[s.mail.length - 1];
    expect(mail.title).toBe('Модель «Альфа» готова');
    expect(mail.important).toBe(true);
  });

  it('слово «очко» согласуется с числом', () => {
    const word = (n: number): string => {
      const s = lateState();
      s.compute.rented.h100 = 1e7;
      startTraining(s, plan());
      s.training!.failAtFraction = null;
      s.training!.failPenalty = n;
      runToEnd(s);
      return s.mail[s.mail.length - 1].body;
    };
    expect(word(1)).toContain('на 1 очко');
    expect(word(3)).toContain('на 3 очка');
    expect(word(5)).toContain('на 5 очков');
  });
});

describe('monthlyExposure: письмо и пределы', () => {
  function setup(seed: number, over: Partial<PlayerModel> = {}): GameState {
    const s = lateState(seed);
    s.day = dateToDay('2023-09-01');
    s.reputation = 60;
    s.hype.player = 40;
    s.models.push(playerModel({ overfit: { mmlu: 12 }, ...over }));
    return s;
  }

  /** Первое зерно, при котором модель разоблачена. */
  function exposedState(over: Partial<PlayerModel> = {}, tweak: (s: GameState) => void = () => {}): GameState {
    for (let seed = 1; seed <= 2000; seed++) {
      const s = setup(seed, over);
      tweak(s);
      monthlyExposure(s);
      if (s.models[0].exposed) return s;
    }
    throw new Error('разоблачение не случилось ни на одном зерне');
  }

  it('в письме показанный и честный балл на самом завышенном бенчмарке', () => {
    const s = exposedState({ overfit: { mmlu: 12, humaneval: 30 } });
    const m = s.models[0];
    const body = s.mail[s.mail.length - 1].body;
    // у HumanEvol разрыв больше, чем у MMLO
    const shown = benchScore('humaneval', m.caps.code, 30).toFixed(1).replace('.', ',');
    const honest = benchScore('humaneval', m.caps.code).toFixed(1).replace('.', ',');
    expect(body).toContain('HumanEvol (код)');
    expect(body).toContain(`вместо заявленных ${shown} % получилось ${honest} %`);
  });

  it('письмо «Подгонка раскрыта» важное', () => {
    const s = exposedState();
    const mail = s.mail[s.mail.length - 1];
    expect(mail.title).toBe('Подгонка раскрыта: Тест-1');
    expect(mail.important).toBe(true);
  });

  it('в письме указано реальное падение репутации и шумихи', () => {
    const s = exposedState({}, (t) => {
      t.reputation = 5;
    });
    expect(s.reputation).toBe(0);
    const body = s.mail[s.mail.length - 1].body;
    expect(body).toContain('Репутация лаборатории упала на 5');
    expect(body).toContain('шумиха - на 50 %');
  });

  it('модели без подгонки в этот же месяц не страдают', () => {
    const t = setup(7);
    t.models.push(playerModel({ id: 'p2', overfit: {} }));
    for (let i = 0; i < 100; i++) monthlyExposure(t);
    expect(t.models[1].exposed).toBe(false);
  });

  it('если все целевые бенчмарки насыщены, случайные числа не тратятся', () => {
    const s = setup(3);
    s.benchmarks.mmlu.saturated = true;
    const rng = s.rng;
    monthlyExposure(s);
    expect(s.rng).toBe(rng);
    expect(s.models[0].exposed).toBe(false);
  });

  it('каждая подогнанная модель проверяется отдельно и тратит своё число', () => {
    const s = setup(11);
    s.models.push(playerModel({ id: 'p2', overfit: { mmlu: 12 } }));
    const ref = { rng: s.rng };
    const p = exposureChance(s, s.models[0]);
    const first = nextRandom(ref) < p;
    const second = nextRandom(ref) < p; // у второй модели то же p: шанс не зависит от первой
    monthlyExposure(s);
    expect(s.models[0].exposed).toBe(first);
    expect(s.models[1].exposed).toBe(second);
    expect(s.rng).toBe(ref.rng);
  });
});

// ---------- Детерминизм ----------

describe('детерминизм', () => {
  function scenario(seed: number): string {
    const s = lateState(seed);
    s.research.done = ['attention', 'rlhf'];
    s.compute.rented.h100 = 5e5;
    startTraining(s, plan({ name: 'Альфа', paramsB: 50, tokensB: 1000, rlhf: true, benchShare: 0.2, benchTargets: ['mmlu'] }));
    runToEnd(s);
    s.models[0].releasedDay = s.day;
    for (let i = 0; i < 24; i++) monthlyExposure(s);
    return JSON.stringify(s);
  }

  it('одинаковое зерно даёт одинаковый результат', () => {
    expect(scenario(42)).toBe(scenario(42));
  });

  it('разные зёрна могут давать разный ход событий', () => {
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) outcomes.add(scenario(seed));
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

describe('контекст в обучении', () => {
  it('каждое удвоение сверх 512 добавляет 5 % вычислений', () => {
    expect(contextFlopMult(512)).toBe(1);
    expect(contextFlopMult(1024)).toBeCloseTo(1.05, 10);
    expect(contextFlopMult(8192)).toBeCloseTo(1.2, 10);
    expect(planFlop(plan({ context: 2048 }))).toBeCloseTo(planFlop(plan()) * 1.1, 0);
  });

  it('контекст больше открытого или нестандартный не принимается', () => {
    const s = lateState();
    expect(validatePlan(s, plan({ context: 2048 }))).toContain('Длинный контекст');
    expect(validatePlan(s, plan({ context: 3000 }))).toContain('Неизвестная');
    s.research.contextLevel = 2;
    expect(validatePlan(s, plan({ context: 2048 }))).toBeNull();
  });

  it('готовая модель хранит контекст плана, выручка начинается с нуля', () => {
    const s = lateState();
    s.research.contextLevel = 1;
    startTraining(s, plan({ context: 1024 }));
    s.training!.failAtFraction = null;
    s.compute.rented.h100 = 1e12;
    progressDay(s);
    expect(s.models[0].plan.context).toBe(1024);
    expect(s.models[0].earned).toBe(0);
  });
});
