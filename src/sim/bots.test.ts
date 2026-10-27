// Боты: выбор при срыве обучения и заявки на тендеры по мощности.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { EXTRA_EVENTS } from '../data/events';
import { botAct, botChoice, chinchillaPlan, nextTech, pickChoice, runBot } from './bots';
import { computeDay, orderedCount, rentNow } from './compute';
import { FAIL_ROLLBACK, TRAIN_FLOP_PER_H100E_DAY } from './constants';
import { minPrice } from './market';
import { botPriceReflex } from './rivalry';
import { emptyLedger } from './state';
import { dateToDay, END_DAY } from './time';
import { tierOf } from './training';
import type { GameState, Mail, MonthRecord, PlayerModel, TrainingRun } from './types';

function run(flopTotal: number, flopDone: number, failed = true): TrainingRun {
  return {
    id: 't1',
    failed,
    plan: { name: 'М', paramsB: 1, tokensB: 20, mix: { language: 1, code: 0, reasoning: 0 }, benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'light' },
    arch: 'transformer',
    algoLevel: 0,
    flopTotal,
    flopDone,
    startedDay: 0,
    failAtFraction: null,
    failPenalty: 0,
  };
}

describe('botChoice', () => {
  it('не срыв обучения - первый вариант', () => {
    const s = newGame('Бот', 1);
    expect(botChoice(s, 'gpt2-withheld')).toBe(0);
    expect(botChoice(s, undefined)).toBe(0);
  });

  it('откат успевает до конца игры - откат (вариант 0)', () => {
    const s = newGame('Бот', 1);
    rentNow(s, 'p100', 100);
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, api: 0, subs: 0 };
    const perDay = 100 * 0.0214 * TRAIN_FLOP_PER_H100E_DAY;
    s.trainings = [run(perDay * 100, perDay * 50)];
    expect(botChoice(s, 'training-fail')).toBe(0);
  });

  it('откат не успевает до конца игры - продолжить (вариант 1)', () => {
    const s = newGame('Бот', 1);
    rentNow(s, 'p100', 100);
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, api: 0, subs: 0 };
    const perDay = 100 * 0.0214 * TRAIN_FLOP_PER_H100E_DAY;
    s.day = END_DAY - 60;
    // Остаток 50 дней плюс откат 25 % от 100 дней - 75 дней, а до конца 57.
    s.trainings = [run(perDay * 100, perDay * 50)];
    expect(FAIL_ROLLBACK).toBe(0.25);
    expect(botChoice(s, 'training-fail')).toBe(1);
  });

  it('решение принимается по проекту с failed, а не по первому в списке', () => {
    const s = newGame('Бот', 1);
    rentNow(s, 'p100', 100);
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, api: 0, subs: 0 };
    const perDay = 100 * 0.0214 * TRAIN_FLOP_PER_H100E_DAY;
    s.day = END_DAY - 60;
    // Первый проект почти готов (без срыва), второй сорван и до конца не успеет после отката: «Продолжить».
    s.trainings = [{ ...run(perDay * 10, perDay * 9, false), id: 't1' }, { ...run(perDay * 200, perDay * 100), id: 't2' }];
    expect(botChoice(s, 'training-fail')).toBe(1);
    s.trainings[1].failed = false;
    expect(botChoice(s, 'training-fail')).toBe(0); // ни один проект не ждёт решения
  });
});

describe('pickChoice', () => {
  it('first - первый вариант, last - последний, bot - как botChoice (письмо с тремя вариантами)', () => {
    const ev = EXTRA_EVENTS.find((e) => e.choices?.length === 3);
    expect(ev).toBeDefined();
    const s = newGame('Бот', 1);
    const mail: Mail = {
      id: 'm1',
      day: 0,
      title: 'Письмо',
      body: '',
      kind: 'event',
      read: false,
      eventId: ev!.id,
      choices: [0, 1, 2].map((i) => ({ label: `Вариант ${i}`, hint: '' })),
    };
    expect(pickChoice(s, mail, 'first')).toBe(0);
    expect(pickChoice(s, mail, 'last')).toBe(2);
    expect(pickChoice(s, mail, 'bot')).toBe(botChoice(s, ev!.id));
    expect(pickChoice(s, mail)).toBe(botChoice(s, ev!.id));
  });
});

