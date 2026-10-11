// Таблицы рейтингов: строки только показанных моделей (announcedOnly) помечаются, столбец даты меняет заголовок.

import { describe, expect, it } from 'vitest';
import { RIVAL_MODELS } from '../../data/rivalModels';
import { leaderboard } from '../../sim/leaderboard';
import { createInitialState } from '../../sim/state';
import { dateToDay } from '../../sim/time';
import { dateHeader, isAnnouncedRow } from './RatingsWindow';

const byId = (id: string) => RIVAL_MODELS.find((m) => m.id === id)!;

function stateWith(ids: string[]) {
  const s = createInitialState('Тест', 1);
  s.day = dateToDay('2022-06-01');
  s.rivalsReleased = ids;
  return s;
}

describe('isAnnouncedRow', () => {
  it('строка показанной модели помечена, выпущенной - нет', () => {
    const rows = leaderboard(stateWith(['gtp-3', 'paln']));
    const paln = rows.find((r) => r.ref.kind === 'rival' && r.ref.id === 'paln')!;
    const gtp3 = rows.find((r) => r.ref.kind === 'rival' && r.ref.id === 'gtp-3')!;
    expect(byId('paln').announcedOnly).toBe(true);
    expect(isAnnouncedRow(paln)).toBe(true);
    expect(isAnnouncedRow(gtp3)).toBe(false);
  });
});

describe('dateHeader', () => {
  it('«Выпущена», пока в таблице только выпущенные модели', () => {
    expect(dateHeader(leaderboard(stateWith(['gtp-3'])))).toEqual({ label: 'Выпущена' });
    expect(dateHeader([])).toEqual({ label: 'Выпущена' });
  });

  it('«Дата» с подсказкой, если среди строк есть только показанная модель', () => {
    const h = dateHeader(leaderboard(stateWith(['gtp-3', 'paln'])));
    expect(h.label).toBe('Дата');
    expect(h.title).toContain('анонса');
  });
});
