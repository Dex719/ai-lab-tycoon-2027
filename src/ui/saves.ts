// Ячейки сохранений в браузере: 5 ручных и автосохранение. В ячейке - краткие сведения для списка и само состояние.

import type { Difficulty } from '../sim/rivalry';
import { deserialize, serialize } from '../sim/save';
import { playerBestArenaRank } from '../sim/tick';
import type { GameState } from '../sim/types';

export type SlotId = 1 | 2 | 3 | 4 | 5 | 'auto';
export const MANUAL_SLOTS: readonly SlotId[] = [1, 2, 3, 4, 5];
export const ALL_SLOTS: readonly SlotId[] = ['auto', 1, 2, 3, 4, 5];

export interface SlotMeta {
  labName: string;
  day: number;
  cash: number;
  arenaRank: number | null;
  outcome: GameState['outcome'];
  /** Сложность партии; в сведениях старых ячеек её нет - читается как «Обычная». */
  difficulty: Difficulty;
  savedAt: number; // реальное время сохранения, мс
}

export interface SlotInfo {
  id: SlotId;
  meta: SlotMeta | null; // null - ячейка пуста
  broken: boolean; // в ячейке что-то есть, но прочитать не удалось
}

const PREFIX = 'ailab.slot.';
// Сохранения первой версии: состояние без сведений. Читаем их как ячейки «авто» и «1».
const LEGACY: Partial<Record<string, string>> = { auto: 'ailab.autosave.v1', '1': 'ailab.save.v1' };

function keyOf(id: SlotId): string {
  return `${PREFIX}${id}`;
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function metaOf(s: GameState): SlotMeta {
  let arenaRank: number | null = null;
  try {
    arenaRank = playerBestArenaRank(s);
  } catch {
    arenaRank = null;
  }
  return {
    labName: s.labName,
    day: s.day,
    cash: s.cash,
    arenaRank,
    outcome: s.outcome,
    difficulty: s.difficulty,
    savedAt: Date.now(),
  };
}

interface Stored {
  v: 1;
  meta: SlotMeta;
  state: GameState;
}

function readRaw(id: SlotId): { stored: Stored | null; broken: boolean } {
  const raw = storageGet(keyOf(id)) ?? (LEGACY[String(id)] ? storageGet(LEGACY[String(id)]!) : null);
  if (!raw) return { stored: null, broken: false };
  try {
    const data = JSON.parse(raw) as Partial<Stored> & { version?: number };
    if (data.v === 1 && data.meta && data.state) {
      // Ячейки, записанные до появления сложности: в сведениях её нет, партия шла как «Обычная».
      const meta: SlotMeta = { ...data.meta, difficulty: data.meta.difficulty ?? 'normal' };
      return { stored: { v: 1, meta, state: data.state }, broken: false };
    }
    // Старый формат: в ключе лежит само состояние.
    if (data.version === 1) {
      const r = deserialize(raw);
      if (r.ok) return { stored: { v: 1, meta: { ...metaOf(r.state), savedAt: 0 }, state: r.state }, broken: false };
    }
  } catch {
    // ниже - «повреждено»
  }
  return { stored: null, broken: true };
}

export function listSlots(): SlotInfo[] {
  return ALL_SLOTS.map((id) => {
    const { stored, broken } = readRaw(id);
    return { id, meta: stored?.meta ?? null, broken };
  });
}

/** Самая свежая занятая ячейка (для «Продолжить») или null. */
export function latestSlot(): SlotId | null {
  let best: SlotInfo | null = null;
  for (const slot of listSlots()) {
    if (!slot.meta || slot.meta.outcome) continue;
    if (!best || slot.meta.savedAt > best.meta!.savedAt) best = slot;
  }
  return best?.id ?? null;
}

export function writeSlot(id: SlotId, s: GameState): boolean {
  try {
    const payload = `{"v":1,"meta":${JSON.stringify(metaOf(s))},"state":${serialize(s)}}`;
    localStorage.setItem(keyOf(id), payload);
  } catch {
    return false;
  }
  // Запись удалась. Старый ключ первой версии убираем отдельно: его отсутствие не делает сохранение неудачным.
  try {
    const legacy = LEGACY[String(id)];
    if (legacy) localStorage.removeItem(legacy);
  } catch {
    // старый ключ останется, читается он только если новый пуст
  }
  return true;
}

/** Загрузить ячейку: состояние или текст ошибки. */
export function readSlot(id: SlotId): { ok: true; state: GameState } | { ok: false; error: string } {
  const { stored, broken } = readRaw(id);
  if (broken) return { ok: false, error: 'Сохранение повреждено.' };
  if (!stored) return { ok: false, error: 'Ячейка пуста.' };
  return deserialize(JSON.stringify(stored.state));
}

export function deleteSlot(id: SlotId): void {
  try {
    localStorage.removeItem(keyOf(id));
    const legacy = LEGACY[String(id)];
    if (legacy) localStorage.removeItem(legacy);
  } catch {
    // нечего удалять
  }
}

/** «11.10.2026, 08:42» */
export function formatSavedAt(ms: number): string {
  if (!ms) return 'дата неизвестна';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}
