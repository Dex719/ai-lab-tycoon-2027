// Вкладка «Лаборатории»: модели, которые соперник только показал (announcedOnly), не считаются выпущенными.

import { describe, expect, it } from 'vitest';
import { RIVAL_MODELS } from '../../data/rivalModels';
import { createInitialState } from '../../sim/state';
import { dateToDay } from '../../sim/time';
import { labRows } from './MarketWindow';

const byId = (id: string) => RIVAL_MODELS.find((m) => m.id === id)!;

describe('labRows', () => {
  it('только показанная модель не попадает ни в счётчик, ни в «последнюю модель», ни в дату первой', () => {
    const gtp3 = byId('gtp-3');
    const paln = byId('paln');
    expect(gtp3.announcedOnly).toBeFalsy();
    expect(paln.announcedOnly).toBe(true);

    const s = createInitialState('Тест', 1);
    s.day = dateToDay('2022-06-01');
    s.rivalsReleased = [gtp3.id, paln.id];

    const rows = labRows(s);
    const openbrain = rows.find((r) => r.owner === gtp3.lab)!;
    const gogle = rows.find((r) => r.owner === paln.lab)!;

    expect(openbrain.count).toBe(1);
    expect(openbrain.lastName).toBe(gtp3.gameName);
    expect(openbrain.since).toBe(dateToDay(gtp3.released));

    expect(gogle.count).toBe(0);
    expect(gogle.lastName).toBeNull();
    expect(gogle.since).toBeNull();
  });

  it('выпущенная модель той же лаборатории считается, показанная рядом с ней - нет', () => {
    const paln = byId('paln');
    const released = RIVAL_MODELS.find((m) => m.lab === paln.lab && !m.announcedOnly)!;

    const s = createInitialState('Тест', 1);
    s.day = dateToDay('2024-01-01');
    s.rivalsReleased = [paln.id, released.id];

    const gogle = labRows(s).find((r) => r.owner === paln.lab)!;
    expect(gogle.count).toBe(1);
    expect(gogle.lastName).toBe(released.gameName);
    expect(gogle.since).toBe(dateToDay(released.released));
  });
});
