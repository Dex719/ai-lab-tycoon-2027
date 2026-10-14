// Финальный квартал: рывки соперников объявляются заранее с целью, цель не меняется, ответ игрока - доработка.

import { describe, expect, it } from 'vitest';
import { EVENTS, EXTRA_EVENTS } from '../data/events';
import { RIVAL_MODELS } from '../data/rivalModels';
import { newGame } from './actions';
import { botChoice, botAct } from './bots';
import { applyChoice, pendingChoice } from './events';
import { FINALE, FINALE_START, finaleDay, finaleThreats, LAST_PUSH_DAY, startUpdate, UPDATE_DAYS, updateQuote } from './finale';
import { rivalDayIn, rivalEloIn, findRivalDefIn, type Difficulty } from './rivalry';
import { deserialize, serialize } from './save';
import { advanceDay, playerBestArenaRank } from './tick';
import { dateToDay, END_DAY } from './time';
import type { GameState, PlayerModel } from './types';

const D = dateToDay;

function apiModel(id: string, arenaElo: number, releasedDay: number, over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id,
    name: `Модель ${id}`,
    plan: {
      name: id, paramsB: 1000, tokensB: 20000, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0, benchTargets: [], rlhf: true, context: 512, tier: 'flagship',
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
    onSubs: false,
    subsPrice: 10,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
    ...over,
  };
}

/** Состояние на день с вышедшими моделями соперников и одной моделью игрока; события прошлых лет считаются прошедшими. */
function stateOn(day: number, elo: number, difficulty: Difficulty = 'normal'): GameState {
  const s = newGame('Тест', 1, difficulty);
  s.day = day;
  s.cash = 1e9;
  s.rivalsReleased = RIVAL_MODELS.filter((m) => D(m.released) <= day).map((m) => m.id);
  s.firedEvents = [...EVENTS, ...EXTRA_EVENTS].map((e) => e.id);
  s.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
  s.models.push(apiModel('p1', elo, day - 30));
  return s;
}

/** Прожить дни до day включительно, решая письма с выбором вариантом по умолчанию. */
function liveUntil(s: GameState, day: number): void {
  while (s.day < day && !s.outcome) {
    const p = pendingChoice(s);
    if (p) {
      applyChoice(s, p.id, p.defaultChoice ?? 0);
      continue;
    }
    advanceDay(s);
  }
}

describe('финальный квартал: рывки соперников', () => {
  it('до 1 октября 2024 года ничего не происходит, поле late не появляется', () => {
    const s = stateOn(FINALE_START - 1, 1370);
    finaleDay(s);
    expect(s.late).toBeUndefined();
  });

  it('лидер получает объявленный рывок: цель = лучшая модель + запас, не больше потолка, с предупреждением', () => {
    const s = stateOn(FINALE_START, 1370);
    finaleDay(s);
    const pushes = s.late!.finale.pushes;
    expect(pushes).toHaveLength(1);
    const p = pushes[0];
    // Сильнее всех среди тех, кто ниже игрока, - Gemeni 2.0 Flesh (1356, 11.12.2024): выйдет к своему дню, но сильнее.
    expect(p.lab).toBe('gogle');
    expect(p.modelId).toBe('gemeni-2-0-flesh');
    expect(p.kind).toBe('release');
    expect(p.target).toBe(Math.round(Math.min(1370 + FINALE.normal.margin, 1356 + FINALE.normal.cap)));
    expect(p.fireDay - p.announceDay).toBeGreaterThanOrEqual(FINALE.normal.notice);
    expect(p.fireDay).toBeLessThanOrEqual(LAST_PUSH_DAY);
    // Письмо важное и называет цель.
    const mail = s.mail.find((m) => m.title === 'Финальный рывок: Gogle DeepMynd');
    expect(mail?.important).toBe(true);
    expect(mail?.body).toContain('1 376');
    // Поправка уже стоит: модель выйдет с целью по Эло.
    const def = findRivalDefIn('gemeni-2-0-flesh')!;
    expect(rivalEloIn(s, def)).toBeCloseTo(p.target, 6);
    expect(rivalDayIn(s, def)).toBeLessThanOrEqual(p.fireDay);
  });

  it('цель рывка не меняется после объявления, даже если игрок усилился', () => {
    const s = stateOn(FINALE_START, 1370);
    finaleDay(s);
    const target = s.late!.finale.pushes[0].target;
    s.models[0].arenaElo = 1400;
    liveUntil(s, D('2024-12-15'));
    const p = s.late!.finale.pushes.find((x) => x.lab === 'gogle')!;
    expect(p.target).toBe(target);
    expect(p.fired).toBe(true);
    expect(rivalEloIn(s, findRivalDefIn(p.modelId)!)).toBeCloseTo(target, 6);
    expect(playerBestArenaRank(s)).toBe(1);
  });

  it('если игрок не первый, рывков нет: соперникам незачем', () => {
    const s = stateOn(FINALE_START, 1300); // q1-Previow (1335) выше
    finaleDay(s);
    expect(s.late!.finale.pushes).toEqual([]);
  });

  it('модель каталога, которая обойдёт игрока, объявляется заранее', () => {
    const s = stateOn(FINALE_START, 1345); // q1 (1352, 05.12) и Gemeni 2.0 Flesh (1356, 11.12) выше
    liveUntil(s, D('2024-11-10'));
    const q1 = s.mail.find((m) => m.title === 'OpenBrain объявила q1');
    expect(q1).toBeDefined();
    expect(q1!.day).toBe(D('2024-12-05') - FINALE.normal.notice);
    const ids = finaleThreats(s).map((t) => t.modelId);
    expect(ids).toContain('q1');
  });

  it.each(['easy', 'normal', 'hard'] as Difficulty[])('честность на сложности %s: предупреждение не короче notice, рывки не позже 20 декабря, не больше maxPushes', (d) => {
    const s = stateOn(FINALE_START, 1365, d);
    // Игрок растёт каждый месяц - проверки 31.10 и 20.11 видят нового лидера.
    for (const day of [D('2024-10-30'), D('2024-11-19'), END_DAY]) {
      liveUntil(s, day);
      s.models[0].arenaElo += 15;
    }
    const pushes = s.late!.finale.pushes;
    expect(pushes.length).toBeLessThanOrEqual(FINALE[d].maxPushes);
    for (const p of pushes) {
      expect(p.fireDay - p.announceDay).toBeGreaterThanOrEqual(FINALE[d].notice);
      expect(p.fireDay).toBeLessThanOrEqual(LAST_PUSH_DAY);
      expect(p.target - p.playerElo).toBeLessThanOrEqual(FINALE[d].margin + 1);
      expect(p.target - p.base).toBeLessThanOrEqual(FINALE[d].cap + 1);
    }
    expect(new Set(pushes.map((p) => p.lab)).size).toBe(pushes.length);
  });

  it('сохранение с финалом загружается и играется так же', () => {
    const s = stateOn(FINALE_START, 1370);
    liveUntil(s, D('2024-10-20'));
    expect(startUpdate(s, 'p1')).toEqual({ ok: true });
    const saved = serialize(s);
    const r = deserialize(saved);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    liveUntil(s, END_DAY);
    liveUntil(r.state, END_DAY);
    expect(serialize(r.state)).toBe(serialize(s));
  });
});

