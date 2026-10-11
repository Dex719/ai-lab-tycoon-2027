// Новая игра: сложность из главного меню и её модификаторы навсегда; начальное состояние соперников.

import { describe, expect, it } from 'vitest';
import { newGame, releaseModel, setOnSubs, setSubsPrice, startReview } from './actions';
import { modValue } from './events';
import { refPrice } from './market';
import { DIFFICULTY, DIFFICULTY_IDS, emptyRivalry } from './rivalry';
import { createInitialState } from './state';
import { dateToDay, END_DAY } from './time';
import { reviewCost } from './training';
import type { GameState, PlayerModel } from './types';

describe('newGame и сложность', () => {
  it('по умолчанию Обычная: без модификаторов сложности, соперники спокойны', () => {
    const s = newGame('Лаб', 1);
    expect(s.difficulty).toBe('normal');
    expect(s.rivalry).toEqual(emptyRivalry());
    expect(s.modifiers.filter((m) => m.id.startsWith('difficulty-'))).toEqual([]);
    expect(modValue(s, 'rentPrice').mult).toBe(1);
    expect(modValue(s, 'exposure', 'p1').mult).toBe(1);
    expect(createInitialState('Лаб', 1).difficulty).toBe('normal');
    expect(createInitialState('Лаб', 1, 'easy').difficulty).toBe('easy');
  });

  it.each(DIFFICULTY_IDS)('сложность «%s»: аренда и шанс разоблачения по таблице DIFFICULTY, навсегда', (d) => {
    const s = newGame('Лаб', 1, d);
    expect(s.difficulty).toBe(d);
    const def = DIFFICULTY[d];
    for (const day of [0, END_DAY]) {
      s.day = day;
      expect(modValue(s, 'rentPrice').mult).toBeCloseTo(def.rentPrice, 10);
      expect(modValue(s, 'exposure', 'p1').mult).toBeCloseTo(def.exposure, 10);
    }
    // Один модификатор на эффект, и только когда множитель не 1.
    expect(s.modifiers.filter((m) => m.id === 'difficulty-rent')).toHaveLength(def.rentPrice === 1 ? 0 : 1);
    expect(s.modifiers.filter((m) => m.id === 'difficulty-exposure')).toHaveLength(def.exposure === 1 ? 0 : 1);
  });

  it('письмо об основании и остальное начальное состояние не зависят от сложности', () => {
    const a = newGame('Лаб', 5, 'easy');
    const b = newGame('Лаб', 5, 'hard');
    expect(a.mail).toEqual(b.mail);
    expect(a.rng).toBe(b.rng);
    expect(a.cash).toBe(b.cash);
    expect(a.benchmarks).toEqual(b.benchmarks);
  });
});

// ---------- Рынок v2: выпуск с подпиской, цена подписки, внешняя проверка ----------

