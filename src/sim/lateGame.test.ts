// Поздняя игра (18.10): промежуточные лаборатории Infleksion и Charakter.AI, письма 2022-2024 и по стране,
// рубежи и автопрочтение почты, старые сохранения без новых лабораторий.

import { describe, expect, it } from 'vitest';
// Сначала симуляция: файлы событий импортируют её модули по кругу, первым должен загрузиться sim.
import { newGame } from './actions';
import { RIVAL_MODELS } from '../data/catalog';
import { amount, REFUSE_HINT, usd } from '../data/eventKit';
import { COUNTRY_EVENTS, LATE_DATE, LATE_EVENTS } from '../data/lateEvents';
import { LABS } from '../data/labs';
import { buyStartup } from './deals';
import { applyChoice, fireDue, triggerEvent } from './events';
import { minPrice } from './market';
import { MILESTONES, milestonesMonth, NEWS_AUTO_READ_DAYS } from './milestones';
import { labGone, marketRivals, releaseDue } from './rivals';
import { deserialize, serialize } from './save';
import { dateToDay } from './time';
import type { GameState, Mail } from './types';

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
    expect(s.modifiers.some((m) => m.id === 'late-corp-reports' && m.kind === 'researchCost' && m.mult === 1.2)).toBe(true);
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

describe('письма 2024 года: ценовая война, акции, мини-модель, заказ агента', () => {
  const def = (id: string) => LATE_EVENTS.find((e) => e.id === id)!;
  const gate = (id: string, s: GameState): boolean => {
    const w = def(id).when;
    return 'check' in w && w.check(s);
  };
  const at2024 = (date: string, cash = 1e9): GameState => {
    const s = newGame('Т', 1);
    s.day = dateToDay(date);
    s.cash = cash;
    s.models = [];
    return s;
  };
  const onSale = (s: GameState, price = 10): void => {
    s.models.push({ id: 'p1', releasedDay: 0, onApi: true, onSubs: false, arenaElo: 1000, price, plan: { tier: 'mid' } } as never);
  };
  const letter = (s: GameState, id: string): Mail => s.mail.find((m) => m.eventId === id)!;

  it('ценовая война: не раньше выхода DeepSeek-V2 и только при модели в продаже', () => {
    const s = at2024('2024-05-10');
    expect(gate('late-price-war', s)).toBe(false);
    onSale(s);
    s.rivalry.extra['deepseak-v2'] = dateToDay('2024-05-20');
    expect(gate('late-price-war', s)).toBe(false);
    s.day = dateToDay('2024-05-20');
    expect(gate('late-price-war', s)).toBe(true);
  });

  it('ценовая война: 10.05.2024 приходит с тремя вариантами, цены соперника падают; отказ по умолчанию не трогает деньги и модели', () => {
    const s = at2024('2024-05-10');
    onSale(s);
    expect(gate('late-price-war', s)).toBe(true);
    triggerEvent(s, 'late-price-war');
    const mail = letter(s, 'late-price-war');
    expect(mail.choices).toHaveLength(3);
    expect(mail.defaultChoice).toBe(2);
    expect(mail.choices![2].label).toBe('Не менять цены');
    expect(mail.choices![2].hint).toBe(REFUSE_HINT);
    const mod = s.modifiers.find((m) => m.id === 'late-price-war-deepcent');
    expect(mod).toMatchObject({ kind: 'rivalPrice', target: 'deepcent', mult: 0.7, untilDay: s.day + 120 });
    const cash = s.cash;
    const rep = s.reputation;
    const prices = s.models.map((m) => m.price);
    applyChoice(s, mail.id, 2);
    expect(s.cash).toBe(cash);
    expect(s.reputation).toBe(rep);
    expect(s.models.map((m) => m.price)).toEqual(prices);
    expect(s.modifiers.some((m) => m.id.startsWith('late-price-war-dev') || m.id.startsWith('late-price-war-ent'))).toBe(false);
    expect(s.modifiers.find((m) => m.id === 'refuse-focus')?.mult).toBe(0.95);
  });

  it('ценовая война: скидка разработчикам стоит 1,5 единицы года с кассой и даёт разработчиков', () => {
    const s = at2024('2024-05-10', 1e9);
    onSale(s);
    triggerEvent(s, 'late-price-war');
    const mail = letter(s, 'late-price-war');
    const sum = amount(s, 1.5);
    expect(mail.choices![0].hint).toContain(usd(sum));
    const cash = s.cash;
    applyChoice(s, mail.id, 0);
    expect(cash - s.cash).toBe(sum);
    expect(s.modifiers.find((m) => m.id === 'late-price-war-dev')).toMatchObject({ kind: 'segBrand', target: 'player:developers', add: 0.2 });
  });

  it('акции: сумма в тексте письма, в подсказке и в деньгах одна и та же; растёт с кассой', () => {
    const rich = at2024('2024-06-20', 1e9);
    onSale(rich);
    triggerEvent(rich, 'late-ai-stocks');
    const mail = letter(rich, 'late-ai-stocks');
    const sum = amount(rich, 6);
    expect(mail.body).toContain(usd(sum));
    expect(mail.choices![0].hint).toContain(usd(sum));
    const cash = rich.cash;
    const share = rich.founderShare;
    applyChoice(rich, mail.id, 0);
    expect(rich.cash - cash).toBe(sum);
    expect(share - rich.founderShare).toBeCloseTo(0.02, 9);

    const poor = at2024('2024-06-20', 1e8);
    expect(amount(poor, 6)).toBeLessThan(sum);
  });

  it('мини-модель: модель в продаже нужна, соперник должен выпустить gtp-4o-mino; снижение цен не ниже минимума рынка', () => {
    const s = at2024('2024-07-18', 1e9);
    onSale(s, 10);
    s.rivalry.extra['gtp-4o-mino'] = dateToDay('2024-08-01');
    expect(gate('late-rival-mini', s)).toBe(false);
    delete s.rivalry.extra['gtp-4o-mino'];
    expect(gate('late-rival-mini', s)).toBe(true);

    triggerEvent(s, 'late-rival-mini');
    const mail = letter(s, 'late-rival-mini');
    expect(s.hype.openbrain).toBeGreaterThan(0);
    applyChoice(s, mail.id, 0);
    expect(s.models[0].price).toBeCloseTo(Math.max(minPrice(s.day), 8), 9);
  });

  it('заказ агента: отказ по умолчанию - «Промолчать», у каждого из четырёх писем последний вариант - отказ с честной подсказкой', () => {
    const labels: Record<string, string> = {
      'late-price-war': 'Не менять цены',
      'late-ai-stocks': 'Не продавать',
      'late-rival-mini': 'Держать цены',
      'late-agent-order': 'Промолчать',
    };
    for (const [id, label] of Object.entries(labels)) {
      const s = at2024(LATE_DATE[id], 1e9);
      onSale(s);
      triggerEvent(s, id);
      const mail = letter(s, id);
      expect(mail.defaultChoice, id).toBe(mail.choices!.length - 1);
      expect(mail.choices![mail.choices!.length - 1].label, id).toBe(label);
      expect(mail.choices![mail.choices!.length - 1].hint, id).toBe(REFUSE_HINT);
    }
    const s = at2024('2024-11-12', 1e9);
    expect(gate('late-agent-order', s)).toBe(false);
    onSale(s);
    expect(gate('late-agent-order', s)).toBe(true);
  });
});
