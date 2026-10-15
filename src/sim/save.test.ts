// Тесты сохранений (FR-13): здоровое сохранение загружается, сохранение от старой версии игры или битый файл
// отклоняются понятной ошибкой на русском, а не роняют тик и отрисовку.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { botAct, runBot } from './bots';
import { CHOICE_DAYS, FAIL_CHOICE_DAYS, TIER_SUBS_PRICE } from './constants';
import { applyChoice, expireChoices, FOREVER, pendingChoice } from './events';
import { emptyRivalry } from './rivalry';
import { deserialize, serialize } from './save';
import { createInitialState, emptyMarket } from './state';
import { advanceDay, advanceDays } from './tick';
import { END_DAY } from './time';
import { tierOf } from './training';
import type { GameState } from './types';

type Json = Record<string, unknown>;

/** Игра, прожитая ботом-подгонщиком: есть обучение, модели с подгонкой, тендеры с заявками, письма с выбором, история месяцев. */
function richState(): GameState {
  const s = newGame('Бот', 1);
  let days = 0;
  while (!s.outcome && (days < 900 || (s.trainings.length === 0 && days < 1500))) {
    const pending = pendingChoice(s);
    if (pending) {
      applyChoice(s, pending.id, 0);
      continue;
    }
    if (s.day % 7 === 0) botAct(s, 'benchmaxx');
    advanceDay(s);
    days++;
  }
  // Чего бот к этому дню не успел, добавляем руками: заявку (бот подаёт их по мощности, открытой может не быть),
  // контракт и модификаторы со всеми необязательными полями.
  if (!s.tenders.some((t) => t.application !== null)) {
    s.tenders[0].application = { modelId: s.models[0].id, appliedDay: s.day, resolveDay: s.day + 20, chance: 0.5, work: 123 };
  }
  s.contracts.push({
    id: 'c-test',
    tender: structuredClone(s.tenders[0]),
    modelId: s.models[0].id,
    startedDay: s.day,
    deadlineDay: s.day + 50,
    workDone: 3,
  });
  s.modifiers.push({ id: 'mod-a', kind: 'rentPrice', target: 'h100', mult: 1.2, add: 0.1, untilDay: FOREVER });
  s.modifiers.push({ id: 'mod-b', kind: 'labBrand', untilDay: s.day + 10 });
  s.modifiers.push({ id: 'mod-c', kind: 'rivalPrice', target: 'gogle', mult: 0.7, add: 0.3, untilDay: s.day + 120 });
  s.modifiers.push({ id: 'mod-d', kind: 'exposure', target: s.models[0].id, mult: 2, untilDay: s.day + 180 });
  s.flags.exportControls = true;
  // Соперники с характерами спят до 2021 года: слух, активный ход, поправки, память и письмо с выбором добавляем руками.
  // Слухи не срабатывают (день после конца игры), письмо отложено - загруженная игра идёт дальше без остановки.
  const r = s.rivalry;
  r.heat.gogle = 42;
  r.cooldownUntil.gogle = s.day + 180;
  r.moveCooldown['gogle:hype'] = s.day + 180;
  r.moveCooldown['global:audit'] = s.day + 365;
  r.pending.push({ id: 'pm1', lab: 'gogle', move: 'hype', fireDay: END_DAY + 1 });
  r.pending.push({ id: 'pm2', lab: 'antropik', move: 'audit', fireDay: END_DAY + 1, modelId: s.models[0].id });
  r.active.push({ lab: 'openbrain', move: 'priceCut', untilDay: END_DAY + 1 });
  r.overrides['gtp-4'] = { dayShift: -10, eloAdd: 5, context: 32_000, price: 20 };
  r.extraCount.openbrain = 1;
  r.memory.openbrain = { lastMove: 'priceCut', firedDay: s.day, shareBefore: 0.2, priceBefore: 5, worked: null, priceMatched: false };
  r.lever = 'price';
  r.choice = { lab: 'antropik', modelId: s.models[0].id };
  r.history.push({ day: s.day, lab: 'openbrain', move: 'priceCut', text: 'снизила цены на API на 30 %' });
  r.shareHigh.openbrain = 0.5;
  s.mail.push({
    id: `m${s.nextMailNum++}`,
    day: s.day,
    title: 'Antropik сомневается в баллах модели',
    body: 'Проверка баллов.',
    kind: 'rival',
    read: true,
    eventId: 'rival-audit',
    choices: [
      { label: 'Опубликовать честные баллы', hint: 'а' },
      { label: 'Снять с продажи', hint: 'б' },
      { label: 'Отрицать', hint: 'в' },
    ],
    important: true,
    replyByDay: s.day + CHOICE_DAYS,
    defaultChoice: 2,
    deferred: true,
  });
  return s;
}

