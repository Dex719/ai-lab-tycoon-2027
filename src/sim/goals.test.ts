// Тесты целей года и «Итогов года»: пять целей на выбор и три в работе, награды стилей, «почти», итоги 31 декабря
// с недостачей, штраф рискованной цели, отдельный поток случайных чисел, старые сохранения.

import { describe, expect, it } from 'vitest';
import { EXTRA_EVENTS } from '../data/events';
import { GOAL_STYLES, goalStyle, makeOffer, revenueTarget, RISK_PENALTY, STYLE_REWARD, trainingProgress } from '../data/goals';
import { activeBonuses } from '../data/questKit';
import { RIVAL_MODELS } from '../data/rivalModels';
import { newGame } from './actions';
import { botAct, botChoice } from './bots';
import { applyChoice, modValue, pendingChoice } from './events';
import {
  ackYearReview,
  checkGoals,
  chooseGoals,
  goalOfferOpen,
  goalProgress,
  goalRewardText,
  goalTitle,
  LAST_REVIEW_YEAR,
  rewardMoney,
  rewardText,
  startYear,
  unseenReview,
  yearEnd,
} from './goals';
import { canResearch } from './research';
import { deserialize, serialize } from './save';
import { emptyQuests, emptyYearly } from './state';
import { advanceDay } from './tick';
import { dateToDay, dayToDate } from './time';
import type { GameState, MonthRecord, PlayerModel, TechId, YearGoalState } from './types';

const D = dateToDay;

