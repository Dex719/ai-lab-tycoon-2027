import { describe, expect, it } from 'vitest';
import { GPUS } from '../data/gpus';
import {
  availableGpus,
  cheapestH100eDay,
  gpuDef,
  isGpuAvailable,
  normalizeAlloc,
  pool,
  rentCapFor,
  rentPerDay,
  rentPerGpuDay,
  setAllocation,
  setRent,
  totalH100e,
} from './compute';
import { DEFAULT_ALLOC } from './constants';
import { addModifier, FOREVER } from './events';
import { createInitialState } from './state';
import { dateToDay } from './time';
import type { GameState, GpuDef, GpuId } from './types';

/** Новая игра, перемотанная на дату. */
function stateAt(iso: string): GameState {
  const s = createInitialState('Тест', 1);
  s.day = dateToDay(iso);
  return s;
}

/** Описание GPU из данных (src/data/gpus.ts): числа в тестах берём отсюда, а не литералами. */
function gpuData(id: GpuId): GpuDef {
  const def = GPUS.find((g) => g.id === id);
  if (!def) throw new Error(`нет GPU ${id} в данных`);
  return def;
}

/** Аренда одного GPU за сутки по таблице данных за указанный год. */
function dayRentOf(id: GpuId, year: number): number {
  const hourly = gpuData(id).rentPerGpuHour[year];
  if (hourly === undefined) throw new Error(`нет цены ${id} за ${year}`);
  return hourly * 24;
}

describe('каталог GPU и доступность', () => {
  it('gpuDef возвращает описание, а на неизвестный id бросает ошибку', () => {
    expect(gpuDef('h100').h100e).toBe(1);
    expect(() => gpuDef('x999' as never)).toThrow();
  });

  it('GPU становится доступен в день выхода, а не раньше', () => {
    const s = stateAt('2017-10-24');
    expect(isGpuAvailable(s, 'v100')).toBe(false);
    s.day = dateToDay('2017-10-25');
    expect(isGpuAvailable(s, 'v100')).toBe(true);
  });

  it('каждый GPU доступен ровно с даты выхода (граница — день выхода)', () => {
    const releases: [GpuId, string][] = GPUS.map((g): [GpuId, string] => [g.id, g.availableFrom]);
    for (const [id, iso] of releases) {
      const s = stateAt(iso);
      expect(isGpuAvailable(s, id), `${id} в день выхода`).toBe(true);
      expect(availableGpus(s).map((g) => g.id)).toContain(id);
      s.day -= 1;
      expect(isGpuAvailable(s, id), `${id} накануне`).toBe(false);
      expect(availableGpus(s).map((g) => g.id)).not.toContain(id);
    }
  });

  it('в первый день есть только P100, к концу 2024 — все пять', () => {
    expect(availableGpus(createInitialState('Тест', 1)).map((g) => g.id)).toEqual(['p100']);
    expect(availableGpus(stateAt('2020-11-02')).map((g) => g.id)).toEqual(['p100', 'v100', 'a100']);
    expect(availableGpus(stateAt('2024-12-31')).map((g) => g.id)).toEqual(['p100', 'v100', 'a100', 'h100', 'h200']);
  });
});

