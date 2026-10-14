// Сделки 2023-2024: звёздные команды, стартапы, облачная сделка; переманивание команды соперником.

import { describe, expect, it } from 'vitest';
import { cloudDef, MAX_TEAMS, OFFER_DAYS, RIVAL_BUY_HYPE, startupDef, teamDef, TEAM_RETAIN_MONTHS } from '../data/deals';
import { EVENTS, EXTRA_EVENTS } from '../data/events';
import { newGame } from './actions';
import { rentCapFor, rentPerGpuDay } from './compute';
import {
  buyStartup,
  buyStartupError,
  cloudExitFee,
  cloudSignError,
  cloudTerms,
  dealsOpenedDay,
  endCloud,
  hireTeam,
  releaseTeam,
  signCloud,
  startupOffers,
  teamHireError,
} from './deals';
import { applyChoice, modValue, pendingChoice } from './events';
import { newModelEloBonus, trainSpeedMult } from './lateState';
import { executeMove } from './rivalry';
import { deserialize, serialize } from './save';
import { advanceDay } from './tick';
import { dateToDay, dayToDate } from './time';
import type { GameState } from './types';

const D = dateToDay;

function stateOn(date: string, cash = 2e9): GameState {
  const s = newGame('Тест', 3);
  s.day = D(date);
  s.cash = cash;
  s.firedEvents = [...EVENTS, ...EXTRA_EVENTS].map((e) => e.id);
  s.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
  return s;
}

/** Прожить дни до day (не включая его), письма с выбором - вариантом по умолчанию. */
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

describe('сделки: доступность', () => {
  it('до 2023 года сделок нет: ярлыка нет, действия отвечают причиной', () => {
    const s = stateOn('2022-12-31');
    expect(dealsOpenedDay(s)).toBeNull();
    expect(teamHireError(s, 'training')).toBe('Сделки откроются в 2023 году.');
    expect(dealsOpenedDay(stateOn('2023-01-01'))).toBe(D('2023-01-01'));
  });
});

describe('сделки: звёздные команды', () => {
  it('найм: подъёмные сразу, эффект действует, больше двух команд нельзя, отпустить - эффект пропадает', () => {
    const s = stateOn('2023-02-01');
    const cash = s.cash;
    expect(hireTeam(s, 'training')).toEqual({ ok: true });
    expect(cash - s.cash).toBe(teamDef('training').signing);
    expect(trainSpeedMult(s)).toBeCloseTo(1.25, 9);
    expect(hireTeam(s, 'research')).toEqual({ ok: true });
    expect(modValue(s, 'researchCost').mult).toBeCloseTo(0.7, 9);
    expect(teamHireError(s, 'posttrain')).toBe(`Больше ${MAX_TEAMS} команд лаборатория не удержит: сначала отпустите одну.`);
    expect(teamHireError(s, 'training')).toBe('Команда уже работает в лаборатории.');
    expect(releaseTeam(s, 'research')).toEqual({ ok: true });
    expect(modValue(s, 'researchCost').mult).toBe(1);
    expect(hireTeam(s, 'posttrain')).toEqual({ ok: true });
    expect(newModelEloBonus(s, true)).toBe(8);
    expect(newModelEloBonus(s, false)).toBe(0);
  });

  it('без денег нанять нельзя', () => {
    const s = stateOn('2023-02-01', 1e6);
    expect(teamHireError(s, 'training')).toMatch(/^Не хватает денег: нужно \$40 млн/);
  });

  it('зарплата списывается в конце месяца за дни в лаборатории', () => {
    const s = stateOn('2023-03-21');
    hireTeam(s, 'training'); // 21-31 марта: 11 дней из 31
    liveUntil(s, D('2023-04-01'));
    const march = s.finance.history.at(-1)!;
    expect(march.month).toBe(3);
    const salary = (teamDef('training').salary * 11) / 31;
    // В накладных марта есть и обычные расходы: зарплата команды - их часть.
    expect(march.expense.overhead).toBeGreaterThanOrEqual(salary);
    const s2 = stateOn('2023-03-21');
    liveUntil(s2, D('2023-04-01'));
    expect(march.expense.overhead - s2.finance.history.at(-1)!.expense.overhead).toBeCloseTo(salary, 0);
  });

  it('соперник переманивает команду: удержать за полгода зарплаты или отпустить', () => {
    const keep = stateOn('2023-05-01');
    hireTeam(keep, 'posttrain');
    hireTeam(keep, 'research');
    executeMove(keep, { id: 'x', lab: 'openbrain', move: 'poach', fireDay: keep.day });
    const mail = pendingChoice(keep)!;
    expect(mail.eventId).toBe('rival-poach-team');
    expect(mail.title).toBe('OpenBrain переманивает команду: Лин Вэй'); // самая дорогая команда
    const cash = keep.cash;
    applyChoice(keep, mail.id, 0);
    expect(cash - keep.cash).toBe(TEAM_RETAIN_MONTHS * teamDef('posttrain').salary);
    expect(keep.late!.teams.map((t) => t.id)).toEqual(['posttrain', 'research']);

    const lose = stateOn('2023-05-01');
    hireTeam(lose, 'research');
    executeMove(lose, { id: 'x', lab: 'gogle', move: 'poach', fireDay: lose.day });
    const m2 = pendingChoice(lose)!;
    applyChoice(lose, m2.id, 1);
    expect(lose.late!.teams).toEqual([]);
    expect(modValue(lose, 'researchCost').mult).toBe(1);
  });
});