/** Игра на заданный день без писем с выбором: случайное письмо отключено, старые письма считаются пришедшими. */
function quietGame(day: number, seed = 1): GameState {
  const s = newGame('Тест', seed);
  s.day = day;
  s.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
  s.quests.nextTaskDay = Number.MAX_SAFE_INTEGER; // короткие задачи здесь не нужны
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

/** Закрытый месяц с выручкой API. */
function month(year: number, m: number, api: number, contracts = 0): MonthRecord {
  return {
    income: { api, subs: 0, contracts, investors: 0 },
    expense: { rent: 700_000, overhead: 300_000, labelers: 0, penalties: 0, review: 0, capex: 0, power: 0 },
    year,
    month: m,
    cashEnd: 0,
    marketShare: 0,
    tokensPerDay: 0,
    subscribers: 0,
  };
}

/** Бот-партия до конца или до дня limit; onDay вызывается после каждого дня. */
function botGame(seed: number, onDay: (s: GameState) => void = () => {}, limit = Infinity): GameState {
  const s = newGame('Бот', seed);
  while (!s.outcome && s.day < limit) {
    const p = pendingChoice(s);
    if (p) {
      applyChoice(s, p.id, botChoice(s, p.eventId));
      continue;
    }
    if (s.day % 7 === 0) botAct(s, 'reasonable');
    advanceDay(s);
    onDay(s);
  }
  return s;
}

describe('выдача целей', () => {
  it('в первый день игры: пять целей разного стиля на выбор, три по умолчанию в работе (деньги, гонка, исследования)', () => {
    const s = newGame('Тест', 1);
    expect(s.yearly.year).toBe(0);
    advanceDay(s);
    expect(s.yearly.year).toBe(2017);
    const offer = s.quests.offer!;
    expect(offer.year).toBe(2017);
    expect(offer.open).toBe(true);
    expect(offer.goals).toHaveLength(5);
    expect(offer.goals.map((g) => goalStyle(g.id))).toEqual([...GOAL_STYLES]);
    expect(s.yearly.goals).toHaveLength(3);
    expect(s.yearly.goals.map((g) => goalStyle(g.id))).toEqual(['money', 'race', 'research']);
    expect(s.yearly.goals.every((g) => !g.done && g.doneDay === null)).toBe(true);
    expect(goalOfferOpen(s)).toBe(true);
  });

  it('2017 год: гонки ещё нет - цель «модель с баллом SQuAT», исследование - «Механизм внимания»', () => {
    const s = quietGame(0);
    startYear(s, 2017);
    const goals = s.quests.offer!.goals;
    const q = goals.find((g) => g.id === 'g-quality')!;
    expect(q).toBeDefined();
    expect(q.param).toBe('squad');
    expect(q.target!).toBeGreaterThan(40);
    expect(q.target!).toBeLessThanOrEqual(95);
    expect(goalTitle(q, 2017)).toMatch(/^Модель с баллом SQuAT от \d+ %$/); // процент не отрывается от числа
    const r = goals.find((g) => goalStyle(g.id) === 'research')!;
    if (r.id === 'r-tech') expect(r.param).toBe('attention');
  });

  it('каждый год 2017-2024 в ходе партии: пять стилей, названия, награды и прогресс заполнены, без длинных тире', () => {
    const seen = new Set<number>();
    botGame(4, (s) => {
      const o = s.quests.offer;
      if (!o || seen.has(o.year)) return;
      seen.add(o.year);
      expect(o.goals.map((g) => goalStyle(g.id)), String(o.year)).toEqual([...GOAL_STYLES]);
      for (const g of o.goals) {
        const title = goalTitle(g, o.year);
        expect(title.length, g.id).toBeGreaterThan(5);
        expect(title).not.toMatch(/undefined|NaN|[–—]/);
        expect(goalRewardText(g, o.year)).not.toBe('');
        const v = goalProgress(s, g)!;
        expect(v.progress.fraction).toBeGreaterThanOrEqual(0);
        expect(v.progress.fraction).toBeLessThanOrEqual(1);
        expect(v.progress.text).not.toMatch(/undefined|NaN|[–—]/);
        expect(v.def.hint?.(s, g) ?? '').not.toMatch(/undefined|NaN|[–—]/);
      }
    });
    expect([...seen]).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]);
  });

  it('цели не одинаковые от партии к партии: разные зёрна дают разные наборы', () => {
    const sets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = quietGame(D('2019-01-01'), seed);
      s.models = [model()];
      s.finance.history.push(month(2018, 12, 400_000));
      startYear(s, 2019);
      sets.add(s.quests.offer!.goals.map((g) => `${g.id}:${g.target ?? ''}:${g.param ?? ''}`).join('|'));
    }
    expect(sets.size).toBeGreaterThan(4);
  });

  it('цели называют только вышедшее: соперник из вышедших моделей, технология доступна, подписчиков до открытия подписок нет', () => {
    for (const date of ['2019-01-01', '2021-01-01', '2022-01-01']) {
      for (let seed = 1; seed <= 4; seed++) {
        const s = quietGame(D(date), seed);
        s.rivalsReleased = RIVAL_MODELS.filter((m) => m.released <= date).map((m) => m.id);
        s.models = [model({ arenaElo: 950, releasedDay: D(date) - 30 })];
        s.research.done.push('attention');
        startYear(s, Number(date.slice(0, 4)));
        for (const g of s.quests.offer!.goals) {
          if (g.id === 'g-beat') expect(s.rivalsReleased).toContain(g.param!.split(':')[1]);
          if (g.id === 'r-tech') expect(canResearch(s, g.param as TechId)).toBe(true);
          expect(g.id).not.toBe('k-subs');
        }
      }
    }
  });

  it('при новом годе (1 января) цели меняются на цели нового года', () => {
    const s = quietGame(D('2018-01-01'));
    s.yearly.year = 2017;
    advanceDay(s);
    expect(s.yearly.year).toBe(2018);
    expect(s.quests.offer!.year).toBe(2018);
  });
});

describe('выбор трёх целей', () => {
  it('выбрать можно ровно три из предложенных, один раз', () => {
    const s = quietGame(D('2019-01-01'));
    s.models = [model()];
    startYear(s, 2019);
    const ids = s.quests.offer!.goals.map((g) => g.id);
    expect(chooseGoals(s, ids.slice(0, 2)).ok).toBe(false);
    expect(chooseGoals(s, [ids[0], ids[1], 'нет-такой']).ok).toBe(false);
    expect(chooseGoals(s, [ids[0], ids[0], ids[1]]).ok).toBe(false);
    const pick = [ids[1], ids[3], ids[4]];
    expect(chooseGoals(s, pick)).toEqual({ ok: true });
    expect(s.yearly.goals.map((g) => g.id)).toEqual(pick);
    expect(goalOfferOpen(s)).toBe(false);
    expect(chooseGoals(s, pick).ok).toBe(false);
  });

  it('цель, которая уже была в работе, при выборе сохраняет своё состояние', () => {
    const s = quietGame(D('2019-01-01'));
    startYear(s, 2019);
    const keep = s.yearly.goals[0];
    keep.done = true;
    keep.doneDay = s.day;
    const others = s.quests.offer!.goals.filter((g) => g.id !== keep.id).map((g) => g.id);
    expect(chooseGoals(s, [keep.id, others[0], others[1]]).ok).toBe(true);
    expect(s.yearly.goals.find((g) => g.id === keep.id)!.done).toBe(true);
  });
});

