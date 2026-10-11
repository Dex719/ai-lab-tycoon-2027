// Тесты дня игры: автосохранение, конец игры, письма за всю партию.

import { describe, expect, it } from 'vitest';
import { EVENTS } from '../data/events';
import { RIVAL_MODELS } from '../data/rivalModels';
import { newGame } from './actions';
import { botAct, runBot } from './bots';
import { BANKRUPT_DAYS } from './constants';
import { applyChoice, pendingChoice } from './events';
import { expectedLeaderElo } from './leaderboard';
import { deserialize, serialize } from './save';
import { advanceDay, blockedByChoice, playerBestArenaRank } from './tick';
import { dateToDay, END_DAY } from './time';
import type { GameState, PlayerModel } from './types';

const D = dateToDay;

/** Выпущенная модель игрока на API с заданным Эло. */
function apiModel(id: string, arenaElo: number, releasedDay: number, over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id,
    name: `Модель ${id}`,
    plan: {
      name: id, paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0, benchTargets: [], rlhf: true, context: 512,
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: releasedDay,
    releasedDay,
    caps: { language: 60, code: 60, reasoning: 60 },
    overfit: {},
    rlhf: true,
    arenaElo,
    price: 1,
    onApi: true,
    exposed: false,
    earned: 0,
    ...over,
  };
}

/** Состояние на день с вышедшими на него моделями соперников (как после releaseDue); события считаются прошедшими. */
function stateOn(day: number): GameState {
  const s = newGame('Тест', 1);
  s.day = day;
  s.rivalsReleased = RIVAL_MODELS.filter((m) => D(m.released) <= day).map((m) => m.id);
  s.firedEvents = EVENTS.map((e) => e.id); // иначе письма с выбором за прошлые годы остановили бы день
  return s;
}

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

describe('победа: 1-е место среди моделей, доступных по API', () => {
  it('в последний день модель на API сильнее планки expectedLeaderElo даёт победу', () => {
    const s = stateOn(END_DAY);
    s.models = [apiModel('p1', expectedLeaderElo(s) + 1, END_DAY - 10)];
    expect(playerBestArenaRank(s)).toBe(1);
    advanceDay(s);
    expect(s.outcome).toBe('victory');
  });

  it('модель слабее планки - «finished», даже если она сильнее всех моделей без API', () => {
    const s = stateOn(END_DAY);
    s.models = [apiModel('p1', expectedLeaderElo(s) - 1, END_DAY - 10)];
    expect(playerBestArenaRank(s)).toBe(2);
    advanceDay(s);
    expect(s.outcome).toBe('finished');
  });

  it('снятая с API или не выпущенная модель победы не даёт; без моделей место null', () => {
    const off = stateOn(END_DAY);
    off.models = [apiModel('p1', 9000, END_DAY - 10, { onApi: false })];
    expect(playerBestArenaRank(off)).toBeNull();
    advanceDay(off);
    expect(off.outcome).toBe('finished');

    const unreleased = stateOn(END_DAY);
    unreleased.models = [apiModel('p1', 9000, END_DAY - 10, { releasedDay: null, onApi: false })];
    expect(playerBestArenaRank(unreleased)).toBeNull();
    advanceDay(unreleased);
    expect(unreleased.outcome).toBe('finished');
  });

  it('берётся лучшее место среди моделей игрока на API', () => {
    const s = stateOn(END_DAY);
    s.models = [apiModel('p1', 1000, END_DAY - 10), apiModel('p2', 9000, END_DAY - 5), apiModel('p3', 1200, END_DAY - 3)];
    expect(playerBestArenaRank(s)).toBe(1);
    s.models[1].onApi = false;
    expect(playerBestArenaRank(s)).toBeGreaterThan(1);
  });
});

