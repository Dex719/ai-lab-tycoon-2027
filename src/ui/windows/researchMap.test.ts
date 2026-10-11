import { describe, expect, it } from 'vitest';
import { TECHS } from '../../sim/research';
import { TECH_IDS } from '../../sim/types';
import { BRANCH_COLOR, clampZoom, GRAPH_ROW, GRAPH_TECHS, graphCol, graphEdges, graphYears, ZOOM_MAX, ZOOM_MIN } from './researchMap';

describe('карта исследований', () => {
  it('на карте все технологии, кроме цепочек; у каждой свой столбец по году и своя клетка', () => {
    expect([...GRAPH_TECHS].sort()).toEqual(TECH_IDS.filter((t) => t !== 'algo' && t !== 'context').sort());
    const cells = new Set(GRAPH_TECHS.map((t) => `${graphCol(t)}:${GRAPH_ROW[t]}`));
    expect(cells.size).toBe(GRAPH_TECHS.length);
    expect(graphYears()).toEqual([2017, 2019, 2020, 2021, 2022, 2023]);
    for (const t of GRAPH_TECHS) expect(graphCol(t)).toBeGreaterThanOrEqual(0);
  });

  it('линии идут слева направо и не проходят через другие узлы', () => {
    const at = new Map(GRAPH_TECHS.map((t) => [`${graphCol(t)}:${GRAPH_ROW[t]}`, t]));
    for (const [from, to] of graphEdges()) {
      const c1 = graphCol(from);
      const c2 = graphCol(to);
      expect(c2).toBeGreaterThan(c1);
      // Горизонталь на строке источника проходит столбцы между ними - там не должно быть узлов.
      for (let c = c1 + 1; c < c2; c++) expect(at.get(`${c}:${GRAPH_ROW[from]}`)).toBeUndefined();
    }
  });

  it('у каждого направления есть цвета, масштаб зажат в 0,6…1,6', () => {
    for (const t of TECHS) expect(BRANCH_COLOR[t.branch]).toBeDefined();
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1.04)).toBe(1.04);
  });
});
