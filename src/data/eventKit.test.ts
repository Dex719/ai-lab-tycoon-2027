import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/actions';
import { applyChoice, modValue, triggerEvent } from '../sim/events';
import { createInitialState } from '../sim/state';
import { dateToDay } from '../sim/time';
import { fmtMoney } from '../ui/format';
import { eloText, finishRollLog, labUnit, REFUSE_HINT, refuseFocus, roll, startRollLog, usd } from './eventKit';

describe('labUnit: денежная единица письма растёт вместе с кассой', () => {
  const at = (date: string, cash: number) => {
    const s = createInitialState('Тест', 1);
    s.day = dateToDay(date);
    s.cash = cash;
    return s;
  };

  it('при маленькой кассе - единица года: 2024-й, $1 млн - $10 млн', () => {
    expect(labUnit(at('2024-06-01', 1e6))).toBe(10_000_000);
  });

  it('в середине - 4 % кассы: 2024-й, касса $500 млн - $20 млн', () => {
    expect(labUnit(at('2024-06-01', 5e8))).toBeCloseTo(20_000_000, -3);
  });

  it('потолок - пять единиц года: 2024-й, касса $5 млрд - $50 млн', () => {
    expect(labUnit(at('2024-06-01', 5e9))).toBe(50_000_000);
  });
});

describe('отказ в письме: исследования дешевле на 5 %, один модификатор', () => {
  it('отказ добавляет модификатор, второй отказ его не удваивает', () => {
    const s = newGame('Тест', 3);
    s.day = dateToDay('2022-03-01');
    s.cash = 1e9;
    const refuse = (id: string) => {
      triggerEvent(s, id);
      const mail = s.mail[s.mail.length - 1];
      const i = mail.choices!.findIndex((c) => c.hint === REFUSE_HINT);
      expect(i, id).toBeGreaterThanOrEqual(0);
      expect(applyChoice(s, mail.id, i).ok).toBe(true);
    };
    refuse('rnd-conference');
    expect(s.modifiers.filter((m) => m.id === 'refuse-focus')).toHaveLength(1);
    expect(modValue(s, 'researchCost').mult).toBeCloseTo(0.95, 9);
    refuse('rnd-gov-grant');
    expect(s.modifiers.filter((m) => m.id === 'refuse-focus')).toHaveLength(1);
    expect(modValue(s, 'researchCost').mult).toBeCloseTo(0.95, 9);
  });

  it('refuseFocus напрямую: повтор не добавляет второй модификатор', () => {
    const s = createInitialState('Тест', 1);
    s.day = dateToDay('2022-03-01');
    refuseFocus(s);
    refuseFocus(s);
    expect(s.modifiers.filter((m) => m.id === 'refuse-focus')).toHaveLength(1);
  });
});

describe('исход выбора со случайностью', () => {
  it('без записи бросков исхода нет', () => {
    const s = createInitialState('Тест', 1);
    roll(s, 1, true);
    expect(finishRollLog()).toBeNull();
  });

  it('выпал хороший исход - повезло, выпал плохой - не повезло', () => {
    const s = createInitialState('Тест', 1);
    startRollLog();
    roll(s, 1, true); // грант одобрен
    expect(finishRollLog()).toEqual({ lucky: true });
    startRollLog();
    roll(s, 1, false); // утечку заметили
    expect(finishRollLog()).toEqual({ lucky: false });
    startRollLog();
    roll(s, 0, false); // утечку не заметили
    expect(finishRollLog()).toEqual({ lucky: true });
  });
});

describe('usd: суммы в письмах и целях', () => {
  it('округляет так же, как fmtMoney в окнах', () => {
    const norm = (t: string) => t.replace(/\s/g, ' ');
    for (const n of [800, 999.4, 999.6, 8_450, 40_000, 194_900, 999_400, 999_600, 1_500_000, 12_340_000, 150_500_000, 2_140_000_000]) {
      expect(norm(usd(n))).toBe(norm(fmtMoney(n)));
    }
    expect(usd(194_900)).toBe('$195 тыс.');
    expect(usd(-40_000)).toBe('-$40 тыс.');
  });
});

describe('eloText: Эло в целях и задачах', () => {
  it('с разрядами, как fmtElo в окнах', () => {
    expect(eloText(987.4)).toBe('987');
    expect(eloText(1294.4).replace(/\s/g, ' ')).toBe('1 294');
  });
});
