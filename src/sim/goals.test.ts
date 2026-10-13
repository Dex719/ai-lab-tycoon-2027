// Тесты целей года и «Итогов года»: выдача, награды, итоги 31 декабря, отдельный поток случайных чисел, старые сохранения.

import { describe, expect, it } from 'vitest';
import { EXTRA_EVENTS } from '../data/events';
import { GOALS, GOALS_BY_YEAR } from '../data/goals';
import { newGame } from './actions';
import { botAct, botChoice } from './bots';
import { applyChoice, pendingChoice } from './events';
import { ackYearReview, checkGoals, goalProgress, LAST_REVIEW_YEAR, rewardMoney, rewardText, startYear, unseenReview, yearEnd } from './goals';
import { deserialize, serialize } from './save';
import { emptyYearly } from './state';
import { advanceDay } from './tick';
import { dateToDay, dayToDate } from './time';
import type { GameState, PlayerModel } from './types';

const D = dateToDay;

/** Игра на заданный день без писем с выбором: случайное письмо отключено, старые письма считаются пришедшими. */
function quietGame(day: number, seed = 1): GameState {
  const s = newGame('Тест', seed);
  s.day = day;
  s.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
  s.firedEvents.push(...EXTRA_EVENTS.map((e) => e.id));
  return s;
}

function model(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Мозг-1',
    plan: {
      name: 'Мозг-1', paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'light',
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 10,
    releasedDay: 20,
    caps: { language: 30, code: 20, reasoning: 20 },
    overfit: {},
    rlhf: false,
    arenaElo: 900,
    price: 10,
    onApi: true,
    exposed: false,
    earned: 0,
    onSubs: false,
    subsPrice: 10,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
    ...over,
  };
}

describe('выдача целей', () => {
  it('в первый день игры выдаются три цели 2017 года из списка года', () => {
    const s = newGame('Тест', 1);
    expect(s.yearly.year).toBe(0);
    advanceDay(s);
    expect(s.yearly.year).toBe(2017);
    expect(s.yearly.goals).toHaveLength(3);
    for (const g of s.yearly.goals) expect(GOALS_BY_YEAR[2017]).toContain(g.id);
    expect(s.yearly.goals.map((g) => g.id)).toContain('first-model');
    expect(s.yearly.goals.every((g) => !g.done && g.doneDay === null)).toBe(true);
  });

  it('в каждом году списка хватает целей, все id известны, названия и награды заполнены', () => {
    const ids = new Set(GOALS.map((g) => g.id));
    expect(ids.size).toBe(GOALS.length);
    for (const year of Object.keys(GOALS_BY_YEAR).map(Number)) {
      for (const id of GOALS_BY_YEAR[year]) expect(ids.has(id), `${year}: ${id}`).toBe(true);
      const s = quietGame(D(`${year}-01-01`));
      startYear(s, year);
      expect(s.yearly.goals.length, String(year)).toBe(3);
    }
    for (const g of GOALS) {
      expect(g.title(2020).length).toBeGreaterThan(5);
      expect(rewardText(g.reward, 2020)).not.toBe('');
      expect(`${g.title(2020)}${rewardText(g.reward, 2020)}`).not.toMatch(/[–—]/);
    }
  });

  it('цель «Выпустить первую модель» заменяется на «Выпустить новую», если модель уже есть; изученное исследование не предлагается', () => {
    const s = quietGame(D('2018-01-01'));
    s.models = [model()];
    s.research.done.push('attention');
    startYear(s, 2018);
    const ids = s.yearly.goals.map((g) => g.id);
    expect(ids).toContain('new-model');
    expect(ids).not.toContain('first-model');
    startYear(s, 2017);
    expect(s.yearly.goals.map((g) => g.id)).not.toContain('tech-attention');
  });

  it('при новом годе (1 января) цели меняются на цели нового года', () => {
    const s = quietGame(D('2018-01-01'));
    s.yearly.year = 2017;
    advanceDay(s);
    expect(s.yearly.year).toBe(2018);
  });
});