describe('выполнение и награда', () => {
  it('денежная цель: выполнена, награда - полторы единицы года, письмо-награда одно', () => {
    const s = quietGame(D('2018-06-10'));
    s.models = [model()];
    s.yearly.year = 2018;
    s.yearly.goals = [{ id: 'm-revenue', done: false, doneDay: null, base: 0, target: 1_000_000 }];
    const cash = s.cash;
    s.finance.month.income.api = 1_200_000;
    advanceDay(s);
    expect(s.yearly.goals[0].done).toBe(true);
    expect(rewardMoney(STYLE_REWARD.money, 2018)).toBe(225_000);
    expect(s.cash - cash).toBeGreaterThan(0);
    const mails = s.mail.filter((m) => m.title.startsWith('Цель выполнена'));
    expect(mails).toHaveLength(1);
    expect(mails[0].reward).toBe(true);
    expect(mails[0].title).toBe('Цель выполнена: Выручка $1 млн за год');
    expect(mails[0].body).toBe('Цель года выполнена. Награда: +$225 тыс.');
    advanceDay(s);
    expect(s.mail.filter((m) => m.title.startsWith('Цель выполнена'))).toHaveLength(1);
  });

  it('у каждого стиля своя награда: исследования и рынок - скидка на время, гонка - шумиха', () => {
    const s = quietGame(D('2020-03-01'));
    s.yearly.year = 2020;
    s.research.done.push('attention');
    s.yearly.goals = [
      { id: 'r-tech', done: false, doneDay: null, base: 0, param: 'attention' },
      { id: 'k-tenders', done: false, doneDay: null, base: 0, target: 1 },
    ];
    s.quests.tendersWon = 1;
    checkGoals(s, true);
    expect(s.yearly.goals.every((g) => g.done)).toBe(true);
    expect(modValue(s, 'researchCost', 'rlhf').mult).toBeCloseTo(STYLE_REWARD.research.researchMult!);
    expect(modValue(s, 'rentPrice', 'h100').mult).toBeCloseTo(STYLE_REWARD.market.rentMult!);
    const bonuses = activeBonuses(s);
    expect(bonuses.map((b) => b.text)).toEqual(['Исследования дешевле на 10 %', 'Аренда дешевле на 8 %']);
    expect(bonuses[0].untilDay).toBe(s.day + 90);
    expect(rewardText(STYLE_REWARD.race, 2020)).toBe('+10 шумихи');
    expect(rewardText(STYLE_REWARD.market, 2020)).toBe('аренда дешевле на 8 % на 60 дней');
    expect(rewardText(STYLE_REWARD.risk, 2020)).toBe('+$1,5 млн, +5 репутации');
  });

  it('старые цели (сохранение до выбора целей): «Выпустить первую модель» досчитывается и награждается', () => {
    const s = quietGame(D('2017-03-01'));
    s.yearly.year = 2017;
    s.yearly.goals = [{ id: 'first-model', done: false, doneDay: null, base: 0 }];
    const rep = s.reputation;
    s.models = [model()];
    advanceDay(s);
    expect(s.yearly.goals[0].done).toBe(true);
    expect(s.reputation).toBeGreaterThan(rep);
    expect(goalTitle(s.yearly.goals[0], 2017)).toBe('Выпустить первую модель');
  });

  it('«выпустить N моделей за год» считается от показателя на начало года', () => {
    const s = quietGame(D('2019-01-01'));
    s.models = [model()];
    s.yearly.year = 2019;
    s.yearly.goals = [{ id: 'x-models', done: false, doneDay: null, base: 1, target: 3 }];
    checkGoals(s, true);
    expect(s.yearly.goals[0].done).toBe(false);
    s.models.push(model({ id: 'p2', releasedDay: 400 }), model({ id: 'p3', releasedDay: 410 }), model({ id: 'p4', releasedDay: 420 }));
    checkGoals(s, true);
    expect(s.yearly.goals[0].done).toBe(true);
  });

  it('выручка за год идёт по закрытым месяцам года и текущему, прошлый год не считается', () => {
    const s = quietGame(D('2018-06-10'));
    s.yearly.year = 2018;
    s.yearly.goals = [{ id: 'm-revenue', done: false, doneDay: null, base: 0, target: 1_000_000 }];
    s.finance.history.push(month(2017, 12, 900_000));
    checkGoals(s, true);
    expect(s.yearly.goals[0].done).toBe(false);
    s.finance.history.push(month(2018, 5, 700_000));
    s.finance.month.income.api = 400_000;
    checkGoals(s, true);
    expect(s.yearly.goals[0].done).toBe(true);
  });

  it('«почти» в гонке - тот же порог, что на верхней панели: 15 Эло; недостача видна', () => {
    const s = quietGame(D('2021-03-01'));
    s.rivalsReleased = RIVAL_MODELS.filter((m) => m.released <= '2021-03-01').map((m) => m.id);
    const rival = RIVAL_MODELS.find((m) => m.id === 'gtp-3')!;
    s.models = [model({ arenaElo: rival.arenaElo - 14 })];
    const g: YearGoalState = { id: 'g-beat', done: false, doneDay: null, base: 60, param: 'arena:gtp-3' };
    expect(goalTitle(g, 2021)).toBe('Обогнать GTP-3 Davanci (OpenBrain) на «Арене»');
    expect(goalProgress(s, g)!.progress.almost).toBe(true);
    s.models[0].arenaElo = rival.arenaElo - 20;
    expect(goalProgress(s, g)!.progress.almost).toBe(false);
    expect(goalProgress(s, g)!.progress.miss).toBe('не хватило 20 Эло');
    s.models[0].arenaElo = rival.arenaElo + 1;
    expect(goalProgress(s, g)!.progress.done).toBe(true);
  });

  it('полоска от 80 % - «почти», выполненная цель - нет', () => {
    const s = quietGame(D('2018-06-10'));
    s.yearly.year = 2018;
    const g: YearGoalState = { id: 'm-revenue', done: false, doneDay: null, base: 0, target: 1_000_000 };
    s.finance.month.income.api = 850_000;
    expect(goalProgress(s, g)!.progress.almost).toBe(true);
    s.finance.month.income.api = 700_000;
    expect(goalProgress(s, g)!.progress.almost).toBe(false);
    expect(goalProgress(s, { ...g, done: true })!.progress.almost).toBe(false);
    // условие уже выполнено, но проверка ещё не засчитала цель: тоже не «почти»
    s.finance.month.income.api = 1_200_000;
    expect(goalProgress(s, g)!.progress.done).toBe(true);
    expect(goalProgress(s, g)!.progress.almost).toBe(false);
  });

  it('цель «1-е место 31 декабря» засчитывается только в конце года', () => {
    const s = quietGame(D('2019-06-01'));
    s.yearly.year = 2019;
    s.yearly.goals = [{ id: 'g-hold', done: false, doneDay: null, base: 0 }];
    s.models = [model({ caps: { language: 99, code: 20, reasoning: 20 } })];
    s.rivalsReleased = ['gtp-1'];
    expect(goalProgress(s, s.yearly.goals[0])!.progress.almost).toBe(false); // держится - это не «почти»
    checkGoals(s, true);
    expect(s.yearly.goals[0].done).toBe(false);
    checkGoals(s, true, true);
    expect(s.yearly.goals[0].done).toBe(true);
  });
});

