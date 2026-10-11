// Хранилище игры для React: состояние, скорость, игровой цикл, автосохранение.
// Симуляция меняет состояние на месте; интерфейс подписан на счётчик версий.

import { useSyncExternalStore } from 'react';
import * as actions from '../sim/actions';
import { TICK_MS } from '../sim/constants';
import { AUTOSAVE_KEY, serialize } from '../sim/save';
import { advanceDay, advanceDays, blockedByChoice } from '../sim/tick';
import type { GameState, Result, Speed } from '../sim/types';

type Listener = () => void;

export class GameStore {
  state: GameState | null = null;
  speed: Speed = 0;
  lastSpeed: Exclude<Speed, 0> = 1;
  version = 0;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Начать игру с готовым состоянием (новая игра или загрузка). */
  start(state: GameState): void {
    this.state = state;
    this.setSpeed(0);
    this.bump();
  }

  newGame(labName: string, seed = (Date.now() ^ 0x5eed) >>> 0): void {
    this.start(actions.newGame(labName, seed));
  }

  quit(): void {
    this.setSpeed(0);
    this.state = null;
    this.bump();
  }

  /** Выполнить действие игрока и перерисовать интерфейс. */
  dispatch<A extends unknown[]>(fn: (s: GameState, ...args: A) => Result | void, ...args: A): Result {
    if (!this.state) return { ok: false, error: 'Игра не начата' };
    const r = fn(this.state, ...args) ?? { ok: true };
    this.bump();
    return r;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    if (speed !== 0) this.lastSpeed = speed;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (speed !== 0) this.timer = setInterval(() => this.tick(), TICK_MS[speed]);
    this.bump();
  }

  togglePause(): void {
    this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
  }

  private tick(): void {
    const s = this.state;
    if (!s) return;
    if (s.outcome) {
      this.setSpeed(0);
      return;
    }
    if (blockedByChoice(s)) return; // ждём выбора в почте, скорость сохраняется
    advanceDay(s);
    this.afterAdvance();
  }

  /** Перемотка на n дней (отладка и проверка агентом). */
  advance(n: number): number {
    if (!this.state) return 0;
    const done = advanceDays(this.state, n);
    this.afterAdvance();
    return done;
  }

  private afterAdvance(): void {
    const s = this.state;
    if (!s) return;
    if (s.flags.autosaveDue) {
      s.flags.autosaveDue = false;
      saveTo(AUTOSAVE_KEY, s);
    }
    if (s.outcome) this.setSpeed(0);
    this.bump();
  }
}

export function saveTo(key: string, s: GameState): boolean {
  try {
    localStorage.setItem(key, serialize(s));
    return true;
  } catch {
    return false;
  }
}

export function readSave(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const store = new GameStore();

/** Текущее состояние; компонент перерисовывается на каждом тике и действии. */
export function useGame(): GameState | null {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.state;
}

export function useSpeed(): Speed {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.speed;
}

export { actions };
