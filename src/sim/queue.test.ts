// Очередь исследований, простой мощности, склонения, честные «месяцы на 1-м месте» и проверка только для подписок.

import { describe, expect, it } from 'vitest';
import { newGame, releaseModel } from './actions';
import { rentNow, setAllocation, setRent } from './compute';
import { RESEARCH_QUEUE_MAX } from './constants';
import { addMail, pruneMail } from './events';
import { idleCompute, idleQuiet, idleTotal, idleWarnings } from './idle';
import { queueBlockReason, queueResearch, researchDaysLeft, rpPerDay, setResearch, techCost, unqueueResearch } from './research';
import { progressDay } from './research';
import { deserialize, serialize } from './save';
import { advanceDay } from './tick';
import { daysWord, lettersWord, pointsWord, ruPlural, timesWord, tokensWord } from './text';
import { dateToDay } from './time';
import type { GameState, PlayerModel } from './types';

function lab(): GameState {
  const s = newGame('Тест', 1);
  rentNow(s, 'p100', 200);
  setAllocation(s, { training: 0, contracts: 0, experiments: 1, api: 0, subs: 0 });
  return s;
}

/** Довести текущее исследование до конца за один шаг. */
function finishCurrent(s: GameState): void {
  const tech = s.research.current!;
  s.research.points[tech] = techCost(s, tech) - 0.001;
  progressDay(s);
}