describe('итоги года', () => {
  it('31 декабря: итоги записаны один раз, цифры из учёта, у каждой цели итог, цели следующего года предложены', () => {
    const s = quietGame(D('2019-12-31'));
    s.models = [model({ releasedDay: D('2019-05-05') })];
    startYear(s, 2019);
    s.finance.history.push(month(2019, 6, 2_000_000, 500_000));
    advanceDay(s); // 31 декабря: месяц закрыт, год закончен
    expect(s.day).toBe(D('2020-01-01'));
    expect(s.yearly.reviews).toHaveLength(1);
    const r = s.yearly.reviews[0];
    expect(r.year).toBe(2019);
    expect(r.revenue).toBeCloseTo(2_500_000, -2);
    expect(r.expense).toBeGreaterThanOrEqual(1_000_000);
    expect(r.models).toBe(1);
    expect(r.goalsTotal).toBe(3);
    expect(r.results).toHaveLength(3);
    for (const x of r.results!) {
      expect(x.title.length).toBeGreaterThan(5);
      expect(x.prize).not.toBe('');
      if (!x.done) expect(x.miss).not.toBe('');
      expect(`${x.title}${x.text}${x.miss}`).not.toMatch(/undefined|NaN|[–—]/);
    }
    expect(r.comment.length).toBeGreaterThan(10);
    expect(r.comment).not.toMatch(/[–—]/);
    expect(r.seen).toBe(false);
    expect(unseenReview(s)).toBe(r);
    expect(s.yearly.year).toBe(2020);
    expect(s.yearly.goals.length).toBe(3);
    expect(goalOfferOpen(s)).toBe(true);
    advanceDay(s); // 1 января: ещё одних итогов нет
    expect(s.yearly.reviews).toHaveLength(1);
  });

  it('«почти получилось»: в итогах видно, сколько не хватило, и комментарий говорит о самой близкой цели', () => {
    const s = quietGame(D('2018-12-31'));
    s.yearly.year = 2018;
    s.yearly.goals = [{ id: 'm-revenue', done: false, doneDay: null, base: 0, target: 1_000_000 }];
    s.finance.history.push(month(2018, 6, 900_000));
    advanceDay(s);
    const r = s.yearly.reviews[0];
    expect(r.results![0]).toMatchObject({ done: false, miss: 'не хватило $100 тыс.', text: 'Выручка за год: $900 тыс. из $1 млн' });
    expect(r.comment).toBe('Почти: «Выручка $1 млн за год» - не хватило $100 тыс.');
  });

  it('рискованная цель, не выполненная к 31 декабря, - штраф и письмо; выполненная - без штрафа', () => {
    const s = quietGame(D('2019-12-31'));
    s.yearly.year = 2019;
    s.reputation = 50;
    s.hype.player = 40;
    s.yearly.goals = [{ id: 'x-revenue', done: false, doneDay: null, base: 0, target: 9_000_000 }];
    advanceDay(s);
    expect(s.reputation).toBe(50 - RISK_PENALTY.reputation!);
    const mail = s.mail.find((m) => m.title.startsWith('Рискованная цель не выполнена'))!;
    expect(mail.title).toBe('Рискованная цель не выполнена: Выручка $9 млн за год');
    expect(mail.body).toBe('Не хватило $9 млн. Штраф: -5 репутации, -10 шумихи.');
    expect(s.yearly.reviews[0].results![0].penalty).toBe('-5 репутации, -10 шумихи');

    const ok = quietGame(D('2019-12-31'));
    ok.yearly.year = 2019;
    ok.reputation = 50;
    ok.yearly.goals = [{ id: 'x-revenue', done: true, doneDay: 300, base: 0, target: 9_000_000 }];
    advanceDay(ok);
    expect(ok.reputation).toBeGreaterThanOrEqual(50);
    expect(ok.mail.some((m) => m.title.startsWith('Рискованная цель'))).toBe(false);
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
    const s = botGame(2);
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
    s.yearly.year = 2018;
    s.yearly.goals = [{ id: 'g-quality', done: false, doneDay: null, base: 0, target: 70, param: 'squad' }];
    advanceDay(s);
    expect(s.yearly.reviews[0].comment).toContain('Выручки не было');
  });
});

