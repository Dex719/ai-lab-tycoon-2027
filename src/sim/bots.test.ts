// Боты: выбор при срыве обучения и заявки на тендеры по мощности.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { botAct, botChoice } from './bots';
import { setRent } from './compute';
import { FAIL_ROLLBACK, TRAIN_FLOP_PER_H100E_DAY } from './constants';
import { END_DAY } from './time';
import type { TrainingRun } from './types';

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
