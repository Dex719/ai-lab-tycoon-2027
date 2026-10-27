// Волна 2 идей (18.10): испытания и условия мира, ред-тиминг и скрытые уязвимости.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { challengeBlock, challengeScoreMult } from './challenges';
import { buildError } from './datacenters';
import { modValue } from './events';
import { canRaise } from './investors';
import { BOARD_RETURN_EVENT, boardBlock, boardDay, boardMonth, OUSTER_DAYS } from './board';
import { applyChoice } from './events';
import { COFOUNDER_LIMIT, dispute, disputeWarning, planDisputes, releaseDisputed } from './cofounder';
import { reviewsDay } from './reviews';
import { CODER_OPEN, coderBlock, coderTarget, launchCoder, productsDay } from './products';
import { holesAtBirth, holesMonth, redTeamBlock, redTeamCost, redTeamDay, REDTEAM, startRedTeam } from './redteam';
import { deserialize, serialize } from './save';
import { staffOf } from './staff';
import { dateToDay } from './time';
import { validatePlan } from './training';
import type { GameState, PlayerModel, TrainingPlan } from './types';

const PLAN: TrainingPlan = {
  name: 'М', paramsB: 0.2, tokensB: 4, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
  benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'mid', checkpoint: 'normal',
};

function model(s: GameState, holes?: number): PlayerModel {
  const m = { id: `p${s.models.length + 1}`, name: 'Модель', releasedDay: 0, onApi: true, onSubs: false, arenaElo: 700, exposed: false, plan: PLAN, holes } as unknown as PlayerModel;
  s.models.push(m);
  return m;
}

describe('испытания и условия мира', () => {
  it('запреты срабатывают, модификаторы ставятся, множитель счёта складывается', () => {
    const s = newGame('Т', 1, 'normal', undefined, { challenges: ['no-investors', 'honest', 'rent-only'], worldMods: ['gpu-shortage', 'generous-funds'] });
    expect(canRaise(s)).toMatch(/Без инвесторов/);
    expect(buildError(s, 'abilene', 10)).toMatch(/Только аренда/);
    expect(challengeBlock(s, 'stolen')).toMatch(/Честная/);
    expect(validatePlan(s, { ...PLAN, stolenData: true })).toMatch(/Честная/);
    expect(modValue(s, 'rentPrice').mult).toBeCloseTo(1.3, 9);
    expect(challengeScoreMult(s)).toBeCloseTo(1 + 0.3 + 0.15 + 0.15 + 0.15 - 0.15, 9);
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.challenges).toEqual(['no-investors', 'honest', 'rent-only']);
    const plain = newGame('Т', 1);
    expect(challengeScoreMult(plain)).toBe(1);
    expect(challengeBlock(plain, 'raise')).toBeNull();
  });
});

describe('ред-тиминг', () => {
  it('дыр больше у флагмана и на чужих данных, меньше с RLHF', () => {
    expect(holesAtBirth({ plan: { ...PLAN, tier: 'light' }, rlhf: false })).toBe(3);
    expect(holesAtBirth({ plan: { ...PLAN, tier: 'flagship', stolenData: true }, rlhf: false })).toBe(6);
    expect(holesAtBirth({ plan: { ...PLAN, tier: 'light' }, rlhf: true })).toBe(2);
  });

  it('проверка стоит денег, идёт дни, закрывает часть дыр и пишет отчёт', () => {
    const s = newGame('Т', 1);
    const m = model(s, 4);
    s.cash = 1e9;
    const cash = s.cash;
    expect(startRedTeam(s, m.id, 'full').ok).toBe(true);
    expect(s.cash).toBe(cash - redTeamCost(s, 'full'));
    expect(redTeamBlock(s, m, 'quick')).toMatch(/Проверка идёт/);
    s.day += REDTEAM.full.days - 1;
    redTeamDay(s);
    expect(m.holes).toBe(4);
    s.day += 1;
    redTeamDay(s);
    expect(m.holes).toBe(1);
    expect(s.mail.some((x) => x.title.startsWith('Проверка модели «Модель»: найдено 4, закрыто 3'))).toBe(true);
    const old = model(s);
    expect(redTeamBlock(s, old, 'quick')).toMatch(/до появления/);
  });

  it('дыры всплывают инцидентами у моделей в продаже; без дыр (боты) - никогда', () => {
    const s = newGame('Т', 2);
    const m = model(s, 5);
    s.reputation = 50;
    let incidents = 0;
    for (let i = 0; i < 120 && m.holes; i++) {
      s.day += 30;
      const before = m.holes!;
      holesMonth(s);
      if (m.holes! < before) incidents++;
    }
    expect(incidents).toBeGreaterThan(0);
    expect(s.reputation).toBeLessThan(50);
    const bot = newGame('Т', 2);
    model(bot);
    for (let i = 0; i < 120; i++) {
      bot.day += 30;
      holesMonth(bot);
    }
    expect(bot.mail.some((x) => x.title.startsWith('Пользователи обошли'))).toBe(false);
  });
});

