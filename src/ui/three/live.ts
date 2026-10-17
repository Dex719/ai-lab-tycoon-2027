// Что сейчас делает лаборатория, в виде, понятном 3D-залам: идёт ли время, насколько занята мощность,
// не в беде ли деньги, и короткие события (обучение началось, модель вышла). Без three.js и без React:
// пишет SceneLive (из состояния партии), читает движок. Симуляцию не трогает.

export type SceneEventKind = 'trainStart' | 'trainDone' | 'release' | 'trouble' | 'hardware' | 'hire';

export interface LiveState {
  /** Время идёт (не пауза). В главном меню - true: зал живёт сам. */
  running: boolean;
  /** Доля мощности, занятая работой, 0..1 (1 - доля простоя). */
  load: number;
  /** Деньги в минусе: огоньки жёлтые. */
  trouble: boolean;
  /** Последнее событие и момент его начала (performance.now()). */
  event: { kind: SceneEventKind; at: number; seq: number } | null;
}

export const live: LiveState = { running: true, load: 0.6, trouble: false, event: null };

/** Длительность события в зале, мс. */
export const EVENT_MS = 2000;

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeLive(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function emit(): void {
  for (const l of listeners) l();
}

/** Обновить непрерывное состояние; слушатели зовутся, только если что-то изменилось. */
export function setLive(patch: Partial<Pick<LiveState, 'running' | 'load' | 'trouble'>>): void {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
    if (patch[k] !== undefined && live[k] !== patch[k]) {
      (live as unknown as Record<string, unknown>)[k] = patch[k];
      changed = true;
    }
  }
  if (changed) emit();
}

let seq = 0;

export function fireSceneEvent(kind: SceneEventKind): void {
  live.event = { kind, at: performance.now(), seq: ++seq };
  emit();
}

/** Вернуть меню-состояние (игры нет): зал живёт, события сброшены. */
export function resetLive(): void {
  live.running = true;
  live.load = 0.6;
  live.trouble = false;
  live.event = null;
  emit();
}

/** Быстрый целочисленный хеш в 0..1: даёт повторяемый «случайный» узор огоньков. */
export function hash01(a: number, b: number, c: number, d: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

// Только в разработке: проверка из консоли (window.__live.fire('release'), window.__live.live).
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__live = { live, fire: fireSceneEvent };
