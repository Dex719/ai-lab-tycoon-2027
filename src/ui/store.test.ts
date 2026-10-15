// Тесты хранилища: автопауза, пробел, скрытая вкладка, автосохранение.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// advanceDay оборачиваем в шпиона с настоящей реализацией: отдельные тесты подкладывают письма «во время хода».
vi.mock('../sim/tick', async (importOriginal) => {
  const real = await importOriginal<typeof import('../sim/tick')>();
  return { ...real, advanceDay: vi.fn(real.advanceDay) };
});

import { newGame } from '../sim/actions';
import { addMail } from '../sim/events';
import { chooseGoals, goalOfferOpen, goalsDay } from '../sim/goals';
import * as tick from '../sim/tick';
import type { GameState } from '../sim/types';
import { setSettings } from './settings';
import { GameStore } from './store';

// Автосохранение пишется в ячейку «авто» (см. ./saves).
const AUTOSAVE_SLOT_KEY = 'ailab.slot.auto';

const advanceDay = vi.mocked(tick.advanceDay);

function newStore(): { store: GameStore; s: GameState } {
  const store = new GameStore();
  const s = newGame('Тест', 7);
  // Цели первого года уже выбраны: иначе первый день партии останавливает время окном выбора целей.
  goalsDay(s);
  chooseGoals(s, s.yearly.goals.map((g) => g.id));
  store.start(s);
  return { store, s };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  advanceDay.mockClear();
});

describe('автопауза на важном письме', () => {
  it('важное письмо ставит паузу, запоминает причину и скорость; продолжение сбрасывает причину', () => {
    const { store } = newStore();
    store.setSpeed(2);
    advanceDay.mockImplementationOnce((s) => {
      addMail(s, { kind: 'rival', title: 'Конкурент выпустил модель', body: '...', important: true });
    });
    vi.advanceTimersByTime(250);
    expect(store.speed).toBe(0);
    expect(store.pauseReason).toBe('Конкурент выпустил модель');
    expect(store.lastSpeed).toBe(2);

    store.togglePause();
    expect(store.speed).toBe(2);
    expect(store.pauseReason).toBeNull();
    store.setSpeed(0);
  });

  it('несколько важных писем за ход: в причине первое и счётчик остальных', () => {
    const { store } = newStore();
    store.setSpeed(1);
    advanceDay.mockImplementationOnce((s) => {
      addMail(s, { kind: 'news', title: 'Первое', body: '', important: true });
      addMail(s, { kind: 'news', title: 'Второе', body: '', important: true });
    });
    vi.advanceTimersByTime(500);
    expect(store.pauseReason).toBe('Первое (и ещё 1)');
  });

  it('обычное письмо игру не останавливает', () => {
    const { store } = newStore();
    store.setSpeed(1);
    advanceDay.mockImplementationOnce((s) => {
      addMail(s, { kind: 'news', title: 'Новость', body: '' });
    });
    vi.advanceTimersByTime(500);
    expect(store.speed).toBe(1);
    expect(store.pauseReason).toBeNull();
    store.setSpeed(0);
  });

  it('важное письмо, пришедшее раньше, повторно паузу не ставит', () => {
    const { store, s } = newStore();
    addMail(s, { kind: 'news', title: 'Старое', body: '', important: true });
    store.setSpeed(1);
    vi.advanceTimersByTime(500);
    expect(store.speed).toBe(1);
    expect(store.pauseReason).toBeNull();
    store.setSpeed(0);
  });
});

describe('автопауза при уходе денег в минус', () => {
  it('ставит паузу в первый день минуса, дальше игра идёт без пауз', () => {
    const { store, s } = newStore();
    s.cash = -1e9;
    store.setSpeed(1);
    vi.advanceTimersByTime(500);
    expect(s.finance.negativeDays).toBe(1);
    expect(store.speed).toBe(0);
    expect(store.pauseReason).toMatch(/Деньги/); // заголовок письма «Деньги кончились», если оно важное, иначе общий текст

    store.togglePause();
    vi.advanceTimersByTime(500);
    expect(s.finance.negativeDays).toBe(2);
    expect(store.speed).toBe(1);
    expect(store.pauseReason).toBeNull();
    store.setSpeed(0);
  });
});

describe('автопауза без письма', () => {
  it('первый день минуса без важного письма даёт запасную причину', () => {
    const { store } = newStore();
    store.setSpeed(1);
    advanceDay.mockImplementationOnce((s) => {
      s.finance.negativeDays = 1;
    });
    vi.advanceTimersByTime(500);
    expect(store.speed).toBe(0);
    expect(store.pauseReason).toBe('Деньги ушли в минус');
  });
});

describe('пробел и пауза', () => {
  it('togglePause в законченной игре ничего не делает', () => {
    const { store, s } = newStore();
    s.outcome = 'finished';
    store.togglePause();
    expect(store.speed).toBe(0);
  });

  it('togglePause не работает, пока в почте ждёт выбор', () => {
    const { store, s } = newStore();
    addMail(s, { kind: 'event', title: 'Выбор', body: '', eventId: 'x', choices: [{ label: 'А', hint: '' }] });
    store.togglePause();
    expect(store.speed).toBe(0);
  });

  it('togglePause переключает паузу и скорость', () => {
    const { store } = newStore();
    store.togglePause();
    expect(store.speed).toBe(1);
    store.togglePause();
    expect(store.speed).toBe(0);
  });
});