describe('monthsFirst: месяцы на 1-м месте', () => {
  it('новая игра - 0; закрытие месяца на 1-м месте прибавляет 1, иначе не меняет', () => {
    const s = stateOn(D('2023-06-29'));
    expect(s.monthsFirst).toBe(0);
    s.models = [apiModel('p1', 9000, D('2023-06-01'))];
    advanceDay(s); // 29 июня
    expect(s.monthsFirst).toBe(0);
    advanceDay(s); // 30 июня: месяц закрыт
    expect(s.day).toBe(D('2023-07-01'));
    expect(s.monthsFirst).toBe(1);

    s.models[0].arenaElo = 100; // теперь не первая
    s.day = D('2023-07-31');
    advanceDay(s);
    expect(s.monthsFirst).toBe(1);

    s.models[0].onApi = false;
    s.day = D('2023-08-31');
    advanceDay(s);
    expect(s.monthsFirst).toBe(1);
  });

  it('старое сохранение без monthsFirst загружается с нулём', () => {
    const s = newGame('Тест', 1);
    s.monthsFirst = 5;
    const data = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete data.monthsFirst;
    const r = deserialize(JSON.stringify(data));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.monthsFirst).toBe(0);
    // А с полем - как сохранили.
    const kept = deserialize(serialize(s));
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.state.monthsFirst).toBe(5);
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
    // обычные письма без пометки: выход бенчмарка, выход модели соперника, слухи и ходы соперников;
    // с пометкой - только письма соперников с выбором (проверка баллов, кампания, переманивание)
    expect(s.mail.filter((m) => m.kind === 'benchmark').every((m) => !m.important)).toBe(true);
    expect(s.mail.filter((m) => m.kind === 'rival').every((m) => !!m.important === !!m.choices)).toBe(true);
  });
});

describe('соперники с характерами в тике', () => {
  it('слух срабатывает в свой день: письмо с выбором, запись в истории, активный ход истекает', () => {
    const s = stateOn(D('2023-03-10'));
    s.models = [apiModel('p1', 1200, D('2023-01-01'))];
    s.rivalry.pending.push({ id: 'pm1', lab: 'gogle', move: 'hype', fireDay: s.day });
    s.rivalry.pending.push({ id: 'pm2', lab: 'antropik', move: 'poach', fireDay: s.day + 5 });
    s.rivalry.active.push({ lab: 'openbrain', move: 'priceCut', untilDay: s.day - 1 });
    const hypeBefore = s.hype.gogle;
    advanceDay(s);
    const mail = s.mail.find((m) => m.eventId === 'rival-hype');
    expect(mail).toBeDefined();
    expect(mail!.kind).toBe('rival');
    expect(mail!.important).toBe(true);
    expect(mail!.choices).toHaveLength(2);
    expect(mail!.chosen).toBeUndefined();
    expect(s.hype.gogle).toBeGreaterThan(hypeBefore);
    expect(s.rivalry.pending.map((p) => p.id)).toEqual(['pm2']); // не наступивший слух ждёт своего дня
    expect(s.rivalry.history.map((h) => h.move)).toEqual(['hype']);
    expect(s.rivalry.active.filter((a) => a.move === 'priceCut')).toEqual([]); // истёк в rivalryDay
    expect(s.rivalry.active.some((a) => a.move === 'hype')).toBe(true);
    expect(blockedByChoice(s)).toBe(true); // письмо с выбором останавливает игру, как любое другое
  });

  it('до 2021 года соперники спят: конец месяца не планирует ходов и не греет накал', () => {
    const s = stateOn(D('2020-12-30'));
    s.models = [apiModel('p1', 1200, D('2020-06-01'))];
    s.rivalry.heat.openbrain = 90;
    advanceDay(s);
    advanceDay(s); // 31 декабря 2020: месяц закрыт
    expect(s.day).toBe(D('2021-01-01'));
    expect(Object.values(s.rivalry.heat).every((h) => h === 0)).toBe(true);
    expect(s.rivalry.pending).toEqual([]);
    expect(s.rivalry.history).toEqual([]);
  });
});