describe('очередь исследований', () => {
  it('в новой игре очередь пуста', () => {
    expect(newGame('Тест', 1).research.queue).toEqual([]);
  });

  it('ставит в очередь и убирает; не больше RESEARCH_QUEUE_MAX; без повторов и текущего', () => {
    const s = lab();
    expect(setResearch(s, 'attention')).toEqual({ ok: true });
    expect(queueResearch(s, 'attention')).toEqual({ ok: false, error: 'Это исследование уже идёт' });
    expect(queueResearch(s, 'algo')).toEqual({ ok: true });
    expect(queueResearch(s, 'algo')).toEqual({ ok: false, error: 'Уже в очереди' });
    expect(queueResearch(s, 'context')).toEqual({ ok: true });
    expect(queueResearch(s, 'scaling').ok).toBe(true);
    expect(s.research.queue).toHaveLength(RESEARCH_QUEUE_MAX);
    expect(queueResearch(s, 'rlhf').ok).toBe(false);
    expect(unqueueResearch(s, 'context')).toEqual({ ok: true });
    expect(s.research.queue).toEqual(['algo', 'scaling']);
    expect(unqueueResearch(s, 'context').ok).toBe(false);
  });

  it('технологию с невыполненным требованием можно поставить только после того, что её открывает', () => {
    const s = lab();
    // RLHF требует «Механизм внимания»: он ещё не идёт и не в очереди.
    expect(queueBlockReason(s, 'rlhf')).toMatch(/Требуется исследование/);
    setResearch(s, 'attention');
    expect(queueBlockReason(s, 'rlhf')).toBeNull();
    expect(queueResearch(s, 'rlhf').ok).toBe(true);
  });

  it('если убрать то, что открывало технологию, зависимая уходит из очереди', () => {
    const s = lab();
    setResearch(s, 'attention');
    queueResearch(s, 'scaling');
    queueResearch(s, 'rlhf');
    // rlhf зависит от attention (идёт) - остаётся; убираем scaling - остаётся rlhf.
    unqueueResearch(s, 'scaling');
    expect(s.research.queue).toEqual(['rlhf']);
  });

  it('после завершения следующее исследование начинается само, письмо называет его', () => {
    const s = lab();
    setResearch(s, 'attention');
    queueResearch(s, 'scaling');
    queueResearch(s, 'rlhf');
    finishCurrent(s);
    expect(s.research.done).toContain('attention');
    expect(s.research.current).toBe('scaling');
    expect(s.research.queue).toEqual(['rlhf']);
    const mail = s.mail.filter((m) => m.kind === 'research').at(-1)!;
    expect(mail.body).toContain('Дальше по очереди: «Законы масштабирования».');
    finishCurrent(s);
    expect(s.research.current).toBe('rlhf');
    expect(s.research.queue).toEqual([]);
    finishCurrent(s);
    expect(s.research.current).toBeNull();
  });

  it('без очереди завершение работает как раньше: current = null', () => {
    const s = lab();
    setResearch(s, 'attention');
    finishCurrent(s);
    expect(s.research.current).toBeNull();
    expect(s.mail.filter((m) => m.kind === 'research').at(-1)!.body).not.toContain('Дальше по очереди');
  });

  it('«Алгоритмические улучшения» уступают место очереди после уровня, а без очереди идут дальше', () => {
    const s = lab();
    setResearch(s, 'algo');
    finishCurrent(s);
    expect(s.research.algoLevel).toBe(1);
    expect(s.research.current).toBe('algo');
    queueResearch(s, 'attention');
    finishCurrent(s);
    expect(s.research.algoLevel).toBe(2);
    expect(s.research.current).toBe('attention');
  });

  it('выбор технологии вручную убирает её из очереди', () => {
    const s = lab();
    setResearch(s, 'attention');
    queueResearch(s, 'algo');
    setResearch(s, 'algo');
    expect(s.research.queue).toEqual([]);
    expect(s.research.current).toBe('algo');
  });

  it('очередь при пустом current запускает следующее в начале дня', () => {
    const s = lab();
    s.research.queue = ['attention'];
    progressDay(s);
    expect(s.research.current).toBe('attention');
    expect(s.research.queue).toEqual([]);
  });

  it('сохранение с очередью возвращается как было; старое сохранение получает пустую очередь', () => {
    const s = lab();
    setResearch(s, 'attention');
    queueResearch(s, 'algo');
    const kept = deserialize(serialize(s));
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.state.research.queue).toEqual(['algo']);
    const data = JSON.parse(serialize(s)) as { research: Record<string, unknown> };
    delete data.research.queue;
    const old = deserialize(JSON.stringify(data));
    expect(old.ok).toBe(true);
    if (old.ok) expect(old.state.research.queue).toEqual([]);
  });

  it('очередь в сохранении с неизвестной технологией отклоняется', () => {
    const s = lab();
    const data = JSON.parse(serialize(s)) as { research: Record<string, unknown> };
    data.research.queue = ['нет-такой'];
    expect(deserialize(JSON.stringify(data)).ok).toBe(false);
  });

  it('очередь не ломает детерминизм: два прогона дают одно состояние', () => {
    const run = (): string => {
      const s = lab();
      setResearch(s, 'attention');
      queueResearch(s, 'scaling');
      queueResearch(s, 'algo');
      for (let i = 0; i < 400; i++) advanceDay(s);
      return serialize(s);
    };
    expect(run()).toBe(run());
  });
});

describe('прогноз срока исследования', () => {
  it('срок короче, чем по сегодняшней цене, когда цена падает к исторической дате', () => {
    const s = lab();
    const rp = rpPerDay(s);
    const flat = Math.ceil((techCost(s, 'attention') - 0) / rp);
    const forecast = researchDaysLeft(s, 'attention', rp);
    expect(forecast).toBeLessThanOrEqual(flat);
  });

  it('прогноз совпадает с тем, что делает progressDay', () => {
    const s = lab();
    setResearch(s, 'attention');
    const predicted = researchDaysLeft(s, 'attention', rpPerDay(s));
    let days = 0;
    while (s.research.current === 'attention' && days < 5000) {
      progressDay(s);
      s.day += 1;
      days++;
    }
    expect(days).toBe(predicted);
  });

  it('без очков или слишком долго - бесконечность', () => {
    const s = lab();
    expect(researchDaysLeft(s, 'attention', 0)).toBe(Infinity);
    expect(researchDaysLeft(s, 'attention', 0.0001)).toBe(Infinity);
  });
});

