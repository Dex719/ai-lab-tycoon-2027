// Тесты инвесторов (TSK-008). Место на Арене подменено: тест проверяет только формулы investors.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, ModelRef, PlayerModel } from './types';

const m = vi.hoisted(() => ({ marketArenaRank: vi.fn() }));

vi.mock('./leaderboard', () => ({ marketArenaRank: m.marketArenaRank }));

import { MANIA, REV_MULT, ROUND_COOLDOWN_DAYS, ROUND_FRACTIONS, VALUATION_FLOOR } from './constants';
import { canRaise, raiseRound, valuation } from './investors';
import { createInitialState } from './state';
import { byYear, dateToDay, lerpByDate } from './time';

// ---------- Заготовки ----------

/** Места моделей игрока на Арене: id → место (нет в таблице - null). */
let ranks: Record<string, number | null> = {};

beforeEach(() => {
  ranks = {};
  m.marketArenaRank.mockReset().mockImplementation((_s: GameState, ref: ModelRef) => ranks[ref.id] ?? null);
});

function newState(day = 0): GameState {
  const s = createInitialState('Тест', 1);
  s.day = day;
  return s;
}

function makeModel(id: string, over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id,
    name: `Модель ${id}`,
    plan: {
      name: id, paramsB: 1, tokensB: 20, mix: { language: 1, code: 0, reasoning: 0 },
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

/** Выручка за 90 дней: каждый день одна и та же сумма. */
function setDailyRevenue(s: GameState, perDay: number): void {
  s.finance.revenueDaily = Array<number>(90).fill(perDay);
}

// ---------- Оценка ----------

describe('valuation: пол', () => {
  it('без выручки и моделей - пол $10 млн, умноженный на шумиху и репутацию', () => {
    const s = newState();
    s.reputation = 20;
    s.hype.player = 0;
    const v = valuation(s);
    expect(v.annualRevenue).toBe(0);
    expect(v.revenuePart).toBe(0);
    expect(v.techPart).toBe(0);
    expect(v.bestRank).toBeNull();
    expect(v.rankFactor).toBe(0);
    expect(v.hypeMult).toBe(1);
    expect(v.repMult).toBeCloseTo(0.6 + 20 / 125, 10);
    expect(v.total).toBeCloseTo(VALUATION_FLOOR * (0.6 + 20 / 125), 4);
  });

  it('малая выручка не опускает оценку ниже пола', () => {
    const s = newState();
    s.reputation = 50;
    setDailyRevenue(s, 1_000); // за год ≈ $365 тыс., × 15 ≈ $5,5 млн < пол
    const v = valuation(s);
    expect(v.revenuePart).toBeLessThan(VALUATION_FLOOR);
    expect(v.total).toBeCloseTo(VALUATION_FLOOR * v.hypeMult * v.repMult, 4);
  });

  it('пол тоже умножается на шумиху и репутацию', () => {
    const s = newState();
    s.hype.player = 50;
    s.reputation = 100;
    expect(valuation(s).total).toBeCloseTo(VALUATION_FLOOR * 1.5 * 1.4, 4);
  });
});

describe('valuation: выручка', () => {
  it('годовая выручка = выручка за 90 дней × 365 / 90', () => {
    const s = newState();
    setDailyRevenue(s, 100_000); // 9 млн за 90 дней
    const v = valuation(s);
    expect(v.annualRevenue).toBeCloseTo(9_000_000 * (365 / 90), 4);
  });

  it('доля выручки = годовая × множитель года (15 / 20 / 30 / 35)', () => {
    for (const [iso, mult] of [['2018-06-01', 15], ['2022-06-01', 20], ['2023-06-01', 30], ['2024-06-01', 35]] as const) {
      const s = newState(dateToDay(iso));
      setDailyRevenue(s, 1_000_000);
      const v = valuation(s);
      expect(byYear(REV_MULT, Number(iso.slice(0, 4)))).toBe(mult);
      expect(v.revenuePart).toBeCloseTo(v.annualRevenue * mult, 2);
    }
  });

  it('оценка растёт вместе с выручкой', () => {
    const totals: number[] = [];
    for (const perDay of [0, 100_000, 300_000, 1_000_000]) {
      const s = newState();
      setDailyRevenue(s, perDay);
      totals.push(valuation(s).total);
    }
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThan(totals[i - 1]);
  });

  it('при выручке выше пола итог = (выручка × множитель + технологии) × шумиха × репутация', () => {
    const s = newState(dateToDay('2021-06-01'));
    setDailyRevenue(s, 200_000);
    s.hype.player = 30;
    s.reputation = 60;
    s.models.push(makeModel('p1'));
    ranks.p1 = 2;
    const v = valuation(s);
    const expected = (v.annualRevenue * 15 + 0.5 * lerpByDate(MANIA, s.day, true)) * 1.3 * (0.6 + 60 / 125);
    expect(v.total).toBeCloseTo(expected, 2);
  });
});

describe('valuation: место на Арене', () => {
  const day2023 = dateToDay('2023-01-01'); // шумиха мании = $8 млрд

  function totalForRank(rank: number | null): number {
    const s = newState(day2023);
    s.models.push(makeModel('p1'));
    ranks.p1 = rank;
    return valuation(s).total;
  }

  it('коэффициент места: 1 → 1, 2-3 → 0,5, 4-10 → 0,2, ниже → 0,05', () => {
    const table: [number, number][] = [
      [1, 1], [2, 0.5], [3, 0.5], [4, 0.2], [10, 0.2], [11, 0.05], [40, 0.05],
    ];
    for (const [rank, factor] of table) {
      const s = newState(day2023);
      s.models.push(makeModel('p1'));
      ranks.p1 = rank;
      const v = valuation(s);
      expect(v.bestRank).toBe(rank);
      expect(v.rankFactor).toBe(factor);
      expect(v.techPart).toBeCloseTo(factor * 3e9, 0);
    }
  });

  it('чем выше место, тем дороже лаборатория', () => {
    const t1 = totalForRank(1);
    const t2 = totalForRank(2);
    const t5 = totalForRank(5);
    const t20 = totalForRank(20);
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t5);
    expect(t5).toBeGreaterThan(t20);
  });

  it('технологическая часть следует за манией года (лог-интерполяция)', () => {
    const early = newState(dateToDay('2017-01-01'));
    const late = newState(dateToDay('2024-06-01'));
    for (const s of [early, late]) {
      s.models.push(makeModel('p1'));
      ranks.p1 = 1;
    }
    expect(valuation(early).techPart).toBeCloseTo(50e6, 0);
    expect(valuation(late).techPart).toBeCloseTo(lerpByDate(MANIA, late.day, true), 0);
    expect(valuation(late).techPart).toBeGreaterThan(8e9);
  });

  it('берётся лучшее место среди моделей на рынке', () => {
    const s = newState(day2023);
    s.models.push(makeModel('p1'), makeModel('p2'), makeModel('p3'));
    ranks = { p1: 7, p2: 2, p3: 15 };
    const v = valuation(s);
    expect(v.bestRank).toBe(2);
    expect(v.rankFactor).toBe(0.5);
  });

  it('невыпущенные и снятые с продажи модели не считаются', () => {
    const s = newState(day2023);
    s.models.push(
      makeModel('p1', { releasedDay: null, onApi: false }),
      makeModel('p2', { onApi: false }),
      makeModel('p3'),
    );
    ranks = { p1: 1, p2: 1, p3: 6 };
    const v = valuation(s);
    expect(v.bestRank).toBe(6);
    const asked = m.marketArenaRank.mock.calls.map((c) => (c[1] as ModelRef).id);
    expect(asked).toEqual(['p3']);
  });

  it('нет моделей на рынке - технологий нет, остаётся пол', () => {
    const s = newState(day2023);
    s.models.push(makeModel('p1'));
    ranks.p1 = null;
    const v = valuation(s);
    expect(v.bestRank).toBeNull();
    expect(v.techPart).toBe(0);
    expect(v.total).toBeCloseTo(VALUATION_FLOOR * v.hypeMult * v.repMult, 4);
  });
});

describe('valuation: шумиха и репутация', () => {
  it('шумиха увеличивает оценку: множитель 1 + hype / 100', () => {
    const base = newState(dateToDay('2022-01-01'));
    setDailyRevenue(base, 500_000);
    const hyped = newState(dateToDay('2022-01-01'));
    setDailyRevenue(hyped, 500_000);
    hyped.hype.player = 80;
    const a = valuation(base);
    const b = valuation(hyped);
    expect(b.hypeMult).toBeCloseTo(1.8, 10);
    expect(b.total / a.total).toBeCloseTo(1.8, 8);
  });

  it('репутация увеличивает оценку: множитель 0,6 + rep / 125', () => {
    const lo = newState(dateToDay('2022-01-01'));
    const hi = newState(dateToDay('2022-01-01'));
    setDailyRevenue(lo, 500_000);
    setDailyRevenue(hi, 500_000);
    lo.reputation = 0;
    hi.reputation = 100;
    const a = valuation(lo);
    const b = valuation(hi);
    expect(a.repMult).toBeCloseTo(0.6, 10);
    expect(b.repMult).toBeCloseTo(1.4, 10);
    expect(b.total).toBeGreaterThan(a.total);
  });

  it('сумма частей сходится с итогом', () => {
    const s = newState(dateToDay('2023-09-01'));
    setDailyRevenue(s, 2_000_000);
    s.hype.player = 40;
    s.reputation = 70;
    s.models.push(makeModel('p1'));
    ranks.p1 = 3;
    const v = valuation(s);
    expect(v.total).toBeCloseTo((v.revenuePart + v.techPart) * v.hypeMult * v.repMult, 2);
  });
});

// ---------- Раунды ----------

describe('canRaise', () => {
  it('до первого раунда доступен', () => {
    expect(canRaise(newState(10))).toBeNull();
  });

  it('кулдаун 180 дней, сообщение с числом дней', () => {
    const s = newState(100);
    s.lastRoundDay = 100;
    expect(canRaise(s)).toBe('Следующий раунд - через 180 дн.');
    s.day = 200;
    expect(canRaise(s)).toBe('Следующий раунд - через 80 дн.');
    s.day = 279;
    expect(canRaise(s)).toBe('Следующий раунд - через 1 дн.');
    s.day = 280;
    expect(canRaise(s)).toBeNull();
    s.day = 1000;
    expect(canRaise(s)).toBeNull();
  });
});

describe('raiseRound', () => {
  it('допустимы только доли 10, 20 и 30 %', () => {
    for (const bad of [0, 0.05, 0.15, 0.25, 0.5, 1, -0.1, Number.NaN]) {
      const s = newState();
      const cash = s.cash;
      expect(raiseRound(s, bad)).toMatchObject({ ok: false });
      expect(s.cash).toBe(cash);
      expect(s.founderShare).toBe(1);
      expect(s.lastRoundDay).toBeNull();
    }
    for (const f of ROUND_FRACTIONS) expect(raiseRound(newState(), f)).toEqual({ ok: true });
  });

  it('деньги = оценка × доля, доля основателя × (1 − f), кулдаун, письмо', () => {
    const s = newState(dateToDay('2022-03-01'));
    setDailyRevenue(s, 300_000);
    s.hype.player = 20;
    s.reputation = 55;
    const value = valuation(s).total;
    const cash = s.cash;

    expect(raiseRound(s, 0.2)).toEqual({ ok: true });
    expect(s.cash).toBeCloseTo(cash + value * 0.2, 2);
    expect(s.finance.month.income.investors).toBeCloseTo(value * 0.2, 2);
    expect(s.founderShare).toBeCloseTo(0.8, 12);
    expect(s.lastRoundDay).toBe(s.day);
    const mail = s.mail[s.mail.length - 1];
    expect(mail.kind).toBe('finance');
    expect(mail.title).toMatch(/Раунд/);
    expect(mail.body).toContain('20 %');
    expect(mail.body).toContain('80 %');
  });

  it('деньги инвесторов не считаются выручкой', () => {
    const s = newState();
    raiseRound(s, 0.1);
    expect(s.finance.revenueDaily.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('второй раунд раньше срока - ошибка с числом дней, ничего не меняется', () => {
    const s = newState(50);
    expect(raiseRound(s, 0.1).ok).toBe(true);
    const cash = s.cash;
    const share = s.founderShare;
    s.day = 120;
    const r = raiseRound(s, 0.1);
    expect(r).toEqual({ ok: false, error: 'Следующий раунд - через 110 дн.' });
    expect(s.cash).toBe(cash);
    expect(s.founderShare).toBe(share);
    expect(s.lastRoundDay).toBe(50);
  });

  it('доли основателя перемножаются: 0,9 × 0,8 × 0,7', () => {
    const s = newState();
    raiseRound(s, 0.1);
    s.day += ROUND_COOLDOWN_DAYS;
    raiseRound(s, 0.2);
    s.day += ROUND_COOLDOWN_DAYS;
    raiseRound(s, 0.3);
    expect(s.founderShare).toBeCloseTo(0.9 * 0.8 * 0.7, 12);
    expect(s.lastRoundDay).toBe(2 * ROUND_COOLDOWN_DAYS);
    expect(s.mail.filter((x) => x.kind === 'finance')).toHaveLength(3);
  });

  it('большая доля даёт больше денег при той же оценке', () => {
    const cashAfter = (f: number) => {
      const s = newState(dateToDay('2023-06-01'));
      setDailyRevenue(s, 1_000_000);
      const before = s.cash;
      raiseRound(s, f);
      return s.cash - before;
    };
    expect(cashAfter(0.2)).toBeCloseTo(2 * cashAfter(0.1), 2);
    expect(cashAfter(0.3)).toBeCloseTo(3 * cashAfter(0.1), 2);
  });
});

// ---------- Дополнительные проверки ----------

describe('valuation: опорные числа', () => {
  it('2024, выручка $1 млн в день, репутация 50, без шумихи и моделей: ровно $12,775 млрд', () => {
    const s = newState(dateToDay('2024-06-01'));
    setDailyRevenue(s, 1_000_000); // 90 млн за 90 дней, 365 млн в год
    s.reputation = 50; // множитель 0,6 + 50 / 125 = 1
    s.hype.player = 0;
    const v = valuation(s);
    expect(v.annualRevenue).toBeCloseTo(365_000_000, 2);
    expect(v.revenuePart).toBeCloseTo(365_000_000 * 35, 0);
    expect(v.techPart).toBe(0);
    expect(v.total).toBeCloseTo(12_775_000_000, 0);
  });

  it('мания: точки кривой и логарифм между ними', () => {
    const techAt = (iso: string): number => {
      const s = newState(dateToDay(iso));
      s.models.push(makeModel('p1'));
      ranks.p1 = 1;
      return valuation(s).techPart;
    };
    expect(techAt('2017-01-01')).toBeCloseTo(50e6, 0);
    expect(techAt('2022-01-01')).toBeCloseTo(0.6e9, 0);
    expect(techAt('2023-01-01')).toBeCloseTo(3e9, 0);
    expect(techAt('2024-01-01')).toBeCloseTo(8e9, 0);
    // Середина 2022 года: лог-среднее √(0,6 млрд × 3 млрд) ≈ 1,34 млрд, а линейное было бы 1,8 млрд.
    const mid = techAt('2022-07-02');
    expect(mid).toBeGreaterThan(1.2e9);
    expect(mid).toBeLessThan(1.5e9);
  });

  it('нет моделей вообще, 2024 год: технологий нет, оценка - пол', () => {
    const s = newState(dateToDay('2024-06-01'));
    s.reputation = 50;
    const v = valuation(s);
    expect(v.bestRank).toBeNull();
    expect(v.techPart).toBe(0);
    expect(v.total).toBeCloseTo(VALUATION_FLOOR, 4);
    expect(m.marketArenaRank).not.toHaveBeenCalled();
  });

  it('место спрашивается у Арены для каждой модели игрока (kind: player)', () => {
    const s = newState(dateToDay('2023-01-01'));
    s.models.push(makeModel('p1'), makeModel('p2'));
    ranks = { p1: 4, p2: 9 };
    valuation(s);
    const refs = m.marketArenaRank.mock.calls.map((c) => c[1]);
    expect(refs).toEqual([
      { kind: 'player', id: 'p1' },
      { kind: 'player', id: 'p2' },
    ]);
  });

  it('оценка только читает состояние: ничего не меняет и не трогает генератор случайных чисел', () => {
    const s = newState(dateToDay('2023-01-01'));
    s.models.push(makeModel('p1'));
    ranks.p1 = 2;
    setDailyRevenue(s, 123_456);
    const before = JSON.stringify(s);
    valuation(s);
    valuation(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('все части конечны и не отрицательны при любой дате среза', () => {
    for (const iso of ['2017-01-01', '2019-05-05', '2021-12-31', '2023-03-03', '2024-12-31']) {
      const s = newState(dateToDay(iso));
      s.models.push(makeModel('p1'));
      ranks.p1 = 1;
      setDailyRevenue(s, 50_000);
      const v = valuation(s);
      for (const x of [v.total, v.annualRevenue, v.revenuePart, v.techPart, v.hypeMult, v.repMult]) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('raiseRound: подробности', () => {
  it('сообщение об ошибке перечисляет допустимые доли', () => {
    const r = raiseRound(newState(), 0.25);
    expect(r).toEqual({ ok: false, error: 'Можно продать 10, 20 или 30 % компании' });
  });

  it('ошибка округления дроби не мешает: 0,1 + 0,2 считается как 0,3', () => {
    const s = newState();
    expect(raiseRound(s, 0.1 + 0.2)).toEqual({ ok: true });
    expect(s.founderShare).toBeCloseTo(0.7, 12);
    expect(s.mail[s.mail.length - 1].body).toContain('30 %');
  });

  it('отказ из-за кулдауна не добавляет письмо и не двигает дату раунда', () => {
    const s = newState(10);
    raiseRound(s, 0.1);
    const mails = s.mail.length;
    s.day = 20;
    expect(raiseRound(s, 0.2).ok).toBe(false);
    expect(s.mail).toHaveLength(mails);
    expect(s.lastRoundDay).toBe(10);
  });

  it('неверная доля проверяется раньше кулдауна', () => {
    const s = newState(10);
    raiseRound(s, 0.1);
    s.day = 20;
    expect(raiseRound(s, 0.25)).toEqual({ ok: false, error: 'Можно продать 10, 20 или 30 % компании' });
  });

  it('оценка для денег считается в момент раунда, до продажи', () => {
    const s = newState(dateToDay('2024-06-01'));
    setDailyRevenue(s, 1_000_000);
    s.reputation = 50;
    const cash = s.cash;
    raiseRound(s, 0.1);
    expect(s.cash - cash).toBeCloseTo(1_277_500_000, 0); // 10 % от $12,775 млрд
  });

  it('письмо: суммы в миллиардах, доля, срок до следующего раунда', () => {
    const s = newState(dateToDay('2024-06-01'));
    setDailyRevenue(s, 1_000_000);
    s.reputation = 50;
    raiseRound(s, 0.1);
    const body = s.mail[s.mail.length - 1].body;
    expect(body).toContain('$12,8 млрд');
    expect(body).toContain('$1,3 млрд');
    expect(body).toContain('10 % компании');
    expect(body).toContain('Доля основателя - 90 %');
    expect(body).toContain('через 180 дн.');
  });

  it('доля основателя в письме с десятыми: 0,9 × 0,8 = 72 %, потом × 0,7 = 50,4 %', () => {
    const s = newState();
    raiseRound(s, 0.1);
    s.day += ROUND_COOLDOWN_DAYS;
    raiseRound(s, 0.2);
    expect(s.mail[s.mail.length - 1].body).toContain('Доля основателя - 72 %');
    s.day += ROUND_COOLDOWN_DAYS;
    raiseRound(s, 0.3);
    expect(s.mail[s.mail.length - 1].body).toContain('Доля основателя - 50,4 %');
  });

  it('деньги от раунда идут в статью «investors» и не попадают в выручку', () => {
    const s = newState();
    raiseRound(s, 0.3);
    expect(s.finance.month.income.investors).toBeGreaterThan(0);
    expect(s.finance.month.income.api).toBe(0);
    expect(s.finance.month.income.contracts).toBe(0);
  });
});
