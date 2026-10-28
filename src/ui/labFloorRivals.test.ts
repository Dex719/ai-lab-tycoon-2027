import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/actions';
import { START_DAY } from '../sim/time';
import { topRivals } from './LabFloor';

describe('здания соперников в комнате лаборатории', () => {
  it('в первый день без доли рынка показываются три основанные к тому году лаборатории по силе бренда', () => {
    const s = newGame('Лаб', 1);
    s.day = START_DAY;
    const rivals = topRivals(s).map((l) => l.id);
    expect(rivals).toEqual(['openbrain', 'gogle', 'alibabo']);
    for (const l of topRivals(s)) expect(s.market.labShares[l.id] ?? 0).toBe(0);
  });

  it('лаборатория с долей рынка идёт первой по доле, остальные добираются по бренду', () => {
    const s = newGame('Лаб', 1);
    s.day = START_DAY;
    s.market.labShares.alibabo = 0.04;
    const rivals = topRivals(s).map((l) => l.id);
    expect(rivals).toContain('alibabo');
    expect(rivals).toHaveLength(3);
  });
});
