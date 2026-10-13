// Тесты событий (TSK-009): сроки, ветки, выбор, модификаторы, срыв обучения.
// training и leaderboard подменены: это чужие модули, здесь важна только связка с событиями.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./training', () => ({ applyFailChoice: vi.fn() }));
// marketArenaRank нужен оценке инвесторов (письмо совета директоров называет цену выкупа): моделей на рынке нет.
vi.mock('./leaderboard', () => ({ bestElo: vi.fn(() => 1000), marketArenaRank: vi.fn(() => null) }));

import { EVENTS, findEvent, money } from '../data/events';
import { pointsWord } from './text';
import { LABS } from '../data/labs';
import { rentCapFor, rentPerGpuDay } from './compute';
import {
  ARENA_OPEN_DATE,
  ATTENTION_PAPER_DISCOUNT,
  BOARD_BUYBACK_SHARE,
  BOARD_DEFEND_REP,
  BOARD_PLAN_HYPE,
  BOARD_PLAN_VALUATION_MULT,
  CHAT_MOMENT_BRAND,
  CHOICE_DAYS,
  EXPORT_CONTROL_BRAND,
  FAIL_CHOICE_DAYS,
  FOUNDER_BOARD_SHARE,
} from './constants';
import { BOARD_PLAN_FLAG, buybackCost, valuation } from './investors';
import {
  applyChoice,
  awaitingEvent,
  deferChoice,
  dropChoices,
  expireChoices,
  fireDue,
  FOREVER,
  modValue,
  openChoices,
  pendingChoice,
  pruneModifiers,
  triggerEvent,
} from './events';
import { bestElo } from './leaderboard';
import { labBrand } from './market';
import { techCost } from './research';
import { RIVALRY_EVENTS } from './rivalry';
import { createInitialState } from './state';
import { dateToDay, END_DAY } from './time';
import { applyFailChoice } from './training';
import type { GameState, PlayerModel } from './types';

const D = dateToDay;

function newState(): GameState {
  return createInitialState('Тест', 42);
}

/** Модель игрока: по умолчанию выпущенная, с RLHF, Эло 1100. */
function model(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Мозг-1',
    plan: {
      name: 'Мозг-1',
      paramsB: 10,
      tokensB: 200,
      mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0,
      benchTargets: [],
      rlhf: true,
      context: 512,
      tier: 'mid',
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 100,
    releasedDay: D('2022-06-01'),
    caps: { language: 40, code: 30, reasoning: 30 },
    overfit: {},
    rlhf: true,
    arenaElo: 1100,
    price: 10,
    onApi: true,
    exposed: false,
    earned: 0,
    onSubs: false,
    subsPrice: 20,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
    ...over,
  };
}

/** Запустить событие и выбрать вариант idx через почту (как делает игрок). */
function choose(s: GameState, eventId: string, idx: number): void {
  triggerEvent(s, eventId);
  const mail = pendingChoice(s);
  if (!mail) throw new Error('нет письма с выбором');
  expect(mail.eventId).toBe(eventId);
  expect(applyChoice(s, mail.id, idx)).toEqual({ ok: true });
}

/** Прожить дни 0…END_DAY только с событиями; вернуть день первого срабатывания каждого события. */
function runAllDays(s: GameState): Record<string, number> {
  const firedOn: Record<string, number> = {};
  for (let d = 0; d <= END_DAY; d++) {
    s.day = d;
    const before = new Set(s.firedEvents);
    fireDue(s);
    for (const id of s.firedEvents) if (!before.has(id)) firedOn[id] = d;
  }
  return firedOn;
}

/** Прожить дни 0…END_DAY и вернуть id сработавших событий по порядку. */
function firedList(s: GameState): string[] {
  runAllDays(s);
  return [...s.firedEvents];
}

/** Число из подсказки: «+15 репутации» → 15, «−3 репутации» → −3; нет упоминания → 0. */
function hintDelta(hint: string, what: string): number {
  const m = hint.match(new RegExp(`([+−])(\\d+) ${what}`));
  return m ? (m[1] === '−' ? -1 : 1) * Number(m[2]) : 0;
}

/** Деньги из подсказки: «−$300 тыс.» → −300 000; нет упоминания → 0. */
function hintMoney(hint: string): number {
  const m = hint.match(/([+−])\$(\d+) тыс\./);
  return m ? (m[1] === '−' ? -1 : 1) * Number(m[2]) * 1000 : 0;
}

beforeEach(() => {
  vi.mocked(bestElo).mockReset();
  vi.mocked(bestElo).mockReturnValue(1000);
  vi.mocked(applyFailChoice).mockClear();
});

