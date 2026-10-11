// Вкладка «Лаборатории»: модели, которые соперник только показал (announcedOnly), не считаются выпущенными;
// день выхода - с поправками ходов соперников; у соперников есть характер, настрой и последний ход;
// блок «Последние ходы» показывает не больше RECENT_MOVES строк, новые сверху.

import { describe, expect, it } from 'vitest';
import { personalityOf } from '../../data/labPersonalities';
import { RIVAL_MODELS } from '../../data/rivalModels';
import { RIVAL_REACTIVE } from '../../data/rivalReactive';
import { emptyRivalry, labStance, type HistoryRow } from '../../sim/rivalry';
import { createInitialState } from '../../sim/state';
import { dateToDay } from '../../sim/time';
import type { GameState, LabId } from '../../sim/types';
import { labRows, RECENT_MOVES, recentMoves } from './MarketWindow';

const byId = (id: string) => RIVAL_MODELS.find((m) => m.id === id)!;

/** Состояние на дату с пустым состоянием соперников (как game() в sim/rivalry.test.ts). */
function stateAt(date: string, released: string[] = []): GameState {
  const s = createInitialState('Тест', 1);
  s.rivalry = emptyRivalry();
  s.day = dateToDay(date);
  s.rivalsReleased = released;
  return s;
}

const row = (day: number, lab: LabId, text: string): HistoryRow => ({ day, lab, move: 'priceCut', text });

describe('labRows', () => {
  it('только показанная модель не попадает ни в счётчик, ни в «последнюю модель», ни в дату первой', () => {
    const gtp3 = byId('gtp-3');
    const paln = byId('paln');
    expect(gtp3.announcedOnly).toBeFalsy();
    expect(paln.announcedOnly).toBe(true);

    const rows = labRows(stateAt('2022-06-01', [gtp3.id, paln.id]));
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

    const gogle = labRows(stateAt('2024-01-01', [paln.id, released.id])).find((r) => r.owner === paln.lab)!;
    expect(gogle.count).toBe(1);
    expect(gogle.lastName).toBe(released.gameName);
    expect(gogle.since).toBe(dateToDay(released.released));
  });

  it('дата первой модели учитывает сдвиг дня выхода ходом соперника (rivalDayIn)', () => {
    const gtp3 = byId('gtp-3');
    const s = stateAt('2022-06-01', [gtp3.id]);
    s.rivalry.overrides[gtp3.id] = { dayShift: -20 };
    const openbrain = labRows(s).find((r) => r.owner === gtp3.lab)!;
    expect(openbrain.since).toBe(dateToDay(gtp3.released) - 20);
  });

  it('ответная модель (шаблон) считается выпущенной со своим днём выхода', () => {
    const t = RIVAL_REACTIVE.find((x) => x.lab === 'zhipo')!;
    const s = stateAt('2024-01-01', [t.id]);
    const day = dateToDay('2023-10-05');
    s.rivalry.extra[t.id] = day;
    const zhipo = labRows(s).find((r) => r.owner === 'zhipo')!;
    expect(zhipo.count).toBe(1);
    expect(zhipo.lastName).toBe(t.gameName);
    expect(zhipo.since).toBe(day);
  });

  it('у соперников есть характер и настрой, у вашей лаборатории - нет', () => {
    const s = stateAt('2022-06-01', ['gtp-3']);
    const rows = labRows(s);
    const me = rows.find((r) => r.owner === 'player')!;
    expect(me.character).toBeNull();
    expect(me.stance).toBeNull();
    expect(me.lastMove).toBeNull();

    for (const r of rows) {
      if (r.owner === 'player') continue;
      const p = personalityOf(r.owner);
      expect(r.character).toEqual({ archetype: p.archetype, description: p.description });
      expect(r.stance).toEqual(labStance(s, r.owner));
      expect(r.stance!.label.length).toBeGreaterThan(0);
      expect(r.stance!.hint.length).toBeGreaterThan(0);
    }
  });

  it('последний ход - последняя строка истории этой лаборатории, а не чужая', () => {
    const s = stateAt('2023-06-01', ['gtp-3']);
    const d = dateToDay('2023-03-01');
    s.rivalry.history = [row(d, 'openbrain', 'первый'), row(d + 10, 'openbrain', 'второй'), row(d + 20, 'gogle', 'чужой')];
    const rows = labRows(s);
    expect(rows.find((r) => r.owner === 'openbrain')!.lastMove).toEqual(row(d + 10, 'openbrain', 'второй'));
    expect(rows.find((r) => r.owner === 'gogle')!.lastMove).toEqual(row(d + 20, 'gogle', 'чужой'));
    expect(rows.find((r) => r.owner === 'zhipo')!.lastMove).toBeNull();
  });
});

describe('recentMoves', () => {
  it('без ходов - пусто', () => {
    expect(recentMoves(stateAt('2022-06-01'))).toEqual([]);
  });

  it(`не больше ${RECENT_MOVES} последних строк, новые сверху`, () => {
    const s = stateAt('2024-01-01');
    const d = dateToDay('2023-01-01');
    s.rivalry.history = Array.from({ length: RECENT_MOVES + 3 }, (_, i) => row(d + i, 'openbrain', `ход ${i}`));
    const out = recentMoves(s);
    expect(out).toHaveLength(RECENT_MOVES);
    expect(out[0].text).toBe(`ход ${RECENT_MOVES + 2}`);
    expect(out[RECENT_MOVES - 1].text).toBe('ход 3');
    // Исходная история не меняется.
    expect(s.rivalry.history[0].text).toBe('ход 0');
  });
});
