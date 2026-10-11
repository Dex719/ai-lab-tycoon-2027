// «Модели»: состояние продажи в списке, статус проверки, границы цены API и цены подписки.

import { describe, expect, it } from 'vitest';
import { SUBS_PRICE_MAX, SUBS_PRICE_MIN } from '../../sim/constants';
import { minPrice } from '../../sim/market';
import { dateToDay, formatDateShort } from '../../sim/time';
import type { PlayerModel } from '../../sim/types';
import { parsePrice, parseSubsPrice, reviewState, saleState, versusMarket } from './ModelsWindow';

const norm = (t: string) => t.replace(/\s/g, ' ');

function model(patch: Partial<PlayerModel>): PlayerModel {
  return {
    id: 'p1',
    name: 'Тест',
    plan: {
      name: 'Тест',
      paramsB: 1,
      tokensB: 20,
      mix: { language: 1, code: 0, reasoning: 0 },
      benchShare: 0,
      benchTargets: [],
      rlhf: false,
      context: 512,
      tier: 'mid',
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 0,
    releasedDay: 10,
    caps: { language: 0, code: 0, reasoning: 0 },
    overfit: {},
    rlhf: false,
    arenaElo: 1000,
    price: 1,
    onApi: true,
    exposed: false,
    earned: 0,
    onSubs: false,
    subsPrice: 20,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
    ...patch,
  };
}

describe('saleState', () => {
  it('не выпущена - «Обучена»', () => {
    expect(saleState(model({ releasedDay: null, onApi: false }))).toEqual({ text: 'Обучена', tone: 'idle' });
  });

  it('каналы продаж названы в списке', () => {
    expect(saleState(model({ onApi: true, onSubs: false }))).toEqual({ text: 'В продаже: API', tone: 'sale' });
    expect(saleState(model({ onApi: false, onSubs: true }))).toEqual({ text: 'В продаже: подписка', tone: 'sale' });
    expect(saleState(model({ onApi: true, onSubs: true }))).toEqual({ text: 'В продаже: API, подписка', tone: 'sale' });
  });

  it('оба канала выключены - «Снята»', () => {
    expect(saleState(model({ onApi: false, onSubs: false }))).toEqual({ text: 'Снята', tone: 'off' });
  });
});

describe('reviewState', () => {
  it('проверка не требовалась - строки нет', () => {
    expect(reviewState(model({ review: 'none' }))).toBeNull();
  });

  it('нужна, идёт (с датой), пройдена', () => {
    expect(reviewState(model({ review: 'required' }))).toEqual({ text: 'Нужна проверка', tone: 'warn' });
    const end = dateToDay('2023-03-31');
    expect(reviewState(model({ review: 'pending', reviewEndDay: end }))).toEqual({
      text: `Проверка до ${formatDateShort(end)}`,
      tone: 'info',
    });
    expect(reviewState(model({ review: 'passed' }))).toEqual({ text: 'Проверка пройдена', tone: 'good' });
  });
});

describe('parseSubsPrice', () => {
  it('пустое поле - нет цены и нет ошибки', () => {
    expect(parseSubsPrice('  ')).toEqual({ price: null, error: null });
  });

  it('запятая как разделитель, округление до центов', () => {
    expect(parseSubsPrice('19,999').price).toBe(20);
    expect(parseSubsPrice('12.5').price).toBe(12.5);
  });

  it('границы цены подписки - как в симуляции', () => {
    expect(parseSubsPrice(String(SUBS_PRICE_MIN)).price).toBe(SUBS_PRICE_MIN);
    expect(parseSubsPrice(String(SUBS_PRICE_MAX)).price).toBe(SUBS_PRICE_MAX);
    expect(parseSubsPrice('0,5').price).toBeNull();
    expect(norm(parseSubsPrice(String(SUBS_PRICE_MAX + 1)).error ?? '')).toBe('Цена подписки - от $1 до $200 в месяц.');
    expect(parseSubsPrice('abc').error).toBe('Цена должна быть числом.');
  });
});

describe('parsePrice (API)', () => {
  const day = dateToDay('2022-01-01');

  it('нижняя граница - опорная цена / 100, верхняя - $10 000', () => {
    const min = minPrice(day);
    expect(parsePrice(String(min), day).price).toBe(min);
    expect(parsePrice(String(min / 2), day).price).toBeNull();
    expect(parsePrice(String(min / 2), day).error).toContain('не может быть ниже');
    expect(parsePrice('10000', day).price).toBe(10_000);
    expect(parsePrice('10001', day).error).toContain('не может быть выше');
  });

  it('запятая как разделитель, пустое поле без ошибки', () => {
    expect(parsePrice('2,5', day).price).toBe(2.5);
    expect(parsePrice('', day)).toEqual({ price: null, error: null });
  });
});

describe('versusMarket', () => {
  it('на уровне рынка, дороже, дешевле', () => {
    expect(versusMarket(10, 10)).toBe('На уровне рынка');
    expect(norm(versusMarket(15, 10))).toBe('+50 % к рынку');
    expect(norm(versusMarket(6, 10))).toBe('−40 % к рынку');
  });
});