describe('выполнение и награда', () => {
  it('выпуск первой модели: цель выполнена, награда выдана один раз, пришло письмо', () => {
    const s = quietGame(D('2017-03-01'));
    startYear(s, 2017);
    const cash = s.cash;
    const rep = s.reputation;
    s.models = [model()];
    advanceDay(s);
    const g = s.yearly.goals.find((x) => x.id === 'first-model')!;
    expect(g.done).toBe(true);
    expect(g.doneDay).toBe(D('2017-03-01'));
    const reward = rewardMoney({ moneyK: 1 }, 2017);
    expect(reward).toBeGreaterThan(0);
    const mails = s.mail.filter((m) => m.title.startsWith('Цель выполнена'));
    expect(mails).toHaveLength(1);
    expect(mails[0].body).toContain('Награда');
    expect(mails[0].body).not.toMatch(/\.\./);
    expect(s.reputation).toBeGreaterThan(rep);
    const gained = s.cash - cash;
    expect(gained).toBeGreaterThan(0);
    // ещё сутки: награда не повторяется
    const cashAfter = s.cash;
    advanceDay(s);
    expect(s.mail.filter((m) => m.title.startsWith('Цель выполнена'))).toHaveLength(1);
    expect(s.cash).toBeLessThanOrEqual(cashAfter);
  });

  it('цель «за год» считается от показателя на начало года (новая модель)', () => {
    const s = quietGame(D('2019-01-01'));
    s.models = [model()];
    startYear(s, 2019);
    const g = s.yearly.goals.find((x) => x.id === 'new-model')!;
    expect(g.base).toBe(1);
    checkGoals(s, true);
    expect(g.done).toBe(false);
    s.models.push(model({ id: 'p2', releasedDay: 400 }));
    checkGoals(s, true);
    expect(g.done).toBe(true);
  });

  it('выручка за год: идёт по закрытым месяцам и текущему', () => {
    const s = quietGame(D('2018-06-10'));
    s.models = [model()];
    startYear(s, 2018);
    const goal = s.yearly.goals.find((x) => x.id === 'rev-1m')!;
    s.finance.month.income.api = 400_000;
    s.finance.history.push({
      ...s.finance.month,
      income: { api: 700_000, subs: 0, contracts: 0, investors: 5e6 }, // деньги инвесторов не считаются
      year: 2018,
      month: 5,
      cashEnd: 0,
      marketShare: 0,
      tokensPerDay: 0,
      subscribers: 0,
    });
    checkGoals(s, true);
    expect(goal.done).toBe(true);
    const other = quietGame(D('2018-06-10'));
    other.models = [model()];
    startYear(other, 2018);
    other.finance.history.push({
      ...other.finance.month,
      income: { api: 900_000, subs: 0, contracts: 0, investors: 5e6 },
      year: 2017, // прошлый год не считается
      month: 12,
      cashEnd: 0,
      marketShare: 0,
      tokensPerDay: 0,
      subscribers: 0,
    });
    checkGoals(other, true);
    expect(other.yearly.goals.find((x) => x.id === 'rev-1m')!.done).toBe(false);
  });

  it('прогресс невыполненной цели читается: строка текста и доля от 0 до 1', () => {
    const s = quietGame(D('2020-03-01'));
    s.models = [model()];
    startYear(s, 2020);
    for (const g of s.yearly.goals) {
      const p = goalProgress(s, g)!;
      expect(p.progress.text.length).toBeGreaterThan(3);
      expect(p.progress.fraction).toBeGreaterThanOrEqual(0);
      expect(p.progress.fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe('итоги года', () => {
  it('31 декабря: итоги записаны один раз, цифры из учёта, цели следующего года выданы, окно не показано', () => {
    const s = quietGame(D('2019-12-31'));
    s.models = [model({ releasedDay: D('2019-05-05') })];
    startYear(s, 2019);
    s.finance.history.push({
      income: { api: 2_000_000, subs: 0, contracts: 500_000, investors: 0 },
      expense: { rent: 700_000, overhead: 300_000, labelers: 0, penalties: 0, review: 0, capex: 0, power: 0 },
      year: 2019,
      month: 6,
      cashEnd: 0,
      marketShare: 0,
      tokensPerDay: 0,
      subscribers: 0,
    });
    advanceDay(s); // 31 декабря: месяц закрыт, год закончен
    expect(s.day).toBe(D('2020-01-01'));
    expect(s.yearly.reviews).toHaveLength(1);
    const r = s.yearly.reviews[0];
    expect(r.year).toBe(2019);
    expect(r.revenue).toBeCloseTo(2_500_000, -2);
    expect(r.expense).toBeGreaterThanOrEqual(1_000_000);
    expect(r.models).toBe(1);
    expect(r.goalsTotal).toBe(3);
    expect(r.comment.length).toBeGreaterThan(10);
    expect(r.comment).not.toMatch(/[–—]/);
    expect(r.seen).toBe(false);
    expect(unseenReview(s)).toBe(r);
    expect(s.yearly.year).toBe(2020);
    expect(s.yearly.goals.length).toBe(3);
    advanceDay(s); // 1 января: ещё одних итогов нет
    expect(s.yearly.reviews).toHaveLength(1);
  });

  it('«Продолжить» закрывает итоги, второй раз - ошибка', () => {
    const s = quietGame(D('2019-12-31'));
    startYear(s, 2019);
    advanceDay(s);
    expect(unseenReview(s)).not.toBeNull();
    expect(ackYearReview(s)).toEqual({ ok: true });
    expect(unseenReview(s)).toBeNull();
    expect(ackYearReview(s).ok).toBe(false);
  });

  it('итоги есть за каждый год 2017-2023, а за 2024 год - нет (там итог партии)', () => {
    const s = newGame('Бот', 2);
    s.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    while (!s.outcome) {
      const p = pendingChoice(s);
      if (p) {
        applyChoice(s, p.id, botChoice(s, p.eventId));
        continue;
      }
      if (s.day % 7 === 0) botAct(s, 'reasonable');
      advanceDay(s);
    }
    expect(s.yearly.reviews.map((r) => r.year)).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023]);
    expect(LAST_REVIEW_YEAR).toBe(2023);
    expect(dayToDate(s.day).year).toBe(2024);
  });

  it('итоги повторно не строятся, если целей этого года нет (старое сохранение посреди года)', () => {
    const s = quietGame(D('2020-12-31'));
    s.yearly.year = 0;
    yearEnd(s);
    expect(s.yearly.reviews).toEqual([]);
  });

  it('нет моделей и выручки: комментарий говорит об этом', () => {
    const s = quietGame(D('2018-12-31'));
    startYear(s, 2018);
    advanceDay(s);
    expect(s.yearly.reviews[0].comment).toContain('Выручки не было');
  });
});

describe('случайные числа', () => {
  it('цели и итоги не трогают основной поток: до первого письма s.rng идёт так же, как без всей новой системы', () => {
    const a = newGame('A', 77);
    const b = newGame('A', 77);
    a.firedEvents.push(...EXTRA_EVENTS.map((e) => e.id)); // ранние заказы только открывают письмо и останавливают день
    b.firedEvents.push(...EXTRA_EVENTS.map((e) => e.id));
    b.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 60; i++) {
      advanceDay(a);
      advanceDay(b);
    }
    expect(a.rng).toBe(b.rng);
    expect(a.mail.filter((m) => m.choices).length).toBe(0);
    expect(a.yearly.nextEventDay).toBeGreaterThanOrEqual(60);
  });

  it('одно зерно - те же цели, те же письма с выбором, то же состояние', () => {
    const play = (): string => {
      const s = newGame('Бот', 5);
      while (!s.outcome && s.day < 1200) {
        const p = pendingChoice(s);
        if (p) {
          applyChoice(s, p.id, botChoice(s, p.eventId));
          continue;
        }
        if (s.day % 7 === 0) botAct(s, 'reasonable');
        advanceDay(s);
      }
      return serialize(s);
    };
    expect(play()).toBe(play());
  });

  it('у каждого зерна свой поток событий, он производный от зерна и не равен основному', () => {
    expect(emptyYearly(1).rng).not.toBe(emptyYearly(2).rng);
    expect(emptyYearly(1).rng).not.toBe(1);
  });
});

describe('сохранения', () => {
  it('сохранение без целей (старая версия) загружается: цели появятся на ближайшем тике, первое письмо через 75 дней', () => {
    const s = newGame('Старая', 9);
    advanceDay(s);
    const data = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete data.yearly;
    data.day = 400;
    const r = deserialize(JSON.stringify(data));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.yearly.year).toBe(0);
    expect(r.state.yearly.goals).toEqual([]);
    expect(r.state.yearly.nextEventDay).toBe(475);
    expect(r.state.yearly.lastFired).toEqual({});
    r.state.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    advanceDay(r.state);
    expect(r.state.yearly.year).toBe(2018);
    expect(r.state.yearly.goals.length).toBeGreaterThan(0);
  });

  it('цели, итоги и расписание проходят сохранение и загрузку без потерь', () => {
    const s = quietGame(D('2019-12-31'));
    startYear(s, 2019);
    advanceDay(s);
    s.yearly.lastFired['rnd-conference'] = 100;
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.yearly).toEqual(s.yearly);
  });

  it('испорченные цели отклоняются', () => {
    const s = quietGame(D('2019-06-01'));
    startYear(s, 2019);
    const data = JSON.parse(serialize(s)) as { yearly: { goals: Record<string, unknown>[] } };
    data.yearly.goals[0].done = 'да';
    expect(deserialize(JSON.stringify(data)).ok).toBe(false);
  });
});
