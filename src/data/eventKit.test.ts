import { describe, expect, it } from 'vitest';
import { createInitialState } from '../sim/state';
import { fmtMoney } from '../ui/format';
import { eloText, finishRollLog, roll, startRollLog, usd } from './eventKit';

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