function coderModel(s: GameState): void {
  const m = model(s);
  Object.assign(m, { caps: { language: 40, code: 40, reasoning: 40 }, overfit: {} });
  s.benchmarks.humaneval.introduced = true;
}

describe('ИИ-программист', () => {
  it('открывается в июле 2021 года, лист ожидания ждёт 30 дней, места растут к цели и дают подписку', () => {
    const s = newGame('Т', 1);
    coderModel(s);
    s.day = dateToDay(CODER_OPEN) - 1;
    expect(coderBlock(s, 'beta')).toMatch(/Рынка/);
    s.day += 1;
    productsDay(s);
    expect(s.mail.some((m) => m.title === 'Разработчики ждут помощника для кода')).toBe(true);
    expect(launchCoder(s, 'waitlist').ok).toBe(true);
    expect(coderBlock(s, 'beta')).toMatch(/уже запущен/);
    const cash = s.cash;
    for (let i = 0; i < 29; i++) {
      s.day++;
      productsDay(s);
    }
    expect(s.coder!.seats).toBe(0);
    expect(s.cash).toBe(cash);
    for (let i = 0; i < 60; i++) {
      s.day++;
      productsDay(s);
    }
    expect(s.coder!.seats).toBeGreaterThan(coderTarget(s) * 0.7);
    expect(s.coder!.earned).toBeGreaterThan(0);
    expect(s.cash).toBeGreaterThan(cash);
    const clean = newGame('Т', 1);
    clean.coder = { ...s.coder! };
    const back = deserialize(serialize(clean));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.coder?.mode).toBe('waitlist');
  });

  it('презентация стоит денег и даёт шумиху; без модели в продаже запустить нельзя', () => {
    const s = newGame('Т', 4);
    s.day = dateToDay(CODER_OPEN);
    expect(coderBlock(s, 'beta')).toMatch(/модель/);
    coderModel(s);
    s.cash = 1e9;
    const hype = s.hype.player;
    expect(launchCoder(s, 'show').ok).toBe(true);
    expect(s.hype.player).toBeGreaterThan(hype);
    expect(s.cash).toBeLessThan(1e9);
    expect(s.coder!.seats).toBeGreaterThan(0);
  });
});

describe('совет директоров', () => {
  it('только у партий из окна игры; доверие падает, отставка на пять дней, потом возвращение с выбором', () => {
    const bot = newGame('Т', 1);
    bot.founderShare = 0.4;
    model(bot).plan = { ...PLAN, checkpoint: undefined }; // боты собирают план без выбора сохранений
    boardMonth(bot);
    expect(bot.board).toBeUndefined();

    const s = newGame('Т', 1);
    s.founderShare = 0.4;
    model(s); // план с checkpoint - партия из окна игры
    boardMonth(s);
    expect(s.board?.trust).toBe(60);
    s.cash = 0;
    for (let i = 0; i < 12 && s.board!.oustedDay === undefined; i++) {
      s.finance.history.push({ placeEnd: 8, income: { api: 0, subs: 0, contracts: 0, investors: 0 }, expense: { rent: 1e6, overhead: 0, labelers: 0, penalties: 0, review: 0, capex: 0, power: 0 } } as never);
      s.day += 30;
      boardMonth(s);
    }
    expect(s.board!.oustedDay).toBeDefined();
    expect(boardBlock(s)).toMatch(/отстранён/);
    expect(validatePlan(s, PLAN)).toMatch(/отстранён/);
    s.day += OUSTER_DAYS;
    boardDay(s);
    const mail = s.mail.find((m) => m.eventId === BOARD_RETURN_EVENT);
    expect(mail).toBeDefined();
    expect(applyChoice(s, mail!.id, 0).ok).toBe(true);
    expect(boardBlock(s)).toBeNull();
    expect(s.board!.trust).toBe(80);
    const clean = newGame('Т', 1);
    clean.board = { ...s.board! };
    expect(deserialize(serialize(clean)).ok).toBe(true);
  });
});