describe('тендеры бота', () => {
  it('без мощности заявок нет, с мощностью - подаются в рамках половины пула', () => {
    const s = newGame('Бот', 1);
    s.day = 100;
    botAct(s, 'reasonable');
    expect(orderedCount(s, 'p100')).toBeGreaterThan(0); // заказано, карты едут
    s.day += 30;
    computeDay(s);
    botAct(s, 'reasonable');
    expect(s.compute.rented.p100).toBeGreaterThan(0);
    const alloc = s.compute.alloc;
    expect(alloc.contracts).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(alloc.training + alloc.contracts + alloc.experiments + alloc.api + alloc.subs).toBeCloseTo(1, 9);
  });
});

/** Выпущенная модель бота в продаже по API. */
function apiModel(id: string, price: number): PlayerModel {
  return {
    id,
    name: `Бот-${id}`,
    plan: { name: id, paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 }, benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'mid' },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 0,
    releasedDay: 0,
    caps: { language: 60, code: 60, reasoning: 60 },
    overfit: {},
    rlhf: false,
    arenaElo: 1000,
    price,
    onApi: true,
    exposed: false,
    earned: 0,
    onSubs: false,
    subsPrice: 20,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
  };
}

function monthRecord(month: number, marketShare: number): MonthRecord {
  return { ...emptyLedger(), year: 2017, month, cashEnd: 1e6, marketShare, tokensPerDay: 1e9, subscribers: 0 };
}

/** Игра в первую неделю марта 2017 с моделью на API и двумя закрытыми месяцами: доля упала с before до now. */
function afterDrop(before: number, now: number, price = 10): GameState {
  const s = newGame('Бот', 1);
  s.day = dateToDay('2017-03-02');
  s.models.push(apiModel('p1', price));
  s.finance.history.push(monthRecord(1, before), monthRecord(2, now));
  return s;
}

describe('рефлекс цен бота (botPriceReflex в botAct)', () => {
  it('доля за месяц упала на четверть и больше - цены моделей на API ×0,85', () => {
    const s = afterDrop(0.4, 0.2);
    botAct(s, 'reasonable');
    expect(s.models[0].price).toBeCloseTo(8.5, 9);
  });

  it('доля упала меньше чем на четверть или выросла - цены прежние', () => {
    const s = afterDrop(0.4, 0.35);
    botAct(s, 'reasonable');
    expect(s.models[0].price).toBe(10);
    const t = afterDrop(0.2, 0.4);
    botAct(t, 'reasonable');
    expect(t.models[0].price).toBe(10);
  });

  it('только в первую неделю месяца, только при двух закрытых месяцах, не ниже 2 × minPrice', () => {
    const late = afterDrop(0.4, 0.2);
    late.day = dateToDay('2017-03-15');
    expect(botPriceReflex(late)).toBe(false);
    expect(late.models[0].price).toBe(10);

    const fresh = newGame('Бот', 1);
    fresh.models.push(apiModel('p1', 10));
    fresh.finance.history.push(monthRecord(1, 0.2));
    expect(botPriceReflex(fresh)).toBe(false);

    const floor = 2 * minPrice(dateToDay('2017-03-02'));
    const cheap = afterDrop(0.4, 0.2, floor * 1.05);
    expect(botPriceReflex(cheap)).toBe(true);
    expect(cheap.models[0].price).toBeCloseTo(floor, 9);
    expect(botPriceReflex(cheap)).toBe(false); // ниже границы не опускается
  });

  it('«ничего» не делает ничего, в том числе не трогает цены', () => {
    const s = afterDrop(0.4, 0.2);
    botAct(s, 'idle');
    expect(s.models[0].price).toBe(10);
  });

  it('цена подписки моделей с onSubs × 0,9, не ниже $5; без подписки не трогается', () => {
    const s = afterDrop(0.4, 0.2);
    s.models[0].onSubs = true;
    s.models[0].subsPrice = 20;
    s.models.push({ ...apiModel('p2', 10), onSubs: false, subsPrice: 20 });
    expect(botPriceReflex(s)).toBe(true);
    expect(s.models[0].subsPrice).toBeCloseTo(18, 9);
    expect(s.models[1].subsPrice).toBe(20);
    s.models[0].subsPrice = 5.2;
    s.models[0].price = 10;
    expect(botPriceReflex(s)).toBe(true);
    expect(s.models[0].subsPrice).toBe(5);
    for (const m of s.models) m.price = 2 * minPrice(s.day);
    expect(botPriceReflex(s)).toBe(false); // ниже $5 и 2 × minPrice не опускается
    expect(s.models[0].subsPrice).toBe(5);
  });
});

