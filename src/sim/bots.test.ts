// Боты: выбор при срыве обучения и заявки на тендеры по мощности.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { botAct, botChoice, runBot } from './bots';
import { setRent } from './compute';
import { FAIL_ROLLBACK, TRAIN_FLOP_PER_H100E_DAY } from './constants';
import { minPrice } from './market';
import { botPriceReflex } from './rivalry';
import { emptyLedger } from './state';
import { dateToDay, END_DAY } from './time';
import type { GameState, MonthRecord, PlayerModel, TrainingRun } from './types';

function run(flopTotal: number, flopDone: number): TrainingRun {
  return {
    plan: { name: 'М', paramsB: 1, tokensB: 20, mix: { language: 1, code: 0, reasoning: 0 }, benchShare: 0, benchTargets: [], rlhf: false, context: 512 },
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
    setRent(s, 'p100', 100);
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, inference: 0 };
    const perDay = 100 * 0.0214 * TRAIN_FLOP_PER_H100E_DAY;
    s.training = run(perDay * 100, perDay * 50);
    expect(botChoice(s, 'training-fail')).toBe(0);
  });

  it('откат не успевает до конца игры - продолжить (вариант 1)', () => {
    const s = newGame('Бот', 1);
    setRent(s, 'p100', 100);
    s.compute.alloc = { training: 1, contracts: 0, experiments: 0, inference: 0 };
    const perDay = 100 * 0.0214 * TRAIN_FLOP_PER_H100E_DAY;
    s.day = END_DAY - 60;
    // Остаток 50 дней плюс откат 25 % от 100 дней - 75 дней, а до конца 57.
    s.training = run(perDay * 100, perDay * 50);
    expect(FAIL_ROLLBACK).toBe(0.25);
    expect(botChoice(s, 'training-fail')).toBe(1);
  });
});

describe('тендеры бота', () => {
  it('без мощности заявок нет, с мощностью - подаются в рамках половины пула', () => {
    const s = newGame('Бот', 1);
    s.day = 100;
    botAct(s, 'reasonable');
    expect(s.compute.rented.p100).toBeGreaterThan(0);
    const alloc = s.compute.alloc;
    expect(alloc.contracts).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(alloc.training + alloc.contracts + alloc.experiments + alloc.inference).toBeCloseTo(1, 9);
  });
});

/** Выпущенная модель бота в продаже по API. */
function apiModel(id: string, price: number): PlayerModel {
  return {
    id,
    name: `Бот-${id}`,
    plan: { name: id, paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 }, benchShare: 0, benchTargets: [], rlhf: false, context: 512 },
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
  };
}

function monthRecord(month: number, marketShare: number): MonthRecord {
  return { ...emptyLedger(), year: 2017, month, cashEnd: 1e6, marketShare, tokensPerDay: 1e9 };
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
