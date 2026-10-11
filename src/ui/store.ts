// Хранилище игры для React: состояние, скорость, игровой цикл, автосохранение.
// Симуляция меняет состояние на месте; интерфейс подписан на счётчик версий.

import { useSyncExternalStore } from 'react';
import * as actions from '../sim/actions';
import { TICK_MS } from '../sim/constants';
import type { Difficulty } from '../sim/rivalry';
import { advanceDay, advanceDays, blockedByChoice } from '../sim/tick';
import type { GameState, Result, Speed } from '../sim/types';
import { readSlot, writeSlot, type SlotId } from './saves';
import { getSettings } from './settings';

type Listener = () => void;

export class GameStore {
  state: GameState | null = null;
  speed: Speed = 0;
  lastSpeed: Exclude<Speed, 0> = 1;
  version = 0;
  /** Текст ошибки последнего автосохранения (например, переполнено хранилище браузера) или null. */
  autosaveError: string | null = null;
  /** Почему игра встала на паузу сама (заголовок важного письма и т. п.) или null. Пропадает, когда игрок продолжает игру. */
  pauseReason: string | null = null;
  /** Письмо, которое «Почта» должна открыть (после нажатия «Открыть» в уведомлении); окно забирает его и сбрасывает. */
  mailFocus: string | null = null;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  focusMail(id: string | null): void {
    this.mailFocus = id;
    this.bump();
  }

  bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Начать игру с готовым состоянием (новая игра или загрузка). */
  start(state: GameState): void {
    this.state = state;
    this.autosaveError = null;
    this.pauseReason = null;
    this.mailFocus = null;
    this.setSpeed(0);
    this.bump();
  }

  /** Новая партия. difficulty - сложность соперников (по умолчанию «Обычная»). */
  newGame(labName: string, opts: { founderName?: string; tutorial?: boolean; seed?: number; difficulty?: Difficulty } = {}): void {
    const s = actions.newGame(labName, opts.seed ?? (Date.now() ^ 0x5eed) >>> 0, opts.difficulty ?? 'normal');
    s.founderName = (opts.founderName ?? '').trim();
    s.tutorial = { step: 0, active: opts.tutorial ?? false };
    this.start(s);
  }

  /** Сохранить партию в ячейку. */
  saveToSlot(id: SlotId): boolean {
    return !!this.state && writeSlot(id, this.state);
  }

  /** Загрузить ячейку; при ошибке вернуть её текст. */
  loadSlot(id: SlotId): string | null {
    const r = readSlot(id);
    if (!r.ok) return r.error;
    this.start(r.state);
    return null;
  }

  quit(): void {
    this.autosaveError = null;
    this.pauseReason = null;
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
    if (speed !== 0) {
      this.lastSpeed = speed;
      this.pauseReason = null; // игрок продолжил игру - причина паузы больше не нужна
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (speed !== 0) this.timer = setInterval(() => this.tick(), TICK_MS[speed]);
    this.bump();
  }

  /** Пауза/продолжение. В законченной игре и пока в почте ждёт выбор, часы не трогаем. */
  togglePause(): void {
    const s = this.state;
    if (!s || s.outcome || blockedByChoice(s)) return;
    this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
  }

  /** Вкладка браузера скрыта: браузер замедляет таймеры, а игра за это время ушла бы вперёд. Сами не продолжаем. */
  pauseForHidden(): void {
    if (!this.state || this.state.outcome || this.speed === 0 || !getSettings().pauseOnHidden) return;
    this.pauseReason = 'Вкладка была скрыта';
    this.setSpeed(0);
  }

  private tick(): void {
    const s = this.state;
    if (!s) return;
    if (s.outcome) {
      this.setSpeed(0);
      return;
    }
    if (blockedByChoice(s)) return; // ждём выбора в почте, скорость сохраняется
    const mark = this.markAdvance(s);
    advanceDay(s);
    this.afterAdvance(mark);
  }

  /** Перемотка на n дней (отладка и проверка агентом). */
  advance(n: number): number {
    if (!this.state) return 0;
    const mark = this.markAdvance(this.state);
    const done = advanceDays(this.state, n);
    this.afterAdvance(mark);
    return done;
  }

  /** Запомнить, что было до шага симуляции, чтобы после него увидеть новые важные письма и уход денег в минус. */
  private markAdvance(s: GameState): AdvanceMark {
    return { mailNum: s.nextMailNum, wasNegative: s.finance.negativeDays > 0 };
  }

  /** Причина, по которой после шага надо поставить паузу, или null. */
  private alertReason(s: GameState, mark: AdvanceMark): string | null {
    // Письма лежат по порядку номеров: новые - в хвосте списка.
    const fresh: string[] = [];
    for (let i = s.mail.length - 1; i >= 0; i--) {
      const m = s.mail[i];
      if (Number(m.id.slice(1)) < mark.mailNum) break;
      if (m.important) fresh.unshift(m.title);
    }
    if (fresh.length > 0) return fresh.length === 1 ? fresh[0] : `${fresh[0]} (и ещё ${fresh.length - 1})`;
    if (!mark.wasNegative && s.finance.negativeDays > 0) return 'Деньги ушли в минус';
    return null;
  }

  private afterAdvance(mark?: AdvanceMark): void {
    const s = this.state;
    if (!s) return;
    if (s.flags.autosaveDue) {
      s.flags.autosaveDue = false;
      // Законченную игру не сохраняем поверх последнего живого автосохранения.
      if (!s.outcome) {
        this.autosaveError = writeSlot('auto', s) ? null : 'Автосохранение не удалось: хранилище браузера переполнено или недоступно.';
      }
    }
    if (s.outcome) {
      this.setSpeed(0);
    } else if (mark && this.speed !== 0 && getSettings().pauseOnImportant) {
      const reason = this.alertReason(s, mark);
      if (reason !== null) {
        this.pauseReason = reason;
        this.setSpeed(0); // lastSpeed сохраняется: пробел продолжит с прежней скоростью
      }
    }
    this.bump();
  }
}

interface AdvanceMark {
  /** Номер, который получит следующее письмо (s.nextMailNum до шага). */
  mailNum: number;
  /** Деньги уже были в минусе до шага. */
  wasNegative: boolean;
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