describe('сооснователь', () => {
  it('даёт выгоду, спорит перед спорными решениями и после третьего спора уходит с частью команды', () => {
    const s = newGame('Т', 1, 'normal', undefined, { cofounder: 'scientist' });
    expect(modValue(s, 'researchCost').mult).toBeCloseTo(0.88, 9);
    expect(planDisputes(PLAN)).toEqual([]);
    expect(disputeWarning(s, planDisputes({ ...PLAN, benchShare: 0.1 }))).toMatch(/Спор 1 из 3/);
    staffOf(s).people = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, name: 'С', role: 'research' as const, level: 1, xp: 0, salary: 1, trait: null, startDay: 0, readyDay: 0 }));
    for (let i = 0; i < COFOUNDER_LIMIT - 1; i++) dispute(s, ['overfit']);
    expect(disputeWarning(s, ['stolen'])).toMatch(/третий спор/);
    dispute(s, ['stolen']);
    expect(s.cofounder!.leftDay).toBe(s.day);
    expect(staffOf(s).people.length).toBe(8);
    expect(modValue(s, 'researchCost').mult).toBe(1);
    expect(disputeWarning(s, ['overfit'])).toBeNull();
    expect(s.mail.some((m) => m.title === 'Ева Штерн уходит из лаборатории')).toBe(true);
    const back = deserialize(serialize(newGame('Т', 1, 'normal', undefined, { cofounder: 'seller' })));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.cofounder?.id).toBe('seller');
  });

  it('первый выпуск партии не спорен, следующий без ред-тиминга - спорен (QA 19.10)', () => {
    const s = newGame('Т', 1, 'normal', undefined, { cofounder: 'engineer' });
    const unchecked = { holes: holesAtBirth({ plan: PLAN, rlhf: false }), redTeamDone: false };
    expect(unchecked.holes).toBe(4);
    expect(releaseDisputed(s, unchecked)).toBe(false); // в продаже ещё ничего: идёт по подсказкам обучения
    model(s, 4); // первая модель выпущена
    expect(releaseDisputed(s, unchecked)).toBe(true);
    expect(releaseDisputed(s, { ...unchecked, redTeamDone: true })).toBe(false);
  });
});

describe('отзывы о модели', () => {
  it('через 7 и 30 дней по настоящим баллам; подгонку замечают; у моделей ботов отзывов нет', () => {
    const s = newGame('Т', 1);
    s.benchmarks.humaneval.introduced = true;
    const m = model(s);
    Object.assign(m, { caps: { language: 40, code: 40, reasoning: 40 }, overfit: { humaneval: 30 }, earnedSubs: 0, earned: 5e5 });
    m.plan = { ...PLAN, benchShare: 0.2, benchTargets: ['humaneval'] };
    const hype = (s.hype.player = 50);
    s.day = 7;
    reviewsDay(s);
    const week = s.mail.find((x) => x.title === 'Отзывы о «Модель»: первая неделя');
    expect(week?.body).toMatch(/слабее, чем в таблице/);
    expect(s.hype.player).toBeLessThan(hype);
    s.day = 30;
    reviewsDay(s);
    expect(s.mail.some((x) => x.title === 'Отзывы о «Модель»: месяц в продаже')).toBe(true);
    expect(s.mail.every((x) => !/undefined|NaN/.test(x.body))).toBe(true);
    const bot = newGame('Т', 1);
    model(bot).plan = { ...PLAN, checkpoint: undefined };
    bot.day = 7;
    reviewsDay(bot);
    expect(bot.mail.some((x) => x.title.startsWith('Отзывы'))).toBe(false);
  });
});
