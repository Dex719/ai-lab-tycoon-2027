// Поздняя игра (18.10): промежуточные лаборатории Infleksion и Charakter.AI, письма 2022-2024 и по стране,
// рубежи и автопрочтение почты, старые сохранения без новых лабораторий.

import { describe, expect, it } from 'vitest';
// Сначала симуляция: файлы событий импортируют её модули по кругу, первым должен загрузиться sim.
import { newGame } from './actions';
import { RIVAL_MODELS } from '../data/catalog';
import { COUNTRY_EVENTS, LATE_DATE, LATE_EVENTS } from '../data/lateEvents';
import { LABS } from '../data/labs';
import { buyStartup } from './deals';
import { fireDue, triggerEvent } from './events';
import { MILESTONES, milestonesMonth, NEWS_AUTO_READ_DAYS } from './milestones';
import { labGone, marketRivals, releaseDue } from './rivals';
import { deserialize, serialize } from './save';
import { dateToDay } from './time';
import type { GameState } from './types';

function at(s: GameState, date: string): GameState {
  s.day = dateToDay(date);
  releaseDue(s);
  return s;
}

describe('промежуточные лаборатории', () => {
  it('выходят на рынок в 2022-2023 и уходят в 2024: модели сняты с продажи, но остаются в истории', () => {
    for (const lab of ['infleksion', 'charakter'] as const) {
      const def = LABS.find((l) => l.id === lab)!;
      const models = RIVAL_MODELS.filter((m) => m.lab === lab);
      expect(models.length).toBeGreaterThan(1);
      expect(models.every((m) => m.released >= '2022-01-01' && m.released < def.exit!.date)).toBe(true);
      expect(def.exit!.date >= '2024-01-01' && def.exit!.date <= '2024-12-31').toBe(true);
    }
    const s = at(newGame('Т', 1), '2024-03-18');
    s.firedEvents.push('chat-moment-player', 'chat-moment-rival');
    expect(marketRivals(s, 'api').some((m) => m.lab === 'infleksion')).toBe(true);
    s.day = dateToDay('2024-03-19');
    fireDue(s);
    expect(labGone(s, 'infleksion')).toBe(true);
    expect(labGone(s, 'charakter')).toBe(false);
    expect(marketRivals(s, 'api').some((m) => m.lab === 'infleksion')).toBe(false);
    expect(s.rivalsReleased.some((id) => id.startsWith('infleksion'))).toBe(false);
    expect(s.rivalsRetired).toContain('infleksion-2-5');
    expect(s.hype.infleksion).toBe(0);
    expect(s.rivalry.cooldownUntil.infleksion).toBeGreaterThan(dateToDay('2030-01-01'));
    expect(s.mail.at(-1)?.title).toBe('Infleksion уходит с рынка');
    // Модели ушедшей лаборатории не выходят снова.
    releaseDue(s);
    expect(s.rivalsReleased.some((id) => id.startsWith('infleksion'))).toBe(false);
  });

  it('купили стартап в «Сделках» - лаборатория уходит сразу, письмо о переходе команды к вам', () => {
    const s = at(newGame('Т', 1), '2024-06-20');
    s.cash = 1e9;
    expect(buyStartup(s, 'charakter').ok).toBe(true);
    fireDue(s);
    expect(labGone(s, 'charakter')).toBe(true);
    expect(s.mail.at(-1)?.title).toBe('Charakter.AI теперь часть вашей лаборатории');
    expect(s.rivalsReleased.some((id) => id.startsWith('charakter'))).toBe(false);
  });

  it('старое сохранение без новых лабораторий загружается: строки дописаны нулями', () => {
    const s = newGame('Т', 1);
    const o = JSON.parse(serialize(s));
    for (const lab of ['infleksion', 'charakter']) {
      delete o.hype[lab];
      delete o.rivalry.heat[lab];
      delete o.rivalry.cooldownUntil[lab];
      delete o.rivalry.extraCount[lab];
      delete o.rivalry.memory[lab];
      delete o.rivalry.shareHigh[lab];
      delete o.market.labShares[lab];
      for (const seg of Object.values(o.market.segments) as { labShares: Record<string, number> }[]) delete seg.labShares[lab];
      if (o.duel) delete o.duel.labs[lab];
    }
    const r = deserialize(JSON.stringify(o));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.hype.charakter).toBe(0);
  });
});