/** Обученная, ещё не выпущенная модель игрока. */
function trained(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Альфа',
    plan: {
      name: 'Альфа', paramsB: 10, tokensB: 200, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0, benchTargets: [], rlhf: true, context: 4096, tier: 'light',
    },
    arch: 'transformer',
    algoLevel: 3,
    trainedDay: 0,
    releasedDay: null,
    caps: { language: 60, code: 60, reasoning: 60 },
    overfit: {},
    rlhf: true,
    arenaElo: 1100,
    price: 0,
    onApi: false,
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

function stateOn(date: string, over: Partial<PlayerModel> = {}): GameState {
  const s = newGame('Лаб', 1);
  s.day = dateToDay(date);
  s.models.push(trained(over));
  return s;
}

/** Письмо о выпуске (после него может прийти письмо о насыщении бенчмарка). */
function releaseMail(s: GameState) {
  return s.mail.find((m) => m.title === 'Модель «Альфа» выпущена')!;
}

describe('releaseModel с подпиской', () => {
  it('до 30.11.2022 подписка не включается, даже если попросили; цена подписки - по уровню', () => {
    const s = stateOn('2022-11-29');
    expect(releaseModel(s, 'p1', refPrice(s.day), { onSubs: true })).toEqual({ ok: true });
    const m = s.models[0];
    expect(m.onApi).toBe(true);
    expect(m.onSubs).toBe(false);
    expect(m.subsPrice).toBe(10); // лёгкая модель
    expect(m.review).toBe('none');
    expect(releaseMail(s).body).toContain('Модель доступна клиентам по API.');
    expect(setOnSubs(s, 'p1', true)).toEqual({ ok: false, error: 'Подписки появятся после выхода чат-ботов (30.11.2022).' });
  });

  it('после 30.11.2022: подписка включается, цена подписки из opts (до центов), письмо «и по подписке»', () => {
    const s = stateOn('2023-06-01');
    expect(releaseModel(s, 'p1', refPrice(s.day), { onSubs: true, subsPrice: 14.999 })).toEqual({ ok: true });
    const m = s.models[0];
    expect(m.onSubs).toBe(true);
    expect(m.subsPrice).toBe(15);
    expect(releaseMail(s).body).toContain('по API и по подписке');
    expect(setOnSubs(s, 'p1', false)).toEqual({ ok: true });
    expect(m.onSubs).toBe(false);
    expect(setOnSubs(s, 'p1', true)).toEqual({ ok: true });
    expect(m.onSubs).toBe(true);
  });

  it('без opts подписка выключена; средняя модель - $20 в месяц', () => {
    const s = stateOn('2023-06-01', { plan: { ...trained().plan, tier: 'mid' }, subsPrice: 0 });
    expect(releaseModel(s, 'p1', refPrice(s.day))).toEqual({ ok: true });
    expect(s.models[0].onSubs).toBe(false);
    expect(s.models[0].subsPrice).toBe(20);
  });

  it('цена подписки вне границ отклоняется при выпуске и при смене', () => {
    const s = stateOn('2023-06-01');
    expect(releaseModel(s, 'p1', refPrice(s.day), { subsPrice: 0.5 })).toEqual({ ok: false, error: 'Цена подписки - от $1 до $200 в месяц.' });
    expect(s.models[0].releasedDay).toBeNull();
    expect(releaseModel(s, 'p1', refPrice(s.day), { subsPrice: 200 })).toEqual({ ok: true });
    expect(s.models[0].subsPrice).toBe(200);
    expect(setSubsPrice(s, 'p1', 201).ok).toBe(false);
    expect(setSubsPrice(s, 'p1', NaN)).toEqual({ ok: false, error: 'Цена подписки не указана' });
    expect(setSubsPrice(s, 'p1', 19.994)).toEqual({ ok: true });
    expect(s.models[0].subsPrice).toBe(19.99);
    expect(setSubsPrice(s, 'нет', 20).ok).toBe(false);
  });

  it('сильная модель: при выпуске проверка «required», подписка не включается, письмо с причиной и сроком', () => {
    const s = stateOn('2024-06-01', { arenaElo: 1300 });
    s.rivalsReleased = ['gtp-4-turbu']; // передний край 1250 Эло
    expect(releaseModel(s, 'p1', refPrice(s.day), { onSubs: true })).toEqual({ ok: true });
    const m = s.models[0];
    expect(m.review).toBe('required');
    expect(m.onSubs).toBe(false);
    expect(m.onApi).toBe(true);
    const mail = s.mail.find((x) => x.title === 'Нужна внешняя проверка: «Альфа»')!;
    expect(mail).toBeDefined();
    expect(mail.kind).toBe('training');
    expect(s.mail.indexOf(mail)).toBe(s.mail.indexOf(releaseMail(s)) + 1); // сразу после письма о выпуске
    expect(mail.body).toContain('Эло 1 300 против 1 250 у лучшего соперника');
    expect(mail.body).toContain('только по API корпоративным клиентам и разработчикам');
    expect(mail.body).toContain('Проверка займёт 20 дней и стоит $320 тыс.; начать её можно в окне «Модели».');
    expect(setOnSubs(s, 'p1', true)).toEqual({ ok: false, error: 'Сначала пройдите внешнюю проверку.' });
    // Без денег проверка не начинается; с деньгами - pending, подписка всё ещё закрыта.
    s.cash = reviewCost(m) - 1;
    expect(startReview(s, 'p1').ok).toBe(false);
    s.cash = reviewCost(m) + 1;
    expect(startReview(s, 'p1')).toEqual({ ok: true });
    expect(m.review).toBe('pending');
    expect(setOnSubs(s, 'p1', true)).toEqual({ ok: false, error: 'Сначала пройдите внешнюю проверку.' });
    m.review = 'passed';
    expect(setOnSubs(s, 'p1', true)).toEqual({ ok: true });
  });

  it('setOnSubs для невыпущенной модели - ошибка; выключить можно всегда', () => {
    const s = stateOn('2024-06-01');
    expect(setOnSubs(s, 'p1', true).ok).toBe(false);
    expect(setOnSubs(s, 'p1', false).ok).toBe(false);
    releaseModel(s, 'p1', refPrice(s.day), { onSubs: true });
    s.models[0].review = 'required';
    expect(setOnSubs(s, 'p1', false)).toEqual({ ok: true });
  });
});
