// Тесты тендеров и контрактов (TSK-008). Чужие модули подменены: тест проверяет только логику contracts.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BENCHMARKS } from '../data/benchmarks';
import { CLIENTS } from '../data/clients';
import type { BenchmarkId, Contract, GameState, PlayerModel, Tender } from './types';

const m = vi.hoisted(() => ({
  modelScore: vi.fn(),
  benchScore: vi.fn(),
  benchDef: vi.fn(),
  activeBenchmarks: vi.fn(),
  introducedBenchmarks: vi.fn(),
  pool: vi.fn(),
  cheapestH100eDay: vi.fn(),
}));

vi.mock('./training', () => ({ modelScore: m.modelScore }));
vi.mock('./benchmarks', () => ({
  benchScore: m.benchScore,
  benchDef: m.benchDef,
  activeBenchmarks: m.activeBenchmarks,
  introducedBenchmarks: m.introducedBenchmarks,
}));
vi.mock('./compute', () => ({ pool: m.pool, cheapestH100eDay: m.cheapestH100eDay }));

import {
  CAP_LEVEL,
  REP_CONTRACT_FAIL,
  REP_CONTRACT_OK,
  RLHF_TENDER_LABELERS,
  RLHF_TENDER_PAY_MULT,
  TENDER_APPLY_DAYS,
  TENDER_EXPIRE_DAYS,
  TENDER_PENALTY,
  WORK_BASE,
} from './constants';
import { applyChance, applyTender, canApply, cancelContract, generateMonthly, progressDay } from './contracts';
import { createInitialState } from './state';
import { byYear, dateToDay, lerpByDate } from './time';

// ---------- Подмены и заготовки ----------

const PRICE = 100; // $ за H100e-день в тестах
let shownScore = 70; // что вернёт modelScore(…, honest = false)
let honestScore = 70; // что вернёт modelScore(…, honest = true)
let poolValue = 0; // что вернёт pool(s, 'contracts')

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
function realBenchScore(id: BenchmarkId, cap: number, overfit = 0): number {
  const b = BENCHMARKS.find((x) => x.id === id)!;
  return 100 * (b.guess + (1 - b.guess) * sigmoid((cap + overfit - b.difficulty) / b.spread));
}

beforeEach(() => {
  shownScore = 70;
  honestScore = 70;
  poolValue = 0;
  m.modelScore.mockReset().mockImplementation((_model: PlayerModel, _bid: BenchmarkId, honest: boolean) =>
    honest ? honestScore : shownScore,
  );
  m.benchScore.mockReset().mockImplementation(realBenchScore);
  m.benchDef.mockReset().mockImplementation((id: BenchmarkId) => BENCHMARKS.find((x) => x.id === id));
  m.activeBenchmarks.mockReset().mockReturnValue(['mmlu', 'humaneval', 'gsm8k']);
  m.introducedBenchmarks.mockReset().mockReturnValue(['squad', 'glue', 'mmlu', 'humaneval', 'gsm8k']);
  m.pool.mockReset().mockImplementation(() => poolValue);
  m.cheapestH100eDay.mockReset().mockReturnValue(PRICE);
});

function newState(seed = 1): GameState {
  return createInitialState('Тест', seed);
}

function makeModel(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Модель-1',
    plan: {
      name: 'Модель-1', paramsB: 1, tokensB: 20, mix: { language: 1, code: 0, reasoning: 0 },
      benchShare: 0, benchTargets: [], rlhf: false,
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 0,
    releasedDay: 0,
    caps: { language: 50, code: 50, reasoning: 50 },
    overfit: {},
    rlhf: false,
    arenaElo: 1000,
    price: 10,
    onApi: true,
    exposed: false,
    ...over,
  };
}

function makeTender(over: Partial<Tender> = {}): Tender {
  return {
    id: 't1',
    clientId: CLIENTS[0].id,
    type: 'finetune',
    benchmark: 'mmlu',
    requirement: 60,
    work: 100,
    durationDays: 60,
    payment: 100_000,
    penalty: 30_000,
    appearedDay: 0,
    expiresDay: 30,
    application: null,
    ...over,
  };
}

function makeContract(over: Partial<Contract> = {}, tender: Partial<Tender> = {}): Contract {
  return {
    id: 'c1',
    tender: makeTender(tender),
    modelId: 'p1',
    startedDay: 0,
    deadlineDay: 60,
    workDone: 0,
    ...over,
  };
}

/** Состояние с выпущенной моделью p1 и одним контрактом c1. */
function withContract(contract = makeContract()): GameState {
  const s = newState();
  s.models.push(makeModel());
  s.contracts.push(contract);
  return s;
}

function lastMail(s: GameState) {
  return s.mail[s.mail.length - 1];
}

// ---------- Генерация ----------

