import { describe, expect, it } from 'vitest';
import { DC_STAGES } from '../../data/datacenters';
import { buildDatacenter } from '../../sim/datacenters';
import { newGame } from '../../sim/actions';
import { dateToDay } from '../../sim/time';
import { campusSpec, CARDS_PER_RACK, farmLayout, rentedFarm, specKey } from './specs';

describe('farmLayout', () => {
  it('раскладывает карты по стойкам: 32 карты на стойку, неполная стойка последней', () => {
    const l = farmLayout([{ gpu: 'p100', cards: 96 }]);
    expect(l.racks).toHaveLength(3);
    expect(l.racks.every((r) => r.servers === 4)).toBe(true);
    expect(l.scale).toBe(1);
    const part = farmLayout([{ gpu: 'v100', cards: 40 }]);
    expect(part.racks.map((r) => r.servers)).toEqual([4, 1]);
    expect(part.totalRacks).toBe(2);
  });

  it('несколько поколений идут по порядку групп, пустые группы пропускаются', () => {
    const l = farmLayout([
      { gpu: 'a100', cards: 64 },
      { gpu: 'p100', cards: 0 },
      { gpu: 'v100', cards: 10 },
    ]);
    expect(l.racks.map((r) => r.gpu)).toEqual(['a100', 'a100', 'v100']);
    expect(l.cards).toBe(74);
  });

  it('большая ферма рисуется в масштабе: стоек на схеме не больше предела', () => {
    const l = farmLayout([{ gpu: 'h100', cards: 400 * CARDS_PER_RACK * 3 }], 400);
    expect(l.scale).toBe(3);
    expect(l.racks.length).toBeLessThanOrEqual(400);
    expect(l.totalRacks).toBe(1200);
  });

  it('ферма без карт - пустая', () => {
    expect(farmLayout([]).racks).toHaveLength(0);
  });
});

describe('rentedFarm', () => {
  it('берёт арендованные карты, новые поколения первыми', () => {
    const s = newGame('Тест', 1);
    s.compute.rented.p100 = 100;
    s.compute.rented.v100 = 50;
    expect(rentedFarm(s).groups.map((g) => g.gpu)).toEqual(['v100', 'p100']);
  });
});

describe('campusSpec', () => {
  it('свободная площадка без стройки', () => {
    const s = newGame('Тест', 1);
    const c = campusSpec(s, 'lulea');
    expect(c.mw).toBeNull();
    expect(c.fill).toBe(0);
  });

  it('стройка: этап и прогресс шагами по 0,1, ключ сцены меняется не каждый день', () => {
    const s = newGame('Тест', 1);
    s.day = dateToDay('2021-03-01');
    s.datacenters.unlockedDay = s.day;
    s.cash = 1e9;
    expect(buildDatacenter(s, 'quincy', 20).ok).toBe(true);
    const a = campusSpec(s, 'quincy');
    expect(a.mw).toBe(20);
    expect(a.stage).toBe(0);
    expect(a.progress * 10).toBe(Math.round(a.progress * 10));
    s.day += 1;
    expect(specKey(campusSpec(s, 'quincy'))).toBe(specKey(a));
  });

  it('готовый дата-центр: заполнение по стоящим картам, грузовики по заказам в пути', () => {
    const s = newGame('Тест', 1);
    s.day = dateToDay('2023-06-01');
    s.datacenters.unlockedDay = s.day;
    s.cash = 1e10;
    buildDatacenter(s, 'lulea', 5);
    const dc = s.datacenters.list[0];
    dc.stage = DC_STAGES;
    dc.gpus.h100 = 1000;
    dc.orders = [{ gpu: 'h100', count: 10, arriveDay: s.day + 30 }];
    const c = campusSpec(s, 'lulea');
    expect(c.stage).toBe(DC_STAGES);
    expect(c.fill).toBeGreaterThan(0.2);
    expect(c.fill).toBeLessThanOrEqual(1);
    expect(c.trucks).toBe(1);
    expect(c.mix).toEqual([{ gpu: 'h100', cards: 1000 }]);
  });
});
