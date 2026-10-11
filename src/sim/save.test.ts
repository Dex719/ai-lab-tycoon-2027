// Тесты сохранений (FR-13): здоровое сохранение загружается, сохранение от старой версии игры или битый файл
// отклоняются понятной ошибкой на русском, а не роняют тик и отрисовку.

import { describe, expect, it } from 'vitest';
import { newGame } from './actions';
import { botAct, runBot } from './bots';
import { applyChoice, FOREVER, pendingChoice } from './events';
import { deserialize, serialize } from './save';
import { createInitialState } from './state';
import { advanceDay, advanceDays } from './tick';
import type { GameState } from './types';

type Json = Record<string, unknown>;

/** Игра, прожитая ботом-подгонщиком: есть обучение, модели с подгонкой, тендеры с заявками, письма с выбором, история месяцев. */
function richState(): GameState {
  const s = newGame('Бот', 1);
  let days = 0;
  while (!s.outcome && days < 900) {
    const pending = pendingChoice(s);
    if (pending) {
      applyChoice(s, pending.id, 0);
      continue;
    }
    if (s.day % 7 === 0) botAct(s, 'benchmaxx');
    advanceDay(s);
    days++;
  }
  // Чего бот к этому дню не успел, добавляем руками: контракт и модификаторы со всеми необязательными полями.
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
  s.flags.exportControls = true;
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
    expect(s.training).not.toBeNull();
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
      ['compute.alloc.inference', (o) => delete (o.compute as { alloc: Json }).alloc.inference],
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
      ['training', (o) => delete o.training],
      ['lastRoundDay', (o) => delete o.lastRoundDay],
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
      ['training.plan.rlhf', (o) => delete (o.training as { plan: Json }).plan.rlhf],
      ['training.arch', (o) => ((o.training as Json).arch = 'rnn')],
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

  it('число вариантов не совпало с событием — отклоняется', () => {
    expectRejected(withChoiceMail({ choices: [{ label: 'Один', hint: 'а' }] }), 'choices');
  });

  it('отвеченный выбор от старого события не мешает', () => {
    expect(load(withChoiceMail({ eventId: 'removed-event', chosen: 0 })).ok).toBe(true);
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
// founderName и tutorial появились позже: в старых сохранениях их нет, загрузка подставляет значения по умолчанию.
const OPTIONAL_FIELDS = new Set(['eventId', 'choices', 'chosen', 'important', 'target', 'mult', 'add', 'founderName', 'tutorial']);
const DICTS = new Set(['flags', 'market.shares', 'models[].overfit']);

describe('проверка покрывает каждое поле живого состояния', () => {
  const s = richState();
  const base = serialize(s);
  const nodes = new Map<string, Node>();
  collect(JSON.parse(base), [], '', nodes);

  it('в разгаре игры много разных полей (проверка не пустая)', () => {
    expect(nodes.size).toBeGreaterThan(150);
    for (const norm of ['compute.rented.h200', 'benchmarks.swebench.saturated', 'finance.history[].expense.rent', 'mail[].choices[].hint']) {
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

  it('любое обязательное поле нужно: без него сохранение отклоняется, без необязательного — нет', () => {
    const survivors: string[] = [];
    const rejectedOptional: string[] = [];
    for (const node of nodes.values()) {
      const last = node.path[node.path.length - 1];
      if (typeof last === 'number') continue; // элементы списков не удаляем
      const parentNorm = node.path.length === 1 ? '' : node.norm.slice(0, node.norm.length - String(last).length - 1);
      const lenient = OPTIONAL_FIELDS.has(String(last)) || DICTS.has(parentNorm);
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
