import { describe, expect, it } from 'vitest';
import { TECHS } from '../../sim/research';
import { createInitialState } from '../../sim/state';
import { TECH_IDS } from '../../sim/types';
import { BRANCH_COLOR, GRAPH_TECHS, graphEdges, MAP_CELL, MAP_COLS, MAP_ROWS, techGain, termText } from './researchMap';

describe('карта исследований', () => {
  it('на карте все технологии, кроме цепочек; у каждой своя клетка в пределах сетки', () => {
    expect([...GRAPH_TECHS].sort()).toEqual(TECH_IDS.filter((t) => t !== 'algo' && t !== 'context').sort());
    const cells = new Set(GRAPH_TECHS.map((t) => `${MAP_CELL[t].col}:${MAP_CELL[t].row}`));
    expect(cells.size).toBe(GRAPH_TECHS.length);
    for (const t of GRAPH_TECHS) {
      expect(MAP_CELL[t].col).toBeGreaterThanOrEqual(0);
      expect(MAP_CELL[t].col).toBeLessThan(MAP_COLS);
      expect(MAP_CELL[t].row).toBeGreaterThanOrEqual(0);
      expect(MAP_CELL[t].row).toBeLessThan(MAP_ROWS);
    }
  });

  it('линии идут в соседний столбец справа; горизонталь на строке источника не задевает узлы', () => {
    const at = new Map(GRAPH_TECHS.map((t) => [`${MAP_CELL[t].col}:${MAP_CELL[t].row}`, t]));
    for (const [from, to] of graphEdges()) {
      expect(MAP_CELL[to].col).toBe(MAP_CELL[from].col + 1);
      // Вертикаль линии идёт в промежутке перед столбцом цели, поэтому узлы задевает только горизонталь
      // на строке цели внутри её столбца - а там стоит сама цель.
      expect(at.get(`${MAP_CELL[to].col}:${MAP_CELL[to].row}`)).toBe(to);
    }
  });

  it('у каждого направления есть цвета', () => {
    for (const t of TECHS) expect(BRANCH_COLOR[t.branch]).toBeDefined();
  });
});

describe('тексты окна «Исследования»', () => {
  it('срок по-человечески, без «дн.» и сотен дней', () => {
    expect(termText(1)).toBe('1 день');
    expect(termText(45)).toBe('45 дней');
    expect(termText(61)).toBe('≈ 2 месяца');
    expect(termText(150)).toBe('≈ 5 месяцев');
    expect(termText(330)).toBe('≈ 11 месяцев');
    expect(termText(365)).toBe('≈ 1 год');
    expect(termText(548)).toBe('≈ 1,5 года');
    expect(termText(730)).toBe('≈ 2 года');
    expect(termText(1830)).toBe('≈ 5 лет');
    expect(termText(5000)).toBe('больше 10 лет');
    expect(termText(Infinity)).toBe('больше 10 лет');
  });

  it('у каждой технологии есть короткая строка «что даст» без длинных тире', () => {
    const s = createInitialState('Тест', 1);
    for (const t of TECH_IDS) {
      const g = techGain(s, t);
      expect(g.length).toBeGreaterThan(5);
      expect(g.length).toBeLessThanOrEqual(52);
      expect(g).not.toMatch(/[—–]/);
    }
    expect(techGain(s, 'context')).toBe('Контекст новых моделей до 1 тыс. токенов');
  });
});