describe('бот и рынок v2', () => {
  it('план по Шиншилле несёт уровень, совпадающий с размером на день', () => {
    const s = newGame('Бот', 1);
    for (const date of ['2017-03-01', '2020-06-11', '2024-06-01']) {
      s.day = dateToDay(date);
      for (const budget of [1e19, 1e22, 1e25]) {
        const plan = chinchillaPlan(s, budget, 'Бот-1', 0);
        expect(plan.tier, `${date}:${budget}`).toBe(tierOf(plan.paramsB, s.day));
      }
    }
  });

  it('доли «API» и «Подписки»: каждая не больше 0,5, вместе не больше 0,7; сумма долей 1', () => {
    const s = newGame('Бот', 1);
    s.day = dateToDay('2024-06-01');
    s.rivalsReleased = ['gtp-4-turbu'];
    rentNow(s, 'h100', 10);
    // Две модели в продаже по обоим каналам с огромным спросом: нужно мощности больше, чем есть.
    s.models.push({ ...apiModel('p1', 0.1), arenaElo: 1400, onSubs: true }, { ...apiModel('p2', 0.1), arenaElo: 1390, onSubs: true });
    botAct(s, 'reasonable');
    // Заказанные ботом карты приходят через поставку: доли считаются уже по пришедшей мощности.
    for (const o of s.compute.incoming ?? []) o.arriveDay = s.day;
    computeDay(s);
    botAct(s, 'reasonable');
    const a = s.compute.alloc;
    expect(a.api).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(a.subs).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(a.api + a.subs).toBeLessThanOrEqual(0.7 + 1e-9);
    expect(a.api).toBeGreaterThan(0.49); // спрос API в токенах много больше чата: канал упирается в потолок
    expect(a.subs).toBeGreaterThan(0);
    expect(a.training + a.contracts + a.experiments + a.api + a.subs).toBeCloseTo(1, 9);
    // Оба канала с огромным спросом: вместе не больше 0,7, урезаны пропорционально.
    s.models[0].plan.paramsB = 2000;
    s.models[1].plan.paramsB = 2000;
    botAct(s, 'reasonable');
    const b = s.compute.alloc;
    expect(b.api + b.subs).toBeCloseTo(0.7, 6);
    expect(b.api).toBeCloseTo(0.35, 6); // оба канала упёрлись в 0,5 и урезаны поровну
    expect(b.subs).toBeCloseTo(0.35, 6);
  });

  it('после 30.11.2022 бот включает подписку у лучших моделей, остальные - без каналов', () => {
    const { state: s } = runBot('reasonable', 2, dateToDay('2023-09-01'));
    expect(s.outcome).toBeNull();
    const released = s.models.filter((m) => m.releasedDay !== null);
    expect(released.length).toBeGreaterThan(0);
    const onSubs = released.filter((m) => m.onSubs);
    const waiting = released.filter((m) => m.review === 'required' || m.review === 'pending');
    expect(onSubs.length + waiting.length).toBeGreaterThan(0);
    for (const m of onSubs) expect(m.onApi).toBe(true);
    expect(released.filter((m) => m.onApi).length).toBeLessThanOrEqual(2);
    expect(s.compute.alloc.subs).toBeGreaterThan(0);
  });
});

