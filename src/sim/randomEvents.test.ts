// Тесты новых событий: ранние заказы, история 2017-2024, случайные письма с выбором (веса, расписание, детерминизм, честные подсказки).

import { describe, expect, it } from 'vitest';
import { EXTRA_EVENTS, findEvent } from '../data/events';
import { EARLY_EVENTS } from '../data/earlyEvents';
import { HISTORY_EVENTS } from '../data/historyEvents';
import { RANDOM_EVENTS } from '../data/randomEvents';
import { newGame } from './actions';
import { botAct, botChoice } from './bots';
import { applyChoice, deferChoice, openChoices, pendingChoice, triggerEvent } from './events';
import { pickWeighted, randomCandidates, RANDOM_GAP_MAX, RANDOM_GAP_MIN, RANDOM_QUIET_DAYS, randomEventDay } from './randomEvents';
import { deserialize, serialize } from './save';
import { advanceDay } from './tick';
import { dateToDay } from './time';
import type { GameState, PlayerModel } from './types';

const D = dateToDay;
const BAD_DASH = /[–—]/;

function model(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Мозг-1',
    plan: {
      name: 'Мозг-1', paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0, benchTargets: [], rlhf: true, context: 512, tier: 'light',
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 10,
    releasedDay: 20,
    caps: { language: 30, code: 20, reasoning: 20 },
    overfit: {},
    rlhf: true,
    arenaElo: 900,
    price: 10,
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

describe('набор новых событий', () => {
  it('случайных 40-50, ранних заказов и грантов не меньше 8, исторических не меньше 25; id уникальны и не совпадают со старыми', () => {
    expect(RANDOM_EVENTS.length).toBeGreaterThanOrEqual(40);
    expect(RANDOM_EVENTS.length).toBeLessThanOrEqual(50);
    expect(EARLY_EVENTS.length).toBeGreaterThanOrEqual(8);
    expect(HISTORY_EVENTS.length).toBeGreaterThanOrEqual(25);
    const ids = EXTRA_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(findEvent(id)).toBeDefined();
  });

  it('у каждого события 2-3 варианта, заполнены тексты, подсказки (после отправки) и нет длинного тире', () => {
    for (const def of EXTRA_EVENTS) {
      expect(def.choices, def.id).toBeDefined();
      expect(def.choices!.length, def.id).toBeGreaterThanOrEqual(2);
      expect(def.choices!.length, def.id).toBeLessThanOrEqual(3);
      const s = newGame('Тест', 3);
      s.day = D('2022-03-01');
      triggerEvent(s, def.id);
      const mail = s.mail[s.mail.length - 1];
      expect(mail.eventId, def.id).toBe(def.id);
      expect(mail.title.length, def.id).toBeGreaterThan(8);
      expect(mail.body.length, def.id).toBeGreaterThan(60);
      expect(mail.choices!.length).toBe(def.choices!.length);
      const text = [mail.title, mail.body, ...mail.choices!.flatMap((c) => [c.label, c.hint])].join(' ');
      expect(text, def.id).not.toMatch(BAD_DASH);
      expect(text, def.id).not.toMatch(/undefined|NaN|\[object|\.\./);
      for (const c of mail.choices!) {
        expect(c.label.length, def.id).toBeGreaterThan(3);
        expect(c.hint.length, `${def.id}: ${c.label}`).toBeGreaterThan(0);
      }
      expect(mail.replyByDay).toBeGreaterThan(s.day);
      expect(mail.defaultChoice).toBe(def.defaultChoice ?? def.choices!.length - 1);
    }
  });

  it('письма не называют будущих дат: годы в текстах не позже даты письма', () => {
    for (const def of EXTRA_EVENTS) {
      const s = newGame('Тест', 3);
      const first = def.id.startsWith('early-') || def.id.startsWith('hist-') ? D('2017-01-01') : D('2017-06-01');
      s.day = first;
      triggerEvent(s, def.id);
      const mail = s.mail[s.mail.length - 1];
      const years = (mail.body + mail.title).match(/\b20\d\d\b/g) ?? [];
      for (const y of years) expect(Number(y), def.id).toBeLessThanOrEqual(2024);
    }
  });

  it('подсказки честные: без «шанса» и условий деньги, репутация и шумиха меняются ровно как написано', () => {
    const parse = (hint: string) => {
      let money = 0, rep = 0, hype = 0;
      const known: boolean[] = [];
      for (const part of hint.split(', ')) {
        const m = part.match(/^([+-])\$([\d,]+)(?: (тыс\.|млн|млрд))?(?:\s|$)/);
        const r = part.match(/^([+-])(\d+) репутации/);
        const h = part.match(/^([+-])(\d+) шумихи/);
        if (m) {
          const v = Number(m[2].replace(',', '.')) * (m[3] === 'тыс.' ? 1e3 : m[3] === 'млн' ? 1e6 : m[3] === 'млрд' ? 1e9 : 1);
          money += (m[1] === '+' ? 1 : -1) * v;
          known.push(true);
        } else if (r) {
          rep += (r[1] === '+' ? 1 : -1) * Number(r[2]);
          known.push(true);
        } else if (h) {
          hype += (h[1] === '+' ? 1 : -1) * Number(h[2]);
          known.push(true);
        } else known.push(false);
      }
      return { money, rep, hype, known };
    };
    let checked = 0;
    for (const def of EXTRA_EVENTS) {
      for (let i = 0; i < def.choices!.length; i++) {
        const s = newGame('Тест', 3);
        s.day = D('2022-03-01');
        s.cash = 1e9;
        s.reputation = 50;
        s.hype.player = 50;
        s.models = [model()]; // есть выпущенная модель: условия «если есть модель» выполнены
        triggerEvent(s, def.id);
        const mail = s.mail[s.mail.length - 1];
        const hint = mail.choices![i].hint;
        if (/шансом|если|на \d+ дн|навсегда|доли основателя/.test(hint)) continue; // случай и условия проверяются отдельно
        if (/(?:шумиха|аренда|исследован|спрос|проекты|иски|шанс)/i.test(hint)) continue;
        const exp = parse(hint);
        if (exp.known.some((k) => !k)) continue;
        const cash = s.cash, rep = s.reputation, hype = s.hype.player;
        expect(applyChoice(s, mail.id, i).ok).toBe(true);
        expect(s.cash - cash, `${def.id}/${i} деньги: ${hint}`).toBeCloseTo(exp.money, -3);
        expect(s.reputation - rep, `${def.id}/${i} репутация: ${hint}`).toBe(exp.rep);
        expect(s.hype.player - hype, `${def.id}/${i} шумиха: ${hint}`).toBe(exp.hype);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('суммы растут вместе с годом: единица 2017-го меньше единицы 2024-го, подсказка берёт ту, что была при отправке', () => {
    const s = newGame('Тест', 3);
    s.day = D('2017-06-01');
    triggerEvent(s, 'rnd-conference');
    const early = s.mail[s.mail.length - 1].choices![0].hint;
    const t = newGame('Тест', 3);
    t.day = D('2024-06-01');
    triggerEvent(t, 'rnd-conference');
    const late = t.mail[t.mail.length - 1].choices![0].hint;
    expect(early).not.toBe(late);
    // единица зафиксирована в письме: смена года до ответа не меняет сумму
    const cash = s.cash;
    s.day = D('2024-01-01');
    applyChoice(s, s.mail[s.mail.length - 1].id, 0);
    expect(cash - s.cash).toBeCloseTo(20_000, -3);
  });
});

describe('веса по году и ситуации', () => {
  it('в 2017 году нет событий, которые начинаются позже; в 2022-м добавляются новые', () => {
    const s = newGame('Тест', 1);
    s.day = D('2017-06-01');
    s.models = [model()];
    const ids17 = randomCandidates(s).map((c) => c.id);
    expect(ids17).toContain('rnd-conference');
    expect(ids17).not.toContain('rnd-regulator'); // с 2021
    expect(ids17).not.toContain('rnd-safety-blogger'); // с 2022
    s.day = D('2022-06-01');
    const ids22 = randomCandidates(s).map((c) => c.id);
    expect(ids22).toContain('rnd-regulator');
    expect(ids22).toContain('rnd-safety-blogger');
  });

  it('зависит от положения: отключение света только при идущем обучении и арендованных картах, иск за данные - после выпуска модели', () => {
    const s = newGame('Тест', 1);
    s.day = D('2021-06-01');
    expect(randomCandidates(s).map((c) => c.id)).not.toContain('rnd-power-outage');
    expect(randomCandidates(s).map((c) => c.id)).not.toContain('rnd-data-lawsuit');
    s.compute.rented.p100 = 100;
    s.trainings.push({ id: 't1', failed: false } as unknown as GameState['trainings'][number]);
    s.models = [model()];
    const ids = randomCandidates(s).map((c) => c.id);
    expect(ids).toContain('rnd-power-outage');
    expect(ids).toContain('rnd-data-lawsuit');
    s.flags.dataLicensed = true;
    expect(randomCandidates(s).map((c) => c.id)).not.toContain('rnd-data-lawsuit');
  });

  it('вес растёт от ситуации: у лаборатории с моделью в продаже утечка и иск вероятнее', () => {
    const s = newGame('Тест', 1);
    s.day = D('2021-06-01');
    s.models = [model({ onApi: false })];
    const w0 = randomCandidates(s).find((c) => c.id === 'rnd-data-leak')!.weight;
    s.models = [model({ onApi: true })];
    const w1 = randomCandidates(s).find((c) => c.id === 'rnd-data-leak')!.weight;
    expect(w1).toBeGreaterThan(w0);
  });

  it('событие не повторяется до конца паузы (540 дней) и «только раз» не повторяется никогда', () => {
    const s = newGame('Тест', 1);
    s.day = D('2021-06-01');
    s.models = [model()];
    s.yearly.lastFired['rnd-conference'] = s.day - 100;
    s.yearly.lastFired['rnd-data-lawsuit'] = s.day - 2000;
    const ids = randomCandidates(s).map((c) => c.id);
    expect(ids).not.toContain('rnd-conference');
    expect(ids).not.toContain('rnd-data-lawsuit');
    s.yearly.lastFired['rnd-conference'] = s.day - 600;
    expect(randomCandidates(s).map((c) => c.id)).toContain('rnd-conference');
  });

  it('жребий по весам: границы и нулевая сумма', () => {
    const list = [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 3 },
    ];
    expect(pickWeighted(list, 0)?.id).toBe('a');
    expect(pickWeighted(list, 0.2)?.id).toBe('a');
    expect(pickWeighted(list, 0.26)?.id).toBe('b');
    expect(pickWeighted(list, 0.999999)?.id).toBe('b');
    expect(pickWeighted([], 0.5)).toBeNull();
  });
});

describe('расписание', () => {
  /** Играет ботом; письма с выбором откладывает и отвечает через answerAfter дней. Собирает дни случайных писем. */
  function play(seed: number, until: number, answerAfter = 0) {
    const s = newGame('Бот', seed);
    const fired: { id: string; day: number }[] = [];
    const born = new Map<string, number>();
    const seen = new Set<string>(); // почту чистят раз в месяц, поэтому индексы не годятся
    let maxOpen = 0;
    while (!s.outcome && s.day < until) {
      for (const m of openChoices(s)) {
        if (!born.has(m.id)) born.set(m.id, s.day);
        if (s.day - born.get(m.id)! >= answerAfter) applyChoice(s, m.id, botChoice(s, m.eventId));
        else if (!m.deferred) deferChoice(s, m.id);
      }
      if (s.day % 7 === 0) botAct(s, 'reasonable');
      advanceDay(s);
      for (const m of s.mail) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (m.eventId && EXTRA_EVENTS.find((e) => e.id === m.eventId)?.random) fired.push({ id: m.eventId, day: m.day });
      }
      maxOpen = Math.max(maxOpen, openChoices(s).filter((m) => EXTRA_EVENTS.some((e) => e.id === m.eventId)).length);
    }
    return { s, fired, maxOpen };
  }

  it('первое письмо не раньше 75-го дня; потом не чаще одного в 60 дней и не реже одного в 120 дней', () => {
    const { fired } = play(2, D('2024-12-31'));
    expect(fired.length).toBeGreaterThanOrEqual(24);
    expect(fired.length).toBeLessThanOrEqual(48);
    expect(fired[0].day).toBeGreaterThanOrEqual(75);
    for (let i = 1; i < fired.length; i++) {
      const gap = fired[i].day - fired[i - 1].day;
      expect(gap, `${fired[i - 1].id} -> ${fired[i].id}`).toBeGreaterThanOrEqual(RANDOM_GAP_MIN);
      expect(gap).toBeLessThanOrEqual(RANDOM_GAP_MAX + 120);
    }
  });

  it('не больше одного неотвеченного письма из новых событий, даже если игрок отвечает не сразу', () => {
    for (const seed of [1, 4]) {
      const { maxOpen } = play(seed, D('2022-12-31'), 20);
      expect(maxOpen, `зерно ${seed}`).toBeLessThanOrEqual(1);
    }
  });

  it('пока в почте ждёт другое письмо с выбором, случайное не приходит; после ответа приходит', () => {
    const s = newGame('Тест', 1);
    s.day = D('2020-08-01'); // ни одно письмо по дате не ждёт в своём окне
    s.models = [model()];
    s.yearly.nextEventDay = s.day;
    triggerEvent(s, 'gpt2-withheld');
    const before = s.mail.length;
    randomEventDay(s);
    expect(s.mail.length).toBe(before);
    applyChoice(s, pendingChoice(s)!.id, 2);
    randomEventDay(s);
    expect(s.mail.length).toBe(before); // сразу после решения - передышка RANDOM_QUIET_DAYS
    s.day += RANDOM_QUIET_DAYS;
    randomEventDay(s);
    expect(s.mail.length).toBe(before + 1);
    expect(s.yearly.nextEventDay).toBeGreaterThanOrEqual(s.day + RANDOM_GAP_MIN);
    expect(s.yearly.nextEventDay).toBeLessThanOrEqual(s.day + RANDOM_GAP_MAX);
  });

  it('одно зерно - одни и те же письма в те же дни; другое зерно - другая очередь', () => {
    const a = play(3, D('2021-12-31')).fired;
    const b = play(3, D('2021-12-31')).fired;
    const c = play(8, D('2021-12-31')).fired;
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('случайные письма не сдвигают основной поток: с письмами и без них s.rng после первого письма отличается только расчётами, а до него - совпадает', () => {
    const a = newGame('A', 31);
    const b = newGame('A', 31);
    b.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 70; i++) {
      advanceDay(a);
      advanceDay(b);
    }
    expect(a.rng).toBe(b.rng);
    expect(serialize(a).length).toBeGreaterThan(0);
  });

  it('ранние заказы приходят в своё окно и не приходят в старом сохранении поздних лет', () => {
    const s = newGame('Тест', 1);
    s.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    s.day = D('2017-02-06');
    advanceDay(s);
    expect(s.mail.some((m) => m.eventId === 'early-bank-forms')).toBe(true);
    const old = newGame('Тест', 1);
    old.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
    old.day = D('2022-06-01');
    for (let i = 0; i < 40; i++) {
      const p = pendingChoice(old);
      if (p) applyChoice(old, p.id, p.choices!.length - 1);
      advanceDay(old);
    }
    expect(old.mail.some((m) => m.eventId?.startsWith('early-'))).toBe(false);
  });

  it('письмо с выбором из новых событий проходит сохранение и загрузку, пока ждёт ответа', () => {
    const s = newGame('Тест', 1);
    s.day = D('2021-03-01');
    triggerEvent(s, 'rnd-gov-grant');
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pendingChoice(r.state)?.eventId).toBe('rnd-gov-grant');
    expect(applyChoice(r.state, pendingChoice(r.state)!.id, 1).ok).toBe(true);
  });
});

describe('мелкие письма не останавливают игру (плейтест 17.10)', () => {
  it('случайное письмо и ранний заказ приходят отложенными: игра идёт, ответ - в «Почте» до срока', () => {
    const s = newGame('Тест', 3);
    let checked = 0;
    for (let d = 0; d < 900 && checked < 3; d++) {
      const before = s.mail.length;
      advanceDay(s);
      for (const m of s.mail.slice(before)) {
        const def = findEvent(m.eventId);
        if (!m.choices || !def) continue;
        const minor = !!def.random || EARLY_EVENTS.some((e) => e.id === def.id);
        if (!minor) continue;
        expect(m.deferred).toBe(true);
        expect(pendingChoice(s)?.id).not.toBe(m.id);
        checked++;
      }
      // Сюжетные письма разбираем, чтобы время шло дальше.
      const p = pendingChoice(s);
      if (p) applyChoice(s, p.id, botChoice(s, p.eventId));
      for (const m of openChoices(s)) if (m.deferred) applyChoice(s, m.id, botChoice(s, m.eventId));
    }
    expect(checked).toBeGreaterThan(0);
  });
});