describe('скрытая вкладка', () => {
  it('ставит запущенную игру на паузу и не продолжает сама', () => {
    const { store } = newStore();
    store.setSpeed(4);
    store.pauseForHidden();
    expect(store.speed).toBe(0);
    expect(store.pauseReason).toBe('Вкладка была скрыта');
    expect(store.lastSpeed).toBe(4);
    vi.advanceTimersByTime(5000);
    expect(store.speed).toBe(0);
  });

  it('игру, уже стоящую на паузе, не трогает', () => {
    const { store } = newStore();
    store.pauseForHidden();
    expect(store.pauseReason).toBeNull();
  });

  it('законченную игру не трогает', () => {
    const { store, s } = newStore();
    store.setSpeed(1);
    s.outcome = 'finished';
    store.pauseForHidden();
    expect(store.pauseReason).toBeNull();
    store.setSpeed(0);
  });
});

describe('автосохранение', () => {
  it('ошибка записи попадает в store.autosaveError, новая игра её сбрасывает', () => {
    vi.stubGlobal('localStorage', {
      setItem() {
        throw new Error('quota');
      },
    });
    const { store, s } = newStore();
    s.flags.autosaveDue = true;
    store.setSpeed(1);
    vi.advanceTimersByTime(500);
    expect(store.autosaveError).toMatch(/Автосохранение не удалось/);
    store.start(newGame('Другая', 8));
    expect(store.autosaveError).toBeNull();
  });

  it('успешная запись сбрасывает ошибку', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    const { store, s } = newStore();
    store.autosaveError = 'старая ошибка';
    s.flags.autosaveDue = true;
    store.setSpeed(1);
    vi.advanceTimersByTime(500);
    expect(setItem).toHaveBeenCalledWith(AUTOSAVE_SLOT_KEY, expect.any(String));
    expect(store.autosaveError).toBeNull();
    store.setSpeed(0);
  });

  it('законченную игру не пишем поверх живого автосохранения', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    const { store, s } = newStore();
    s.outcome = 'finished';
    s.flags.autosaveDue = true;
    store.advance(1);
    expect(setItem).not.toHaveBeenCalled();
    expect(s.flags.autosaveDue).toBe(false);
  });
});

describe('автопауза по галочкам настроек', () => {
  afterEach(() => {
    setSettings({ pauseOnReady: true, pauseOnResearch: false, pauseOnTender: false, pauseOnGoal: false });
  });

  it('исследование завершено: без галочки игра идёт, с галочкой встаёт', () => {
    const { store } = newStore();
    store.setSpeed(1);
    advanceDay.mockImplementationOnce((s) => {
      s.research.algoLevel += 1;
    });
    vi.advanceTimersByTime(500);
    expect(store.speed).toBe(1);

    setSettings({ pauseOnResearch: true });
    advanceDay.mockImplementationOnce((s) => {
      s.research.algoLevel += 1;
    });
    vi.advanceTimersByTime(500);
    expect(store.speed).toBe(0);
    expect(store.pauseReason).toBe('Исследование завершено');
  });

  it('тендер выигран (новый контракт) ставит паузу по галочке', () => {
    const { store, s } = newStore();
    setSettings({ pauseOnTender: true });
    store.setSpeed(1);
    advanceDay.mockImplementationOnce((st) => {
      st.contracts.push({ ...(s.contracts[0] ?? {}), id: 'c-test' } as GameState['contracts'][number]);
    });
    vi.advanceTimersByTime(500);
    expect(store.pauseReason).toBe('Тендер выигран');
  });

  it('«Модель готова» с выключенной галочкой не останавливает игру, хотя письмо важное', () => {
    const { store } = newStore();
    setSettings({ pauseOnReady: false });
    store.setSpeed(1);
    advanceDay.mockImplementationOnce((s) => {
      addMail(s, { kind: 'training', title: 'Модель «Тест» готова', body: '', important: true });
    });
    vi.advanceTimersByTime(500);
    expect(store.speed).toBe(1);
    store.setSpeed(0);
  });
});

describe('выбор целей года', () => {
  it('новая партия сразу предлагает цели 2017 года: время стоит, пока цели не выбраны', () => {
    const store = new GameStore();
    store.newGame('Тест', { seed: 3 });
    const s = store.state!;
    expect(goalOfferOpen(s)).toBe(true);
    store.togglePause();
    expect(store.speed).toBe(0);
    store.setSpeed(1);
    vi.advanceTimersByTime(2000);
    expect(s.day).toBe(0);
    store.setSpeed(0);
    store.dispatch(chooseGoals, s.yearly.goals.map((g) => g.id));
    store.togglePause();
    vi.advanceTimersByTime(1000);
    expect(s.day).toBeGreaterThan(0);
    store.setSpeed(0);
  });

  it('если цели предложены во время хода (сохранение с первого дня), игра встаёт на паузу с причиной', () => {
    const store = new GameStore();
    const s = newGame('Тест', 7);
    store.start(s);
    store.setSpeed(1);
    vi.advanceTimersByTime(500);
    expect(goalOfferOpen(s)).toBe(true);
    expect(store.speed).toBe(0);
    expect(store.pauseReason).toBe('Цели года');
  });
});
