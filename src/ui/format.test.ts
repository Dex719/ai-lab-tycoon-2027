// Тесты форматирования чисел (границы единиц, кэш форматтеров), подписей из labels.ts и геометрии окон на столе.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { newGame } from '../sim/actions';
import { dateToDay } from '../sim/time';
import {
  cardsLabel,
  fmtCards,
  fmtDays,
  fmtElo,
  fmtH100e,
  fmtMoney,
  fmtMult,
  fmtNum,
  fmtParams,
  fmtPct,
  fmtSci,
  h100ePerCard,
  ruPlural,
} from './format';
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
    expect(norm(fmtMoney(-12_000))).toBe('-$12 тыс.');
    expect(fmtMoney(NaN)).toBe('-');
  });

  it('у границы единицы сначала округляем, потом выбираем единицу (не «1 000 тыс.»)', () => {
    expect(norm(fmtMoney(999.6))).toBe('$1 тыс.');
    expect(norm(fmtMoney(999_499))).toBe('$999 тыс.');
    expect(norm(fmtMoney(999_600))).toBe('$1 млн');
    expect(norm(fmtMoney(999_600_000))).toBe('$1 млрд');
    expect(norm(fmtMoney(999_600_000_000))).toBe('$1 трлн');
    expect(norm(fmtMoney(-999_600))).toBe('-$1 млн');
  });

  it('в строке не бывает «1 000» перед единицей', () => {
    for (const base of [1e3, 1e6, 1e9, 1e12]) {
      for (const k of [0.9994, 0.9995, 0.9996, 0.9999, 1]) {
        expect(norm(fmtMoney(base * k))).not.toMatch(/\$1 000/);
      }
    }
  });
});

describe('fmtElo', () => {
  it('целое с разрядами, как Эло в остальных окнах', () => {
    expect(norm(fmtElo(987.4))).toBe('987');
    expect(norm(fmtElo(1354.2))).toBe('1 354');
    expect(fmtElo(Number.NaN)).toBe('-');
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

describe('ruPlural и fmtDays', () => {
  it('одна, две-четыре, пять и больше', () => {
    const w = (n: number) => ruPlural(n, 'карта', 'карты', 'карт');
    expect([1, 21, 101, 1001].map(w)).toEqual(['карта', 'карта', 'карта', 'карта']);
    expect([2, 3, 4, 22, 34, 102].map(w)).toEqual(['карты', 'карты', 'карты', 'карты', 'карты', 'карты']);
    expect([0, 5, 9, 10, 20, 25, 100, 111].map(w).every((x) => x === 'карт')).toBe(true);
  });

  it('11-14 всегда «карт», даже когда число оканчивается на 1-4', () => {
    for (const n of [11, 12, 13, 14, 111, 112, 113, 114]) expect(ruPlural(n, 'карта', 'карты', 'карт')).toBe('карт');
  });

  it('fmtDays', () => {
    expect(fmtDays(1)).toBe('1 день');
    expect(fmtDays(3)).toBe('3 дня');
    expect(fmtDays(45)).toBe('45 дней');
    expect(fmtDays(31)).toBe('31 день');
  });
});

describe('fmtH100e', () => {
  it('знаков столько, сколько нужно по величине', () => {
    expect(norm(fmtH100e(0.0214))).toBe('0,021');
    expect(norm(fmtH100e(2.03))).toBe('2,03');
    expect(norm(fmtH100e(45.64))).toBe('45,6');
    expect(norm(fmtH100e(1234.4))).toBe('1 234');
    expect(norm(fmtH100e(12_000))).toBe('12 тыс.');
    expect(fmtH100e(NaN)).toBe('-');
  });
});

describe('число карт мелкими цифрами', () => {
  it('cardsLabel: склонение «карта / карты / карт»', () => {
    expect(norm(cardsLabel(1))).toBe('≈ 1 карта');
    expect(norm(cardsLabel(3))).toBe('≈ 3 карты');
    expect(norm(cardsLabel(17))).toBe('≈ 17 карт');
    expect(norm(cardsLabel(21))).toBe('≈ 21 карта');
    expect(norm(cardsLabel(22))).toBe('≈ 22 карты');
    expect(norm(cardsLabel(11))).toBe('≈ 11 карт');
    expect(norm(cardsLabel(112))).toBe('≈ 112 карт');
    expect(norm(cardsLabel(1234))).toBe('≈ 1 234 карты');
  });

  it('cardsLabel: ноль, меньше половины карты, большие числа, мусор', () => {
    expect(cardsLabel(0)).toBe('0 карт');
    expect(cardsLabel(-3)).toBe('0 карт');
    expect(cardsLabel(NaN)).toBe('0 карт');
    expect(cardsLabel(0.3)).toBe('< 1 карты');
    expect(norm(cardsLabel(0.6))).toBe('≈ 1 карта');
    expect(norm(cardsLabel(12_500))).toBe('≈ 12,5 тыс. карт');
  });

  it('если ничего не арендовано, берётся лучшая карта этого года', () => {
    const s = newGame('Тест', 1);
    expect(h100ePerCard(s)).toBeCloseTo(0.0214, 4); // 01.01.2017: доступна только P100
    expect(norm(fmtCards(s, 0.0214 * 17))).toBe('≈ 17 карт');
    s.day = dateToDay('2024-07-01'); // H200 вышла в июне 2024
    expect(h100ePerCard(s)).toBeCloseTo(1.4, 4);
    expect(norm(fmtCards(s, 4.2))).toBe('≈ 3 карты');
    expect(norm(fmtCards(s, 1.4))).toBe('≈ 1 карта');
  });

  it('при аренде берётся средняя мощность карты набора', () => {
    const s = newGame('Тест', 1);
    s.day = dateToDay('2024-07-01');
    s.compute.rented.h100 = 10; // 10 H100e
    s.compute.rented.h200 = 10; // 14 H100e
    expect(h100ePerCard(s)).toBeCloseTo(1.2, 6); // 24 H100e на 20 карт
    expect(norm(fmtCards(s, 24))).toBe('≈ 20 карт');
    expect(norm(fmtCards(s, 12))).toBe('≈ 10 карт');
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
