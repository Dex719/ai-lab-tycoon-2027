import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/actions';
import { runBot } from '../sim/bots';
import { dateToDay } from '../sim/time';
import type { GameState, MonthRecord } from '../sim/types';
import { LAB_STAGES, labStage, metricStage, stageFlag, yearCups } from './labStage';

/** Месяц учёта с заданной выручкой контрактов: остальное берём из первой записи партии бота. */
function withMonth(s: GameState, year: number, month: number, revenue: number, placeEnd?: number): void {
  const base = s.finance.history[0] ?? ({} as MonthRecord);
  s.finance.history.push({ ...base, year, month, income: { api: 0, subs: 0, contracts: revenue }, placeEnd } as MonthRecord);
}

describe('этап лаборатории на рабочем столе', () => {
  it('пороги растут от этапа к этапу, названия без длинного тире', () => {
    for (let i = 1; i < LAB_STAGES.length; i++) {
      expect(LAB_STAGES[i].month).toBeGreaterThan(LAB_STAGES[i - 1].month);
      expect(LAB_STAGES[i].value).toBeGreaterThan(LAB_STAGES[i - 1].value);
      expect(LAB_STAGES[i].desks).toBeGreaterThan(LAB_STAGES[i - 1].desks);
      expect(LAB_STAGES[i].racks).toBeGreaterThanOrEqual(LAB_STAGES[i - 1].racks);
    }
    for (const d of LAB_STAGES) expect(d.name).not.toMatch(/[—–]/);
  });

  it('новая партия - гараж', () => {
    expect(labStage(newGame('Тест', 1))).toBe(0);
  });

  it('этап по лучшему месяцу выручки', () => {
    const s = newGame('Тест', 1);
    s.finance.history = [];
    withMonth(s, 2018, 3, 400e3);
    expect(metricStage(s).stage).toBe(0);
    withMonth(s, 2018, 4, 600e3);
    expect(metricStage(s)).toMatchObject({ stage: 1, by: 'month' });
    withMonth(s, 2020, 5, 6e6);
    expect(labStage(s)).toBe(2);
    withMonth(s, 2023, 5, 55e6);
    expect(labStage(s)).toBe(3);
  });

  it('достигнутый этап не теряется, даже если показатели ниже порога', () => {
    const s = newGame('Тест', 1);
    s.flags[stageFlag(2)] = true;
    expect(metricStage(s).stage).toBe(0);
    expect(labStage(s)).toBe(2);
  });

  it('партии ботов: бездействие - гараж, разумная игра к 2021 году - не ниже офиса, к концу - кампус', () => {
    expect(labStage(runBot('idle', 1, 4000, 'normal').state)).toBe(0);
    expect(labStage(runBot('reasonable', 1, dateToDay('2021-01-01'), 'normal').state)).toBeGreaterThanOrEqual(1);
    expect(labStage(runBot('reasonable', 1, dateToDay('2018-01-01'), 'normal').state)).toBe(0);
    expect(labStage(runBot('strong', 2, 4000, 'normal').state)).toBe(3);
  });

  it('кубки: 1-е место на конец года - золото, все цели года - серебро, один кубок за год', () => {
    const s = newGame('Тест', 1);
    s.finance.history = [];
    withMonth(s, 2019, 11, 1, 1);
    withMonth(s, 2019, 12, 1, 2);
    withMonth(s, 2020, 12, 1, 1);
    s.yearly.reviews = [
      { year: 2019, goalsDone: 3, goalsTotal: 3 },
      { year: 2020, goalsDone: 3, goalsTotal: 3 },
      { year: 2021, goalsDone: 1, goalsTotal: 3 },
    ] as GameState['yearly']['reviews'];
    expect(yearCups(s)).toEqual([
      { year: 2019, kind: 'goals' },
      { year: 2020, kind: 'first' },
    ]);
  });
});