describe('generateMonthly: количество', () => {
  function counts(year: number): number[] {
    const set = new Set<number>();
    for (let k = 1; k <= 60; k++) {
      const s = newState(k * 104729);
      s.day = dateToDay(`${year}-03-01`);
      generateMonthly(s);
      set.add(s.tenders.length);
    }
    return [...set].sort((a, b) => a - b);
  }

  it('2017–2019: два тендера плюс 0–1', () => {
    for (const y of [2017, 2018, 2019]) expect(counts(y)).toEqual([2, 3]);
  });

  it('2020–2022: три плюс 0–1', () => {
    for (const y of [2020, 2021, 2022]) expect(counts(y)).toEqual([3, 4]);
  });

  it('2023–2024: четыре плюс 0–1', () => {
    for (const y of [2023, 2024]) expect(counts(y)).toEqual([4, 5]);
  });

  it('нумерует тендеры подряд: t1, t2, …', () => {
    const s = newState();
    generateMonthly(s);
    generateMonthly(s);
    const ids = s.tenders.map((t) => t.id);
    expect(ids).toEqual(ids.map((_, i) => `t${i + 1}`));
    expect(s.nextTenderNum).toBe(ids.length + 1);
  });

  it('детерминирован: одно зерно — те же тендеры', () => {
    const a = newState(42);
    const b = newState(42);
    a.day = b.day = dateToDay('2021-05-01');
    generateMonthly(a);
    generateMonthly(b);
    expect(a.tenders).toEqual(b.tenders);
    expect(a.rng).toBe(b.rng);
  });

  it('без вышедших бенчмарков тендеров нет', () => {
    m.activeBenchmarks.mockReturnValue([]);
    m.introducedBenchmarks.mockReturnValue([]);
    const s = newState();
    generateMonthly(s);
    expect(s.tenders).toHaveLength(0);
    expect(s.nextTenderNum).toBe(1);
  });
});

describe('generateMonthly: поля тендера', () => {
  it('срок, штраф, оплата и работа в границах design.md', () => {
    const s = newState(7);
    s.day = dateToDay('2017-01-01');
    for (let i = 0; i < 20; i++) generateMonthly(s);
    expect(s.tenders.length).toBeGreaterThan(30);
    const workBase = lerpByDate(WORK_BASE, s.day);
    for (const t of s.tenders) {
      expect(CLIENTS.map((c) => c.id)).toContain(t.clientId);
      expect(['mmlu', 'humaneval', 'gsm8k']).toContain(t.benchmark);
      expect(t.type).toBe('finetune');
      expect(t.application).toBeNull();
      expect(t.appearedDay).toBe(s.day);
      expect(t.expiresDay).toBe(s.day + TENDER_EXPIRE_DAYS);
      expect(t.durationDays).toBeGreaterThanOrEqual(45);
      expect(t.durationDays).toBeLessThanOrEqual(150);
      expect(t.work).toBeGreaterThanOrEqual(workBase * 0.5);
      expect(t.work).toBeLessThan(workBase * 1.5);
      const payMult = t.payment / (t.work * PRICE);
      expect(payMult).toBeGreaterThanOrEqual(2);
      expect(payMult).toBeLessThan(3.5);
      expect(t.penalty).toBeCloseTo(TENDER_PENALTY * t.payment, 6);
    }
  });

  it('работа растёт со временем (кривая WORK_BASE)', () => {
    const early = newState(3);
    early.day = dateToDay('2017-06-01');
    const late = newState(3);
    late.day = dateToDay('2024-06-01');
    for (let i = 0; i < 10; i++) {
      generateMonthly(early);
      generateMonthly(late);
    }
    const avg = (s: GameState) => s.tenders.reduce((a, t) => a + t.work, 0) / s.tenders.length;
    expect(avg(late)).toBeGreaterThan(avg(early) * 50);
  });
});

describe('generateMonthly: требование', () => {
  it('балл на бенчмарке при способности «уровень года − 0…15»', () => {
    m.activeBenchmarks.mockReturnValue(['mmlu']);
    const day = dateToDay('2020-03-01');
    const level = byYear(CAP_LEVEL, 2020);
    const lo = Math.max(1, Math.round(realBenchScore('mmlu', level - 15)));
    const hi = Math.round(realBenchScore('mmlu', level));
    const seen = new Set<number>();
    for (let k = 1; k <= 40; k++) {
      const s = newState(k * 7919);
      s.day = day;
      generateMonthly(s);
      for (const t of s.tenders) {
        expect(t.requirement).toBeGreaterThanOrEqual(lo);
        expect(t.requirement).toBeLessThanOrEqual(hi);
        seen.add(t.requirement);
      }
    }
    expect(hi).toBeGreaterThan(lo);
    expect(seen.size).toBeGreaterThan(3);
    for (const call of m.benchScore.mock.calls) {
      expect(call[1]).toBeGreaterThanOrEqual(level - 15);
      expect(call[1]).toBeLessThanOrEqual(level);
    }
  });

  it('требование не меньше 1', () => {
    m.benchScore.mockReturnValue(0.2);
    const s = newState();
    generateMonthly(s);
    expect(s.tenders.length).toBeGreaterThan(0);
    for (const t of s.tenders) expect(t.requirement).toBe(1);
  });
});