describe('простой мощности', () => {
  it('без карт простоя нет', () => {
    const s = newGame('Тест', 1);
    expect(idleCompute(s)).toEqual([]);
  });

  it('исследование не выбрано: простаивает вся доля исследований', () => {
    const s = lab();
    const items = idleCompute(s);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'experiments', reason: 'исследование не выбрано', fix: 'research' });
    expect(items[0].h100e).toBeGreaterThan(0);
    setResearch(s, 'attention');
    expect(idleCompute(s)).toEqual([]);
  });

  it('когда исследование закончилось и очереди нет, простой появляется; с очередью - нет', () => {
    const s = lab();
    setResearch(s, 'attention');
    queueResearch(s, 'algo');
    finishCurrent(s);
    expect(idleCompute(s)).toEqual([]);
    const t = lab();
    setResearch(t, 'attention');
    finishCurrent(t);
    expect(idleCompute(t).map((i) => i.kind)).toEqual(['experiments']);
  });

  it('обучение и контракты без работы: простаивают их доли', () => {
    const s = lab();
    setAllocation(s, { training: 0.5, contracts: 0.5, experiments: 0, api: 0, subs: 0 });
    const kinds = idleCompute(s).map((i) => i.kind);
    expect(kinds).toEqual(['training', 'contracts']);
    expect(idleTotal(idleCompute(s))).toBeCloseTo(200 * 0.0225 * 0 + idleCompute(s).reduce((a, i) => a + i.h100e, 0));
  });

  it('нераспределённый остаток тоже простой', () => {
    const s = lab();
    setResearch(s, 'attention');
    setAllocation(s, { training: 0, contracts: 0, experiments: 0.5, api: 0, subs: 0 });
    const items = idleCompute(s);
    expect(items.map((i) => i.kind)).toEqual(['free']);
  });
});

describe('склонения', () => {
  it('ruPlural: 1 / 2-4 / 5-20 / 21 / 11-14', () => {
    const w = (n: number) => ruPlural(n, 'карта', 'карты', 'карт');
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(w)).toEqual([
      'карта', 'карты', 'карты', 'карт', 'карт', 'карт', 'карт', 'карта', 'карты', 'карт', 'карта', 'карт',
    ]);
  });

  it('daysWord, pointsWord, lettersWord', () => {
    expect(daysWord(1)).toBe('1 день');
    expect(daysWord(3)).toBe('3 дня');
    expect(daysWord(45)).toBe('45 дней');
    expect(pointsWord(21)).toBe('очко');
    expect(pointsWord(3)).toBe('очка');
    expect(pointsWord(12)).toBe('очков');
    expect(lettersWord(2)).toBe('письма');
    expect(lettersWord(7)).toBe('писем');
  });

  it('timesWord: «в 244 раза», «в 5 раз», «в 1,6 раза»', () => {
    expect(timesWord(244)).toBe('в 244 раза');
    expect(timesWord(5)).toBe('в 5 раз');
    expect(timesWord(1.6)).toBe('в 1,6 раза');
    expect(timesWord(2)).toBe('в 2 раза');
    expect(timesWord(12)).toBe('в 12 раз');
  });

  it('tokensWord: малые числа склоняются, «тыс.» и «млн» - всегда «токенов»', () => {
    expect(tokensWord(564)).toBe('токена');
    expect(tokensWord(512)).toBe('токенов');
    expect(tokensWord(1)).toBe('токен');
    expect(tokensWord(2048)).toBe('токенов');
    expect(tokensWord(4)).toBe('токена');
  });
});

function soloModel(day: number): PlayerModel {
  return {
    id: 'p1',
    name: 'Один',
    plan: { name: 'Один', paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 }, benchShare: 0, benchTargets: [], rlhf: true, context: 512, tier: 'light' },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: day,
    releasedDay: day,
    caps: { language: 60, code: 60, reasoning: 60 },
    overfit: {},
    rlhf: true,
    arenaElo: 9000,
    price: 1,
    onApi: true,
    exposed: false,
    earned: 0,
    onSubs: false,
    subsPrice: 20,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
  };
}

