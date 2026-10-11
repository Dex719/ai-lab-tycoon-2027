// Тесты дня игры: автосохранение, конец игры, письма за всю партию.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { botAct, runBot } from './bots';
import { BANKRUPT_DAYS } from './constants';
import { applyChoice, pendingChoice } from './events';
import { serialize } from './save';
import { advanceDay } from './tick';
import { dateToDay, END_DAY } from './time';
import type { GameState } from './types';

const D = dateToDay;

/** Играет ботом, пока не наступит конец игры. Как интерфейс, сразу «сохраняет» состояние, когда игра просит автосохранение. */
function playWithAutosave(seed: number): { s: GameState; lastAuto: string | null; autosaves: number } {
  const s = newGame('Бот', seed);
  let lastAuto: string | null = null;
  let autosaves = 0;
  while (!s.outcome) {
    const pending = pendingChoice(s);
    if (pending) {
      applyChoice(s, pending.id, 0);
      continue;
    }
    if (s.day % 7 === 0) botAct(s, 'reasonable');
    advanceDay(s);
    if (s.flags.autosaveDue) {
      s.flags.autosaveDue = false;
      lastAuto = serialize(s);
      autosaves++;
    }
  }
  return { s, lastAuto, autosaves };
}

describe('автосохранение (flags.autosaveDue)', () => {
  it('просится в начале каждого месяца, а в обычный день - нет', () => {
    const s = newGame('Тест', 1);
    s.day = D('2017-01-30');
    advanceDay(s);
    expect(s.flags.autosaveDue).toBeFalsy();
    expect(s.day).toBe(D('2017-01-31'));
    advanceDay(s); // последний день января: игра переходит на 1 февраля
    expect(s.day).toBe(D('2017-02-01'));
    expect(s.flags.autosaveDue).toBe(true);
  });

  it('последний тик игры (31.12.2024) автосохранение не просит', () => {
    const s = newGame('Тест', 1);
    s.day = END_DAY;
    advanceDay(s);
    expect(s.outcome).not.toBeNull();
    expect(s.day).toBe(END_DAY);
    expect(s.flags.autosaveDue).toBeFalsy();
  });

  it('банкротство в последний день месяца автосохранение не просит', () => {
    const s = newGame('Тест', 1);
    s.day = D('2018-03-31');
    s.cash = -1e9;
    s.finance.negativeDays = BANKRUPT_DAYS - 1;
    advanceDay(s);
    expect(s.outcome).toBe('bankrupt');
    expect(s.day).toBe(D('2018-03-31'));
    expect(s.flags.autosaveDue).toBeFalsy();
  });

  it('банкротство в середине месяца тоже его не просит', () => {
    const s = newGame('Тест', 1);
    s.day = D('2018-03-15');
    s.cash = -1e9;
    s.finance.negativeDays = BANKRUPT_DAYS - 1;
    advanceDay(s);
    expect(s.outcome).toBe('bankrupt');
    expect(s.flags.autosaveDue).toBeFalsy();
  });

  it('за всю партию: последнее автосохранение - живая игра на 1 декабря 2024, а не конец', () => {
    const { s, lastAuto, autosaves } = playWithAutosave(1);
    expect(s.outcome === 'victory' || s.outcome === 'finished').toBe(true);
    expect(autosaves).toBeGreaterThan(90); // по одному на месяц с февраля 2017 по декабрь 2024
    const saved = JSON.parse(lastAuto!) as GameState;
    expect(saved.outcome).toBeNull();
    expect(saved.day).toBe(D('2024-12-01'));
  });
});

describe('письма за всю партию', () => {
  const doubleDot = /(?<!\.)\.\.(?!\.)/;

  it.each([
    ['reasonable', 1],
    ['benchmaxx', 3],
    ['strong', 7],
  ] as const)('у бота «%s» (зерно %i) в письмах нет двойной точки', (kind, seed) => {
    const { state: s } = runBot(kind, seed);
    expect(s.mail.length).toBeGreaterThan(50);
    for (const m of s.mail) {
      expect(m.title, m.id).not.toMatch(doubleDot);
      expect(m.body, `${m.id}: ${m.title}`).not.toMatch(doubleDot);
    }
  });

  it('важные письма есть в ходе партии: тендеры, модели, провалы и банкротство', () => {
    const { state: s } = runBot('benchmaxx', 3);
    const important = new Set(
      s.mail.filter((m) => m.important).map((m) => m.title.replace(/:.*/, '').replace(/^Модель «.*» готова$/, 'Модель готова')),
    );
    expect(important).toContain('Модель готова');
    expect(important).toContain('Тендер выигран');
    expect(important).toContain('Подгонка раскрыта');
    // обычные письма без пометки: выход бенчмарка, выход модели соперника
    expect(s.mail.filter((m) => m.kind === 'benchmark').every((m) => !m.important)).toBe(true);
    expect(s.mail.filter((m) => m.kind === 'rival').every((m) => !m.important)).toBe(true);
  });
});