describe('generateMonthly: бенчмарк и RLHF', () => {
  function rlhfState(seed: number): GameState {
    const s = newState(seed);
    s.research.done.push('rlhf');
    s.day = dateToDay('2023-03-01');
    return s;
  }

  it('без исследования RLHF таких тендеров нет', () => {
    const s = newState(5);
    s.day = dateToDay('2023-03-01');
    for (let i = 0; i < 50; i++) generateMonthly(s);
    expect(s.tenders.length).toBeGreaterThan(150);
    expect(s.tenders.every((t) => t.type === 'finetune')).toBe(true);
  });

  it('после RLHF около 30 % тендеров — RLHF, только языковой бенчмарк, оплата ×1,6', () => {
    const s = rlhfState(11);
    for (let i = 0; i < 100; i++) generateMonthly(s);
    const rlhf = s.tenders.filter((t) => t.type === 'rlhf');
    const share = rlhf.length / s.tenders.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.4);
    for (const t of rlhf) {
      expect(t.benchmark).toBe('mmlu'); // единственный активный языковой
      const mult = t.payment / (t.work * PRICE);
      expect(mult).toBeGreaterThanOrEqual(2 * RLHF_TENDER_PAY_MULT - 1e-9);
      expect(mult).toBeLessThan(3.5 * RLHF_TENDER_PAY_MULT);
    }
    const plain = s.tenders.filter((t) => t.type === 'finetune');
    expect(plain.some((t) => t.benchmark !== 'mmlu')).toBe(true);
  });

  it('нет активных бенчмарков — берётся самый новый из вышедших', () => {
    m.activeBenchmarks.mockReturnValue([]);
    const s = newState(9);
    for (let i = 0; i < 10; i++) generateMonthly(s);
    expect(s.tenders.length).toBeGreaterThan(0);
    expect(s.tenders.every((t) => t.benchmark === 'gsm8k')).toBe(true);
  });

  it('RLHF без активных: самый новый вышедший языковой бенчмарк', () => {
    m.activeBenchmarks.mockReturnValue([]);
    const s = rlhfState(13);
    for (let i = 0; i < 50; i++) generateMonthly(s);
    const rlhf = s.tenders.filter((t) => t.type === 'rlhf');
    expect(rlhf.length).toBeGreaterThan(0);
    expect(rlhf.every((t) => t.benchmark === 'mmlu')).toBe(true);
  });
});

describe('generateMonthly: особые случаи', () => {
  it('клиенты разные, список CLIENTS не меняется', () => {
    const before = JSON.stringify(CLIENTS);
    const s = newState(21);
    for (let i = 0; i < 30; i++) generateMonthly(s);
    expect(new Set(s.tenders.map((t) => t.clientId)).size).toBeGreaterThan(8);
    expect(JSON.stringify(CLIENTS)).toBe(before);
  });

  it('нет языковых бенчмарков — вместо RLHF выходит обычное дообучение, а не пропуск', () => {
    m.activeBenchmarks.mockReturnValue([]);
    m.introducedBenchmarks.mockReturnValue(['humaneval', 'gsm8k']);
    const s = newState(17);
    s.research.done.push('rlhf');
    s.day = dateToDay('2023-03-01');
    const months = 40;
    for (let i = 0; i < months; i++) generateMonthly(s);
    expect(s.tenders.length).toBeGreaterThanOrEqual(months * 4); // 4 + 0…1 в месяц, ни один не потерян
    expect(s.tenders.every((t) => t.type === 'finetune')).toBe(true);
    expect(s.tenders.every((t) => t.benchmark === 'gsm8k')).toBe(true); // самый новый из вышедших
    for (const t of s.tenders) {
      const mult = t.payment / (t.work * PRICE);
      expect(mult).toBeLessThan(3.5); // без множителя RLHF ×1,6
    }
  });

  it('нет доступных GPU (цена бесконечна) — тендеров нет, бесконечных сумм тоже', () => {
    m.cheapestH100eDay.mockReturnValue(Infinity);
    const s = newState();
    generateMonthly(s);
    expect(s.tenders).toHaveLength(0);
    expect(s.nextTenderNum).toBe(1);
  });

  it('все числа тендера конечны и положительны', () => {
    const s = newState(33);
    s.day = dateToDay('2024-06-01');
    for (let i = 0; i < 20; i++) generateMonthly(s);
    for (const t of s.tenders) {
      for (const x of [t.work, t.payment, t.penalty, t.requirement, t.durationDays]) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThan(0);
      }
    }
  });
});

describe('CLIENTS', () => {
  it('двадцать клиентов с уникальными id и названиями', () => {
    expect(CLIENTS).toHaveLength(20);
    expect(new Set(CLIENTS.map((c) => c.id)).size).toBe(20);
    expect(new Set(CLIENTS.map((c) => c.name)).size).toBe(20);
  });

  it('названия русские вида Банк «Северный», отрасль указана', () => {
    for (const c of CLIENTS) {
      expect(c.name).toMatch(/^[А-ЯЁ][а-яё]+ «[^«»]*[А-Яа-яЁё][^«»]*»$/);
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.industry.trim().length).toBeGreaterThan(2);
    }
  });

  it('есть все обязательные отрасли', () => {
    const industries = CLIENTS.map((c) => c.industry);
    for (const need of [
      'банк', 'ритейл', 'авиалинии', 'страхование', 'медицина', 'юристы',
      'игры', 'логистика', 'телеком', 'госуслуги', 'маркетплейс', 'автопроизводитель',
    ]) {
      expect(industries).toContain(need);
    }
  });
});

// ---------- Заявки ----------