describe('письма поздней игры и по стране', () => {
  it('у каждого письма есть дата, и оно не приходит раньше неё; у каждого - вариант-отказ последним', () => {
    for (const def of [...LATE_EVENTS, ...COUNTRY_EVENTS]) {
      const date = LATE_DATE[def.id];
      expect(date, def.id).toBeTruthy();
      const s = newGame('Т', 1, 'normal', def.id.startsWith('us-') ? 'us' : def.id.startsWith('cn-') ? 'cn' : def.id.startsWith('eu-') ? 'eu' : undefined);
      s.models.push({ id: 'p1', releasedDay: 0, onApi: true, onSubs: true, arenaElo: 1000, name: 'М', plan: { tier: 'mid' } } as never);
      s.day = dateToDay(date) - 1;
      expect('check' in def.when && def.when.check(s), def.id).toBe(false);
      s.day = dateToDay(date);
      expect('check' in def.when && def.when.check(s), def.id).toBe(true);
      expect(def.choices!.length, def.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('письма страны приходят только лаборатории этой страны', () => {
    for (const def of COUNTRY_EVENTS) {
      const own = def.id.slice(0, 2) as 'us' | 'cn' | 'eu';
      for (const c of ['us', 'cn', 'eu'] as const) {
        const s = newGame('Т', 1, 'normal', c);
        s.day = dateToDay(LATE_DATE[def.id]);
        expect('check' in def.when && def.when.check(s), `${def.id} ${c}`).toBe(c === own);
      }
      const none = newGame('Т', 1);
      none.day = dateToDay(LATE_DATE[def.id]);
      expect('check' in def.when && def.when.check(none), def.id).toBe(false);
    }
  });

  it('варианты писем работают: деньги, модификаторы, доля основателя', () => {
    const s = newGame('Т', 1);
    s.day = dateToDay('2022-11-07');
    triggerEvent(s, 'late-corp-partner');
    const cash = s.cash;
    const def = LATE_EVENTS.find((e) => e.id === 'late-corp-partner')!;
    def.choices![0].apply(s);
    expect(s.cash).toBeGreaterThan(cash);
    expect(s.founderShare).toBeCloseTo(0.9, 9);
    expect(s.modifiers.some((m) => m.id === 'late-corp-cloud' && m.kind === 'rentPrice')).toBe(true);
  });
});

describe('рубежи и почта', () => {
  it('рубеж - одно письмо-награда за партию и немного шумихи', () => {
    const s = newGame('Т', 1);
    s.market.labShares.player = 0.3;
    const hype = s.hype.player;
    milestonesMonth(s);
    milestonesMonth(s);
    const got = s.mail.filter((m) => m.reward && MILESTONES.some((x) => x.title === m.title));
    expect(got.map((m) => m.title)).toEqual(['Каждый десятый клиент - ваш', 'Четверть рынка']);
    expect(s.hype.player).toBeGreaterThan(hype);
  });

  it('письма старше месяца прочитаны сами, кроме ждущих решения', () => {
    const s = newGame('Т', 1);
    s.day = dateToDay('2022-11-07');
    triggerEvent(s, 'late-corp-partner');
    s.mail.push({ id: 'mx', day: s.day, title: 'Новость', body: 'Текст', kind: 'news', read: false, important: true });
    s.day += NEWS_AUTO_READ_DAYS;
    milestonesMonth(s);
    expect(s.mail.find((m) => m.id === 'mx')!.read).toBe(true);
    expect(s.mail.find((m) => m.eventId === 'late-corp-partner')!.read).toBe(false);
    expect(s.mail.filter((m) => !m.read && !m.choices)).toHaveLength(0);
  });
});