describe('случайные числа', () => {
  it('цели, задачи и итоги не трогают основной поток: до первого письма s.rng идёт так же, как без всей новой системы', () => {
    const a = newGame('A', 77);
    const b = newGame('A', 77);
    a.firedEvents.push(...EXTRA_EVENTS.map((e) => e.id)); // ранние заказы только открывают письмо и останавливают день
    b.firedEvents.push(...EXTRA_EVENTS.map((e) => e.id));
    b.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    b.quests.nextTaskDay = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 60; i++) {
      advanceDay(a);
      advanceDay(b);
    }
    expect(a.rng).toBe(b.rng);
    expect(a.mail.filter((m) => m.choices).length).toBe(0);
    expect(a.yearly.nextEventDay).toBeGreaterThanOrEqual(60);
  });

  it('одно зерно - те же цели, задачи, письма с выбором, то же состояние', () => {
    const play = (): string => serialize(botGame(5, () => {}, 1200));
    expect(play()).toBe(play());
  });

  it('у каждого зерна свой поток событий и задач, он производный от зерна и не равен основному', () => {
    expect(emptyYearly(1).rng).not.toBe(emptyYearly(2).rng);
    expect(emptyYearly(1).rng).not.toBe(1);
    expect(emptyQuests(1).rng).not.toBe(emptyYearly(1).rng);
    expect(emptyQuests(1).rng).not.toBe(emptyQuests(2).rng);
  });
});