describe('цена аренды', () => {
  it('берёт цену года из таблицы и умножает на 24 часа', () => {
    expect(rentPerGpuDay(stateAt('2017-03-01'), 'p100')).toBeCloseTo(dayRentOf('p100', 2017), 9);
    expect(rentPerGpuDay(stateAt('2024-03-01'), 'p100')).toBeCloseTo(dayRentOf('p100', 2024), 9);
    expect(rentPerGpuDay(stateAt('2023-06-01'), 'h100')).toBeCloseTo(dayRentOf('h100', 2023), 9);
  });

  it('если года в таблице нет — берёт ближайший известный', () => {
    // у A100 таблица начинается с 2020: в 2018 берём цену 2020
    expect(rentPerGpuDay(stateAt('2018-05-01'), 'a100')).toBeCloseTo(dayRentOf('a100', 2020), 9);
    // у H200 только 2024: в 2026 берём цену 2024
    expect(rentPerGpuDay(stateAt('2026-05-01'), 'h200')).toBeCloseTo(dayRentOf('h200', 2024), 9);
  });

  it('цена меняется с первым днём нового года', () => {
    expect(rentPerGpuDay(stateAt('2017-12-31'), 'p100')).toBeCloseTo(dayRentOf('p100', 2017), 9);
    expect(rentPerGpuDay(stateAt('2018-01-01'), 'p100')).toBeCloseTo(dayRentOf('p100', 2018), 9);
  });

  it('год в «дырке» таблицы — берётся предыдущий известный, до таблицы — первый', () => {
    const def = gpuDef('p100');
    const saved = def.rentPerGpuHour;
    def.rentPerGpuHour = { 2018: 1, 2021: 2 };
    try {
      expect(rentPerGpuDay(stateAt('2017-06-01'), 'p100')).toBeCloseTo(1 * 24, 9); // раньше таблицы
      expect(rentPerGpuDay(stateAt('2019-06-01'), 'p100')).toBeCloseTo(1 * 24, 9); // дырка
      expect(rentPerGpuDay(stateAt('2020-06-01'), 'p100')).toBeCloseTo(1 * 24, 9); // дырка
      expect(rentPerGpuDay(stateAt('2021-06-01'), 'p100')).toBeCloseTo(2 * 24, 9);
      expect(rentPerGpuDay(stateAt('2024-06-01'), 'p100')).toBeCloseTo(2 * 24, 9); // позже таблицы
    } finally {
      def.rentPerGpuHour = saved;
    }
  });

  it('модификатор цены не меняет лимит, а модификатор лимита — цену', () => {
    const s = stateAt('2021-05-01');
    const price = rentPerGpuDay(s, 'a100');
    const cap = rentCapFor(s, 'a100');
    addModifier(s, { id: 'price', kind: 'rentPrice', mult: 3, untilDay: FOREVER });
    expect(rentCapFor(s, 'a100')).toBe(cap);
    addModifier(s, { id: 'cap', kind: 'rentCap', mult: 0.5, untilDay: FOREVER });
    expect(rentPerGpuDay(s, 'a100')).toBeCloseTo(price * 3, 9);
    expect(rentCapFor(s, 'a100')).toBe(cap / 2);
  });

  it('общий модификатор rentPrice действует на все типы, целевой — только на свой', () => {
    const s = stateAt('2021-05-01');
    const p100 = rentPerGpuDay(s, 'p100');
    const a100 = rentPerGpuDay(s, 'a100');

    addModifier(s, { id: 'all', kind: 'rentPrice', mult: 2, untilDay: FOREVER });
    expect(rentPerGpuDay(s, 'p100')).toBeCloseTo(p100 * 2, 9);
    expect(rentPerGpuDay(s, 'a100')).toBeCloseTo(a100 * 2, 9);

    addModifier(s, { id: 'a100only', kind: 'rentPrice', target: 'a100', mult: 0.5, untilDay: FOREVER });
    expect(rentPerGpuDay(s, 'p100')).toBeCloseTo(p100 * 2, 9);
    expect(rentPerGpuDay(s, 'a100')).toBeCloseTo(a100 * 2 * 0.5, 9);
  });

  it('истёкший модификатор не действует', () => {
    const s = stateAt('2021-05-01');
    const before = rentPerGpuDay(s, 'p100');
    addModifier(s, { id: 'old', kind: 'rentPrice', mult: 3, untilDay: s.day - 1 });
    expect(rentPerGpuDay(s, 'p100')).toBeCloseTo(before, 9);
    addModifier(s, { id: 'today', kind: 'rentPrice', mult: 3, untilDay: s.day });
    expect(rentPerGpuDay(s, 'p100')).toBeCloseTo(before * 3, 9);
  });

  it('rentPerDay складывает аренду всех типов', () => {
    const s = stateAt('2018-05-01');
    expect(rentPerDay(s)).toBe(0);
    s.compute.rented.p100 = 100;
    s.compute.rented.v100 = 10;
    const expected = 100 * dayRentOf('p100', 2018) + 10 * dayRentOf('v100', 2018);
    expect(rentPerDay(s)).toBeCloseTo(expected, 6);
  });

  it('rentPerDay применяет модификаторы цены (общий и целевой)', () => {
    const s = stateAt('2018-05-01');
    s.compute.rented.p100 = 100;
    s.compute.rented.v100 = 10;
    addModifier(s, { id: 'all', kind: 'rentPrice', mult: 2, untilDay: FOREVER });
    addModifier(s, { id: 'v100only', kind: 'rentPrice', target: 'v100', mult: 0.5, untilDay: FOREVER });
    const expected = 100 * dayRentOf('p100', 2018) * 2 + 10 * dayRentOf('v100', 2018) * 2 * 0.5;
    expect(rentPerDay(s)).toBeCloseTo(expected, 6);
  });
});

