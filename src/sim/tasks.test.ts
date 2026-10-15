// Тесты коротких задач: появление по ситуации, не больше двух сразу и разных групп, награда и праздник при выполнении,
// «почти» при провале, счётчик выигранных тендеров, свой поток случайных чисел, сохранения.

import { describe, expect, it } from 'vitest';
import { EXTRA_EVENTS } from '../data/events';
import { cumRevenue } from '../data/questKit';
import { RIVAL_MODELS } from '../data/rivalModels';
import { findTask, TASKS } from '../data/tasks';
import { newGame } from './actions';
import { botAct, botChoice } from './bots';
import { applyChoice, pendingChoice } from './events';
import { deserialize, serialize } from './save';
import { activeTasks, CLOSED_KEEP_DAYS, MAX_TASKS, syncTenders, taskProgress, taskTitle, tasksDay } from './tasks';
import { advanceDay } from './tick';
import { dateToDay } from './time';
import type { GameState, PlayerModel, TaskState, Tender } from './types';

const D = dateToDay;

function quietGame(day: number, seed = 1): GameState {
  const s = newGame('Тест', seed);
  s.day = day;
  s.yearly.nextEventDay = Number.MAX_SAFE_INTEGER;
  s.firedEvents.push(...EXTRA_EVENTS.map((e) => e.id));
  return s;
}

