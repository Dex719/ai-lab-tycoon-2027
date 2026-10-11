// Тесты форматирования чисел: границы единиц и кэш форматтеров.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtMoney, fmtNum, fmtParams, fmtPct, fmtSci } from './format';

/** ru-RU разделяет разряды неразрывным пробелом: сводим все пробелы к обычному. */
const norm = (t: string) => t.replace(/\s/g, ' ');

describe('fmtMoney', () => {
  it('обычные значения', () => {
    expect(norm(fmtMoney(950))).toBe('$950');
    expect(norm(fmtMoney(12_000))).toBe('$12 тыс.');
    expect(norm(fmtMoney(1_234_567))).toBe('$1,2 млн');
    expect(norm(fmtMoney(3_400_000_000))).toBe('$3,4 млрд');
    expect(norm(fmtMoney(-12_000))).toBe('−$12 тыс.');
    expect(fmtMoney(NaN)).toBe('—');
  });

  it('у границы единицы сначала округляем, потом выбираем единицу (не «1 000 тыс.»)', () => {
    expect(norm(fmtMoney(999.6))).toBe('$1 тыс.');
    expect(norm(fmtMoney(999_499))).toBe('$999 тыс.');
    expect(norm(fmtMoney(999_600))).toBe('$1 млн');
    expect(norm(fmtMoney(999_600_000))).toBe('$1 млрд');
    expect(norm(fmtMoney(999_600_000_000))).toBe('$1 трлн');
    expect(norm(fmtMoney(-999_600))).toBe('−$1 млн');
  });

  it('в строке не бывает «1 000» перед единицей', () => {
    for (const base of [1e3, 1e6, 1e9, 1e12]) {
      for (const k of [0.9994, 0.9995, 0.9996, 0.9999, 1]) {
        expect(norm(fmtMoney(base * k))).not.toMatch(/\$1 000/);
      }
    }
  });
});

describe('fmtNum', () => {
  it('обычные значения', () => {
    expect(norm(fmtNum(1234))).toBe('1 234');
    expect(norm(fmtNum(2_500_000))).toBe('2,5 млн');
  });

  it('у границы единицы переходит в следующую', () => {
    expect(norm(fmtNum(999_940))).toBe('999,9 тыс.');
    expect(norm(fmtNum(999_960))).toBe('1 млн');
    expect(norm(fmtNum(999_960_000))).toBe('1 млрд');
    expect(norm(fmtNum(999_960_000_000))).toBe('1 трлн');
  });
});

describe('fmtParams и fmtSci', () => {
  it('fmtParams у границы единицы', () => {
    expect(norm(fmtParams(0.117))).toBe('117 млн');
    expect(norm(fmtParams(175))).toBe('175 млрд');
    expect(norm(fmtParams(0.9996))).toBe('1 млрд');
    expect(norm(fmtParams(999.6))).toBe('1 трлн');
  });

  it('fmtSci не печатает мантиссу 10', () => {
    expect(norm(fmtSci(1.2e25))).toBe('1,2·10²⁵');
    expect(norm(fmtSci(1e25))).toBe('1·10²⁵');
    expect(norm(fmtSci(9.96e25))).toBe('1·10²⁶');
  });
});

describe('кэш форматтеров', () => {
  afterEach(() => vi.restoreAllMocks());

  it('не вызывает toLocaleString с параметрами на каждое число', () => {
    const spy = vi.spyOn(Number.prototype, 'toLocaleString');
    for (let i = 0; i < 50; i++) {
      fmtMoney(1000 * i + 0.5);
      fmtNum(1234 * i);
      fmtPct(i / 3);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
