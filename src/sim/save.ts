// Сохранения: состояние целиком в JSON, включая генератор случайных чисел (FR-13).

import type { GameState } from './types';

export const SAVE_KEY = 'ailab.save.v1';
export const AUTOSAVE_KEY = 'ailab.autosave.v1';

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

const REQUIRED: (keyof GameState)[] = [
  'version', 'seed', 'rng', 'day', 'labName', 'cash', 'reputation', 'founderShare', 'hype', 'compute',
  'research', 'models', 'rivalsReleased', 'benchmarks', 'tenders', 'contracts', 'mail', 'firedEvents',
  'modifiers', 'flags', 'finance', 'market',
];

export function deserialize(json: string): { ok: true; state: GameState } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Файл сохранения повреждён' };
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'Файл сохранения повреждён' };
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1) return { ok: false, error: 'Сохранение от другой версии игры' };
  for (const k of REQUIRED) {
    if (!(k in obj)) return { ok: false, error: `В сохранении нет поля ${k}` };
  }
  return { ok: true, state: data as GameState };
}