describe('сделки: стартапы', () => {
  it('стартап выходит на продажу письмом; не купили за 45 дней - покупает соперник', () => {
    const def = startupDef('mozaic');
    const s = stateOn('2023-02-27');
    const hype = s.hype[def.rival];
    liveUntil(s, D(def.from) + 1);
    expect(s.mail.some((m) => m.title === 'MozaicML ищет покупателя')).toBe(true);
    expect(startupOffers(s)[0]).toMatchObject({ status: 'open', closeDay: D(def.from) + OFFER_DAYS - 1 });
    liveUntil(s, D(def.from) + OFFER_DAYS + 1);
    expect(startupOffers(s).find((o) => o.def.id === 'mozaic')).toMatchObject({ status: 'rival', lab: 'alibabo' });
    expect(s.hype[def.rival]).toBeGreaterThan(hype + RIVAL_BUY_HYPE - 5); // шумиха за месяц слегка затухает
    expect(s.mail.some((m) => m.title === 'Alibabo купила MozaicML')).toBe(true);
    expect(buyStartupError(s, 'mozaic')).toBe('Стартап уже купила Alibabo.');
  });

  it('покупка: деньги сразу, эффект навсегда (бренд в сегменте, уровень алгоритмов, скорость обучения)', () => {
    const s = stateOn('2024-03-02');
    // Kodeium и Charakter.AI уже ушли соперникам, Inflexion продаётся.
    const algo = s.research.algoLevel;
    const cash = s.cash;
    expect(buyStartup(s, 'inflexion')).toEqual({ ok: true });
    expect(cash - s.cash).toBe(startupDef('inflexion').price);
    expect(s.research.algoLevel).toBe(algo + 1);
    const s2 = stateOn('2023-07-02');
    expect(buyStartup(s2, 'kodeium')).toEqual({ ok: true });
    expect(modValue(s2, 'segBrand', 'player:developers').add).toBeCloseTo(0.25, 9);
    const s3 = stateOn('2023-03-02');
    expect(buyStartup(s3, 'mozaic')).toEqual({ ok: true });
    expect(trainSpeedMult(s3)).toBeCloseTo(1.1, 9);
    expect(buyStartupError(s3, 'mozaic')).toBe('Стартап уже ваш.');
    expect(buyStartupError(s3, 'skale')).toBe('Этот стартап не продаётся.'); // ещё не выставлен
  });
});

/** Состояние с закрытым прошлым месяцем, в котором аренда стоила rent. */
function withLastRent(date: string, rent: number): GameState {
  const s = stateOn(date);
  const prev = dayToDate(D(date) - dayToDate(D(date)).day);
  s.finance.history.push({
    income: { ...s.finance.month.income },
    expense: { ...s.finance.month.expense, rent },
    year: prev.year,
    month: prev.month,
    cashEnd: s.cash,
    marketShare: 0,
    tokensPerDay: 0,
    subscribers: 0,
  });
  return s;
}