describe('лимит аренды', () => {
  it('2017 — 512 на тип и удваивается каждый год, 2024 — 65 536', () => {
    expect(rentCapFor(stateAt('2017-01-01'), 'p100')).toBe(512);
    expect(rentCapFor(stateAt('2017-12-31'), 'p100')).toBe(512);
    expect(rentCapFor(stateAt('2018-01-01'), 'p100')).toBe(1024);
    expect(rentCapFor(stateAt('2020-06-01'), 'a100')).toBe(4096);
    expect(rentCapFor(stateAt('2024-12-31'), 'h100')).toBe(65_536);
  });

  it('модификатор rentCap умножает лимит, дробь отбрасывается вниз', () => {
    const s = stateAt('2017-06-01');
    addModifier(s, { id: 'cap', kind: 'rentCap', mult: 0.3333, untilDay: FOREVER });
    expect(rentCapFor(s, 'p100')).toBe(170); // floor(512 × 0,3333) = floor(170,6)
  });

  it('целевой модификатор rentCap не трогает другие типы', () => {
    const s = stateAt('2023-06-01');
    addModifier(s, { id: 'ban', kind: 'rentCap', target: 'h100', mult: 0.5, untilDay: FOREVER });
    expect(rentCapFor(s, 'h100')).toBe(32_768 / 2);
    expect(rentCapFor(s, 'a100')).toBe(32_768);
  });
});

describe('мощность и доли', () => {
  it('totalH100e = Σ count × h100e', () => {
    const s = stateAt('2018-05-01');
    expect(totalH100e(s)).toBe(0);
    s.compute.rented.p100 = 100;
    s.compute.rented.v100 = 10;
    expect(totalH100e(s)).toBeCloseTo(100 * gpuData('p100').h100e + 10 * gpuData('v100').h100e, 9);
  });

  it('pool = totalH100e × доля', () => {
    const s = stateAt('2018-05-01');
    s.compute.rented.p100 = 100;
    s.compute.rented.v100 = 10;
    s.compute.alloc = { training: 0.5, contracts: 0.1, experiments: 0.4, inference: 0 };
    expect(pool(s, 'training')).toBeCloseTo(totalH100e(s) * 0.5, 9);
    expect(pool(s, 'experiments')).toBeCloseTo(totalH100e(s) * 0.4, 9);
    expect(pool(s, 'inference')).toBe(0);
  });
});

describe('cheapestH100eDay', () => {
  it('в первый день единственный вариант — P100', () => {
    const s = createInitialState('Тест', 1);
    expect(cheapestH100eDay(s)).toBeCloseTo(dayRentOf('p100', 2017) / gpuData('p100').h100e, 6);
  });

  it('берёт минимум по доступным: V100 дешевле P100 за H100e', () => {
    const s = stateAt('2018-05-01');
    const v100 = dayRentOf('v100', 2018) / gpuData('v100').h100e;
    const p100 = dayRentOf('p100', 2018) / gpuData('p100').h100e;
    expect(v100).toBeLessThan(p100); // условие теста по данным
    expect(cheapestH100eDay(s)).toBeCloseTo(v100, 6);
  });

  it('H200 и H100 за H100e одинаково дороги по данным, пока нет скидки; со скидкой H200 выигрывает', () => {
    const s = stateAt('2024-09-01');
    const h100 = dayRentOf('h100', 2024) / gpuData('h100').h100e;
    const h200 = dayRentOf('h200', 2024) / gpuData('h200').h100e;
    expect(h200).toBeCloseTo(h100, 9); // условие теста: 4,2 / 1,4 = 3,0 = цена H100
    expect(cheapestH100eDay(s)).toBeCloseTo(h100, 6);
    addModifier(s, { id: 'h200-sale', kind: 'rentPrice', target: 'h200', mult: 0.5, untilDay: FOREVER });
    expect(cheapestH100eDay(s)).toBeCloseTo(h200 * 0.5, 6);
  });

  it('недоступные типы не учитываются', () => {
    const s = stateAt('2023-01-01'); // H100 ещё не вышел (с 21.03.2023)
    expect(cheapestH100eDay(s)).toBeCloseTo(dayRentOf('a100', 2023) / gpuData('a100').h100e, 6); // A100 в 2023
  });
});

