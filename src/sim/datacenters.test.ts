import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH } from './constants';
import { DC_GPU_KW, DC_MONTH_DAYS, DC_UPKEEP_PER_MW_MONTH, dcSite } from '../data/datacenters';
import { newGame } from './actions';
import { runBot } from './bots';
import { ownedH100e, rentedH100e, rentPerGpuDay, totalH100e } from './compute';
import {
  buildCost,
  buildDatacenter,
  buildMonths,
  buyDcGpus,
  datacentersDay,
  dcCostPerDay,
  dcReady,
  deliveryDays,
  expectedReadyDay,
  findDc,
  freeSlots,
  gpuBuyPrice,
  gpusPerMw,
  resaleFactor,
  resalePrice,
  sellDcGpus,
  writeOffDcGpus,
} from './datacenters';
import { serialize, deserialize } from './save';
import { advanceDay } from './tick';
import { dateToDay } from './time';
import type { GameState } from './types';

/** Игра на дату с деньгами; дата-центры уже открыты. */
function gameOn(date: string, cash = 1e9): GameState {
  const s = newGame('ДЦ', 11);
  s.day = dateToDay(date);
  s.cash = cash;
  datacentersDay(s);
  return s;
}

/** Прожить дни без писем с выбором (их решаем первым вариантом). */
function live(s: GameState, days: number): void {
  for (let i = 0; i < days; i++) {
    const pending = s.mail.find((m) => m.choices && m.chosen === undefined);
    if (pending) pending.chosen = 0;
    advanceDay(s);
  }
}

describe('открытие дата-центров', () => {
  it('в начале игры закрыты, стройка недоступна', () => {
    const s = newGame('ДЦ', 1);
    datacentersDay(s);
    expect(s.datacenters.unlockedDay).toBeNull();
    expect(buildDatacenter(s, 'abilene', 5)).toEqual({ ok: false, error: 'Дата-центры пока недоступны' });
  });

  it('открываются с 2021 года письмом, без даты в тексте', () => {
    const s = newGame('ДЦ', 1);
    s.day = dateToDay('2020-12-31');
    datacentersDay(s);
    expect(s.datacenters.unlockedDay).toBeNull();
    s.day += 1;
    datacentersDay(s);
    expect(s.datacenters.unlockedDay).toBe(s.day);
    const mail = s.mail.at(-1)!;
    expect(mail.title).toBe('Свои дата-центры');
    expect(mail.body).not.toMatch(/20\d\d/);
    expect(mail.body).not.toMatch(new RegExp('[\\u2013\\u2014]'));
  });

  it('открываются раньше, если на счету от $50 млн', () => {
    const s = newGame('ДЦ', 1);
    s.day = dateToDay('2019-05-01');
    s.cash = 60e6;
    datacentersDay(s);
    expect(s.datacenters.unlockedDay).toBe(s.day);
  });

  it('без построек тик не трогает генератор случайных чисел', () => {
    const s = gameOn('2022-01-01');
    const rng = s.rng;
    for (let i = 0; i < 50; i++) datacentersDay(s);
    expect(s.rng).toBe(rng);
  });
});

describe('стройка', () => {
  it('ошибки одной фразой: денег мало, размер не из списка, площадка занята', () => {
    const s = gameOn('2022-01-01', 1e6);
    expect(buildDatacenter(s, 'abilene', 5)).toEqual({ ok: false, error: 'Не хватает денег на стройку' });
    s.cash = 1e10;
    expect(buildDatacenter(s, 'abilene', 7)).toEqual({ ok: false, error: 'Такой мощности нет в списке' });
    expect(buildDatacenter(s, 'abilene', 5).ok).toBe(true);
    expect(buildDatacenter(s, 'abilene', 20)).toEqual({ ok: false, error: 'На этой площадке уже есть дата-центр' });
  });

  it('стоимость списывается сразу в статью «Дата-центры»: 5 МВт в Абилине в 2022 году - $40,5 млн', () => {
    const s = gameOn('2022-03-01');
    const before = s.cash;
    expect(buildCost(s, 'abilene', 5)).toBeCloseTo(9e6 * 0.9 * 5, 0);
    expect(buildDatacenter(s, 'abilene', 5).ok).toBe(true);
    expect(before - s.cash).toBeCloseTo(40.5e6, 0);
    expect(s.finance.month.expense.capex).toBeCloseTo(40.5e6, 0);
  });

  it('сроки без задержек - от 6 до 19 месяцев', () => {
    expect(buildMonths('abilene', 5)).toBe(6);
    expect(buildMonths('quincy', 5)).toBe(17);
    expect(buildMonths('quincy', 100)).toBe(19);
    for (const site of ['abilene', 'ashburn', 'lulea', 'quincy'] as const) {
      expect(buildMonths(site, 5)).toBeGreaterThanOrEqual(6);
      expect(buildMonths(site, 20)).toBeLessThanOrEqual(18);
    }
  });

  it('этапы идут по очереди, готовый дата-центр присылает важное письмо; задержки - только в пределах 1-2 месяцев на этап', () => {
    const s = gameOn('2022-01-01');
    expect(buildDatacenter(s, 'abilene', 5).ok).toBe(true);
    const dc = findDc(s, 'abilene')!;
    const base = buildMonths('abilene', 5) * DC_MONTH_DAYS;
    expect(expectedReadyDay(dc)).toBeGreaterThanOrEqual(s.day + base);
    const start = s.day;
    let days = 0;
    while (!dcReady(dc) && days < 800) {
      live(s, 1);
      days++;
    }
    expect(dcReady(dc)).toBe(true);
    expect(dc.stageEndDay - start).toBeGreaterThanOrEqual(base);
    expect(dc.stageEndDay - start).toBeLessThanOrEqual(base + 4 * 2 * DC_MONTH_DAYS + 1);
    expect(dc.delayDays).toBe(dc.stageEndDay - start - base);
    expect(s.mail.some((m) => m.title === 'Дата-центр в Абилине готов' && m.important)).toBe(true);
    // Пустой готовый дата-центр стоит обслуживание: $40 тыс. за МВт в месяц.
    expect(dcCostPerDay(s)).toBeCloseTo((5 * DC_UPKEEP_PER_MW_MONTH) / DAYS_PER_MONTH, 6);
  });
});