describe('месяцы на 1-м месте считаются, только когда соперники продают по API', () => {
  it('в 2018 году, когда у соперников нет моделей по API, месяц не засчитывается', () => {
    const s = newGame('Тест', 1);
    s.day = dateToDay('2018-06-30');
    s.models = [soloModel(dateToDay('2018-06-01'))];
    advanceDay(s);
    expect(s.day).toBe(dateToDay('2018-07-01'));
    expect(s.monthsFirst).toBe(0);
  });
});

describe('внешняя проверка нужна только для подписок', () => {
  it('до открытия подписок сильная модель выходит без метки «Нужна проверка»', () => {
    const s = newGame('Тест', 1);
    s.day = dateToDay('2021-06-01');
    s.rivalsReleased = ['gtp-3'];
    const m = soloModel(0);
    m.releasedDay = null;
    m.arenaElo = 5000;
    s.models = [m];
    expect(releaseModel(s, 'p1', 5).ok).toBe(true);
    expect(s.models[0].review).toBe('none');
    expect(s.mail.some((x) => x.title.startsWith('Нужна внешняя проверка'))).toBe(false);
  });

  it('старое сохранение с меткой до открытия подписок теряет метку', () => {
    const s = newGame('Тест', 1);
    s.day = dateToDay('2020-01-01');
    const m = soloModel(dateToDay('2019-01-01'));
    m.review = 'required';
    s.models = [m];
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.models[0].review).toBe('none');
  });

  it('в день открытия подписок сильная модель на API получает метку и письмо', () => {
    const s = newGame('Тест', 1);
    s.day = dateToDay('2022-11-30');
    s.rivalsReleased = ['gtp-3'];
    const m = soloModel(dateToDay('2022-06-01'));
    m.arenaElo = 5000;
    s.models = [m];
    advanceDay(s);
    expect(s.models[0].review).toBe('required');
    expect(s.mail.some((x) => x.title === 'Нужна внешняя проверка: «Один»')).toBe(true);
  });
});

describe('мягкое предупреждение о простое', () => {
  it('молчит первые 14 дней партии и 3 дня после смены аренды', () => {
    const s = lab(); // lab() сам ставит аренду
    expect(idleCompute(s)).toHaveLength(1);
    expect(idleWarnings(s)).toEqual([]);
    s.day += 14;
    s.compute.rentChangedDay = undefined; // старое сохранение: смены аренды не помним
    expect(idleQuiet(s)).toBe(false);
    expect(idleWarnings(s)).toHaveLength(1);
    setRent(s, 'p100', 300);
    expect(s.compute.rentChangedDay).toBe(s.day);
    expect(idleWarnings(s)).toEqual([]);
    s.day += 3;
    expect(idleWarnings(s)).toHaveLength(1);
    setRent(s, 'p100', 300); // то же число: не смена
    expect(idleWarnings(s)).toHaveLength(1);
  });
});

describe('чистка почты', () => {
  it('прочитанные письма старше года уходят, непрочитанные и с невыбранным ответом остаются', () => {
    const s = newGame('Тест', 1);
    s.mail = [];
    const old = addMail(s, { kind: 'news', title: 'старое прочитанное', body: '.' });
    const oldUnread = addMail(s, { kind: 'news', title: 'старое новое', body: '.' });
    const oldChoice = addMail(s, { kind: 'event', title: 'выбор', body: '.', choices: [{ label: 'а', hint: '' }] });
    old.read = true;
    oldChoice.read = true;
    s.day += 400;
    const fresh = addMail(s, { kind: 'news', title: 'свежее', body: '.' });
    fresh.read = true;
    pruneMail(s);
    expect(s.mail.map((m) => m.title).sort()).toEqual(['выбор', 'свежее', 'старое новое'].sort());
    expect(oldUnread.read).toBe(false);
  });
});