describe('сделки: облако', () => {
  it('условия: платёж - аренда прошлого месяца со скидкой партнёра, не меньше минимума; скидка и лимит сразу', () => {
    const s = withLastRent('2023-06-10', 50e6);
    expect(cloudTerms(s, 'azura').monthly).toBe(40e6); // 1 × 50 × (1 − 0,2)
    expect(cloudTerms(s, 'orakle').monthly).toBe(23e6); // 0,5 × 50 × (1 − 0,08)
    expect(cloudTerms(stateOn('2023-06-10'), 'awz').monthly).toBe(cloudDef('awz').minMonthly);
    const price = rentPerGpuDay(s, 'h100');
    const cap = rentCapFor(s, 'h100');
    expect(signCloud(s, 'azura')).toEqual({ ok: true });
    expect(rentPerGpuDay(s, 'h100')).toBeCloseTo(price * 0.8, 6);
    expect(rentCapFor(s, 'h100')).toBe(Math.floor(cap * 1.5));
    expect(cloudSignError(s, 'awz')).toBe('Уже действует сделка с Mikrosoft Azura.');
  });

  it('недобор: аренда за месяц меньше обязательного платежа - разница списывается в конце месяца', () => {
    const s = withLastRent('2023-06-01', 50e6);
    signCloud(s, 'azura'); // весь июнь, карт не арендовано
    liveUntil(s, D('2023-07-01'));
    const june = s.finance.history.at(-1)!;
    expect(june.month).toBe(6);
    expect(june.expense.rent).toBe(40e6);
    expect(s.late!.cloud!.shortfall).toBe(40e6);
    expect(s.mail.some((m) => m.title === 'Доплата по сделке с Mikrosoft Azura: $40 млн')).toBe(true);
  });

  it('расторжение: половина оставшихся платежей, второй раз тот же партнёр сделку не предлагает', () => {
    const s = withLastRent('2023-06-10', 50e6);
    const price = rentPerGpuDay(s, 'h100');
    signCloud(s, 'orakle');
    const fee = cloudExitFee(s);
    expect(fee).toBeCloseTo(0.5 * 23e6 * 12, -6);
    const cash = s.cash;
    expect(endCloud(s)).toEqual({ ok: true });
    expect(cash - s.cash).toBe(fee);
    expect(rentPerGpuDay(s, 'h100')).toBeCloseTo(price, 6);
    expect(cloudSignError(s, 'orakle')).toBe('Сделка с Orakle Cloud уже была: второй раз партнёр её не предлагает.');
    expect(cloudSignError(s, 'awz')).toBeNull();
  });

  it('сделка заканчивается в срок: скидка и лимит пропадают, приходит письмо', () => {
    const s = withLastRent('2023-06-10', 50e6);
    signCloud(s, 'orakle');
    const until = s.late!.cloud!.until;
    liveUntil(s, until + 2);
    expect(s.late!.cloud).toBeNull();
    expect(s.late!.cloudPast).toEqual(['orakle']);
    expect(modValue(s, 'rentPrice').mult).toBe(1);
    expect(s.mail.some((m) => m.title === 'Сделка с Orakle Cloud закончилась')).toBe(true);
  });
});

describe('сделки: сохранение', () => {
  it('сделки сохраняются и загружаются, игра идёт так же', () => {
    const s = withLastRent('2023-06-10', 50e6);
    hireTeam(s, 'posttrain');
    signCloud(s, 'awz');
    liveUntil(s, D('2023-07-05'));
    buyStartup(s, 'kodeium');
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    liveUntil(s, D('2023-09-01'));
    liveUntil(r.state, D('2023-09-01'));
    expect(serialize(r.state)).toBe(serialize(s));
  });

  it('старое сохранение без поля late загружается', () => {
    const s = stateOn('2023-06-10');
    expect(s.late).toBeUndefined();
    expect(deserialize(serialize(s)).ok).toBe(true);
  });
});