describe('canApply', () => {
  it('пропускает подходящую модель', () => {
    const s = newState();
    expect(canApply(s, makeTender(), makeModel())).toBeNull();
  });

  it('невыпущенная модель', () => {
    const s = newState();
    expect(canApply(s, makeTender(), makeModel({ releasedDay: null }))).toMatch(/не выпущена/);
  });

  it('показанный балл ниже требования', () => {
    shownScore = 59.9;
    const s = newState();
    const reason = canApply(s, makeTender({ requirement: 60 }), makeModel());
    expect(reason).toMatch(/ниже требования 60/);
  });

  it('балл ровно на уровне требования проходит', () => {
    shownScore = 60;
    const s = newState();
    expect(canApply(s, makeTender({ requirement: 60 }), makeModel())).toBeNull();
  });

  it('для RLHF-тендера нужна модель с RLHF', () => {
    const s = newState();
    const tender = makeTender({ type: 'rlhf' });
    expect(canApply(s, tender, makeModel({ rlhf: false }))).toMatch(/RLHF/);
    expect(canApply(s, tender, makeModel({ rlhf: true }))).toBeNull();
  });

  it('повторная заявка запрещена', () => {
    const s = newState();
    const tender = makeTender({ application: { modelId: 'p1', appliedDay: 0, resolveDay: 20, chance: 0.5 } });
    expect(canApply(s, tender, makeModel())).toMatch(/уже подана/);
  });

  it('проверяет показанный балл (honest = false)', () => {
    const s = newState();
    canApply(s, makeTender(), makeModel());
    expect(m.modelScore).toHaveBeenCalledWith(expect.anything(), 'mmlu', false);
  });
});

describe('applyChance', () => {
  it('репутация 20, балл на уровне требования: 0,2 + 0,12', () => {
    shownScore = 60;
    const s = newState();
    s.reputation = 20;
    expect(applyChance(s, makeTender({ requirement: 60 }), makeModel())).toBeCloseTo(0.32, 10);
  });

  it('запас балла добавляет (shown − req) / req', () => {
    shownScore = 66; // запас 6 / 60 = 0,1
    const s = newState();
    s.reputation = 20;
    expect(applyChance(s, makeTender({ requirement: 60 }), makeModel())).toBeCloseTo(0.42, 10);
  });

  it('прибавка за запас не больше 0,3', () => {
    shownScore = 100;
    const s = newState();
    s.reputation = 20;
    expect(applyChance(s, makeTender({ requirement: 60 }), makeModel())).toBeCloseTo(0.62, 10);
  });

  it('потолок 0,92 и пол 0,05', () => {
    shownScore = 100;
    const s = newState();
    s.reputation = 100;
    expect(applyChance(s, makeTender({ requirement: 60 }), makeModel())).toBe(0.92);
    s.reputation = -500;
    expect(applyChance(s, makeTender({ requirement: 60 }), makeModel())).toBe(0.05);
  });

  it('требование 0 не даёт деления на ноль', () => {
    shownScore = 5;
    const s = newState();
    s.reputation = 0;
    const p = applyChance(s, makeTender({ requirement: 0 }), makeModel());
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeCloseTo(0.5, 10); // 0,2 + min(0,3, 5 / 1)
  });
});

