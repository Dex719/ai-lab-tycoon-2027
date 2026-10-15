// Досье лаборатории: в списке только вышедшие на рынок (или уже боровшиеся с вами) лаборатории - будущее не раскрываем;
// сначала те, кто борется с вами чаще; лучшая модель - по Эло, без только показанных; слово угрозы по порогам.

import { describe, expect, it } from 'vitest';
import { RIVAL_MODELS } from '../../data/rivalModels';
import { emptyDuel } from '../../sim/duel';
import { emptyRivalry } from '../../sim/rivalry';
import { createInitialState } from '../../sim/state';
import { dateToDay } from '../../sim/time';
import type { GameState } from '../../sim/types';
import { dossierLabs, labBestModel, threatWord } from './LabsDossier';

function stateAt(date: string, released: string[] = []): GameState {
  const s = createInitialState('Тест', 1);
  s.rivalry = emptyRivalry();
  s.day = dateToDay(date);
  s.rivalsReleased = released;
  return s;
}

const released = (lab: string, before: string): string[] =>
  RIVAL_MODELS.filter((m) => m.lab === lab && m.released < before && !m.announcedOnly).map((m) => m.id);

describe('досье лаборатории', () => {
  it('лаборатория без вышедших моделей в список не попадает', () => {
    const s = stateAt('2019-01-01', released('openbrain', '2019-01-01'));
    const labs = dossierLabs(s).map((r) => r.owner);
    expect(labs).toContain('openbrain');
    expect(labs).not.toContain('deepcent');
    expect(labs).not.toContain('antropik');
  });

  it('выше в списке тот, кто чаще боролся с вами', () => {
    const ids = [...released('openbrain', '2021-01-01'), ...released('gogle', '2021-01-01')];
    const s = stateAt('2021-01-01', ids);
    s.duel = emptyDuel();
    s.duel.labs.gogle.passedYou = 3;
    s.duel.labs.openbrain.youPassed = 1;
    expect(dossierLabs(s).map((r) => r.owner).slice(0, 2)).toEqual(['gogle', 'openbrain']);
  });

  it('лучшая модель - с наибольшим Эло среди вышедших', () => {
    const ids = released('openbrain', '2023-06-01');
    const s = stateAt('2023-06-01', ids);
    const best = labBestModel(s, 'openbrain')!;
    const top = Math.max(...ids.map((id) => RIVAL_MODELS.find((m) => m.id === id)!.arenaElo));
    expect(best.def.lab).toBe('openbrain');
    expect(best.elo).toBeGreaterThanOrEqual(top - 1);
    expect(labBestModel(stateAt('2017-01-01'), 'deepcent')).toBeNull();
  });

  it('слово угрозы', () => {
    expect(threatWord(0)).toBe('нет');
    expect(threatWord(0.1)).toBe('низкая');
    expect(threatWord(0.3)).toBe('заметная');
    expect(threatWord(0.7)).toBe('высокая');
  });
});