describe('normalizeAlloc', () => {
  it('приводит к сумме 1 с сохранением пропорций', () => {
    const a = normalizeAlloc({ training: 1, contracts: 1, experiments: 2, inference: 0 });
    expect(a).toEqual({ training: 0.25, contracts: 0.25, experiments: 0.5, inference: 0 });
  });

  it('все нули → DEFAULT_ALLOC (копия, а не тот же объект)', () => {
    const a = normalizeAlloc({ training: 0, contracts: 0, experiments: 0, inference: 0 });
    expect(a).toEqual(DEFAULT_ALLOC);
    expect(a).not.toBe(DEFAULT_ALLOC);
  });

  it('отрицательные, NaN и бесконечные значения считаются нулём', () => {
    const a = normalizeAlloc({ training: -5, contracts: Number.NaN, experiments: 3, inference: Infinity });
    expect(a).toEqual({ training: 0, contracts: 0, experiments: 1, inference: 0 });
    const zeros = normalizeAlloc({ training: -1, contracts: Number.NaN, experiments: -2, inference: 0 });
    expect(zeros).toEqual(DEFAULT_ALLOC);
  });

  it('уже нормальные доли не меняются', () => {
    const a = { training: 0.4, contracts: 0.2, experiments: 0.4, inference: 0 };
    expect(normalizeAlloc(a)).toEqual(a);
  });

  it('доли из процентов (сумма 0,9999999999999999) не получают «хвостов» после деления', () => {
    const a = { training: 0.06, contracts: 0.57, experiments: 0.37, inference: 0 }; // 6 % + 57 % + 37 %
    expect(normalizeAlloc(a)).toEqual(a);
  });

  it('сумма всегда 1', () => {
    const a = normalizeAlloc({ training: 3, contracts: 7, experiments: 11, inference: 13 });
    expect(a.training + a.contracts + a.experiments + a.inference).toBeCloseTo(1, 12);
  });

  it('повторная нормализация ничего не меняет', () => {
    const once = normalizeAlloc({ training: 3, contracts: 7, experiments: 11, inference: 13 });
    expect(normalizeAlloc(once)).toEqual(once);
  });

  it('сумма переполнена (огромные числа) — стартовые доли, без NaN и нулей', () => {
    const a = normalizeAlloc({ training: 1e308, contracts: 1e308, experiments: 1e308, inference: 0 });
    expect(a).toEqual(DEFAULT_ALLOC);
  });

  it('не меняет переданный объект', () => {
    const input = { training: 2, contracts: 2, experiments: 4, inference: 0 };
    const copy = { ...input };
    const out = normalizeAlloc(input);
    expect(input).toEqual(copy);
    expect(out).not.toBe(input);
  });
});

describe('setAllocation', () => {
  it('сохраняет нормализованные доли', () => {
    const s = createInitialState('Тест', 1);
    const r = setAllocation(s, { training: 50, contracts: 0, experiments: 50, inference: 0 });
    expect(r).toEqual({ ok: true });
    expect(s.compute.alloc).toEqual({ training: 0.5, contracts: 0, experiments: 0.5, inference: 0 });
  });

  it('нули превращает в стартовые доли', () => {
    const s = createInitialState('Тест', 1);
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, inference: 0 };
    setAllocation(s, { training: 0, contracts: 0, experiments: 0, inference: 0 });
    expect(s.compute.alloc).toEqual(DEFAULT_ALLOC);
    expect(s.compute.alloc).not.toBe(DEFAULT_ALLOC); // копия: правка состояния не портит константу
  });

  it('не хранит ссылку на переданный объект', () => {
    const s = createInitialState('Тест', 1);
    const input = { training: 0.5, contracts: 0, experiments: 0.5, inference: 0 };
    setAllocation(s, input);
    input.training = 0;
    expect(s.compute.alloc.training).toBe(0.5);
  });

  it('доли «Клиенты» тоже принимаются: вся мощность на инференс', () => {
    const s = createInitialState('Тест', 1);
    s.compute.rented.p100 = 100;
    setAllocation(s, { training: 0, contracts: 0, experiments: 0, inference: 7 });
    expect(s.compute.alloc).toEqual({ training: 0, contracts: 0, experiments: 0, inference: 1 });
    expect(pool(s, 'inference')).toBeCloseTo(totalH100e(s), 9);
  });
});

