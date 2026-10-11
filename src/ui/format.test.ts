// Тесты форматирования чисел (границы единиц, кэш форматтеров), подписей из labels.ts и геометрии окон на столе.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fmtMoney, fmtMult, fmtNum, fmtParams, fmtPct, fmtSci } from './format';
import { EXPENSE_KINDS, EXPENSE_LABELS, fmtRank, INCOME_KINDS, INCOME_LABELS } from './labels';
import { clampPos, deskAreaOf, TITLEBAR_H } from './Window';

/** ru-RU разделяет разряды неразрывным пробелом: сводим все пробелы к обычному. */
const norm = (t: string) => t.replace(/\s/g, ' ');

describe('fmtMoney', () => {
  it('обычные значения', () => {
    expect(norm(fmtMoney(950))).toBe('$950');
    expect(norm(fmtMoney(12_000))).toBe('$12 тыс.');
    expect(norm(fmtMoney(1_234_567))).toBe('$1,2 млн');
    expect(norm(fmtMoney(3_400_000_000))).toBe('$3,4 млрд');
    expect(norm(fmtMoney(-12_000))).toBe('−$12 тыс.');
    expect(fmtMoney(NaN)).toBe('-');
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

describe('fmtMult', () => {
  it('оставляет знаки, которые меняют смысл', () => {
    expect(norm(fmtMult(1.25))).toBe('1,25');
    expect(norm(fmtMult(14.55))).toBe('14,6');
    expect(norm(fmtMult(120.4))).toBe('120');
    expect(fmtMult(NaN)).toBe('-');
  });
});

describe('подписи (labels)', () => {
  it('fmtRank: «N-е место», без места - тире', () => {
    expect(fmtRank(1)).toBe('1-е место');
    expect(fmtRank(3)).toBe('3-е место');
    expect(fmtRank(12)).toBe('12-е место');
    expect(fmtRank(null)).toBe('-');
    expect(fmtRank(undefined)).toBe('-');
    expect(fmtRank(NaN)).toBe('-');
  });

  it('у каждой статьи доходов и расходов есть подпись, без длинных тире', () => {
    const longDashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`); // U+2013 и U+2014 в интерфейсе запрещены
    for (const k of INCOME_KINDS) expect(INCOME_LABELS[k]).not.toMatch(longDashes);
    for (const k of EXPENSE_KINDS) expect(EXPENSE_LABELS[k]).not.toMatch(longDashes);
    expect(INCOME_LABELS.api).toBe('Продажа API');
    expect(EXPENSE_LABELS.overhead).toBe('Зарплаты и офис');
  });
});

describe('окна на столе (Window)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clampPos: заголовок остаётся на столе при любом y', () => {
    const area = { w: 1200, h: 700 };
    for (const y of [-500, -1, 0, 100, 668, 669, 700, 5000]) {
      const p = clampPos({ x: 100, y, w: 600 }, area);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + TITLEBAR_H).toBeLessThanOrEqual(area.h);
    }
  });

  it('clampPos: окно нельзя увести за край по горизонтали целиком', () => {
    const area = { w: 1200, h: 700 };
    expect(clampPos({ x: -5000, y: 10, w: 600 }, area).x).toBe(-480); // 120 px окна остаются на столе
    expect(clampPos({ x: 5000, y: 10, w: 600 }, area).x).toBe(1120);
    expect(clampPos({ x: 300, y: 10, w: 600 }, area)).toEqual({ x: 300, y: 10 });
  });

  it('clampPos: на крошечном столе окно прижато к верхнему левому углу', () => {
    expect(clampPos({ x: 50, y: 50, w: 600 }, { w: 10, h: 10 })).toEqual({ x: 0, y: 0 });
  });

  it('deskAreaOf: без стола берёт окно браузера минус верхняя панель и панель задач', () => {
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
    expect(deskAreaOf(null)).toEqual({ w: 1280, h: 720 });
  });

  it('deskAreaOf: ищет стол по классу .desk', () => {
    const desk = { clientWidth: 900, clientHeight: 500 };
    const el = { closest: (sel: string) => (sel === '.desk' ? desk : null) } as unknown as Element;
    expect(deskAreaOf(el)).toEqual({ w: 900, h: 500 });
  });
});