/** Сохранение в виде обычного объекта: его можно ломать и снова превращать в текст. */
function parsed(s: GameState): Json {
  return JSON.parse(serialize(s)) as Json;
}

function load(obj: unknown) {
  return deserialize(JSON.stringify(obj));
}

/** Перейти по пути ключей и вернуть объект, лежащий выше последнего ключа. */
function parentOf(root: unknown, path: (string | number)[]): Record<string | number, unknown> {
  let cur = root as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) cur = cur[key] as Record<string | number, unknown>;
  return cur;
}

function expectRejected(obj: unknown, mention?: string): string {
  const r = load(obj);
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('ожидалась ошибка');
  expect(r.error).toMatch(/[а-яё]/i); // сообщение на русском
  if (mention) expect(r.error).toContain(mention);
  return r.error;
}

describe('здоровые сохранения загружаются', () => {
  it('новая игра и пустое начальное состояние', () => {
    for (const s of [newGame('Лаб', 5), createInitialState('Лаб', 5)]) {
      const r = deserialize(serialize(s));
      expect(r.ok).toBe(true);
      if (r.ok) expect(serialize(r.state)).toBe(serialize(s));
    }
  });

  it('игра в разгаре, со всеми видами записей', () => {
    const s = richState();
    expect(s.trainings.length).toBeGreaterThan(0);
    expect(s.models.length).toBeGreaterThan(3);
    expect(s.tenders.some((t) => t.application !== null)).toBe(true);
    expect(s.finance.history.length).toBeGreaterThan(12);
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(serialize(r.state)).toBe(serialize(s));
  });

  it.each([
    ['idle', 1, 'bankrupt'],
    ['reasonable', 1, null],
    ['strong', 7, null],
  ] as const)('конец игры у бота «%s»: банкротство, победа или итоги тоже загружаются', (kind, seed, outcome) => {
    const { state: s } = runBot(kind, seed);
    if (outcome) expect(s.outcome).toBe(outcome);
    expect(s.outcome).not.toBeNull();
    expect(deserialize(serialize(s)).ok).toBe(true);
  });

  it('загруженная игра идёт дальше без исключений и без NaN', () => {
    const r = deserialize(serialize(richState()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    advanceDays(r.state, 120);
    expect(Number.isFinite(r.state.cash)).toBe(true);
    expect(r.state.finance.revenueDaily.every(Number.isFinite)).toBe(true);
  });
});

describe('несовместимые сохранения отклоняются', () => {
  it('не JSON, не объект, чужая версия', () => {
    expect(deserialize('не json').ok).toBe(false);
    expect(deserialize('null').ok).toBe(false);
    expect(deserialize('42').ok).toBe(false);
    expect(deserialize('[]').ok).toBe(false);
    expect(deserialize('{"version":2}')).toEqual({ ok: false, error: 'Сохранение от другой версии игры' });
    expect(deserialize('{}').ok).toBe(false);
  });

  it('сохранение без нового бенчмарка (случай из ревью): ошибка с названием поля', () => {
    const o = parsed(newGame('Лаб', 1)) as { benchmarks: Json };
    delete o.benchmarks.swebench;
    const error = expectRejected(o, 'benchmarks.swebench');
    expect(error).toContain('нет поля');
  });

  it('нет нового GPU, лаборатории, технологии, доли или поля финансов', () => {
    const cases: [string, (o: Json) => void][] = [
      ['compute.rented.h200', (o) => delete (o.compute as { rented: Json }).rented.h200],
      ['compute.alloc.api', (o) => delete (o.compute as { alloc: Json }).alloc.api],
      ['hype.alibabo', (o) => delete (o.hype as Json).alibabo],
      ['hype.player', (o) => delete (o.hype as Json).player],
      ['research.points.rlhf', (o) => delete (o.research as { points: Json }).points.rlhf],
      ['research.algoLevel', (o) => delete (o.research as Json).algoLevel],
      ['finance.month.expense.penalties', (o) => delete (o.finance as { month: { expense: Json } }).month.expense.penalties],
      ['finance.month.income.investors', (o) => delete (o.finance as { month: { income: Json } }).month.income.investors],
      ['finance.revenueDaily', (o) => delete (o.finance as Json).revenueDaily],
      ['finance.negativeDays', (o) => delete (o.finance as Json).negativeDays],
      ['market.labShares.none', (o) => delete (o.market as { labShares: Json }).labShares.none],
      ['market.shares', (o) => delete (o.market as Json).shares],
      ['market.totalTokens', (o) => delete (o.market as Json).totalTokens],
      ['nextModelNum', (o) => delete o.nextModelNum],
      ['nextTenderNum', (o) => delete o.nextTenderNum],
      ['nextMailNum', (o) => delete o.nextMailNum],
      ['bestFlop', (o) => delete o.bestFlop],
      ['outcome', (o) => delete o.outcome],
      ['lastRoundDay', (o) => delete o.lastRoundDay],
      ['market.segments.consumers.total', (o) => delete ((o.market as Json).segments as Record<string, Json>).consumers.total],
      ['market.segments.developers.labShares.none', (o) => delete (((o.market as Json).segments as Record<string, Json>).developers.labShares as Json).none],
    ];
    for (const [path, mutate] of cases) {
      const o = parsed(newGame('Лаб', 1));
      mutate(o);
      expectRejected(o, path);
    }
  });

  it('поля неверного вида: массив вместо объекта, строка вместо числа, null вместо числа', () => {
    const cases: [string, (o: Json) => void][] = [
      ['mail', (o) => (o.mail = {})],
      ['models', (o) => (o.models = null)],
      ['tenders', (o) => (o.tenders = 'нет')],
      ['contracts', (o) => (o.contracts = {})],
      ['firedEvents', (o) => (o.firedEvents = {})],
      ['rivalsReleased', (o) => (o.rivalsReleased = 5)],
      ['modifiers', (o) => (o.modifiers = {})],
      ['flags', (o) => (o.flags = [])],
      ['cash', (o) => (o.cash = null)], // так выглядит NaN после JSON.stringify
      ['day', (o) => (o.day = '5')],
      ['day', (o) => (o.day = -1)],
      ['day', (o) => (o.day = 1.5)],
      ['rng', (o) => (o.rng = null)],
      ['labName', (o) => (o.labName = 7)],
      ['outcome', (o) => (o.outcome = 'won')],
      ['hype', (o) => (o.hype = [])],
      ['hype.player', (o) => ((o.hype as Json).player = null)],
      ['compute', (o) => (o.compute = null)],
      ['compute.rented.h100', (o) => ((o.compute as { rented: Json }).rented.h100 = -5)],
      ['compute.alloc', (o) => ((o.compute as Json).alloc = [])],
      ['research.current', (o) => ((o.research as Json).current = 'magic')],
      ['research.done', (o) => ((o.research as Json).done = 'attention')],
      ['research.points.attention', (o) => ((o.research as { points: Json }).points.attention = 'x')],
      ['benchmarks.mmlu', (o) => ((o.benchmarks as Json).mmlu = true)],
      ['benchmarks.mmlu.introduced', (o) => ((o.benchmarks as { mmlu: Json }).mmlu.introduced = 1)],
      ['finance', (o) => (o.finance = [])],
      ['finance.month', (o) => ((o.finance as Json).month = null)],
      ['finance.history', (o) => ((o.finance as Json).history = {})],
      ['finance.revenueDaily', (o) => ((o.finance as Json).revenueDaily = [1, null, 3])],
      ['market', (o) => (o.market = 0)],
      ['market.labShares', (o) => ((o.market as Json).labShares = [])],
      ['market.shares.none', (o) => ((o.market as { shares: Json }).shares.none = 'x')],
      ['nextModelNum', (o) => (o.nextModelNum = 0)],
      ['nextTenderNum', (o) => (o.nextTenderNum = 1.5)],
      ['nextMailNum', (o) => (o.nextMailNum = '3')],
    ];
    for (const [path, mutate] of cases) {
      const o = parsed(newGame('Лаб', 1));
      // у новой игры нет тендеров и истории, но для этих полей хватает «неверного вида» верхнего уровня
      mutate(o);
      const error = expectRejected(o, path);
      expect(error, path).toContain('неверный вид');
    }
  });

  it('записи внутри списков проверяются по полям', () => {
    const s = richState();
    const cases: [string, (o: Json) => void][] = [
      ['mail[0].title', (o) => ((o.mail as Json[])[0].title = 5)],
      ['mail[0].kind', (o) => ((o.mail as Json[])[0].kind = 'spam')],
      ['mail[0].read', (o) => delete (o.mail as Json[])[0].read],
      ['models[0].caps.code', (o) => delete (o.models as { caps: Json }[])[0].caps.code],
      ['models[0].plan.mix', (o) => ((o.models as { plan: Json }[])[0].plan.mix = null)],
      ['models[0].price', (o) => ((o.models as Json[])[0].price = null)],
      ['tenders[0].benchmark', (o) => ((o.tenders as Json[])[0].benchmark = 'doom')],
      ['tenders[0].application', (o) => ((o.tenders as Json[])[0].application = {})],
      ['contracts[0].tender', (o) => delete (o.contracts as Json[])[0].tender],
      ['modifiers[0].kind', (o) => ((o.modifiers as Json[])[0].kind = 'luck')],
      ['modifiers[0].untilDay', (o) => delete (o.modifiers as Json[])[0].untilDay],
      ['finance.history[0].cashEnd', (o) => delete (o.finance as { history: Json[] }).history[0].cashEnd],
      ['finance.history[3].expense', (o) => ((o.finance as { history: Json[] }).history[3].expense = {})],
      ['trainings[0].plan.rlhf', (o) => delete (o.trainings as { plan: Json }[])[0].plan.rlhf],
      ['trainings[0].arch', (o) => ((o.trainings as Json[])[0].arch = 'rnn')],
      ['trainings[0].id', (o) => delete (o.trainings as Json[])[0].id],
      ['trainings[0].failed', (o) => ((o.trainings as Json[])[0].failed = 'да')],
      ['models[0].plan.tier', (o) => ((o.models as { plan: Json }[])[0].plan.tier = 'huge')],
      ['models[0].review', (o) => ((o.models as Json[])[0].review = 'done')],
      ['models[0].subsPrice', (o) => ((o.models as Json[])[0].subsPrice = null)],
    ];
    for (const [path, mutate] of cases) {
      const o = parsed(s);
      mutate(o);
      expectRejected(o, path);
    }
  });

  it('ошибка называет поле и говорит про другую версию игры', () => {
    const o = parsed(newGame('Лаб', 1));
    (o.hype as Json).player = 'много';
    expect(expectRejected(o)).toBe('Сохранение повреждено или от другой версии игры: поле «hype.player» имеет неверный вид');
    delete (o.hype as Json).player;
    expect(expectRejected(o)).toBe('Сохранение повреждено или от другой версии игры: в нём нет поля «hype.player»');
  });
});

describe('письма с выбором в сохранении', () => {
  function withChoiceMail(over: Json): Json {
    const o = parsed(newGame('Лаб', 1));
    (o.mail as Json[]).push({
      id: 'm99',
      day: 0,
      title: 'Выбор',
      body: 'Выберите',
      kind: 'event',
      read: false,
      eventId: 'gpt2-withheld',
      choices: [
        { label: 'Первое', hint: 'а' },
        { label: 'Второе', hint: 'б' },
        { label: 'Третье', hint: 'в' },
      ],
      ...over,
    });
    return o;
  }

  it('неотвеченный выбор из известного события загружается', () => {
    expect(load(withChoiceMail({})).ok).toBe(true);
  });

  it('событие, которого нет в игре, отклоняется: иначе игра встала бы навсегда', () => {
    expectRejected(withChoiceMail({ eventId: 'removed-event' }), 'choices');
    expectRejected(withChoiceMail({ eventId: undefined }), 'choices');
  });

  it('число вариантов не совпало с событием - отклоняется', () => {
    expectRejected(withChoiceMail({ choices: [{ label: 'Один', hint: 'а' }] }), 'choices');
  });

  it('отвеченный выбор от старого события не мешает', () => {
    expect(load(withChoiceMail({ eventId: 'removed-event', chosen: 0 })).ok).toBe(true);
  });

  it('письмо с выбором соперника (его нет в EVENTS) загружается, с чужим числом вариантов - нет', () => {
    const poach = { kind: 'rival', eventId: 'rival-poach', choices: [{ label: 'Поднять зарплаты', hint: 'а' }, { label: 'Отпустить', hint: 'б' }] };
    expect(load(withChoiceMail(poach)).ok).toBe(true);
    expect(load(withChoiceMail({ kind: 'rival', eventId: 'rival-audit' })).ok).toBe(true); // три варианта, как в withChoiceMail
    expectRejected(withChoiceMail({ kind: 'rival', eventId: 'rival-poach' }), 'choices'); // у переманивания два варианта
  });

  /** Загрузить и вернуть письмо m99 (сохранение обязано загрузиться). */
  function loadedMail(obj: Json) {
    const r = load(obj);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    return r.state.mail.find((m) => m.id === 'm99')!;
  }

  it('старое сохранение: письмо с выбором без срока получает срок от дня игры и вариант по умолчанию', () => {
    const o = withChoiceMail({ day: 3 });
    const today = o.day as number;
    const m = loadedMail(o);
    expect(m.replyByDay).toBe(Math.max(3, today) + CHOICE_DAYS);
    expect(m.defaultChoice).toBe(2); // последний вариант, как в triggerEvent
  });

  it('старое сохранение: если письмо датировано позже дня игры, срок идёт от дня письма', () => {
    const o = withChoiceMail({ day: 100 });
    expect(o.day as number).toBeLessThan(100);
    expect(loadedMail(o).replyByDay).toBe(100 + CHOICE_DAYS);
  });

  it('старое сохранение: срыв обучения получает короткий срок FAIL_CHOICE_DAYS', () => {
    const o = withChoiceMail({
      eventId: 'training-fail',
      kind: 'training',
      choices: [
        { label: 'Вернуться к чекпоинту', hint: 'а' },
        { label: 'Продолжить', hint: 'б' },
      ],
    });
    const m = loadedMail(o);
    expect(m.replyByDay).toBe((o.day as number) + FAIL_CHOICE_DAYS);
    expect(m.defaultChoice).toBe(1);
  });

  it('срок и вариант из сохранения не перезаписываются; отвеченное письмо срока не получает', () => {
    const kept = loadedMail(withChoiceMail({ replyByDay: 7, defaultChoice: 0 }));
    expect(kept.replyByDay).toBe(7);
    expect(kept.defaultChoice).toBe(0);
    const answered = loadedMail(withChoiceMail({ eventId: 'removed-event', chosen: 1 }));
    expect(answered.replyByDay).toBeUndefined();
    expect(answered.defaultChoice).toBeUndefined();
  });

  it('после загрузки отложенное письмо со старым сроком решается само по варианту по умолчанию', () => {
    const r = load(withChoiceMail({ deferred: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.state.mail.find((x) => x.id === 'm99')!;
    r.state.day = m.replyByDay! - 1;
    expireChoices(r.state);
    expect(m.chosen).toBeUndefined();
    r.state.day = m.replyByDay!;
    expireChoices(r.state);
    expect(m.chosen).toBe(2);
    expect(m.autoChosen).toBe(true);
  });
});

describe('сложность и соперники с характерами в сохранении', () => {
  it('старое сохранение без difficulty и rivalry: Обычная сложность, соперники спокойны', () => {
    const o = parsed(newGame('Лаб', 1));
    delete o.difficulty;
    delete o.rivalry;
    const r = load(o);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.difficulty).toBe('normal');
    expect(r.state.rivalry).toEqual(emptyRivalry());
  });

  it('сложность, её модификаторы и состояние соперников переживают сохранение', () => {
    const s = richState();
    s.difficulty = 'hard';
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.difficulty).toBe('hard');
    expect(r.state.rivalry).toEqual(s.rivalry);
    expect(r.state.rivalry.pending.map((p) => p.id)).toEqual(['pm1', 'pm2']);
    expect(r.state.rivalry.overrides['gtp-4']).toEqual({ dayShift: -10, eloAdd: 5, context: 32_000, price: 20 });
    expect(r.state.modifiers.map((m) => m.kind)).toEqual(expect.arrayContaining(['rivalPrice', 'exposure']));

    const hard = newGame('Лаб', 2, 'hard');
    expect(hard.modifiers.map((m) => m.id).sort()).toEqual(['difficulty-exposure', 'difficulty-rent']);
    const back = deserialize(serialize(hard));
    expect(back.ok).toBe(true);
    if (back.ok) expect(serialize(back.state)).toBe(serialize(hard));
  });

  it('поля соперников проверяются: сложность, ход, рычаг, лаборатория, память, поправки', () => {
    const s = richState();
    const cases: [string, (o: Json) => void][] = [
      ['difficulty', (o) => (o.difficulty = 'insane')],
      ['rivalry', (o) => (o.rivalry = [])],
      ['rivalry.heat.gogle', (o) => delete ((o.rivalry as Json).heat as Json).gogle],
      ['rivalry.pending[0].move', (o) => (((o.rivalry as Json).pending as Json[])[0].move = 'dance')],
      ['rivalry.pending[1].modelId', (o) => (((o.rivalry as Json).pending as Json[])[1].modelId = 7)],
      ['rivalry.active[0].untilDay', (o) => delete ((o.rivalry as Json).active as Json[])[0].untilDay],
      ['rivalry.overrides.gtp-4.eloAdd', (o) => ((((o.rivalry as Json).overrides as Json)['gtp-4'] as Json).eloAdd = 'много')],
      ['rivalry.memory.openbrain.lastMove', (o) => ((((o.rivalry as Json).memory as Json).openbrain as Json).lastMove = 'x')],
      ['rivalry.memory.openbrain.worked', (o) => ((((o.rivalry as Json).memory as Json).openbrain as Json).worked = 'да')],
      ['rivalry.lever', (o) => ((o.rivalry as Json).lever = 'luck')],
      ['rivalry.choice.lab', (o) => (((o.rivalry as Json).choice as Json).lab = 'nvidia')],
      ['rivalry.history[0].lab', (o) => (((o.rivalry as Json).history as Json[])[0].lab = 'nvidia')],
      ['rivalry.shareHigh', (o) => delete (o.rivalry as Json).shareHigh],
      ['rivalry.moveCooldown.gogle:hype', (o) => (((o.rivalry as Json).moveCooldown as Json)['gogle:hype'] = null)],
    ];
    for (const [path, mutate] of cases) {
      const o = parsed(s);
      mutate(o);
      expectRejected(o, path);
    }
  });
});

// ---------- Рынок v2: сохранения старого вида ----------

describe('сохранение до рынка v2 (design market-v2, раздел 9)', () => {
  /** Сохранение в старом виде: alloc с inference, одно поле training, модели и журнал без новых полей, рынок без сегментов. */
  function oldShape(s: GameState, failedLetter = false): Json {
    const o = parsed(s);
    const alloc = (o.compute as { alloc: Json }).alloc;
    alloc.inference = alloc.api;
    delete alloc.api;
    delete alloc.subs;
    const run = (o.trainings as Json[])[0];
    delete run.id;
    delete run.failed;
    delete (run.plan as Json).tier;
    o.training = run;
    delete o.trainings;
    delete o.nextRunNum;
    for (const m of o.models as Json[]) {
      delete (m.plan as Json).tier;
      for (const k of ['onSubs', 'subsPrice', 'review', 'reviewEndDay', 'earnedSubs']) delete m[k];
    }
    const strip = (l: Json) => {
      delete (l.income as Json).subs;
      delete (l.expense as Json).review;
      delete l.subscribers;
    };
    const finance = o.finance as { month: Json; history: Json[] };
    strip(finance.month);
    for (const h of finance.history) strip(h);
    const market = o.market as Json;
    for (const k of ['playerSubs', 'totalSubs', 'lostApi', 'lostSubs', 'segments']) delete market[k];
    if (failedLetter) {
      (o.mail as Json[]).push({
        id: 'm999', day: o.day, title: 'Срыв', body: 'Срыв.', kind: 'training', read: false, eventId: 'training-fail',
        choices: [{ label: 'Вернуться к чекпоинту', hint: 'а' }, { label: 'Продолжить', hint: 'б' }],
      });
    }
    return o;
  }

  it('загружается с умолчаниями: alloc.api из inference, trainings из training, модели и журнал дополнены, рынок с пустыми сегментами', () => {
    const s = richState();
    const r = load(oldShape(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.state;
    expect(st.compute.alloc.api).toBe(s.compute.alloc.api);
    expect(st.compute.alloc.subs).toBe(0);
    expect('inference' in st.compute.alloc).toBe(false);
    expect('training' in st).toBe(false);
    expect(st.trainings).toHaveLength(1);
    expect(st.trainings[0].id).toBe('t1');
    expect(st.trainings[0].failed).toBe(false);
    expect(st.trainings[0].plan.tier).toBe(tierOf(st.trainings[0].plan.paramsB, st.trainings[0].startedDay));
    expect(st.nextRunNum).toBe(2);
    for (const m of st.models) {
      expect(m.plan.tier).toBe(tierOf(m.plan.paramsB, m.trainedDay));
      expect(m.onSubs).toBe(false);
      expect(m.subsPrice).toBe(TIER_SUBS_PRICE[m.plan.tier]);
      expect(m.review).toBe('none');
      expect(m.reviewEndDay).toBeNull();
      expect(m.earnedSubs).toBe(0);
    }
    expect(st.finance.month.income.subs).toBe(0);
    expect(st.finance.month.expense.review).toBe(0);
    for (const h of st.finance.history) {
      expect(h.income.subs).toBe(0);
      expect(h.expense.review).toBe(0);
      expect(h.subscribers).toBe(0);
    }
    expect(st.market.playerSubs).toBe(0);
    expect(st.market.totalSubs).toBe(0);
    expect(st.market.lostApi).toBe(0);
    expect(st.market.lostSubs).toBe(0);
    expect(st.market.segments).toEqual(emptyMarket().segments);
    expect(st.market.shares).toEqual(s.market.shares);
  });

  it('неотвеченное письмо о срыве делает проект failed; без проекта trainings пуст и nextRunNum = 1', () => {
    const s = richState();
    const r = load(oldShape(s, true));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.trainings[0].failed).toBe(true);

    const o = oldShape(s);
    o.training = null;
    const empty = load(o);
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.state.trainings).toEqual([]);
      expect(empty.state.nextRunNum).toBe(1);
    }
  });

  it('загруженное старое сохранение идёт дальше детерминированно и без NaN', () => {
    const s = richState();
    const a = load(oldShape(s));
    const b = load(oldShape(s));
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    advanceDays(a.state, 200);
    advanceDays(b.state, 200);
    expect(serialize(a.state)).toBe(serialize(b.state));
    expect(Number.isFinite(a.state.cash)).toBe(true);
    expect(a.state.finance.revenueDaily.every(Number.isFinite)).toBe(true);
    for (const v of Object.values(a.state.market.labShares)) expect(Number.isFinite(v)).toBe(true);
  });

  it('новое сохранение загружается без изменений', () => {
    const s = richState();
    s.models[0].onSubs = true;
    s.models[0].subsPrice = 15.5;
    s.models[0].review = 'pending';
    s.models[0].reviewEndDay = s.day + 30;
    s.models[0].earnedSubs = 123;
    const r = deserialize(serialize(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(serialize(r.state)).toBe(serialize(s));
  });
});

// ---------- Полнота проверки ----------

/** Все узлы дерева: путь, нормализованный путь (индексы массивов заменены на []) и значение. */
interface Node {
  path: (string | number)[];
  norm: string;
  value: unknown;
}

function collect(value: unknown, path: (string | number)[], norm: string, seen: Map<string, Node>): void {
  if (path.length > 0 && !seen.has(norm)) seen.set(norm, { path, norm, value });
  if (Array.isArray(value)) {
    value.forEach((v, i) => collect(v, [...path, i], `${norm}[]`, seen));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, [...path, k], norm ? `${norm}.${k}` : k, seen);
  }
}

/** Поля, которых может не быть (необязательные в типах), и словари, в которых ключи приходят и уходят. */
// founderName, tutorial, monthsFirst, autoApply, difficulty и rivalry появились позже: в старых сохранениях их нет,
// загрузка подставляет значения по умолчанию.
// Рынок v2 (tier, onSubs, subsPrice, review, reviewEndDay, earnedSubs, subs, subscribers, playerSubs, totalSubs, lostApi,
// lostSubs, segments и их сегменты, trainings, nextRunNum) тоже появился позже: загрузка дополняет умолчаниями.
const OPTIONAL_FIELDS = new Set([
  'eventId', 'choices', 'chosen', 'important', 'target', 'mult', 'add', 'founderName', 'tutorial', 'replyByDay', 'defaultChoice',
  'deferred', 'autoChosen', 'reward', 'eloMine', 'eloRival', 'placeEnd', 'prices', 'context', 'contextLevel', 'earned', 'monthsFirst', 'autoApply', 'difficulty', 'rivalry',
  'tier', 'onSubs', 'subsPrice', 'review', 'reviewEndDay', 'earnedSubs', 'subs', 'subscribers', 'playerSubs', 'totalSubs',
  'lostApi', 'lostSubs', 'segments', 'consumers', 'enterprise', 'developers', 'trainings', 'nextRunNum',
  'queue', 'techs', 'distill', 'moe', 'codetrain', 'instruct', 'cot', 'quant', 'multimodal', 'synthetic',
  'datacenters', 'capex', 'power', 'yearly', 'rentChangedDay',
]);
/** Необязательные поля по полному пути: имя поля (modelId, price) в других местах обязательно. */
const OPTIONAL_PATHS = new Set(['mail[].outcome', 'mail[].choices[].story', 'tenders[].application.work', 'contracts[].tender.application.work', 'rivalry.pending[].modelId', 'rivalry.choice.modelId']);
/** Поправки к модели соперника (rivalry.overrides.<id>.*) все необязательные. */
const optionalPath = (norm: string): boolean => OPTIONAL_PATHS.has(norm) || /^rivalry\.overrides\.[^.]+\.[^.]+$/.test(norm);
const DICTS = new Set([
  'flags', 'yearly.lastFired', 'finance.history[].prices', 'market.shares', 'models[].overfit', 'rivalry.moveCooldown', 'rivalry.overrides', 'rivalry.extra',
  'market.segments.consumers.shares', 'market.segments.enterprise.shares', 'market.segments.developers.shares',
]);

describe('проверка покрывает каждое поле живого состояния', () => {
  const s = richState();
  const base = serialize(s);
  const nodes = new Map<string, Node>();
  collect(JSON.parse(base), [], '', nodes);

  it('в разгаре игры много разных полей (проверка не пустая)', () => {
    expect(nodes.size).toBeGreaterThan(150);
    for (const norm of [
      'compute.rented.h200',
      'benchmarks.swebench.saturated',
      'finance.history[].expense.rent',
      'mail[].choices[].hint',
      'rivalry.pending[].modelId',
      'rivalry.memory.openbrain.lastMove',
      'rivalry.overrides.gtp-4.dayShift',
      'rivalry.history[].text',
    ]) {
      expect(nodes.has(norm), norm).toBe(true);
    }
  });

  it('любое поле с испорченным типом отклоняется', () => {
    const survivors: string[] = [];
    for (const node of nodes.values()) {
      const wrong = typeof node.value === 'string' ? 5 : Array.isArray(node.value) ? {} : node.value !== null && typeof node.value === 'object' ? [] : 'испорчено';
      const o = JSON.parse(base) as Json;
      const parent = parentOf(o, node.path);
      parent[node.path[node.path.length - 1]] = wrong;
      if (deserialize(JSON.stringify(o)).ok) survivors.push(node.norm);
    }
    expect(survivors).toEqual([]);
  });

  it('любое обязательное поле нужно: без него сохранение отклоняется, без необязательного - нет', () => {
    const survivors: string[] = [];
    const rejectedOptional: string[] = [];
    for (const node of nodes.values()) {
      const last = node.path[node.path.length - 1];
      if (typeof last === 'number') continue; // элементы списков не удаляем
      const parentNorm = node.path.length === 1 ? '' : node.norm.slice(0, node.norm.length - String(last).length - 1);
      const lenient = OPTIONAL_FIELDS.has(String(last)) || optionalPath(node.norm) || DICTS.has(parentNorm);
      const o = JSON.parse(base) as Json;
      delete parentOf(o, node.path)[last];
      const ok = deserialize(JSON.stringify(o)).ok;
      if (lenient && !ok) rejectedOptional.push(node.norm);
      if (!lenient && ok) survivors.push(node.norm);
    }
    expect(survivors).toEqual([]);
    expect(rejectedOptional).toEqual([]);
  });
});

describe('сохранение до новых технологий', () => {
  it('нет очков по новым технологиям и снимков у моделей - загружается, очки 0, снимок пустой', () => {
    const o = parsed(richState());
    const points = (o.research as { points: Json }).points;
    for (const id of ['distill', 'moe', 'codetrain', 'instruct', 'cot', 'quant', 'multimodal', 'synthetic']) delete points[id];
    for (const m of o.models as Json[]) delete m.techs;
    for (const r of o.trainings as Json[]) delete r.techs;
    const r = load(o);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.research.points.moe).toBe(0);
    expect(r.state.research.points.synthetic).toBe(0);
    expect(r.state.models.every((m) => (m.techs ?? []).length === 0)).toBe(true);
  });

  it('снимок с неизвестной технологией отклоняется', () => {
    const o = parsed(richState());
    (o.models as Json[])[0].techs = ['teleport'];
    expectRejected(o, 'techs');
  });
});
