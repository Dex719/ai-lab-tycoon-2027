// Волна 1 идей (18.10): рекорды, выкуп доли, концовки и счёт, утечка планов соперника, свой переводчик, сбои кластера.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { LEAK_EVENT } from '../data/lateEvents';
import { rentNow } from './compute';
import { endingOf, epilogueOf, partyScore } from './ending';
import { BUYBACK_GAP_DAYS, buybackError, buyBackStake, buybackStepCost } from './investors';
import { leakDay, LEAK_ID, lastChoiceDay } from './randomEvents';
import { recordsMonth } from './records';
import { deserialize, serialize } from './save';
import { dateToDay } from './time';
import { CHECKPOINT_FLOP, clusterFailChance, planFlop, progressDay, startTraining } from './training';
import { launchTranslator, translatorBlock, translatorDay, translatorPerDay } from './translator';
import type { GameState, PlayerModel, TrainingPlan } from './types';

const PLAN: TrainingPlan = {
  name: 'М', paramsB: 0.2, tokensB: 4, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
  benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'mid',
};

function released(s: GameState, elo = 700): void {
  s.models.push({ id: `p${s.models.length + 1}`, name: 'Модель', releasedDay: 0, onApi: true, onSubs: false, arenaElo: elo, exposed: false, plan: PLAN } as unknown as PlayerModel);
}

describe('рекорды', () => {
  it('первое значение молча, улучшение - рекорд с прошлым значением; шум не считается', () => {
    const s = newGame('Т', 1);
    released(s, 600);
    recordsMonth(s);
    expect(s.records?.elo).toMatchObject({ value: 600, prev: null });
    (s.models[0] as PlayerModel).arenaElo = 601;
    expect(recordsMonth(s)).not.toContain('elo');
    (s.models[0] as PlayerModel).arenaElo = 700;
    s.day = 40;
    expect(recordsMonth(s)).toContain('elo');
    expect(s.records?.elo).toEqual({ value: 700, day: 40, prev: 600 });
    const clean = newGame('Т', 1);
    clean.records = { elo: { value: 700, day: 40, prev: 600 } };
    clean.translator = { launchedDay: 3, earned: 10 };
    clean.lastBuybackDay = 5;
    const back = deserialize(serialize(clean));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.records?.elo?.prev).toBe(600);
  });
});

describe('выкуп доли', () => {
  it('5 % по оценке с надбавкой, раз в квартал, только если хватает денег', () => {
    const s = newGame('Т', 1);
    s.founderShare = 0.4;
    s.cash = 0;
    expect(buybackError(s)).toMatch(/Не хватает денег/);
    s.cash = 1e9;
    const cost = buybackStepCost(s);
    expect(buyBackStake(s).ok).toBe(true);
    expect(s.founderShare).toBeCloseTo(0.45, 9);
    expect(s.cash).toBeCloseTo(1e9 - cost, 3);
    expect(buybackError(s)).toMatch(/Следующий выкуп/);
    s.day += BUYBACK_GAP_DAYS;
    expect(buybackError(s)).toBeNull();
    s.founderShare = 1;
    expect(buybackError(s)).toBe('Вся компания уже ваша');
  });
});

describe('конец партии', () => {
  it('счёт растёт с местом и сложностью; концовка зависит от доли и честности; эпилог без пустых строк', () => {
    const s = newGame('Т', 1, 'hard');
    released(s, 1300);
    s.outcome = 'victory';
    s.finance.history.push({ placeEnd: 1 } as never);
    s.monthsFirst = 20;
    const score = partyScore(s);
    expect(score.mult).toBe(1.3);
    expect(score.total).toBeGreaterThan(1300);
    expect(endingOf(s).title).toBe('Лидер гонки');
    s.founderShare = 0.3;
    expect(endingOf(s).title).toBe('Победа на чужие деньги');
    s.outcome = 'finished';
    s.founderShare = 0.2;
    expect(endingOf(s).title).toBe('Компанию забрал совет');
    s.outcome = 'bankrupt';
    expect(partyScore(s).parts[0].value).toBe(0);
    expect(epilogueOf(s).every((l) => l.length > 10 && !/undefined|NaN/.test(l))).toBe(true);
  });
});

describe('утечка планов соперника', () => {
  it('не из общего жребия: своё расписание, отложена, не считается последним решением', () => {
    expect(LEAK_EVENT.random).toBeUndefined();
    const s = newGame('Т', 5);
    let fired = -1;
    for (let d = dateToDay('2019-01-01'); d < dateToDay('2022-12-31') && fired < 0; d++) {
      s.day = d;
      leakDay(s);
      if (s.mail.some((m) => m.eventId === LEAK_ID)) fired = d;
    }
    expect(fired).toBeGreaterThan(0);
    const m = s.mail.find((x) => x.eventId === LEAK_ID)!;
    expect(m.deferred).toBe(true);
    expect(lastChoiceDay(s)).not.toBe(m.day);
  });
});

describe('свой переводчик', () => {
  it('нужны «Механизм внимания» и модель; приносит выручку каждый день; после 2020 года не запустить', () => {
    const s = newGame('Т', 1);
    expect(translatorBlock(s)).toMatch(/Механизм внимания/);
    s.research.done.push('attention');
    expect(translatorBlock(s)).toMatch(/модель/);
    released(s, 750);
    expect(launchTranslator(s).ok).toBe(true);
    const cash = s.cash;
    translatorDay(s);
    expect(s.cash - cash).toBe(translatorPerDay(s));
    expect(s.translator!.earned).toBe(translatorPerDay(s));
    const late = newGame('Т', 1);
    late.day = dateToDay('2021-02-01');
    late.research.done.push('attention');
    released(late);
    expect(translatorBlock(late)).toMatch(/API/);
  });
});

describe('сбои кластера', () => {
  it('частые сохранения дороже; без режима (боты) сбоев нет; сбой откатывает и пишет письмо', () => {
    expect(planFlop({ ...PLAN, checkpoint: 'often' }) / planFlop(PLAN)).toBeCloseTo(CHECKPOINT_FLOP.often, 9);
    const s = newGame('Т', 3);
    rentNow(s, 'p100', 512);
    released(s);
    expect(clusterFailChance(s)).toBeGreaterThanOrEqual(0.04);
    expect(startTraining(s, { ...PLAN, paramsB: 0.3, tokensB: 6, checkpoint: 'rare', name: 'Сбойная' }).ok).toBe(true);
    s.trainings[0].flopTotal = 1e30; // обучение не кончится за время проверки
    for (let i = 0; i < 400; i++) {
      s.day++;
      progressDay(s);
    }
    expect(s.mail.some((m) => m.title.startsWith('Сбой на кластере: «Сбойная»'))).toBe(true);
    const bot = newGame('Т', 3);
    rentNow(bot, 'p100', 512);
    released(bot);
    expect(startTraining(bot, { ...PLAN, paramsB: 0.3, tokensB: 6, name: 'Бот' }).ok).toBe(true);
    bot.trainings[0].flopTotal = 1e30;
    for (let i = 0; i < 400; i++) {
      bot.day++;
      progressDay(bot);
    }
    expect(bot.mail.some((m) => m.title.startsWith('Сбой на кластере'))).toBe(false);
  });
});