// Боты «как игрок» (QA 19.10): уязвимости, ред-тиминг, отзывы, совет директоров - то, что видит человек. Замер 19.10 на
// Обычной (зёрна 1-5, карты 2017-2018 годов сразу): разумный 4, 5, 10, 6, 6-е место (без систем - 3-4-е), сильный 1-2-е,
// все доходят до конца. Опора: игра доходит до конца, системы работают, разумный не ниже 10-го места.
describe('боты с системами игрока', () => {
  it('разумный: партия до конца, ред-тиминг перед выпуском, место не ниже 10-го', () => {
    for (const seed of [2, 3, 5]) {
      const { state: s } = runBot('reasonable', seed, 4000, 'normal', { playerSystems: true });
      expect(s.outcome === 'finished' || s.outcome === 'victory').toBe(true);
      expect(s.models.some((m) => m.redTeamDone)).toBe(true);
      expect(s.models.every((m) => m.holes !== undefined)).toBe(true); // план как из окна игры: у моделей есть уязвимости
      expect(s.finance.history.at(-1)!.placeEnd!).toBeLessThanOrEqual(10);
    }
  }, 60_000);

  it('сильный: доля у инвесторов - у партии есть совет директоров', () => {
    const { state: s } = runBot('strong', 1, 4000, 'normal', { playerSystems: true });
    expect(s.founderShare).toBeLessThan(0.5);
    expect(s.board).toBeDefined();
    expect(s.outcome === 'finished' || s.outcome === 'victory').toBe(true);
  }, 60_000);
});

describe('runBot и сложность', () => {
  it('по умолчанию Обычная; сложность передаётся в newGame вместе с её модификаторами', () => {
    expect(runBot('idle', 1, 3).state.difficulty).toBe('normal');
    const hard = runBot('idle', 1, 3, 'hard').state;
    expect(hard.difficulty).toBe('hard');
    expect(hard.modifiers.map((m) => m.id).sort()).toEqual(['difficulty-exposure', 'difficulty-rent']);
  });

  it('запас денег: «сильный» на Сложной (зерно 2) не банкротится в 2017-2018 годах', () => {
    // Без запаса бот проедал арендой разовую оплату контракта и при аренде ×1,1 банкротился 19.12.2017.
    const { state: s, days } = runBot('strong', 2, 500, 'hard');
    expect(s.outcome).not.toBe('bankrupt');
    expect(days).toBe(500);
    expect(s.day).toBeGreaterThan(dateToDay('2018-05-01'));
    // Касса ни в один конец месяца не уходила в минус.
    expect(s.finance.history.every((h) => h.cashEnd >= 0)).toBe(true);
  });
});

describe('исследования бота', () => {
  it('новые технологии - после исторической даты, по порядку; раньше даты - алгоритмы', () => {
    const s = newGame('Бот', 1);
    s.research.done = ['attention', 'scaling', 'rlhf'];
    s.research.algoLevel = 5;
    s.research.contextLevel = 7;
    s.research.done.push('context');
    s.day = dateToDay('2019-10-01');
    expect(nextTech(s)).toBe('algo');
    s.day = dateToDay('2019-10-02');
    expect(nextTech(s)).toBe('distill');
    s.research.done.push('distill');
    s.day = dateToDay('2021-09-03');
    expect(nextTech(s)).toBe('moe');
    s.research.done.push('moe', 'codetrain');
    expect(nextTech(s)).toBe('instruct');
    s.research.done.push('instruct');
    expect(nextTech(s)).toBe('algo'); // «Цепочки рассуждений» - только с 28.01.2022
    s.day = dateToDay('2023-07-01');
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      const t = nextTech(s);
      if (t === 'algo') break;
      order.push(t);
      s.research.done.push(t);
    }
    expect(order).toEqual(['cot', 'quant', 'multimodal', 'synthetic']);
  });
});