function model(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Мозг-1',
    plan: {
      name: 'Мозг-1', paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'light',
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 10,
    releasedDay: 20,
    caps: { language: 60, code: 20, reasoning: 20 },
    overfit: {},
    rlhf: false,
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

function task(over: Partial<TaskState>): TaskState {
  return { id: 'q1', kind: 'earn', startDay: 0, endDay: 100, need: 1, base: 0, subject: '', status: 'active', closedDay: null, result: '', ...over };
}

function tender(over: Partial<Tender> = {}): Tender {
  return {
    id: 't1', clientId: 'bank-severny', type: 'finetune', benchmark: 'squad', requirement: 30, work: 10, durationDays: 60,
    payment: 100_000, penalty: 10_000, appearedDay: 0, expiresDay: 1000, application: null, ...over,
  };
}

const rnd = () => 0.5;

describe('задачи в партии', () => {
  it('за партию бота задачи появляются, идут не больше двух сразу и всегда разных групп; часть выполнена, часть нет', () => {
    const s = newGame('Бот', 3);
    let maxActive = 0;
    const kinds = new Set<string>();
    while (!s.outcome) {
      const p = pendingChoice(s);
      if (p) {
        applyChoice(s, p.id, botChoice(s, p.eventId));
        continue;
      }
      if (s.day % 7 === 0) botAct(s, 'reasonable');
      advanceDay(s);
      const active = activeTasks(s);
      maxActive = Math.max(maxActive, active.length);
      const groups = active.map((t) => findTask(t.kind)!.group);
      expect(new Set(groups).size).toBe(groups.length);
      for (const t of active) {
        kinds.add(t.kind);
        expect(t.endDay).toBeGreaterThan(t.startDay);
        const title = taskTitle(s, t);
        expect(title.length).toBeGreaterThan(5);
        expect(title).not.toMatch(/undefined|NaN|[–—]/);
        const pr = taskProgress(s, t)!;
        expect(pr.text).not.toMatch(/undefined|NaN|[–—]/);
        expect(pr.fraction).toBeGreaterThanOrEqual(0);
        expect(pr.fraction).toBeLessThanOrEqual(1);
      }
    }
    expect(maxActive).toBe(MAX_TASKS);
    expect(s.quests.done).toBeGreaterThan(10);
    expect(s.quests.failed).toBeGreaterThan(5);
    expect(kinds.size).toBeGreaterThanOrEqual(6);
    const done = s.mail.filter((m) => m.title.startsWith('Задача выполнена: '));
    expect(done.length).toBeGreaterThan(0);
    expect(done.every((m) => m.reward && m.body.startsWith('Награда: '))).toBe(true);
    for (const m of s.mail.filter((x) => x.title.startsWith('Почти: '))) expect(m.read).toBe(false);
    for (const m of s.mail.filter((x) => x.title.startsWith('Задача не выполнена: '))) expect(m.read).toBe(true);
  });

  it('задачи не раскрывают будущее: соперник в задаче «обогнать» уже вышел, подписчики - только после открытия подписок', () => {
    const s = newGame('Бот', 2);
    while (!s.outcome) {
      const p = pendingChoice(s);
      if (p) {
        applyChoice(s, p.id, botChoice(s, p.eventId));
        continue;
      }
      if (s.day % 7 === 0) botAct(s, 'reasonable');
      advanceDay(s);
      for (const t of activeTasks(s)) {
        if (t.startDay !== s.day - 1) continue;
        if (t.kind === 'beat') expect(s.rivalsReleased).toContain(t.subject.split(':')[1]);
        if (t.kind === 'subs') expect(s.day).toBeGreaterThanOrEqual(D('2022-11-30'));
      }
    }
  });
});

describe('появление по ситуации', () => {
  it('«выиграть тендер» - только когда есть тендер, на который модель проходит', () => {
    const def = findTask('tender')!;
    const s = quietGame(D('2019-03-01'));
    expect(def.make(s, rnd)).toBeNull();
    s.models = [model()];
    s.tenders = [tender({ requirement: 99 })];
    expect(def.make(s, rnd)).toBeNull();
    s.tenders = [tender()];
    const plan = def.make(s, rnd)!;
    expect(plan).toMatchObject({ need: 1, days: 40, base: s.quests.tendersWon });
  });

  it('«заработать» - только при модели в продаже и выручке; порог - на 10-30 % выше обычных 60 дней', () => {
    const def = findTask('earn')!;
    const s = quietGame(D('2019-03-01'));
    s.finance.revenueDaily = Array.from({ length: 90 }, () => 1000);
    expect(def.make(s, rnd)).toBeNull();
    s.models = [model()];
    const plan = def.make(s, rnd)!;
    expect(plan.need).toBeGreaterThanOrEqual(60_000 * 1.1 * 0.9);
    expect(plan.need).toBeLessThanOrEqual(60_000 * 1.3 * 1.1);
    expect(plan.days).toBe(60);
  });

  it('«завершить исследование» - срок чуть короче нынешнего прогноза: нужно поднажать', () => {
    const def = findTask('research')!;
    const s = quietGame(D('2017-02-01'));
    s.compute.rented.p100 = 100;
    expect(def.make(s, rnd)).toBeNull();
    s.research.current = 'attention';
    const plan = def.make(s, rnd);
    expect(plan).not.toBeNull();
    expect(plan!.subject).toBe('attention');
    expect(plan!.days).toBeGreaterThan(10);
  });

  it('«обогнать» - только когда соперник впереди близко и идёт обучение', () => {
    const def = findTask('beat')!;
    const s = quietGame(D('2021-03-01'));
    s.rivalsReleased = RIVAL_MODELS.filter((m) => m.released <= '2021-03-01').map((m) => m.id);
    const gtp3 = RIVAL_MODELS.find((m) => m.id === 'gtp-3')!;
    s.models = [model({ arenaElo: gtp3.arenaElo - 10 })];
    expect(def.make(s, rnd)).toBeNull(); // обучения нет - обогнать нечем
    s.models.push(model({ id: 'p2', releasedDay: null, arenaElo: 0 }));
    const plan = def.make(s, rnd);
    if (plan) {
      expect(plan.subject.startsWith('arena:')).toBe(true);
      expect(plan.base).toBeLessThanOrEqual(40);
    }
  });
});

describe('выполнение и провал', () => {
  it('выполненная задача: награда, золотое письмо, счётчик; задача остаётся в списке закрытой', () => {
    const s = quietGame(D('2019-03-01'));
    s.quests.nextTaskDay = Number.MAX_SAFE_INTEGER;
    s.quests.tasks = [task({ kind: 'earn', need: 50_000, base: cumRevenue(s), endDay: s.day + 30 })];
    s.finance.month.income.api = 60_000;
    const cash = s.cash;
    tasksDay(s);
    const t = s.quests.tasks[0];
    expect(t.status).toBe('done');
    expect(t.closedDay).toBe(s.day);
    expect(s.quests.done).toBe(1);
    expect(s.cash - cash).toBe(50_000); // 0,2 единицы 2019 года
    const mail = s.mail[s.mail.length - 1];
    expect(mail.title).toBe('Задача выполнена: Заработать $50 тыс.');
    expect(mail.reward).toBe(true);
    expect(mail.body).toBe('Награда: +$50 тыс.');
  });

  it('срок вышел почти у цели: письмо «Почти» с недостачей приходит уведомлением', () => {
    const s = quietGame(D('2019-03-01'));
    s.quests.nextTaskDay = Number.MAX_SAFE_INTEGER;
    s.quests.tasks = [task({ kind: 'earn', need: 100_000, base: cumRevenue(s), endDay: s.day })];
    s.finance.month.income.api = 92_000;
    tasksDay(s);
    const t = s.quests.tasks[0];
    expect(t.status).toBe('failed');
    expect(t.result).toBe('Не хватило $8 тыс.');
    const mail = s.mail[s.mail.length - 1];
    expect(mail.title).toBe('Почти: Заработать $100 тыс.');
    expect(mail.read).toBe(false);
    expect(mail.body).toBe('Срок задачи вышел. Заработано: $92 тыс. из $100 тыс. Не хватило $8 тыс.');
  });

  it('далёкий промах: письмо ложится в «Почту» прочитанным, без уведомления', () => {
    const s = quietGame(D('2019-03-01'));
    s.quests.nextTaskDay = Number.MAX_SAFE_INTEGER;
    s.quests.tasks = [task({ kind: 'earn', need: 100_000, base: cumRevenue(s), endDay: s.day })];
    s.finance.month.income.api = 20_000;
    tasksDay(s);
    const mail = s.mail[s.mail.length - 1];
    expect(mail.title).toBe('Задача не выполнена: Заработать $100 тыс.');
    expect(mail.read).toBe(true);
  });

  it('«сдать контракт досрочно»: провал контракта закрывает задачу сразу', () => {
    const s = quietGame(D('2019-03-01'));
    s.quests.nextTaskDay = Number.MAX_SAFE_INTEGER;
    s.quests.tasks = [task({ kind: 'deliver', need: 100_000, subject: 'c9', base: 0, endDay: s.day + 40 })];
    tasksDay(s);
    expect(s.quests.tasks[0].status).toBe('failed');
  });

  it('закрытые задачи уходят из списка через 30 дней', () => {
    const s = quietGame(D('2019-03-01'));
    s.quests.nextTaskDay = Number.MAX_SAFE_INTEGER;
    s.quests.tasks = [task({ status: 'done', closedDay: s.day - CLOSED_KEEP_DAYS - 1 }), task({ id: 'q2', status: 'failed', closedDay: s.day - 3 })];
    tasksDay(s);
    expect(s.quests.tasks.map((t) => t.id)).toEqual(['q2']);
  });
});

describe('счётчик тендеров', () => {
  it('новый контракт засчитывается один раз', () => {
    const s = quietGame(D('2019-03-01'));
    s.contracts.push({ id: 'c5', tender: tender({ id: 't5' }), modelId: 'p1', startedDay: s.day, deadlineDay: s.day + 50, workDone: 0 });
    syncTenders(s);
    syncTenders(s);
    expect(s.quests.tendersWon).toBe(1);
    s.contracts = [];
    syncTenders(s);
    expect(s.quests.tendersWon).toBe(1);
    expect(s.quests.knownContracts).toEqual([]);
  });

  it('старое сохранение: идущие контракты не считаются новыми победами', () => {
    const s = quietGame(D('2019-03-01'));
    s.contracts.push({ id: 'c5', tender: tender({ id: 't5' }), modelId: 'p1', startedDay: s.day, deadlineDay: s.day + 50, workDone: 0 });
    const data = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete data.quests;
    const r = deserialize(JSON.stringify(data));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    syncTenders(r.state);
    expect(r.state.quests.tendersWon).toBe(0);
  });
});

describe('описания задач', () => {
  it('у каждого вида своя группа, вес и награда', () => {
    expect(new Set(TASKS.map((t) => t.kind)).size).toBe(TASKS.length);
    for (const t of TASKS) {
      expect(t.weight).toBeGreaterThan(0);
      expect(Object.keys(t.reward).length).toBeGreaterThan(0);
    }
  });
});
