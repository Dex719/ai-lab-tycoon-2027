// Общие подписи: статьи доходов и расходов, каналы продажи и пометка внешней проверки модели.

import { describe, expect, it } from 'vitest';
import { dateToDay } from '../sim/time';
import type { PlayerModel } from '../sim/types';
import { EXPENSE_KINDS, EXPENSE_LABELS, INCOME_KINDS, INCOME_LABELS, modelChannels, reviewNote } from './labels';

const model = (over: Partial<PlayerModel>): PlayerModel => over as PlayerModel;

describe('статьи', () => {
  it('у каждой статьи есть подпись, среди доходов - «Подписки», среди расходов - «Проверки»', () => {
    for (const k of INCOME_KINDS) expect(INCOME_LABELS[k].length).toBeGreaterThan(0);
    for (const k of EXPENSE_KINDS) expect(EXPENSE_LABELS[k].length).toBeGreaterThan(0);
    expect(INCOME_LABELS.subs).toBe('Подписки');
    expect(EXPENSE_LABELS.review).toBe('Проверки');
    expect(INCOME_KINDS).toContain('subs');
    expect(EXPENSE_KINDS).toContain('review');
  });
});

describe('modelChannels', () => {
  it('API, подписка, оба канала, ни одного', () => {
    expect(modelChannels(model({ onApi: true, onSubs: false }), true)).toBe('API');
    expect(modelChannels(model({ onApi: false, onSubs: true }), true)).toBe('Подписка');
    expect(modelChannels(model({ onApi: true, onSubs: true }), true)).toBe('API, подписка');
    expect(modelChannels(model({ onApi: false, onSubs: false }), true)).toBeNull();
  });

  it('пока подписки закрыты, канал подписки не показывается', () => {
    expect(modelChannels(model({ onApi: true, onSubs: true }), false)).toBe('API');
    expect(modelChannels(model({ onApi: false, onSubs: true }), false)).toBeNull();
  });
});

describe('reviewNote', () => {
  it('нужна проверка - предупреждение, идёт - срок с датой, остальное - без пометки', () => {
    expect(reviewNote(model({ review: 'required' }))).toEqual({ text: 'Нужна проверка', tone: 'warn' });
    const end = dateToDay('2023-03-05');
    expect(reviewNote(model({ review: 'pending', reviewEndDay: end }))).toEqual({ text: 'Проверка до 05.03.2023', tone: 'info' });
    expect(reviewNote(model({ review: 'pending', reviewEndDay: null }))).toEqual({ text: 'Идёт проверка', tone: 'info' });
    expect(reviewNote(model({ review: 'passed' }))).toBeNull();
    expect(reviewNote(model({ review: 'none' }))).toBeNull();
  });
});