describe('сохранения', () => {
  it('сохранение без целей (старая версия) загружается: цели появятся на ближайшем тике, первое письмо через 75 дней', () => {
    const s = newGame('Старая', 9);
    advanceDay(s);
    const data = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete data.yearly;
    delete data.quests;
    data.day = 400;
    const r = deserialize(JSON.stringify(data));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.yearly.year).toBe(0);
    expect(r.state.yearly.goals).toEqual([]);
    expect(r.state.yearly.nextEventDay).toBe(475);
    expect(r.state.yearly.lastFired).toEqual({});
    expect(r.state.quests.offer).toBeNull();
    expect(r.state.quests.nextTaskDay).toBe(405);
    r.state.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    advanceDay(r.state);
    expect(r.state.yearly.year).toBe(2018);
    expect(r.state.yearly.goals.length).toBe(3);
  });

  it('сохранение посреди года со старыми целями: цели остаются, выбора нет до 31 декабря', () => {
    const s = quietGame(D('2019-06-01'));
    s.yearly.year = 2019;
    s.yearly.goals = [
      { id: 'rev-3m', done: false, doneDay: null, base: 0 },
      { id: 'share-10', done: false, doneDay: null, base: 0 },
      { id: 'tech-scaling', done: false, doneDay: null, base: 0 },
    ];
    const data = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete data.quests;
    const r = deserialize(JSON.stringify(data));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    advanceDay(r.state);
    expect(r.state.yearly.goals.map((g) => g.id)).toEqual(['rev-3m', 'share-10', 'tech-scaling']);
    expect(goalOfferOpen(r.state)).toBe(false);
    for (const g of r.state.yearly.goals) expect(goalProgress(r.state, g)!.title.length).toBeGreaterThan(5);
  });

  it('цели, выбор, итоги и расписание проходят сохранение и загрузку без потерь', () => {
    const s = quietGame(D('2019-12-31'));
    startYear(s, 2019);
    advanceDay(s);
    s.yearly.lastFired['rnd-conference'] = 100;
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.yearly).toEqual(s.yearly);
      expect(r.state.quests).toEqual(s.quests);
    }
  });

  it('испорченные цели и выбор отклоняются', () => {
    const s = quietGame(D('2019-06-01'));
    startYear(s, 2019);
    const data = JSON.parse(serialize(s)) as { yearly: { goals: Record<string, unknown>[] }; quests: { offer: { goals: Record<string, unknown>[] } } };
    data.yearly.goals[0].done = 'да';
    expect(deserialize(JSON.stringify(data)).ok).toBe(false);
    const bad = JSON.parse(serialize(s)) as typeof data;
    bad.quests.offer.goals[0].target = 'много';
    expect(deserialize(JSON.stringify(bad)).ok).toBe(false);
  });
});

describe('цель «Выпустить новую модель»: какая модель ждёт выпуска', () => {
  it('называет самую свежую обученную модель, а не старую, которую так и не выпустили', () => {
    const s = quietGame(D('2019-03-01'));
    s.models.push(
      model({ id: 'p1', name: 'Старая', releasedDay: 30 }),
      model({ id: 'p2', name: 'Забытая', trainedDay: 200, releasedDay: null }),
      model({ id: 'p3', name: 'Свежая', trainedDay: D('2019-02-10'), releasedDay: null }),
    );
    s.models.push(model({ id: 'p4', name: 'Вторая свежая', trainedDay: D('2019-01-20'), releasedDay: null }));
    expect(trainingProgress(s, '').text).toBe('«Свежая» обучена, осталось выпустить');
  });
});

describe('цели по реальной экономике (плейтест 17.10)', () => {
  it('до 2020 года целей «выручка за месяц» нет: месяц закрывался одной оплатой тендера', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let r = seed / 31;
      const rnd = () => (r = (r * 9301 + 49297) % 1);
      for (const year of [2017, 2018, 2019]) {
        const ids = makeOffer(quietGame(D(`${year}-01-01`), seed), year, rnd).map((g) => g.id);
        expect(ids).not.toContain('m-month');
        expect(ids).not.toContain('x-month');
      }
    }
  });

  it('выручка за год: крупный контракт прошлого года не задирает цель выше REVENUE_GROWTH_CAP планок', () => {
    const s = quietGame(D('2018-01-01'));
    s.finance.history = [month(2017, 11, 0, 4_000_000), month(2017, 12, 20_000)];
    // Планка 2018 года - $1 млн: цель не выше $2,5 млн, хотя прошлый год дал $4 млн.
    expect(revenueTarget(s, 2018, 1)).toBeLessThanOrEqual(2_500_000);
    expect(revenueTarget(s, 2018, 0)).toBeGreaterThanOrEqual(800_000);
  });
});