describe('applyTender', () => {
  function setup(): GameState {
    const s = newState();
    s.day = 10;
    s.models.push(makeModel());
    s.tenders.push(makeTender({ expiresDay: 40 }));
    return s;
  }

  it('записывает заявку: решение через 20 дней, шанс по формуле', () => {
    shownScore = 66;
    const s = setup();
    s.reputation = 20;
    expect(applyTender(s, 't1', 'p1')).toEqual({ ok: true });
    const a = s.tenders[0].application!;
    expect(a.modelId).toBe('p1');
    expect(a.appliedDay).toBe(10);
    expect(a.resolveDay).toBe(10 + TENDER_APPLY_DAYS);
    expect(a.chance).toBeCloseTo(0.42, 10);
  });

  it('нет тендера или модели', () => {
    const s = setup();
    expect(applyTender(s, 'nope', 'p1')).toMatchObject({ ok: false });
    expect(applyTender(s, 't1', 'nope')).toMatchObject({ ok: false });
    expect(s.tenders[0].application).toBeNull();
  });

  it('отказ canApply возвращается как ошибка', () => {
    shownScore = 10;
    const s = setup();
    const r = applyTender(s, 't1', 'p1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ниже требования/);
    expect(s.tenders[0].application).toBeNull();
  });

  it('вторая заявка на тот же тендер — ошибка', () => {
    const s = setup();
    expect(applyTender(s, 't1', 'p1').ok).toBe(true);
    const r = applyTender(s, 't1', 'p1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/уже подана/);
  });
});

// ---------- Ежедневный ход ----------

describe('progressDay: тендеры без заявки', () => {
  it('исчезают через 30 дней, с заявкой остаются', () => {
    const s = newState();
    s.tenders.push(
      makeTender({ id: 't1', appearedDay: 0, expiresDay: 30 }),
      makeTender({ id: 't2', appearedDay: 0, expiresDay: 30, application: { modelId: 'p1', appliedDay: 5, resolveDay: 45, chance: 0 } }),
      makeTender({ id: 't3', appearedDay: 10, expiresDay: 40 }),
    );
    s.models.push(makeModel());
    s.day = 29;
    progressDay(s);
    expect(s.tenders.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    s.day = 30;
    progressDay(s);
    expect(s.tenders.map((t) => t.id)).toEqual(['t2', 't3']); // t1 без заявки исчез, t2 ждёт решения
  });

  it('без заявок и контрактов ничего не ломает', () => {
    const s = newState();
    s.day = 100;
    expect(() => progressDay(s)).not.toThrow();
    expect(s.mail).toHaveLength(0);
  });
});

describe('progressDay: решение по заявке', () => {
  function applied(over: Partial<Tender> = {}, chance = 1): GameState {
    const s = newState();
    s.day = 5;
    s.models.push(makeModel());
    s.tenders.push(
      makeTender({
        expiresDay: 35,
        application: { modelId: 'p1', appliedDay: 5, resolveDay: 25, chance },
        ...over,
      }),
    );
    return s;
  }

  it('до дня решения ничего не происходит', () => {
    const s = applied();
    s.day = 24;
    progressDay(s);
    expect(s.tenders).toHaveLength(1);
    expect(s.contracts).toHaveLength(0);
    expect(s.mail).toHaveLength(0);
  });

  it('победа: контракт со сроком, тендер убран, письмо', () => {
    const s = applied({ durationDays: 90 });
    s.day = 25;
    progressDay(s);
    expect(s.tenders).toHaveLength(0);
    expect(s.contracts).toHaveLength(1);
    const c = s.contracts[0];
    expect(c.modelId).toBe('p1');
    expect(c.startedDay).toBe(25);
    expect(c.deadlineDay).toBe(25 + 90);
    expect(c.workDone).toBe(0);
    expect(c.tender.id).toBe('t1');
    expect(c.id).toBe('c1'); // номер берётся из тендера: t1 → c1
    expect(lastMail(s).kind).toBe('contract');
    expect(lastMail(s).title).toMatch(/выигран/);
    expect(s.finance.month.expense.labelers).toBe(0); // обычный тендер без разметчиков
  });

  it('победа в RLHF-тендере: разметчики 25 % оплаты', () => {
    const s = applied({ type: 'rlhf', payment: 400_000 });
    s.models[0].rlhf = true;
    s.day = 25;
    const cash = s.cash;
    progressDay(s);
    expect(s.contracts).toHaveLength(1);
    expect(s.finance.month.expense.labelers).toBeCloseTo(RLHF_TENDER_LABELERS * 400_000, 6);
    expect(s.cash).toBeCloseTo(cash - 100_000, 6);
  });

  it('поражение: тендер убран, контракта нет, письмо', () => {
    const s = applied({ type: 'rlhf', payment: 400_000 }, 0);
    s.day = 25;
    const cash = s.cash;
    progressDay(s);
    expect(s.tenders).toHaveLength(0);
    expect(s.contracts).toHaveLength(0);
    expect(lastMail(s).title).toMatch(/проигран/);
    expect(s.cash).toBe(cash); // разметчики не оплачены
  });

  it('исход зависит от шанса: при 0,5 бывают и победы, и поражения', () => {
    let wins = 0;
    for (let k = 1; k <= 60; k++) {
      const s = applied({}, 0.5);
      s.rng = k * 104729;
      s.day = 25;
      progressDay(s);
      wins += s.contracts.length;
    }
    expect(wins).toBeGreaterThan(15);
    expect(wins).toBeLessThan(45);
  });
});

describe('progressDay: работа контрактов', () => {
  it('мощность доли «Контракты» делится поровну между контрактами', () => {
    const s = newState();
    s.models.push(makeModel());
    s.contracts.push(
      makeContract({ id: 'c1' }, { id: 't1', work: 1000 }),
      makeContract({ id: 'c2' }, { id: 't2', work: 1000 }),
      makeContract({ id: 'c3' }, { id: 't3', work: 1000 }),
    );
    poolValue = 30;
    s.day = 1;
    progressDay(s);
    expect(s.contracts.map((c) => c.workDone)).toEqual([10, 10, 10]);
    progressDay(s);
    expect(s.contracts.map((c) => c.workDone)).toEqual([20, 20, 20]);
    expect(m.pool).toHaveBeenCalledWith(s, 'contracts');
  });

  it('без мощности работа не идёт', () => {
    const s = withContract(makeContract({}, { work: 100 }));
    poolValue = 0;
    s.day = 1;
    progressDay(s);
    expect(s.contracts[0].workDone).toBe(0);
  });
});

describe('progressDay: завершение контракта', () => {
  it('честный балл достаточен: оплата, репутация +3, контракт закрыт', () => {
    honestScore = 65;
    const s = withContract(makeContract({}, { work: 100, requirement: 60, payment: 250_000 }));
    s.reputation = 20;
    poolValue = 100;
    s.day = 10;
    const cash = s.cash;
    progressDay(s);
    expect(s.contracts).toHaveLength(0);
    expect(s.cash).toBeCloseTo(cash + 250_000, 6);
    expect(s.finance.month.income.contracts).toBeCloseTo(250_000, 6);
    expect(s.finance.revenueDaily.at(-1)).toBeCloseTo(250_000, 6);
    expect(s.reputation).toBe(20 + REP_CONTRACT_OK);
    expect(lastMail(s).kind).toBe('contract');
    expect(lastMail(s).title).toMatch(/выполнен/);
    expect(m.modelScore).toHaveBeenCalledWith(expect.anything(), 'mmlu', true);
  });

  it('работа ещё не закончена: контракт продолжается', () => {
    const s = withContract(makeContract({}, { work: 100 }));
    poolValue = 99;
    s.day = 10;
    progressDay(s);
    expect(s.contracts).toHaveLength(1);
    expect(s.mail).toHaveLength(0);
  });

  it('подгонка не спасает: показанный балл выше, честный ниже — штраф и −8', () => {
    shownScore = 80;
    honestScore = 40;
    const s = withContract(makeContract({}, { work: 100, requirement: 60, payment: 250_000, penalty: 75_000 }));
    s.reputation = 30;
    poolValue = 100;
    s.day = 10;
    const cash = s.cash;
    progressDay(s);
    expect(s.contracts).toHaveLength(0);
    expect(s.cash).toBeCloseTo(cash - 75_000, 6);
    expect(s.finance.month.expense.penalties).toBeCloseTo(75_000, 6);
    expect(s.finance.month.income.contracts).toBe(0);
    expect(s.reputation).toBe(30 + REP_CONTRACT_FAIL);
    expect(lastMail(s).kind).toBe('contract');
    expect(lastMail(s).body).toContain('модель не справилась на реальных задачах клиента');
  });

  it('честный балл ровно на уровне требования проходит', () => {
    honestScore = 60;
    const s = withContract(makeContract({}, { work: 10, requirement: 60 }));
    poolValue = 10;
    s.day = 3;
    progressDay(s);
    expect(s.finance.month.income.contracts).toBeGreaterThan(0);
  });

  it('репутация зажата в 0…100', () => {
    honestScore = 99;
    const hi = withContract(makeContract({}, { work: 1, requirement: 50 }));
    hi.reputation = 99;
    poolValue = 10;
    hi.day = 3;
    progressDay(hi);
    expect(hi.reputation).toBe(100);

    honestScore = 1;
    const lo = withContract(makeContract({}, { work: 1, requirement: 50 }));
    lo.reputation = 5;
    lo.day = 3;
    progressDay(lo);
    expect(lo.reputation).toBe(0);
  });

  it('контракт на вышедшую из игры модель считается проваленным', () => {
    const s = newState();
    s.contracts.push(makeContract({ modelId: 'ghost' }, { work: 1 }));
    poolValue = 10;
    s.day = 3;
    progressDay(s);
    expect(s.contracts).toHaveLength(0);
    expect(s.finance.month.expense.penalties).toBeGreaterThan(0);
  });
});

describe('progressDay: срок', () => {
  it('до срока контракт жив, в день срока без результата — штраф и −8', () => {
    const s = withContract(makeContract({ deadlineDay: 60 }, { work: 1000, penalty: 30_000 }));
    s.reputation = 40;
    poolValue = 1;
    s.day = 59;
    progressDay(s);
    expect(s.contracts).toHaveLength(1);
    s.day = 60;
    const cash = s.cash;
    progressDay(s);
    expect(s.contracts).toHaveLength(0);
    expect(s.cash).toBeCloseTo(cash - 30_000, 6);
    expect(s.reputation).toBe(40 + REP_CONTRACT_FAIL);
    expect(lastMail(s).title).toMatch(/просрочен/);
  });

  it('работа, законченная в день срока, ещё засчитывается', () => {
    honestScore = 90;
    const s = withContract(makeContract({ deadlineDay: 60 }, { work: 100, requirement: 50 }));
    poolValue = 100;
    s.day = 60;
    progressDay(s);
    expect(s.finance.month.income.contracts).toBeGreaterThan(0);
    expect(s.finance.month.expense.penalties).toBe(0);
  });
});

describe('cancelContract', () => {
  it('штраф, репутация −8, контракт убран, письмо', () => {
    const s = withContract(makeContract({}, { penalty: 40_000 }));
    s.reputation = 50;
    const cash = s.cash;
    expect(cancelContract(s, 'c1')).toEqual({ ok: true });
    expect(s.contracts).toHaveLength(0);
    expect(s.cash).toBeCloseTo(cash - 40_000, 6);
    expect(s.finance.month.expense.penalties).toBeCloseTo(40_000, 6);
    expect(s.reputation).toBe(50 + REP_CONTRACT_FAIL);
    expect(lastMail(s).kind).toBe('contract');
  });

  it('нет такого контракта — ошибка, ничего не меняется', () => {
    const s = withContract();
    const cash = s.cash;
    expect(cancelContract(s, 'zzz')).toMatchObject({ ok: false });
    expect(s.contracts).toHaveLength(1);
    expect(s.cash).toBe(cash);
  });

  it('репутация не уходит ниже нуля', () => {
    const s = withContract();
    s.reputation = 3;
    cancelContract(s, 'c1');
    expect(s.reputation).toBe(0);
  });
});

describe('полный путь: заявка → победа → работа → оплата', () => {
  it('идёт по дням', () => {
    const s = newState();
    s.models.push(makeModel());
    s.day = 100;
    s.reputation = 20;
    s.tenders.push(makeTender({ id: 't7', appearedDay: 100, expiresDay: 130, work: 50, durationDays: 40, payment: 80_000, requirement: 55 }));
    poolValue = 10;
    shownScore = 70;
    honestScore = 70;

    expect(applyTender(s, 't7', 'p1')).toEqual({ ok: true });
    s.tenders[0].application!.chance = 1; // исход не оставляем на случай
    const resolveDay = s.tenders[0].application!.resolveDay;
    expect(resolveDay).toBe(120);

    const cash = s.cash;
    for (s.day = 101; s.day < resolveDay; s.day++) progressDay(s);
    expect(s.contracts).toHaveLength(0);

    s.day = resolveDay;
    progressDay(s); // победа; 10 единиц работы в тот же день
    expect(s.contracts).toHaveLength(1);
    expect(s.contracts[0].workDone).toBe(10);
    expect(s.contracts[0].deadlineDay).toBe(160);

    for (s.day = resolveDay + 1; s.day <= resolveDay + 4; s.day++) progressDay(s);
    expect(s.contracts).toHaveLength(0); // 50 единиц набрано к 4-му дню после победы
    expect(s.cash).toBeCloseTo(cash + 80_000, 6);
    expect(s.reputation).toBe(20 + REP_CONTRACT_OK);
    expect(s.mail.map((x) => x.kind)).toEqual(['contract', 'contract']);
  });
});

// ---------- Дополнительные проверки ----------

describe('applyTender: побочные эффекты', () => {
  it('заявка меняет только сам тендер: ни денег, ни репутации, ни почты', () => {
    const s = newState();
    s.models.push(makeModel());
    s.tenders.push(makeTender());
    const before = { cash: s.cash, rep: s.reputation, mail: s.mail.length, rng: s.rng };
    expect(applyTender(s, 't1', 'p1').ok).toBe(true);
    expect({ cash: s.cash, rep: s.reputation, mail: s.mail.length, rng: s.rng }).toEqual(before);
  });

  it('одна модель может подать заявки на разные тендеры', () => {
    const s = newState();
    s.models.push(makeModel());
    s.tenders.push(makeTender({ id: 't1' }), makeTender({ id: 't2' }));
    expect(applyTender(s, 't1', 'p1').ok).toBe(true);
    expect(applyTender(s, 't2', 'p1').ok).toBe(true);
  });

  it('в последний день жизни тендера заявку ещё можно подать, и тендер не исчезает', () => {
    const s = newState();
    s.day = 30;
    s.models.push(makeModel());
    s.tenders.push(makeTender({ expiresDay: 30 }));
    expect(applyTender(s, 't1', 'p1').ok).toBe(true);
    progressDay(s);
    expect(s.tenders).toHaveLength(1);
  });
});

describe('progressDay: решение по заявке, подробности', () => {
  function applied(over: Partial<Tender> = {}, chance = 1): GameState {
    const s = newState();
    s.day = 25;
    s.models.push(makeModel());
    s.tenders.push(
      makeTender({ expiresDay: 35, application: { modelId: 'p1', appliedDay: 5, resolveDay: 25, chance }, ...over }),
    );
    return s;
  }

  it('победа: контракт получает копию тендера, исходный объект не используется', () => {
    const s = applied();
    const original = s.tenders[0];
    progressDay(s);
    const c = s.contracts[0];
    expect(c.tender).not.toBe(original);
    expect(c.tender).toEqual(original);
  });

  it('победа: письмо называет клиента, модель, срок и оплату', () => {
    const s = applied({ durationDays: 90, payment: 100_000, clientId: 'bank-severny' });
    progressDay(s);
    const body = lastMail(s).body;
    expect(body).toContain('Банк «Северный»');
    expect(body).toContain('Модель-1');
    expect(body).toContain('90 дн.');
    expect(body).toContain('$100 тыс.');
  });

  it('победа в RLHF-тендере: письмо говорит про разметчиков', () => {
    const s = applied({ type: 'rlhf', payment: 400_000 });
    progressDay(s);
    expect(lastMail(s).body).toContain('Разметчикам заплачено $100 тыс.');
  });

  it('поражение не трогает ни деньги, ни репутацию', () => {
    const s = applied({}, 0);
    const before = { cash: s.cash, rep: s.reputation };
    progressDay(s);
    expect({ cash: s.cash, rep: s.reputation }).toEqual(before);
    expect(s.finance.month.expense.penalties).toBe(0);
  });

  it('модели уже нет — тендер проигран, контракта нет', () => {
    const s = applied({ application: { modelId: 'ghost', appliedDay: 5, resolveDay: 25, chance: 1 } });
    progressDay(s);
    expect(s.tenders).toHaveLength(0);
    expect(s.contracts).toHaveLength(0);
    expect(lastMail(s).title).toMatch(/проигран/);
  });

  it('день решения пропущен (например, после загрузки сохранения) — решается в первый же ход', () => {
    const s = applied();
    s.day = 40;
    progressDay(s);
    expect(s.tenders).toHaveLength(0);
    expect(s.contracts).toHaveLength(1);
    expect(s.contracts[0].startedDay).toBe(40);
    expect(s.contracts[0].deadlineDay).toBe(40 + 60);
  });

  it('используется шанс, записанный при подаче, а не пересчитанный', () => {
    shownScore = 100;
    const s = newState();
    s.models.push(makeModel());
    s.tenders.push(makeTender({ requirement: 60 }));
    s.reputation = 100;
    applyTender(s, 't1', 'p1');
    expect(s.tenders[0].application!.chance).toBe(0.92);
    s.reputation = 0; // репутация упала, но шанс уже записан
    s.tenders[0].application!.chance = 1;
    s.day = s.tenders[0].application!.resolveDay;
    progressDay(s);
    expect(s.contracts).toHaveLength(1);
  });

  it('одно зерно — один и тот же исход', () => {
    const run = (): string => {
      const s = applied({}, 0.5);
      s.rng = 777;
      progressDay(s);
      return JSON.stringify([s.contracts.length, s.mail.map((x) => x.title), s.rng]);
    };
    expect(run()).toBe(run());
  });
});

describe('progressDay: несколько контрактов', () => {
  it('один сдан, другой просрочен в тот же день; доля считана до завершения', () => {
    honestScore = 90;
    const s = newState();
    s.models.push(makeModel());
    s.reputation = 50;
    s.contracts.push(
      makeContract({ id: 'c1', deadlineDay: 100 }, { id: 't1', work: 20, requirement: 50, payment: 100_000 }),
      makeContract({ id: 'c2', deadlineDay: 10 }, { id: 't2', work: 1000, penalty: 30_000 }),
    );
    poolValue = 40; // по 20 на каждый
    s.day = 10;
    const cash = s.cash;
    progressDay(s);
    expect(s.contracts).toHaveLength(0);
    expect(s.cash).toBeCloseTo(cash + 100_000 - 30_000, 6);
    expect(s.reputation).toBe(50 + REP_CONTRACT_OK + REP_CONTRACT_FAIL);
    expect(s.mail.map((x) => x.title)).toEqual(['Контракт выполнен', 'Контракт просрочен']);
  });

  it('после сдачи одного весь пул достаётся оставшемуся', () => {
    const s = newState();
    s.models.push(makeModel());
    s.contracts.push(
      makeContract({ id: 'c1' }, { id: 't1', work: 10, requirement: 50 }),
      makeContract({ id: 'c2' }, { id: 't2', work: 1000 }),
    );
    poolValue = 20;
    s.day = 1;
    progressDay(s); // по 10: c1 готов
    expect(s.contracts.map((c) => c.id)).toEqual(['c2']);
    expect(s.contracts[0].workDone).toBe(10);
    s.day = 2;
    progressDay(s); // теперь все 20 достаются c2
    expect(s.contracts[0].workDone).toBe(30);
  });

  it('сданный контракт не оплачивается повторно', () => {
    const s = withContract(makeContract({}, { work: 10, requirement: 50, payment: 77_000 }));
    poolValue = 10;
    s.day = 1;
    progressDay(s);
    const cash = s.cash;
    s.day = 2;
    progressDay(s);
    expect(s.cash).toBe(cash);
    expect(s.mail).toHaveLength(1);
  });
});

describe('письма о деньгах', () => {
  /** Отменяем контракт со штрафом x и читаем, как сумма записана в письме. */
  function penaltyText(x: number): string {
    const s = withContract(makeContract({}, { penalty: x }));
    cancelContract(s, 'c1');
    return lastMail(s).body;
  }

  it('короткая запись: $900, $12 тыс., $350 тыс., $1,2 млн, $2,5 млрд', () => {
    expect(penaltyText(900)).toContain('Штраф $900,');
    expect(penaltyText(12_000)).toContain('Штраф $12 тыс.,');
    expect(penaltyText(350_000)).toContain('Штраф $350 тыс.,');
    expect(penaltyText(1_234_567)).toContain('Штраф $1,2 млн,');
    expect(penaltyText(2_500_000_000)).toContain('Штраф $2,5 млрд,');
  });

  it('округление не даёт «$1000 тыс.» и «$1000 млн»', () => {
    expect(penaltyText(999_700)).toContain('Штраф $1 млн,');
    expect(penaltyText(999_960_000)).toContain('Штраф $1 млрд,');
    expect(penaltyText(999_000)).toContain('Штраф $999 тыс.,');
    expect(penaltyText(999_900_000)).toContain('Штраф $999,9 млн,');
  });
});

describe('cancelContract: детали', () => {
  it('RLHF-контракт: разметчики не возвращаются, платится только штраф', () => {
    const s = withContract(makeContract({}, { type: 'rlhf', payment: 400_000, penalty: 120_000 }));
    const cash = s.cash;
    cancelContract(s, 'c1');
    expect(s.cash).toBeCloseTo(cash - 120_000, 6);
    expect(s.finance.month.expense.labelers).toBe(0);
  });

  it('повторная отмена того же контракта — ошибка, штраф не удваивается', () => {
    const s = withContract(makeContract({}, { penalty: 40_000 }));
    expect(cancelContract(s, 'c1').ok).toBe(true);
    const cash = s.cash;
    const rep = s.reputation;
    expect(cancelContract(s, 'c1')).toMatchObject({ ok: false });
    expect(s.cash).toBe(cash);
    expect(s.reputation).toBe(rep);
  });

  it('отмена одного контракта не трогает остальные', () => {
    const s = withContract();
    s.contracts.push(makeContract({ id: 'c2' }, { id: 't2' }));
    cancelContract(s, 'c1');
    expect(s.contracts.map((c) => c.id)).toEqual(['c2']);
  });
});