describe('финальный квартал: доработка модели', () => {
  it('до финала, без денег и слишком поздно - нельзя, с причиной', () => {
    const early = stateOn(FINALE_START - 1, 1370);
    expect(updateQuote(early, 'p1').error).toBe('Доработка откроется в финальном квартале.');
    const poor = stateOn(FINALE_START, 1370);
    poor.cash = 1e6;
    expect(updateQuote(poor, 'p1').error).toMatch(/^Не хватает денег: нужно \$60 млн/);
    const late = stateOn(END_DAY - UPDATE_DAYS + 1, 1370);
    expect(updateQuote(late, 'p1').error).toMatch(/^Не успеет до 31 декабря 2024/);
  });

  it('первая доработка +10 Эло за $60 млн через 28 дней, вторая +6 дороже в 1,5 раза, третьей нет', () => {
    const s = stateOn(FINALE_START, 1370);
    const cash = s.cash;
    expect(startUpdate(s, 'p1')).toEqual({ ok: true });
    expect(cash - s.cash).toBe(60e6);
    // Пока идёт одна доработка, вторую не начать.
    expect(updateQuote(s, 'p1').error).toMatch(/^Идёт доработка/);
    liveUntil(s, FINALE_START + UPDATE_DAYS + 1); // доработка заканчивается в день endDay
    expect(s.models[0].arenaElo).toBe(1380);
    expect(s.mail.some((m) => m.title === 'Доработка «Модель p1» завершена' && m.reward)).toBe(true);
    const second = updateQuote(s, 'p1');
    expect(second).toMatchObject({ nth: 1, gain: 6, cost: 90e6, error: null });
    expect(startUpdate(s, 'p1')).toEqual({ ok: true });
    liveUntil(s, s.late!.finale.update!.endDay + 1);
    expect(s.models[0].arenaElo).toBe(1386);
    expect(updateQuote(s, 'p1').error).toBe('Модель уже доработана дважды.');
  });

  it('доработка сильнее запаса рывка на любой сложности: одной хватает, чтобы остаться выше цели', () => {
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) expect(10).toBeGreaterThan(FINALE[d].margin);
  });

  it('бот отвечает на рывок доработкой и остаётся первым', () => {
    const s = stateOn(FINALE_START, 1370);
    while (s.day < END_DAY && !s.outcome) {
      const p = pendingChoice(s);
      if (p) {
        applyChoice(s, p.id, botChoice(s, p.eventId));
        continue;
      }
      if (s.day % 7 === 0) botAct(s, 'strong');
      advanceDay(s);
    }
    expect(s.late!.finale.done.length).toBeGreaterThan(0);
  });
});
