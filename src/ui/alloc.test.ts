// Тесты помощников окна «Мощности»: независимые ползунки, сумма долей, проверка перед «Распределить».

import { describe, expect, it } from 'vitest';
import { ALLOC_KEYS, normalizeAlloc } from '../sim/compute';
import { DEFAULT_ALLOC } from '../sim/constants';
import {
  ALLOC_ROWS,
  checkAllocation,
  occupancy,
  percentsOf,
  samePercents,
  setPercent,
  soldChannels,
  toAllocation,
  totalPercent,
  withPercent,
  ZERO_SHARE_WARNING,
  type Percents,
} from './alloc';

const base: Percents = { training: 40, contracts: 20, experiments: 20, api: 10, subs: 10 };

describe('ALLOC_ROWS и percentsOf', () => {
  it('пять строк в порядке ключей симуляции', () => {
    expect(ALLOC_ROWS.map((r) => r.key)).toEqual([...ALLOC_KEYS]);
    expect(ALLOC_ROWS.map((r) => r.label)).toEqual(['Обучение', 'Контракты', 'Исследования', 'API', 'Подписки']);
    // у каждой строки свой цвет: по нему красятся ползунок и полоса распределения
    expect(new Set(ALLOC_ROWS.map((r) => r.color)).size).toBe(5);
  });

  it('percentsOf: все пять ключей, сумма ровно 100', () => {
    const p = percentsOf(normalizeAlloc({ training: 1, contracts: 1, experiments: 1, api: 1, subs: 1 }));
    expect(Object.keys(p).sort()).toEqual([...ALLOC_KEYS].sort());
    expect(totalPercent(p)).toBe(100);
    expect(Object.values(p)).toEqual([20, 20, 20, 20, 20]);
    const odd = percentsOf({ training: 0.333, contracts: 0.333, experiments: 0.334, api: 0, subs: 0 });
    expect(totalPercent(odd)).toBe(100);
  });

  it('percentsOf стартовых долей: 40 / 20 / 40 / 0 / 0', () => {
    expect(percentsOf(DEFAULT_ALLOC)).toEqual({ training: 40, contracts: 20, experiments: 40, api: 0, subs: 0 });
  });

  it('toAllocation переводит проценты в доли и обратно без потерь', () => {
    expect(percentsOf(toAllocation(base))).toEqual(base);
    expect(toAllocation(base).api).toBeCloseTo(0.1, 12);
  });
});

describe('setPercent', () => {
  it('меняет только свою долю: остальные не двигаются', () => {
    const next = setPercent(base, 'api', 55);
    expect(next).toEqual({ ...base, api: 55 });
    for (const k of ALLOC_KEYS) if (k !== 'api') expect(next[k]).toBe(base[k]);
  });

  it('не меняет исходный объект', () => {
    const copy = { ...base };
    setPercent(base, 'training', 5);
    expect(base).toEqual(copy);
  });

  it('сумма после ползунка может быть не 100: ползунки независимы', () => {
    const next = setPercent(base, 'training', 100);
    expect(totalPercent(next)).toBe(160);
  });

  it('значение округляется и зажимается в 0…100, мусор - ноль', () => {
    expect(setPercent(base, 'api', 12.6).api).toBe(13);
    expect(setPercent(base, 'api', -5).api).toBe(0);
    expect(setPercent(base, 'api', 250).api).toBe(100);
    expect(setPercent(base, 'api', NaN).api).toBe(0);
    expect(setPercent(base, 'api', Infinity).api).toBe(0);
  });

  it('withPercent (диалог исследования) по-прежнему подгоняет остальные до 100', () => {
    const next = withPercent(base, 'training', 70);
    expect(next.training).toBe(70);
    expect(totalPercent(next)).toBe(100);
  });
});

describe('totalPercent, samePercents, occupancy', () => {
  it('totalPercent складывает пять долей', () => {
    expect(totalPercent(base)).toBe(100);
    expect(totalPercent({ training: 0, contracts: 0, experiments: 0, api: 0, subs: 0 })).toBe(0);
    expect(totalPercent({ training: 50, contracts: 50, experiments: 50, api: 50, subs: 50 })).toBe(250);
  });

  it('samePercents сравнивает все ключи', () => {
    expect(samePercents(base, { ...base })).toBe(true);
    expect(samePercents(base, { ...base, subs: 11 })).toBe(false);
  });

  it('occupancy: ровно 100, свободно, лишние', () => {
    expect(occupancy(base)).toEqual({ total: 100, tone: 'full', text: 'Занято: 100 %' });
    expect(occupancy(setPercent(base, 'api', 0))).toEqual({ total: 90, tone: 'free', text: 'Занято: 90 %, свободно: 10 %' });
    expect(occupancy(setPercent(base, 'api', 30))).toEqual({ total: 120, tone: 'over', text: 'Занято: 120 %, лишние: 20 %' });
  });
});

describe('checkAllocation', () => {
  const none = { api: false, subs: false };

  it('сумма не 100 - ошибка с текущей суммой, подтверждений нет', () => {
    const r = checkAllocation(setPercent(base, 'api', 30), { api: true, subs: true });
    expect(r.error).toBe('Сумма долей должна быть 100 %. Сейчас 120 %.');
    expect(r.zero).toEqual([]);
    expect(checkAllocation(setPercent(base, 'api', 0), none).error).toContain('Сейчас 90 %');
  });

  it('сумма 100 и нет нулей - всё чисто', () => {
    expect(checkAllocation(base, { api: true, subs: true })).toEqual({ error: null, zero: [] });
  });

  it('0 % у API или подписок при продажах в канале - нужно подтверждение', () => {
    const p: Percents = { training: 50, contracts: 25, experiments: 25, api: 0, subs: 0 };
    expect(checkAllocation(p, { api: true, subs: false })).toEqual({ error: null, zero: ['api'] });
    expect(checkAllocation(p, { api: false, subs: true })).toEqual({ error: null, zero: ['subs'] });
    expect(checkAllocation(p, { api: true, subs: true }).zero).toEqual(['api', 'subs']);
    expect(checkAllocation(p, none).zero).toEqual([]);
  });

  it('тексты подтверждений - обычные предложения без длинных тире', () => {
    const longDashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(ZERO_SHARE_WARNING.api).toBe('Клиентам API не будет выделено мощности: продажи по API остановятся.');
    for (const text of Object.values(ZERO_SHARE_WARNING)) expect(text).not.toMatch(longDashes);
  });
});

describe('soldChannels', () => {
  const m = (releasedDay: number | null, onApi: boolean, onSubs: boolean) => ({ releasedDay, onApi, onSubs });

  it('учитывает только выпущенные модели с включённым каналом', () => {
    expect(soldChannels([])).toEqual({ api: false, subs: false });
    expect(soldChannels([m(null, true, true)])).toEqual({ api: false, subs: false });
    expect(soldChannels([m(10, true, false)])).toEqual({ api: true, subs: false });
    expect(soldChannels([m(10, true, false), m(20, false, true)])).toEqual({ api: true, subs: true });
    expect(soldChannels([m(10, false, false)])).toEqual({ api: false, subs: false });
  });
});
