// Ячейки сохранений в браузере: 5 ручных и автосохранение. В ячейке - краткие сведения для списка и само состояние.

import { DIFFICULTY_IDS, type Difficulty } from '../sim/rivalry';
import { deserialize, serialize } from '../sim/save';
import { bestArenaPlace } from './arena';
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
  const arenaRank = bestArenaPlace(s);
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

const OUTCOMES: readonly (GameState['outcome'] & string)[] = ['victory', 'finished', 'bankrupt'];

/**
 * Сведения ячейки из хранилища: их рисует меню без проверки состояния, поэтому проверяем здесь. Неизвестная сложность
 * (ячейка более новой версии) читается как «Обычная», битые поля - ячейка повреждена. Раньше такая ячейка роняла
 * главное меню в белый экран при каждом запуске.
 */
function cleanMeta(m: unknown): SlotMeta | null {
  if (!m || typeof m !== 'object') return null;
  const x = m as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (typeof x.labName !== 'string' || !num(x.day) || !num(x.cash)) return null;
  return {
    labName: x.labName,
    day: x.day,
    cash: x.cash,
    arenaRank: num(x.arenaRank) ? x.arenaRank : null,
    outcome: OUTCOMES.includes(x.outcome as never) ? (x.outcome as GameState['outcome']) : null,
    difficulty: DIFFICULTY_IDS.includes(x.difficulty as Difficulty) ? (x.difficulty as Difficulty) : 'normal',
    savedAt: num(x.savedAt) ? x.savedAt : 0,
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
      // Ячейки, записанные до появления сложности: в сведениях её нет, партия шла как «Обычная» (cleanMeta).
      const meta = cleanMeta(data.meta);
      if (meta) return { stored: { v: 1, meta, state: data.state }, broken: false };
      return { stored: null, broken: true };
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

/** Самая свежая занятая ячейка (для «Продолжить») или null; slots - уже прочитанный список, чтобы не разбирать ячейки снова. */
export function latestSlot(slots: SlotInfo[] = listSlots()): SlotId | null {
  let best: SlotInfo | null = null;
  for (const slot of slots) {
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

// ---------- Код партии ----------

/** Начало кода: по нему видно, что строка - партия этой игры, и какой версии формат. */
const CODE_PREFIX = 'AILT1:';

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Партия одной строкой (сжатое сохранение): её можно скопировать и вставить в другом браузере. */
export async function exportCode(s: GameState): Promise<string> {
  const json = new TextEncoder().encode(serialize(s));
  const packed = await pipe(json, new CompressionStream('gzip'));
  return CODE_PREFIX + toBase64(packed);
}

/** Партия из кода: состояние или понятная ошибка. */
export async function importCode(code: string): Promise<{ ok: true; state: GameState } | { ok: false; error: string }> {
  const text = code.replace(/\s+/g, '');
  if (!text) return { ok: false, error: 'Вставьте код партии.' };
  if (!text.startsWith(CODE_PREFIX)) return { ok: false, error: 'Это не код партии AI Lab Tycoon.' };
  let json: string;
  try {
    const raw = await pipe(fromBase64(text.slice(CODE_PREFIX.length)), new DecompressionStream('gzip'));
    json = new TextDecoder().decode(raw);
  } catch {
    return { ok: false, error: 'Код повреждён: скопируйте его целиком.' };
  }
  return deserialize(json);
}