describe('данные событий', () => {
  it('id уникальны, письма заполнены, у вариантов есть подсказки', () => {
    const ids = EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const s = newState();
    for (const def of EVENTS) {
      const m = def.mail(s);
      expect(m.title.length, def.id).toBeGreaterThan(0);
      expect(m.body.length, def.id).toBeGreaterThan(40);
      expect(m.title + m.body, def.id).toMatch(/[а-яё]/i);
      for (const c of def.choices ?? []) {
        expect(c.label.length, def.id).toBeGreaterThan(0);
        expect(c.hint.length, def.id).toBeGreaterThan(0);
      }
    }
  });

  it('письмо с выбором всегда с типом event или training, новость без выбора - news', () => {
    const s = newState();
    for (const def of EVENTS) {
      const kind = def.mail(s).kind;
      if (def.choices) expect(['event', 'training'], def.id).toContain(kind);
      else expect(kind, def.id).toBe('news');
    }
  });

  it('в письмах и подсказках нет двойной точки: «$300 тыс..» (многоточие допустимо)', () => {
    const s = newState();
    const doubleDot = /(?<!\.)\.\.(?!\.)/;
    for (const def of EVENTS) {
      const m = def.mail(s);
      const texts = [m.title, m.body, ...(def.choices ?? []).flatMap((c) => [c.label, c.hint])];
      for (const text of texts) expect(text, def.id).not.toMatch(doubleDot);
    }
    const gpt3 = EVENTS.find((e) => e.id === 'gpt3-api')!.mail(s);
    expect(gpt3.body.endsWith('Реклама собственного API стоит $300 тыс.')).toBe(true);
  });

  it('подсказки названы по ТЗ', () => {
    const byId = (id: string) => EVENTS.find((e) => e.id === id)!;
    expect(byId('gpt3-api').choices![0].hint).toBe('−$300 тыс., +15 шумихи');
    expect(byId('training-fail').choices![0].hint).toBe('откат на 25 % всего объёма');
    expect(byId('training-fail').choices![1].hint).toBe('модель выйдет на 3 очка слабее');
    expect(byId('attention-paper-player').choices![1].hint).toContain('1,25 раза');
  });

  it('набор событий не потерял и не переименовал ни одного id (training.ts вызывает «training-fail» по строке)', () => {
    expect(EVENTS.map((e) => e.id).sort()).toEqual(
      [
        'arena-open',
        'attention-paper-player',
        'attention-paper-public',
        'board-control',
        'chat-moment-player',
        'chat-moment-rival',
        'export-controls-2022',
        'export-controls-2023',
        'gpt2-withheld',
        'gpt3-api',
        'gpu-a100',
        'gpu-h100',
        'gpu-h200',
        'gpu-shortage',
        'gpu-v100',
        'q3-arc',
        'reasoning-models',
        'training-fail',
      ].sort(),
    );
  });

  it('в письмах нет «undefined», «NaN» и «[object» - ни в пустом состоянии, ни с проектом и моделью', () => {
    const empty = newState();
    const busy = newState();
    busy.models.push(model());
    busy.trainings = [{
      id: 't1',
      failed: true,
      plan: { ...model().plan, name: 'Гигант-2' },
      arch: 'transformer',
      algoLevel: 0,
      flopTotal: 1e22,
      flopDone: 1e21,
      startedDay: 5,
      failAtFraction: null,
      failPenalty: 0,
    }];
    for (const s of [empty, busy]) {
      for (const def of EVENTS) {
        const m = def.mail(s);
        const text = [m.title, m.body, ...(def.choices ?? []).flatMap((c) => [c.label, c.hint])].join(' | ');
        expect(text, def.id).not.toMatch(/undefined|NaN|\[object|Infinity|null/);
      }
    }
  });

  it('в каждом письме 2-4 предложения', () => {
    const s = newState();
    for (const def of EVENTS) {
      const sentences = def.mail(s).body.split(/(?<=[.!?…])\s+(?=[«А-ЯЁA-Z$])/);
      expect(sentences.length, def.id).toBeGreaterThanOrEqual(2);
      expect(sentences.length, def.id).toBeLessThanOrEqual(4);
    }
  });

  it('письмо новости без eventId, письмо с выбором - с eventId события и подписями вариантов', () => {
    const s = newState();
    for (const def of EVENTS) {
      s.mail.length = 0;
      triggerEvent(s, def.id);
      const mail = s.mail[0];
      if (def.choices) {
        expect(mail.eventId, def.id).toBe(def.id);
        expect(mail.choices, def.id).toEqual(def.choices.map((c) => ({ label: c.label, hint: c.hint })));
      } else {
        expect(mail.eventId, def.id).toBeUndefined();
        expect(mail.choices, def.id).toBeUndefined();
      }
      expect(mail.read, def.id).toBe(false);
    }
  });
});

describe('помощники текста', () => {
  it('money: тысячи, миллионы, миллиарды и граница округления', () => {
    expect(money(800)).toBe('$800');
    expect(money(1_500)).toBe('$1,5 тыс.');
    expect(money(300_000)).toBe('$300 тыс.');
    expect(money(350_000)).toBe('$350 тыс.');
    expect(money(999_499)).toBe('$999,5 тыс.');
    expect(money(999_999)).toBe('$1 млн'); // не «$1000 тыс.»
    expect(money(1_000_000)).toBe('$1 млн');
    expect(money(1_200_000)).toBe('$1,2 млн');
    expect(money(999_999_999)).toBe('$1 млрд'); // не «$1000 млн»
    expect(money(2_500_000_000)).toBe('$2,5 млрд');
  });

  it('pointsWord: очко / очка / очков', () => {
    expect(pointsWord(1)).toBe('очко');
    expect(pointsWord(2)).toBe('очка');
    expect(pointsWord(3)).toBe('очка');
    expect(pointsWord(5)).toBe('очков');
    expect(pointsWord(11)).toBe('очков');
    expect(pointsWord(12)).toBe('очков');
    expect(pointsWord(21)).toBe('очко');
    expect(pointsWord(24)).toBe('очка');
  });
});

describe('срабатывание по датам (fireDue)', () => {
  // Парные события здесь представлены той веткой, которая срабатывает в пустом состоянии.
  const DATED: [string, string][] = [
    ['attention-paper-public', '2017-06-12'],
    ['gpt2-withheld', '2019-02-14'],
    ['gpt3-api', '2020-06-11'],
    ['export-controls-2022', '2022-10-07'],
    ['chat-moment-rival', '2022-11-30'],
    ['gpu-shortage', '2023-04-01'],
    ['arena-open', ARENA_OPEN_DATE],
    ['export-controls-2023', '2023-10-17'],
    ['reasoning-models', '2024-09-12'],
    ['q3-arc', '2024-12-20'],
  ];

  it.each(DATED)('%s срабатывает ровно в свой день и даёт одно письмо', (id, date) => {
    const s = newState();
    s.day = D(date) - 1;
    fireDue(s);
    expect(s.firedEvents).not.toContain(id);
    const mailsBefore = s.mail.length;

    s.day = D(date);
    fireDue(s);
    expect(s.firedEvents).toContain(id);
    expect(s.mail.length - mailsBefore).toBe(1);

    // второй раз в тот же день и позже - тишина
    fireDue(s);
    s.day += 100;
    fireDue(s);
    expect(s.firedEvents.filter((x) => x === id)).toHaveLength(1);
  });

  it('арена: открытие ставит флаг arenaOpen', () => {
    const s = newState();
    s.day = D(ARENA_OPEN_DATE) - 1;
    fireDue(s);
    expect(s.flags.arenaOpen).toBeUndefined();
    s.day = D(ARENA_OPEN_DATE);
    fireDue(s);
    expect(s.flags.arenaOpen).toBe(true);
  });

  it('полный прогон 2017-2024: события приходят в свои дни, срыв обучения сам не приходит', () => {
    const s = newState();
    const firedOn = runAllDays(s);
    expect(firedOn['attention-paper-public']).toBe(D('2017-06-12'));
    expect(firedOn['gpt2-withheld']).toBe(D('2019-02-14'));
    expect(firedOn['gpt3-api']).toBe(D('2020-06-11'));
    expect(firedOn['export-controls-2022']).toBe(D('2022-10-07'));
    expect(firedOn['chat-moment-rival']).toBe(D('2022-11-30'));
    expect(firedOn['gpu-shortage']).toBe(D('2023-04-01'));
    expect(firedOn['arena-open']).toBe(D(ARENA_OPEN_DATE));
    expect(firedOn['export-controls-2023']).toBe(D('2023-10-17'));
    expect(firedOn['reasoning-models']).toBe(D('2024-09-12'));
    expect(firedOn['q3-arc']).toBe(D('2024-12-20'));
    expect(firedOn['training-fail']).toBeUndefined();
    expect(s.mail.some((m) => m.eventId === 'training-fail')).toBe(false);
  });
});

describe('парные события: срабатывает ровно одно', () => {
  it('внимание: исследование готово до даты - ветка «Механизм внимания изучен до публикации Gogle»', () => {
    const s = newState();
    s.research.done.push('attention');
    s.day = D('2017-06-11');
    fireDue(s);
    expect(s.firedEvents).toEqual([]);
    s.day = D('2017-06-12');
    fireDue(s);
    expect(s.firedEvents).toEqual(['attention-paper-player']);
    expect(s.mail).toHaveLength(1);
    expect(s.mail[0].title).toBe('Механизм внимания изучен до публикации Gogle');
    expect(s.mail[0].choices).toHaveLength(2);
    expect(modValue(s, 'researchCost', 'attention').mult).toBe(1);
  });

  it('внимание: не готово к дате - Gogle публикует первой, и поздняя готовность ничего не меняет', () => {
    const s = newState();
    s.day = D('2017-06-12');
    fireDue(s);
    expect(s.firedEvents).toEqual(['attention-paper-public']);
    expect(s.mail[0].title).toContain('Gogle опубликовала');
    expect(s.mail[0].choices).toBeUndefined();

    s.research.done.push('attention');
    s.day = D('2017-09-01');
    fireDue(s);
    expect(s.firedEvents).toEqual(['attention-paper-public']);
  });

  it('внимание: за весь срез срабатывает ровно одна ветка в каждом из двух случаев', () => {
    const a = newState();
    a.research.done.push('attention');
    const firedA = runAllDays(a);
    expect(firedA['attention-paper-player']).toBe(D('2017-06-12'));
    expect(firedA['attention-paper-public']).toBeUndefined();

    const b = newState();
    const firedB = runAllDays(b);
    expect(firedB['attention-paper-public']).toBe(D('2017-06-12'));
    expect(firedB['attention-paper-player']).toBeUndefined();
  });

  it('ChatGTP: у игрока выпущен чат с RLHF и Эло не ниже OpenBrain - «Чат лаборатории не уступает моделям OpenBrain»', () => {
    const s = newState();
    s.models.push(model({ arenaElo: 1100 }));
    vi.mocked(bestElo).mockReturnValue(1100); // равенство тоже считается
    s.day = D('2022-11-29');
    fireDue(s);
    expect(s.firedEvents).not.toContain('chat-moment-player');

    s.day = D('2022-11-30');
    fireDue(s);
    expect(s.firedEvents).toContain('chat-moment-player');
    expect(s.firedEvents).not.toContain('chat-moment-rival');
    const mail = s.mail.find((m) => m.title === 'Чат лаборатории не уступает моделям OpenBrain');
    expect(mail).toBeDefined();
    expect(mail!.body).toContain('Мозг-1');
    expect(mail!.choices).toBeUndefined();
    expect(s.hype.player).toBe(40);
    expect(s.reputation).toBe(20 + 10);
    expect(s.flags.chatMomentPlayer).toBe(true);
    // бренд OpenBrain не растёт: момент достался игроку
    expect(modValue(s, 'labBrand', 'openbrain').add).toBe(0);
  });

  it.each([
    ['Эло ниже OpenBrain', { arenaElo: 1099 }],
    ['нет RLHF', { rlhf: false }],
    ['модель не выпущена', { releasedDay: null }],
  ] as [string, Partial<PlayerModel>][])('ChatGTP: %s - «момент» у соперника', (_name, over) => {
    const s = newState();
    s.models.push(model(over));
    vi.mocked(bestElo).mockReturnValue(1100);
    s.day = D('2022-11-30');
    fireDue(s);
    expect(s.firedEvents).toContain('chat-moment-rival');
    expect(s.firedEvents).not.toContain('chat-moment-player');
    expect(s.flags.chatMomentPlayer).toBeUndefined();
  });

  it('ChatGTP: без моделей игрока - ветка соперника, и таблицу Эло (leaderboard) даже не спрашивают', () => {
    const s = newState();
    s.day = D('2022-11-30');
    fireDue(s);
    expect(s.firedEvents).toContain('chat-moment-rival');
    expect(s.firedEvents).not.toContain('chat-moment-player');
    expect(bestElo).not.toHaveBeenCalled();
  });

  it('ChatGTP: за весь срез срабатывает ровно одна ветка; позднее появление модели ничего не меняет', () => {
    const a = newState();
    a.models.push(model());
    const firedA = runAllDays(a);
    expect(firedA['chat-moment-player']).toBe(D('2022-11-30'));
    expect(firedA['chat-moment-rival']).toBeUndefined();

    const b = newState();
    b.day = D('2022-11-30');
    fireDue(b);
    b.models.push(model());
    b.day = D('2023-06-01');
    fireDue(b);
    expect(b.firedEvents.filter((x) => x.startsWith('chat-moment'))).toEqual(['chat-moment-rival']);
  });

  // Не срабатывают: две лишние ветки пар, срыв обучения (только через triggerEvent) и совет директоров (доля основателя 100 %).
  const NEVER = 4;

  it('сценарий игрока: сработали все события, кроме двух лишних веток, срыва обучения и совета директоров', () => {
    const s = newState();
    s.research.done.push('attention');
    s.models.push(model());
    const firedOn = runAllDays(s);
    expect(Object.keys(firedOn)).toHaveLength(EVENTS.length - NEVER);
    expect(firedOn['attention-paper-public']).toBeUndefined();
    expect(firedOn['chat-moment-rival']).toBeUndefined();
    expect(firedOn['training-fail']).toBeUndefined();
    expect(firedOn['board-control']).toBeUndefined();
  });

  it('сценарий без игрока: тоже EVENTS.length − 4 событий', () => {
    const firedOn = runAllDays(newState());
    expect(Object.keys(firedOn)).toHaveLength(EVENTS.length - NEVER);
    expect(firedOn['attention-paper-player']).toBeUndefined();
    expect(firedOn['chat-moment-player']).toBeUndefined();
  });

  // Все сочетания «внимание изучено или нет» × «модель игрока»: из каждой пары ровно одна ветка, в свой день.
  const MODELS: [string, Partial<PlayerModel> | null, boolean][] = [
    ['нет моделей', null, false],
    ['сильный чат с RLHF', {}, true],
    ['слабый чат с RLHF', { arenaElo: 900 }, false],
    ['сильная модель без RLHF', { rlhf: false }, false],
    ['сильная, но не выпущенная', { releasedDay: null }, false],
  ];
  it.each(MODELS.flatMap(([name, over, strong]) => [true, false].map((att) => [name, over, strong, att] as const)))(
    'матрица пар: %s, внимание изучено = %s → ровно по одной ветке',
    (_name, over, strong, att) => {
      const s = newState();
      if (att) s.research.done.push('attention');
      if (over) s.models.push(model(over));
      const firedOn = firedList(s);
      expect(firedOn).toHaveLength(EVENTS.length - NEVER);

      const attention = att ? 'attention-paper-player' : 'attention-paper-public';
      const attentionOther = att ? 'attention-paper-public' : 'attention-paper-player';
      expect(s.firedEvents).toContain(attention);
      expect(s.firedEvents).not.toContain(attentionOther);

      const chat = strong ? 'chat-moment-player' : 'chat-moment-rival';
      const chatOther = strong ? 'chat-moment-rival' : 'chat-moment-player';
      expect(s.firedEvents).toContain(chat);
      expect(s.firedEvents).not.toContain(chatOther);
      // письмо пары приходит один раз
      expect(s.mail.filter((m) => m.title === 'Чат лаборатории не уступает моделям OpenBrain' || m.title.startsWith('ChatGTP'))).toHaveLength(1);
      expect(s.mail.filter((m) => m.title === 'Механизм внимания изучен до публикации Gogle' || m.title.startsWith('Gogle опубликовала'))).toHaveLength(1);
    },
  );

  // Защита не должна держаться только на порядке событий в списке: сами условия пары не пересекаются.
  it.each(MODELS.flatMap(([name, over]) => [true, false].map((att) => [name, over, att] as const)))(
    'условия пары не пересекаются на «чистом» состоянии: %s, внимание изучено = %s',
    (_name, over, att) => {
      const checkOf = (id: string, s: GameState): boolean => {
        const when = EVENTS.find((e) => e.id === id)!.when;
        if (!('check' in when)) throw new Error(`${id}: ожидалось условие`);
        return when.check(s);
      };
      const s = newState();
      if (att) s.research.done.push('attention');
      if (over) s.models.push(model(over));
      const pairs = [
        ['attention-paper-player', 'attention-paper-public', '2017-06-12'],
        ['chat-moment-player', 'chat-moment-rival', '2022-11-30'],
      ] as const;
      for (const [a, b, date] of pairs) {
        s.day = D(date) - 1;
        expect([checkOf(a, s), checkOf(b, s)], `${a}/${b} до даты`).toEqual([false, false]);
        for (const day of [D(date), D(date) + 1, END_DAY]) {
          s.day = day;
          const hits = [checkOf(a, s), checkOf(b, s)].filter(Boolean).length;
          expect(hits, `${a}/${b} в день ${day}`).toBe(1);
        }
      }
    },
  );
});

describe('эффекты выбора', () => {
  it('статья о внимании: опубликовать - репутация и шумиха', () => {
    const s = newState();
    choose(s, 'attention-paper-player', 0);
    expect(s.reputation).toBe(20 + 15);
    expect(s.hype.player).toBe(20);
    expect(s.research.algoLevel).toBe(0);
  });

  it('статья о внимании: держать в секрете - уровень алгоритмов', () => {
    const s = newState();
    choose(s, 'attention-paper-player', 1);
    expect(s.research.algoLevel).toBe(1);
    expect(s.reputation).toBe(20);
    expect(s.hype.player).toBe(0);
  });

  it('статья Gogle: цена «внимания» ×0,4 навсегда, шумиха Gogle +10', () => {
    const s = newState();
    triggerEvent(s, 'attention-paper-public');
    expect(modValue(s, 'researchCost', 'attention').mult).toBeCloseTo(ATTENTION_PAPER_DISCOUNT, 10);
    expect(modValue(s, 'researchCost', 'scaling').mult).toBe(1);
    expect(s.hype.gogle).toBe(10);
    s.day = END_DAY;
    expect(modValue(s, 'researchCost', 'attention').mult).toBeCloseTo(ATTENTION_PAPER_DISCOUNT, 10);
    pruneModifiers(s);
    expect(s.modifiers).toHaveLength(1);
    expect(s.modifiers[0].untilDay).toBe(FOREVER);
  });

  it('GTP-2: поддержать осторожность', () => {
    const s = newState();
    choose(s, 'gpt2-withheld', 0);
    expect(s.reputation).toBe(28);
    expect(s.hype.player).toBe(0);
  });

  it('GTP-2: назвать это рекламным ходом', () => {
    const s = newState();
    choose(s, 'gpt2-withheld', 1);
    expect(s.reputation).toBe(17);
    expect(s.hype.player).toBe(10);
  });

  it('API GTP-3: реклама - минус $300 тыс. накладными, шумиха +15', () => {
    const s = newState();
    const cash = s.cash;
    choose(s, 'gpt3-api', 0);
    expect(s.cash).toBe(cash - 300_000);
    expect(s.finance.month.expense.overhead).toBe(300_000);
    expect(s.hype.player).toBe(15);
    expect(s.reputation).toBe(20);
  });

  it('API GTP-3: не тратиться - репутация +3, деньги целы', () => {
    const s = newState();
    const cash = s.cash;
    choose(s, 'gpt3-api', 1);
    expect(s.cash).toBe(cash);
    expect(s.reputation).toBe(23);
    expect(s.hype.player).toBe(0);
  });

  it('шумиха и репутация не выходят за 0…100', () => {
    const s = newState();
    s.hype.player = 95;
    s.reputation = 98;
    choose(s, 'attention-paper-player', 0);
    expect(s.hype.player).toBe(100);
    expect(s.reputation).toBe(100);
    const t = newState();
    t.reputation = 1;
    choose(t, 'gpt2-withheld', 1);
    expect(t.reputation).toBe(0);
  });

  it('подсказки не врут: репутация, шумиха игрока, деньги и уровень алгоритмов меняются ровно как написано', () => {
    const checked: string[] = [];
    for (const def of EVENTS) {
      // срыв обучения проверяется отдельно (мок training), дефицит GPU - через модификаторы
      if (!def.choices || def.id === 'training-fail' || def.id === 'gpu-shortage') continue;
      def.choices.forEach((c, idx) => {
        // выкуп доли зависит от оценки лаборатории: проверяется отдельно
        if (def.id === 'board-control' && idx === 2) return;
        const s = newState();
        s.reputation = 50;
        s.hype.player = 50;
        s.cash = 5_000_000;
        s.models.push(model()); // чтобы условный вариант «свой чат» сработал
        choose(s, def.id, idx);
        const tag = `${def.id}/${idx}`;
        expect(s.reputation - 50, `${tag} репутация`).toBe(hintDelta(c.hint, 'репутации'));
        expect(s.hype.player - 50, `${tag} шумиха`).toBe(hintDelta(c.hint, 'шумихи'));
        expect(s.cash - 5_000_000, `${tag} деньги`).toBe(hintMoney(c.hint));
        expect(s.research.algoLevel, `${tag} алгоритмы`).toBe(hintDelta(c.hint, 'уровень'));
        checked.push(tag);
      });
    }
    expect(checked).toEqual([
      'attention-paper-player/0',
      'attention-paper-player/1',
      'gpt2-withheld/0',
      'gpt2-withheld/1',
      'gpt2-withheld/2',
      'gpt3-api/0',
      'gpt3-api/1',
      'chat-moment-rival/0',
      'chat-moment-rival/1',
      'board-control/0',
      'board-control/1',
    ]);
  });

  it('ChatGTP у соперника: бренд OpenBrain +CHAT_MOMENT_BRAND навсегда, шумиха OpenBrain +30', () => {
    const s = newState();
    triggerEvent(s, 'chat-moment-rival');
    expect(modValue(s, 'labBrand', 'openbrain').add).toBeCloseTo(CHAT_MOMENT_BRAND, 10);
    expect(modValue(s, 'labBrand', 'gogle').add).toBe(0);
    expect(s.hype.openbrain).toBe(30);
    s.day = END_DAY;
    expect(modValue(s, 'labBrand', 'openbrain').add).toBeCloseTo(CHAT_MOMENT_BRAND, 10);
  });

  it('тексты по ревью: API GTP-3 по заявкам, дефицит видеокарт, рассуждающие модели, чат соперника', () => {
    const s = newState();
    const byId = (id: string) => EVENTS.find((e) => e.id === id)!;
    const gpt3 = byId('gpt3-api').mail(s);
    expect(gpt3.title).toBe('OpenBrain открыла API для GTP-3');
    expect(gpt3.body).toContain('по заявкам');
    expect(gpt3.body).toContain('$60 за 1 млн токенов');
    expect(gpt3.body).not.toContain('Любой разработчик');

    const shortage = byId('gpu-shortage').mail(s);
    expect(shortage.title).toBe('Дефицит видеокарт в облаках');
    expect(shortage.body).toContain('Спрос на видеокарты превысил предложение.');
    expect(shortage.body).not.toContain('GPU');

    const reasoning = byId('reasoning-models').mail(s);
    expect(reasoning.title).toBe('Модели, которые думают: q1-Previow');
    expect(reasoning.body).toContain('GPQE (наука)');
    expect(reasoning.body).toContain('SWE-banch (код)');
    expect(reasoning.body).not.toContain('GSM8C');
    expect(reasoning.body).not.toContain('математика');

    expect(byId('chat-moment-rival').choices![0].label).toBe('Объявить о своём чате');
    expect(byId('chat-moment-rival').choices![0].hint).toBe('+15 шумихи, если выпущена модель с RLHF');
  });

  it('ChatGTP у соперника: «Объявить о своём чате» с RLHF-моделью даёт +15 шумихи', () => {
    const s = newState();
    s.models.push(model());
    choose(s, 'chat-moment-rival', 0);
    expect(s.hype.player).toBe(15);
  });

  it('ChatGTP у соперника: «Объявить о своём чате» без выпущенной RLHF-модели - ничего', () => {
    const s = newState();
    s.models.push(model({ releasedDay: null })); // обучена, но не выпущена
    s.models.push(model({ id: 'p2', rlhf: false }));
    choose(s, 'chat-moment-rival', 0);
    expect(s.hype.player).toBe(0);
    expect(s.reputation).toBe(20);
  });

  it('ChatGTP у соперника: «Ждать» - без эффекта', () => {
    const s = newState();
    s.models.push(model());
    choose(s, 'chat-moment-rival', 1);
    expect(s.hype.player).toBe(0);
    expect(s.reputation).toBe(20);
  });

  it('дефицит GPU: лимит ×0,5 и цена ×1,2 до 31.03.2024', () => {
    const s = newState();
    s.day = D('2023-04-01');
    triggerEvent(s, 'gpu-shortage');
    expect(modValue(s, 'rentCap').mult).toBe(0.5);
    expect(modValue(s, 'rentPrice').mult).toBeCloseTo(1.2, 10);
    expect(s.modifiers.map((m) => m.id).sort()).toEqual(['gpu-shortage-cap', 'gpu-shortage-price']);
    for (const m of s.modifiers) expect(m.untilDay).toBe(D('2024-03-31'));
  });

  it('дефицит GPU: «Переплатить посредникам» снимает лимит и поднимает цену до ×1,6', () => {
    const s = newState();
    s.day = D('2023-04-01');
    choose(s, 'gpu-shortage', 0);
    expect(modValue(s, 'rentCap').mult).toBe(1);
    expect(modValue(s, 'rentPrice').mult).toBeCloseTo(1.6, 10);
    expect(s.modifiers).toHaveLength(1);
    expect(s.modifiers[0].untilDay).toBe(D('2024-03-31'));
  });

  it('дефицит GPU: «Ждать» оставляет всё как есть', () => {
    const s = newState();
    s.day = D('2023-04-01');
    choose(s, 'gpu-shortage', 1);
    expect(modValue(s, 'rentCap').mult).toBe(0.5);
    expect(modValue(s, 'rentPrice').mult).toBeCloseTo(1.2, 10);
  });
});

describe('совет директоров (board-control)', () => {
  it('срабатывает один раз, когда доля основателя опускается ниже FOUNDER_BOARD_SHARE; ровно на границе - нет', () => {
    const s = newState();
    s.day = 100;
    s.founderShare = FOUNDER_BOARD_SHARE;
    fireDue(s);
    expect(s.firedEvents).not.toContain('board-control');

    s.founderShare = FOUNDER_BOARD_SHARE - 0.01;
    fireDue(s);
    expect(s.firedEvents).toContain('board-control');
    const mail = pendingChoice(s)!;
    expect(mail.eventId).toBe('board-control');
    expect(mail.kind).toBe('event');
    expect(mail.title).toBe('Совет директоров требует контроля');
    expect(mail.body).toContain('49 %');
    expect(mail.body).toContain(money(buybackCost(s)));
    expect(mail.choices).toHaveLength(3);
    expect(mail.defaultChoice).toBe(0);
    expect(mail.replyByDay).toBe(100 + CHOICE_DAYS);

    // Дальше не повторяется, даже если доля падает ещё ниже.
    applyChoice(s, mail.id, 1);
    s.founderShare = 0.1;
    s.day = 500;
    fireDue(s);
    expect(s.mail.filter((m) => m.eventId === 'board-control')).toHaveLength(1);
  });

  it('«Принять план совета»: шумиха +BOARD_PLAN_HYPE и флаг сниженной оценки следующего раунда', () => {
    const s = newState();
    s.founderShare = 0.4;
    choose(s, 'board-control', 0);
    expect(s.hype.player).toBe(BOARD_PLAN_HYPE);
    expect(s.reputation).toBe(20);
    expect(s.flags[BOARD_PLAN_FLAG]).toBe(true);
    expect(valuation(s).boardMult).toBe(BOARD_PLAN_VALUATION_MULT);
    expect(s.founderShare).toBe(0.4);
  });

  it('«Отстоять свой план»: репутация BOARD_DEFEND_REP, остальное без изменений', () => {
    const s = newState();
    s.founderShare = 0.4;
    const cash = s.cash;
    choose(s, 'board-control', 1);
    expect(s.reputation).toBe(20 + BOARD_DEFEND_REP);
    expect(s.hype.player).toBe(0);
    expect(s.cash).toBe(cash);
    expect(s.flags[BOARD_PLAN_FLAG]).toBeUndefined();
    expect(s.founderShare).toBe(0.4);
  });

  it('«Выкупить долю»: деньги по цене выкупа на день ответа, доля основателя +BOARD_BUYBACK_SHARE', () => {
    const s = newState();
    s.founderShare = 0.4;
    const cash = s.cash;
    const cost = buybackCost(s);
    expect(cost).toBeGreaterThan(0);
    choose(s, 'board-control', 2);
    expect(s.cash).toBeCloseTo(cash - cost, 6);
    expect(s.founderShare).toBeCloseTo(0.4 + BOARD_BUYBACK_SHARE, 12);
    expect(s.reputation).toBe(20);
    expect(s.hype.player).toBe(0);
    const last = s.mail[s.mail.length - 1];
    expect(last.kind).toBe('finance');
    expect(last.title).toContain('Выкуплено');
  });

  it('без ответа в срок выбирается план совета (вариант по умолчанию)', () => {
    const s = newState();
    s.day = 10;
    s.founderShare = 0.3;
    fireDue(s);
    const mail = pendingChoice(s)!;
    deferChoice(s, mail.id);
    s.day = mail.replyByDay!;
    expireChoices(s);
    expect(mail.chosen).toBe(0);
    expect(mail.autoChosen).toBe(true);
    expect(s.hype.player).toBe(BOARD_PLAN_HYPE);
    expect(s.flags[BOARD_PLAN_FLAG]).toBe(true);
  });

  it('подсказки называют числа из констант', () => {
    const def = EVENTS.find((e) => e.id === 'board-control')!;
    expect(def.choices![0].hint).toBe(`+${BOARD_PLAN_HYPE} шумихи, оценка в следующем раунде ×0,7`);
    expect(def.choices![1].hint).toBe(`−${Math.abs(BOARD_DEFEND_REP)} репутации`);
    expect(def.choices![2].label).toBe(`Выкупить ${Math.round(BOARD_BUYBACK_SHARE * 100)} % компании`);
    expect(def.choices![2].hint).toContain('надбавкой 25 %');
    expect(def.choices![2].hint).toContain(`+${Math.round(BOARD_BUYBACK_SHARE * 100)} п.п.`);
  });
});

describe('модификаторы с датой окончания', () => {
  it.each([0, 1])('дефицит GPU (выбор %i): после 31.03.2024 всё возвращается к норме', (idx) => {
    const s = newState();
    s.day = D('2023-04-01');
    choose(s, 'gpu-shortage', idx);

    s.day = D('2024-03-31'); // последний день включительно
    expect(modValue(s, 'rentPrice').mult).toBeGreaterThan(1);

    s.day = D('2024-04-01');
    expect(modValue(s, 'rentCap')).toEqual({ mult: 1, add: 0 });
    expect(modValue(s, 'rentPrice')).toEqual({ mult: 1, add: 0 });
    pruneModifiers(s);
    expect(s.modifiers).toEqual([]);
  });

  it('экспортные запреты: бренд только китайских лабораторий, суммарно EXPORT_CONTROL_BRAND', () => {
    const s = newState();
    expect(s.flags.exportControls).toBeUndefined();
    triggerEvent(s, 'export-controls-2022');
    expect(s.flags.exportControls).toBe(true);
    const chinese = LABS.filter((l) => l.chinese);
    expect(chinese.length).toBeGreaterThan(0);
    for (const lab of LABS) {
      const add = modValue(s, 'labBrand', lab.id).add;
      expect(add, lab.id).toBeCloseTo(lab.chinese ? EXPORT_CONTROL_BRAND / 2 : 0, 10);
    }

    triggerEvent(s, 'export-controls-2023');
    for (const lab of LABS) {
      const add = modValue(s, 'labBrand', lab.id).add;
      expect(add, lab.id).toBeCloseTo(lab.chinese ? EXPORT_CONTROL_BRAND : 0, 10);
    }
    expect(s.modifiers).toHaveLength(chinese.length * 2);
    expect(new Set(s.modifiers.map((m) => m.id)).size).toBe(s.modifiers.length);

    s.day = END_DAY;
    pruneModifiers(s);
    expect(s.modifiers).toHaveLength(chinese.length * 2); // навсегда
  });

  it('повторный запуск того же события не дублирует модификаторы', () => {
    const s = newState();
    triggerEvent(s, 'export-controls-2022');
    triggerEvent(s, 'export-controls-2022');
    triggerEvent(s, 'gpu-shortage');
    triggerEvent(s, 'gpu-shortage');
    expect(s.mail.filter((m) => m.title === 'США ограничили продажу чипов в Китай')).toHaveLength(1);
    expect(s.modifiers.filter((m) => m.id === 'gpu-shortage-cap')).toHaveLength(1);
  });
});

describe('срыв обучения (training-fail)', () => {
  it('повторяемое: только через triggerEvent, и может прийти дважды', () => {
    const s = newState();
    triggerEvent(s, 'training-fail');
    expect(s.firedEvents).not.toContain('training-fail');
    const first = pendingChoice(s);
    expect(first?.eventId).toBe('training-fail');
    expect(applyChoice(s, first!.id, 0)).toEqual({ ok: true });
    expect(pendingChoice(s)).toBeNull();

    triggerEvent(s, 'training-fail');
    const second = pendingChoice(s);
    expect(second?.eventId).toBe('training-fail');
    expect(second!.id).not.toBe(first!.id);
    expect(s.mail.filter((m) => m.eventId === 'training-fail')).toHaveLength(2);
  });

  it('fireDue его не запускает никогда', () => {
    const s = newState();
    s.day = END_DAY;
    fireDue(s);
    expect(s.mail.some((m) => m.eventId === 'training-fail')).toBe(false);
    expect(s.firedEvents).not.toContain('training-fail');
  });

  it('«Откатиться к чекпоинту» вызывает applyFailChoice(rollback)', () => {
    const s = newState();
    choose(s, 'training-fail', 0);
    expect(applyFailChoice).toHaveBeenCalledTimes(1);
    expect(applyFailChoice).toHaveBeenCalledWith(s, 'rollback');
  });

  it('«Продолжить» вызывает applyFailChoice(continue)', () => {
    const s = newState();
    choose(s, 'training-fail', 1);
    expect(applyFailChoice).toHaveBeenCalledTimes(1);
    expect(applyFailChoice).toHaveBeenCalledWith(s, 'continue');
  });

  it('в письме есть название проекта с failed, а не первого в списке', () => {
    const s = newState();
    const run = (id: string, name: string, failed: boolean) => ({
      id,
      failed,
      plan: { ...model().plan, name },
      arch: 'transformer' as const,
      algoLevel: 0,
      flopTotal: 1e22,
      flopDone: 4e21,
      startedDay: 10,
      failAtFraction: null,
      failPenalty: 0,
    });
    s.trainings = [run('t1', 'Малыш-1', false), run('t2', 'Гигант-2', true)];
    triggerEvent(s, 'training-fail');
    const mail = s.mail[0];
    expect(mail.title).toContain('Срыв обучения');
    expect(mail.body).toContain('Гигант-2');
    expect(mail.body).not.toContain('Малыш-1');
    expect(mail.kind).toBe('training');
  });

  it('письмо не падает без идущего проекта', () => {
    const s = newState();
    expect(() => triggerEvent(s, 'training-fail')).not.toThrow();
  });
});

describe('поток pendingChoice / applyChoice', () => {
  it('новости без выбора не блокируют игру', () => {
    const s = newState();
    triggerEvent(s, 'arena-open');
    triggerEvent(s, 'q3-arc');
    expect(s.mail).toHaveLength(2);
    expect(pendingChoice(s)).toBeNull();
  });

  it('письмо с выбором ждёт ответа; повторный и неверный выбор отклоняются', () => {
    const s = newState();
    triggerEvent(s, 'gpt2-withheld');
    const mail = pendingChoice(s);
    expect(mail).not.toBeNull();
    expect(mail!.choices).toEqual([
      { label: 'Поддержать осторожность', hint: '+8 репутации' },
      { label: 'Назвать это рекламным ходом', hint: '+10 шумихи, −3 репутации' },
      { label: 'Не комментировать', hint: 'без изменений' },
    ]);
    expect(mail!.chosen).toBeUndefined();
    expect(mail!.read).toBe(false);

    expect(applyChoice(s, mail!.id, 5).ok).toBe(false);
    expect(applyChoice(s, mail!.id, -1).ok).toBe(false);
    expect(applyChoice(s, 'нет-такого', 0).ok).toBe(false);
    expect(pendingChoice(s)).not.toBeNull();
    expect(s.reputation).toBe(20);

    expect(applyChoice(s, mail!.id, 0)).toEqual({ ok: true });
    expect(mail!.chosen).toBe(0);
    expect(mail!.read).toBe(true);
    expect(pendingChoice(s)).toBeNull();
    expect(s.reputation).toBe(28);

    const again = applyChoice(s, mail!.id, 1);
    expect(again.ok).toBe(false);
    expect(s.reputation).toBe(28); // второй выбор не сработал
  });

  it('выбор в новости без вариантов невозможен', () => {
    const s = newState();
    triggerEvent(s, 'q3-arc');
    expect(applyChoice(s, s.mail[0].id, 0).ok).toBe(false);
  });

  it('несколько писем с выбором идут по очереди, по одному', () => {
    const s = newState();
    s.day = END_DAY;
    fireDue(s); // всё накопилось за срез, игрок ничего не выбирал
    const pending = s.mail.filter((m) => m.choices && m.chosen === undefined);
    expect(pending.map((m) => m.eventId)).toEqual(['gpt2-withheld', 'gpt3-api', 'chat-moment-rival', 'gpu-shortage']);

    const order: (string | undefined)[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const m = pendingChoice(s);
      if (!m) break;
      order.push(m.eventId);
      expect(applyChoice(s, m.id, 1).ok).toBe(true);
    }
    expect(order).toEqual(['gpt2-withheld', 'gpt3-api', 'chat-moment-rival', 'gpu-shortage']);
    expect(pendingChoice(s)).toBeNull();
  });
});

describe('сохранение: в JSON попадают только id события и номер выбора', () => {
  it('состояние с событиями переживает JSON; выбор и модификаторы работают после загрузки', () => {
    const s = newState();
    s.day = D('2023-04-01');
    triggerEvent(s, 'export-controls-2022');
    triggerEvent(s, 'gpu-shortage');

    const loaded = JSON.parse(JSON.stringify(s)) as GameState;
    expect(loaded.mail).toEqual(s.mail);
    expect(modValue(loaded, 'rentCap').mult).toBe(0.5);
    const mail = pendingChoice(loaded);
    expect(mail?.eventId).toBe('gpu-shortage');
    expect(applyChoice(loaded, mail!.id, 0)).toEqual({ ok: true });
    expect(modValue(loaded, 'rentCap').mult).toBe(1);
    expect(modValue(loaded, 'rentPrice').mult).toBeCloseTo(1.6, 10);

    // «навсегда» не ломается после JSON
    loaded.day = END_DAY;
    expect(modValue(loaded, 'labBrand', 'zhipo').add).toBeCloseTo(EXPORT_CONTROL_BRAND / 2, 10);

    // исходное состояние не затронуто
    expect(modValue(s, 'rentCap').mult).toBe(0.5);
    expect(pendingChoice(s)?.chosen).toBeUndefined();
  });

  it('FOREVER - целое безопасное число и переживает JSON без потерь', () => {
    expect(JSON.parse(JSON.stringify({ x: FOREVER })).x).toBe(FOREVER);
    expect(Number.isSafeInteger(FOREVER)).toBe(true);
  });
});

describe('модификаторы читают настоящие потребители (compute, research, market)', () => {
  it('дефицит GPU: цена аренды ×1,2 и лимит ×0,5; после 31.03.2024 всё как у состояния без события', () => {
    const s = newState();
    s.day = D('2023-04-01');
    const price0 = rentPerGpuDay(s, 'h100');
    const cap0 = rentCapFor(s, 'h100');
    expect(price0).toBeGreaterThan(0);
    triggerEvent(s, 'gpu-shortage');
    expect(rentPerGpuDay(s, 'h100')).toBeCloseTo(price0 * 1.2, 8);
    expect(rentCapFor(s, 'h100')).toBe(Math.floor(cap0 * 0.5));

    const clean = newState();
    for (const date of ['2024-03-31', '2024-04-01']) {
      s.day = D(date);
      clean.day = D(date);
      const sameDay = date === '2024-04-01';
      expect(rentPerGpuDay(s, 'h100') === rentPerGpuDay(clean, 'h100'), date).toBe(sameDay);
      expect(rentCapFor(s, 'h100') === rentCapFor(clean, 'h100'), date).toBe(sameDay);
    }
  });

  it('дефицит GPU: «Переплатить» - лимит прежний, цена ×1,6', () => {
    const s = newState();
    s.day = D('2023-04-01');
    const price0 = rentPerGpuDay(s, 'h100');
    const cap0 = rentCapFor(s, 'h100');
    choose(s, 'gpu-shortage', 0);
    expect(rentCapFor(s, 'h100')).toBe(cap0);
    expect(rentPerGpuDay(s, 'h100')).toBeCloseTo(price0 * 1.6, 8);
  });

  it('статья Gogle: «Механизм внимания» дешевле на 60 %, остальные исследования - по прежней цене', () => {
    const s = newState();
    const before = { attention: techCost(s, 'attention'), scaling: techCost(s, 'scaling'), rlhf: techCost(s, 'rlhf'), algo: techCost(s, 'algo') };
    triggerEvent(s, 'attention-paper-public');
    expect(techCost(s, 'attention')).toBeCloseTo(before.attention * ATTENTION_PAPER_DISCOUNT, 8);
    expect(techCost(s, 'scaling')).toBe(before.scaling);
    expect(techCost(s, 'rlhf')).toBe(before.rlhf);
    expect(techCost(s, 'algo')).toBe(before.algo);
  });

  it('ChatGTP у соперника: бренд OpenBrain +0,5, бренд остальных и игрока не меняется', () => {
    const s = newState();
    const before = Object.fromEntries(LABS.map((l) => [l.id, labBrand(s, l.id)]));
    const player0 = labBrand(s, 'player');
    triggerEvent(s, 'chat-moment-rival');
    for (const lab of LABS) {
      const expected = before[lab.id] + (lab.id === 'openbrain' ? CHAT_MOMENT_BRAND : 0);
      expect(labBrand(s, lab.id), lab.id).toBeCloseTo(expected, 10);
    }
    expect(labBrand(s, 'player')).toBe(player0);
  });

  it('экспортные запреты: бренд китайских лабораторий −0,1 за каждый запрет, остальные и игрок не меняются', () => {
    const s = newState();
    const before = Object.fromEntries(LABS.map((l) => [l.id, labBrand(s, l.id)]));
    const player0 = labBrand(s, 'player');
    triggerEvent(s, 'export-controls-2022');
    for (const lab of LABS) {
      expect(labBrand(s, lab.id), lab.id).toBeCloseTo(before[lab.id] + (lab.chinese ? EXPORT_CONTROL_BRAND / 2 : 0), 10);
    }
    triggerEvent(s, 'export-controls-2023');
    for (const lab of LABS) {
      expect(labBrand(s, lab.id), lab.id).toBeCloseTo(before[lab.id] + (lab.chinese ? EXPORT_CONTROL_BRAND : 0), 10);
    }
    expect(labBrand(s, 'player')).toBe(player0);
  });
});

describe('письма с выбором соперников (findEvent, RIVALRY_EVENTS)', () => {
  it('findEvent находит события каталога и письма соперников; EVENTS писем соперников не содержит', () => {
    expect(RIVALRY_EVENTS.map((e) => e.id).sort()).toEqual(['rival-audit', 'rival-hype', 'rival-poach']);
    expect(findEvent('gpt2-withheld')?.id).toBe('gpt2-withheld');
    for (const def of RIVALRY_EVENTS) {
      expect(findEvent(def.id)).toBe(def);
      expect(def.repeatable).toBe(true);
      expect(EVENTS.some((e) => e.id === def.id)).toBe(false);
    }
    expect(findEvent('нет-такого')).toBeUndefined();
    expect(findEvent(undefined)).toBeUndefined();
  });

  it('fireDue письма соперников не запускает никогда', () => {
    const s = newState();
    s.day = END_DAY;
    fireDue(s);
    expect(s.mail.some((m) => m.eventId?.startsWith('rival-'))).toBe(false);
    expect(s.firedEvents.some((id) => id.startsWith('rival-'))).toBe(false);
  });

  it('triggerEvent письма соперника: повторяемое, с выбором, отложить и дождаться срока можно', () => {
    const s = newState();
    s.day = 100;
    s.rivalry.choice = { lab: 'gogle' };
    triggerEvent(s, 'rival-poach');
    expect(s.firedEvents).toEqual([]);
    const m = pendingChoice(s)!;
    expect(m.eventId).toBe('rival-poach');
    expect(m.kind).toBe('rival');
    expect(m.title).toContain('Gogle');
    expect(m.choices).toHaveLength(2);
    expect(m.replyByDay).toBe(100 + CHOICE_DAYS);
    expect(m.defaultChoice).toBe(1);
    expect(deferChoice(s, m.id)).toEqual({ ok: true });
    expect(pendingChoice(s)).toBeNull();
    expect(awaitingEvent(s, 'rival-poach')).toBe(true);
    s.day = m.replyByDay!;
    expireChoices(s);
    expect(m.chosen).toBe(1); // «Отпустить»: исследования дороже на 25 % на 180 дней
    expect(m.autoChosen).toBe(true);
    expect(modValue(s, 'researchCost').mult).toBeCloseTo(1.25, 10);
    s.day += 181;
    expect(modValue(s, 'researchCost').mult).toBe(1);
    // второй раз письмо приходит снова
    triggerEvent(s, 'rival-poach');
    expect(s.mail.filter((x) => x.eventId === 'rival-poach')).toHaveLength(2);
  });

  it('рекламная кампания соперника: «Ответная кампания» списывает деньги и даёт +15 шумихи', () => {
    const s = newState();
    const cash = s.cash;
    choose(s, 'rival-hype', 0); // в 2017 году рост цен за годы ×1: $300 тыс.
    expect(s.cash).toBe(cash - 300_000);
    expect(s.finance.month.expense.overhead).toBe(300_000);
    expect(s.hype.player).toBe(15);
    const t = newState();
    choose(t, 'rival-hype', 1);
    expect(t.cash).toBe(cash);
    expect(t.hype.player).toBe(0);
  });

  it('проверка баллов без модели в контексте не падает; dropChoices снимает письмо соперника', () => {
    const s = newState();
    triggerEvent(s, 'rival-audit');
    const m = pendingChoice(s)!;
    expect(m.eventId).toBe('rival-audit');
    expect(m.body).not.toMatch(/undefined|NaN/);
    dropChoices(s, 'rival-audit', 'Решение не требуется.');
    expect(awaitingEvent(s, 'rival-audit')).toBe(false);
    expect(pendingChoice(s)).toBeNull();
  });
});

describe('отложенный выбор', () => {
  it('письмо с выбором получает срок ответа и вариант по умолчанию (последний)', () => {
    const s = newState();
    s.day = 100;
    triggerEvent(s, 'gpt2-withheld');
    const m = pendingChoice(s)!;
    expect(m.replyByDay).toBe(100 + CHOICE_DAYS);
    expect(m.defaultChoice).toBe(2);
    expect(m.deferred).toBeUndefined();
  });

  it('у срыва обучения срок короче', () => {
    const s = newState();
    triggerEvent(s, 'training-fail');
    expect(pendingChoice(s)!.replyByDay).toBe(s.day + FAIL_CHOICE_DAYS);
  });

  it('отложенное письмо не останавливает игру, но остаётся среди ждущих ответа', () => {
    const s = newState();
    triggerEvent(s, 'gpt2-withheld');
    const m = pendingChoice(s)!;
    expect(deferChoice(s, m.id)).toEqual({ ok: true });
    expect(m.deferred).toBe(true);
    expect(m.read).toBe(true);
    expect(pendingChoice(s)).toBeNull();
    expect(openChoices(s)).toEqual([m]);
    expect(awaitingEvent(s, 'gpt2-withheld')).toBe(true);
    // ответить можно и позже
    expect(applyChoice(s, m.id, 0)).toEqual({ ok: true });
    expect(openChoices(s)).toEqual([]);
    expect(s.reputation).toBe(28);
  });

  it('отложить можно только неотвеченное письмо с выбором', () => {
    const s = newState();
    triggerEvent(s, 'gpt2-withheld');
    const m = pendingChoice(s)!;
    applyChoice(s, m.id, 0);
    expect(deferChoice(s, m.id).ok).toBe(false);
    expect(deferChoice(s, 'нет-такого').ok).toBe(false);
  });

  it('срок истёк: выбирается вариант по умолчанию, письмо снова непрочитанное', () => {
    const s = newState();
    triggerEvent(s, 'attention-paper-player');
    const m = pendingChoice(s)!;
    deferChoice(s, m.id);
    const level = s.research.algoLevel;
    s.day = m.replyByDay! - 1;
    expireChoices(s);
    expect(m.chosen).toBeUndefined();
    s.day = m.replyByDay!;
    expireChoices(s);
    expect(m.chosen).toBe(1); // «Оставить в секрете»
    expect(m.autoChosen).toBe(true);
    expect(m.read).toBe(false);
    expect(s.research.algoLevel).toBe(level + 1);
  });

  it('dropChoices снимает выбор: письмо больше не ждёт ответа', () => {
    const s = newState();
    triggerEvent(s, 'training-fail');
    const m = pendingChoice(s)!;
    deferChoice(s, m.id);
    dropChoices(s, 'training-fail', 'Проект отменён.');
    expect(m.choices).toBeUndefined();
    expect(awaitingEvent(s, 'training-fail')).toBe(false);
    expect(m.body.endsWith('Проект отменён.')).toBe(true);
  });
});