/** Готовый дата-центр на площадке (стройка «промотана»). */
function readyDc(s: GameState, site: 'abilene' | 'quincy' = 'abilene', mw = 5) {
  expect(buildDatacenter(s, site, mw).ok).toBe(true);
  const dc = findDc(s, site)!;
  dc.stage = 4;
  dc.stageDelay = 0;
  dc.stageEndDay = s.day;
  return dc;
}

describe('карты в своём дата-центре', () => {
  it('в строящийся дата-центр карты не покупаются; будущие карты - тоже', () => {
    const s = gameOn('2022-01-01');
    expect(buildDatacenter(s, 'abilene', 5).ok).toBe(true);
    expect(buyDcGpus(s, 'abilene', 'a100', 10)).toEqual({ ok: false, error: 'Дата-центр ещё строится' });
    const dc = findDc(s, 'abilene')!;
    dc.stage = 4;
    expect(buyDcGpus(s, 'abilene', 'h100', 10)).toEqual({ ok: false, error: 'Эта карта ещё не вышла' });
    expect(buyDcGpus(s, 'abilene', 'a100', 0).ok).toBe(false);
  });

  it('вместимость по МВт и PUE: 1 МВт в Абилине - 595 H100, в Куинси - 694', () => {
    expect(gpusPerMw('abilene', 'h100')).toBe(Math.floor(1000 / (DC_GPU_KW.h100 * dcSite('abilene').pue)));
    expect(gpusPerMw('abilene', 'h100')).toBe(595);
    expect(gpusPerMw('quincy', 'h100')).toBe(694);
    const s = gameOn('2024-01-01');
    const dc = readyDc(s);
    expect(freeSlots(dc, 'h100')).toBe(2976);
    expect(buyDcGpus(s, 'abilene', 'h100', 2977)).toEqual({ ok: false, error: 'Столько карт не помещается в дата-центр' });
  });

  it('покупка: деньги сразу, карты приходят через срок доставки и добавляются к мощности', () => {
    const s = gameOn('2024-01-01');
    readyDc(s);
    const rentBefore = rentedH100e(s);
    const cash = s.cash;
    expect(buyDcGpus(s, 'abilene', 'h100', 1000).ok).toBe(true);
    expect(cash - s.cash).toBeCloseTo(1000 * gpuBuyPrice(s, 'h100'), 0);
    expect(ownedH100e(s)).toBe(0);
    const wait = deliveryDays(s);
    expect(wait).toBe(60);
    // Заказ занимает место сразу.
    expect(freeSlots(findDc(s, 'abilene')!, 'h100')).toBe(1976);
    for (let i = 0; i < wait; i++) datacentersDay(Object.assign(s, { day: s.day + 1 }));
    expect(ownedH100e(s)).toBe(1000);
    expect(totalH100e(s)).toBe(rentBefore + 1000);
    expect(s.mail.some((m) => m.title === 'Карты доставлены в Абилине')).toBe(true);
    expect(s.finance.month.expense.power).toBeGreaterThan(0);
  });

  it('денег не хватает - ошибка, деньги не тратятся', () => {
    const s = gameOn('2024-01-01');
    readyDc(s);
    s.cash = 100_000;
    expect(buyDcGpus(s, 'abilene', 'h100', 10)).toEqual({ ok: false, error: 'Не хватает денег на карты' });
    expect(s.cash).toBe(100_000);
  });

  it('списание освобождает место без возврата денег', () => {
    const s = gameOn('2024-01-01');
    const dc = readyDc(s);
    dc.gpus.a100 = 500;
    const cash = s.cash;
    expect(writeOffDcGpus(s, 'abilene', 'a100', 600).ok).toBe(false);
    expect(writeOffDcGpus(s, 'abilene', 'a100', 500).ok).toBe(true);
    expect(dc.gpus.a100).toBe(0);
    expect(s.cash).toBe(cash);
  });

  it('продажа старых карт: цена падает с возрастом и новыми поколениями, деньги приходят сразу', () => {
    const s = gameOn('2021-06-01');
    const dc = readyDc(s);
    dc.gpus.v100 = 100;
    const f0 = resaleFactor(s, 'v100'); // V100 вышла в октябре 2017: возраст 3 года, новее есть A100
    expect(f0).toBeCloseTo(0.1, 5); // 0,6 - 0,6 - 0,05 -> не меньше 10 %
    const fresh = gameOn('2024-07-01');
    expect(resaleFactor(fresh, 'h200')).toBeCloseTo(0.6, 5);
    expect(resaleFactor(fresh, 'h100')).toBeCloseTo(0.6 - 0.2 - 0.05, 5);
    const cash = s.cash;
    const capex = s.finance.month.expense.capex;
    const amount = 40 * resalePrice(s, 'v100');
    expect(sellDcGpus(s, 'abilene', 'v100', 101).ok).toBe(false);
    expect(sellDcGpus(s, 'abilene', 'v100', 40).ok).toBe(true);
    expect(dc.gpus.v100).toBe(60);
    expect(s.cash).toBeCloseTo(cash + amount, 3);
    expect(s.finance.month.expense.capex).toBeCloseTo(capex - amount, 3);
  });

  it('своя H100 в 2024 году дешевле аренды в месяц и окупается за 1-3 года', () => {
    const s = gameOn('2024-01-01');
    const perMw = gpusPerMw('abilene', 'h100');
    const dc = readyDc(s, 'abilene', 5);
    dc.gpus.h100 = perMw * 5; // полный дата-центр
    const rentMonth = rentPerGpuDay(s, 'h100') * 30;
    const ownMonth = (dcCostPerDay(s) * 30) / dc.gpus.h100; // электричество и обслуживание на карту
    expect(ownMonth).toBeLessThan(rentMonth / 10);
    const capex = gpuBuyPrice(s, 'h100') + buildCost(s, 'abilene', 1) / perMw;
    const payback = capex / (rentMonth - ownMonth);
    expect(payback).toBeGreaterThan(12);
    expect(payback).toBeLessThan(36);
  });
});