describe('setRent', () => {
  it('ставит число GPU и сразу меняет мощность', () => {
    const s = createInitialState('Тест', 1);
    expect(setRent(s, 'p100', 105)).toEqual({ ok: true });
    expect(s.compute.rented.p100).toBe(105);
    expect(totalH100e(s)).toBeCloseTo(105 * gpuData('p100').h100e, 9);
  });

  it('число должно быть целым и не меньше нуля', () => {
    const s = createInitialState('Тест', 1);
    for (const bad of [1.5, -1, Number.NaN, Infinity, -Infinity, '5' as unknown as number]) {
      const r = setRent(s, 'p100', bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('Число GPU должно быть целым и не меньше нуля');
    }
    expect(s.compute.rented.p100).toBe(0);
  });

  it('«−0» сохраняется как обычный ноль', () => {
    const s = createInitialState('Тест', 1);
    s.compute.rented.p100 = 10;
    expect(setRent(s, 'p100', -0)).toEqual({ ok: true });
    expect(Object.is(s.compute.rented.p100, 0)).toBe(true);
  });

  it('неизвестный тип GPU — ошибка, состояние не меняется', () => {
    const s = createInitialState('Тест', 1);
    const before = JSON.stringify(s);
    const r = setRent(s, 'x999' as GpuId, 5);
    expect(r).toEqual({ ok: false, error: 'Неизвестный тип GPU' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('меняет только свой тип и не трогает деньги', () => {
    const s = stateAt('2021-05-01');
    s.compute.rented.p100 = 7;
    const cash = s.cash;
    setRent(s, 'a100', 20);
    expect(s.compute.rented).toEqual({ p100: 7, v100: 0, a100: 20, h100: 0, h200: 0 });
    expect(s.cash).toBe(cash);
  });

  it('лимит считается отдельно на каждый тип', () => {
    const s = stateAt('2018-05-01'); // лимит 1024 на тип
    expect(setRent(s, 'p100', 1024)).toEqual({ ok: true });
    expect(setRent(s, 'v100', 1024)).toEqual({ ok: true });
    expect(setRent(s, 'v100', 1025).ok).toBe(false);
  });

  it('текст ошибки лимита: имя GPU и лимит цифрами без пробелов', () => {
    const s = createInitialState('Тест', 1);
    expect(setRent(s, 'p100', 513)).toEqual({ ok: false, error: 'Лимит аренды Fermi P100 в этом году — 512 шт.' });
    s.day = dateToDay('2024-12-31');
    expect(setRent(s, 'h100', 65_537)).toEqual({ ok: false, error: 'Лимит аренды Fermi H100 в этом году — 65536 шт.' });
    expect(setRent(s, 'h100', 65_536)).toEqual({ ok: true });
  });

  it('модификатор rentCap уменьшает допустимое число, и ошибка называет новый лимит', () => {
    const s = stateAt('2017-06-01');
    addModifier(s, { id: 'shortage', kind: 'rentCap', mult: 0.5, untilDay: FOREVER });
    const r = setRent(s, 'p100', 300);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('256');
    expect(setRent(s, 'p100', 256)).toEqual({ ok: true });
  });

  it('недоступный тип отклоняется раньше, чем проверяется лимит', () => {
    const s = createInitialState('Тест', 1);
    expect(setRent(s, 'h200', 1_000_000)).toEqual({ ok: false, error: 'Этот GPU ещё не вышел' });
  });

  it('недоступный тип — ошибка «Этот GPU ещё не вышел», состояние не меняется', () => {
    const s = createInitialState('Тест', 1);
    expect(setRent(s, 'h100', 5)).toEqual({ ok: false, error: 'Этот GPU ещё не вышел' });
    expect(s.compute.rented.h100).toBe(0);
  });

  it('выше лимита — ошибка с числом лимита; ровно лимит — можно', () => {
    const s = createInitialState('Тест', 1);
    const r = setRent(s, 'p100', 513);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('512');
    expect(s.compute.rented.p100).toBe(0);
    expect(setRent(s, 'p100', 512)).toEqual({ ok: true });
    expect(s.compute.rented.p100).toBe(512);
  });

  it('лимит растёт вместе с годом', () => {
    const s = createInitialState('Тест', 1);
    expect(setRent(s, 'p100', 1000).ok).toBe(false);
    s.day = dateToDay('2018-01-01');
    expect(setRent(s, 'p100', 1000).ok).toBe(true);
  });

  it('уменьшать можно всегда, даже когда лимит упал ниже текущего числа', () => {
    const s = stateAt('2023-06-01');
    expect(setRent(s, 'h100', 1000)).toEqual({ ok: true });
    addModifier(s, { id: 'ban', kind: 'rentCap', mult: 0.01, untilDay: FOREVER }); // лимит 327
    expect(setRent(s, 'h100', 1200).ok).toBe(false); // увеличивать нельзя
    expect(setRent(s, 'h100', 1000)).toEqual({ ok: true }); // оставить как есть можно
    expect(setRent(s, 'h100', 500)).toEqual({ ok: true }); // уменьшить можно
    expect(s.compute.rented.h100).toBe(500);
    expect(setRent(s, 'h100', 0)).toEqual({ ok: true });
  });

  it('ноль для ещё не вышедшего типа ничего не ломает', () => {
    const s = createInitialState('Тест', 1);
    expect(setRent(s, 'h200', 0)).toEqual({ ok: true });
    expect(s.compute.rented.h200).toBe(0);
  });
});