describe('сохранения с дата-центрами', () => {
  it('стройка и заказы переживают сохранение и загрузку', () => {
    const s = gameOn('2024-01-01');
    readyDc(s);
    expect(buyDcGpus(s, 'abilene', 'h100', 100).ok).toBe(true);
    expect(buildDatacenter(s, 'quincy', 20).ok).toBe(true);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.datacenters).toEqual(s.datacenters);
  });

  it('старое сохранение без дата-центров загружается: построек нет, статьи расходов - нули', () => {
    const s = newGame('Старое', 5);
    live(s, 40);
    const o = JSON.parse(serialize(s));
    delete o.datacenters;
    delete o.finance.month.expense.capex;
    delete o.finance.month.expense.power;
    for (const h of o.finance.history) {
      delete h.expense.capex;
      delete h.expense.power;
    }
    const r = deserialize(JSON.stringify(o));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.datacenters).toEqual({ unlockedDay: null, list: [] });
    expect(r.state.finance.month.expense.capex).toBe(0);
  });

  it('битый дата-центр отклоняется', () => {
    const s = gameOn('2024-01-01');
    readyDc(s);
    const o = JSON.parse(serialize(s));
    o.datacenters.list[0].site = 'mars';
    expect(deserialize(JSON.stringify(o)).ok).toBe(false);
  });
});

describe('дата-центры у ботов', () => {
  it('сильный бот строит один дата-центр в 2022-2023 годах и заполняет его картами', () => {
    const { state: s } = runBot('strong', 1);
    expect(s.datacenters.list.length).toBe(1);
    const dc = s.datacenters.list[0];
    expect(dc.startedDay).toBeGreaterThanOrEqual(dateToDay('2022-01-01'));
    expect(dc.startedDay).toBeLessThanOrEqual(dateToDay('2023-12-31'));
    expect(dcReady(dc)).toBe(true);
    expect(ownedH100e(s)).toBeGreaterThan(0);
  });
});
