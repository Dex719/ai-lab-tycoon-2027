// Партитура фоновой музыки «лаборатория ночью»: настроение по ситуации в игре, аккорды и редкие ноты.
// Здесь только решения (что и когда играть), без Web Audio: звук делает music.ts.
// Всё случайно в пределах правил, поэтому музыка не повторяется заметно.

export type Rng = () => number;

export interface MoodInput {
  inGame: boolean; // идёт партия (иначе главное меню)
  year: number; // год в игре
  finale: boolean; // финальный квартал
  paused: boolean; // игра на паузе или окончена
}

export interface Mood {
  density: number; // 0..1: 2017 - 0 (тихо и просто), 2024 - 1 (плотнее)
  tension: boolean; // финальный квартал: тёмные аккорды и тихий пульс
  level: number; // множитель громкости музыки (на паузе тише)
  voices: number; // голосов в аккорде
  bass: boolean; // низкий тон под аккордом
  noteGap: number; // средний промежуток между редкими нотами, с
  phraseMax: number; // нот в короткой фразе (1 - одиночные ноты)
  arpChance: number; // вероятность тихого перебора на аккорде
  chordLen: [number, number]; // длительность аккорда, с (от и до)
  cutoff: number; // фильтр аккордов, Гц: выше - ярче
  pulse: boolean; // тихий пульс в финальном квартале
}

const FIRST_YEAR = 2017;
const DENSE_YEAR = 2024;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function moodFor(i: MoodInput): Mood {
  const density = i.inGame ? clamp01((i.year - FIRST_YEAR) / (DENSE_YEAR - FIRST_YEAR)) : 0;
  const m: Mood = {
    density,
    tension: false,
    level: i.inGame ? lerp(0.8, 1, density) : 0.75,
    voices: 3 + Math.round(density * 2),
    bass: density >= 0.4,
    noteGap: lerp(8, 3.2, density),
    phraseMax: density < 0.5 ? 1 : density < 0.85 ? 2 : 3,
    arpChance: density < 0.55 ? 0 : (density - 0.55) * 1.1,
    chordLen: [lerp(16, 10, density), lerp(22, 14, density)],
    cutoff: lerp(700, 1400, density),
    pulse: false,
  };
  if (i.inGame && i.finale) {
    m.tension = true;
    m.voices = Math.max(m.voices, 4);
    m.bass = true;
    m.noteGap *= 0.8;
    m.chordLen = [8, 11];
    m.cutoff = Math.max(m.cutoff, 1500);
    m.pulse = true;
  }
  if (i.inGame && i.paused) {
    m.level *= 0.5;
    m.noteGap *= 1.6;
    m.phraseMax = 1;
    m.arpChance = 0;
    m.pulse = false;
  }
  return m;
}

export interface Chord {
  name: string;
  /** Ноты MIDI по важности: основной тон, квинта, краски, терция. Голосов берётся сколько нужно. */
  notes: number[];
  /** Лад для мелодии над аккордом: звуки по высоте без октавы (до = 0, ре = 2, ... си = 11). */
  scale: number[];
}

const D_MAJOR = [2, 4, 6, 7, 9, 11, 1]; // ре мажор
const D_MAJOR_PENTA = [2, 4, 6, 9, 11];

// Лад мелодии у каждого аккорда без звуков, которые стоят в полутоне от звука аккорда
// (иначе редкая нота над аккордом звучит фальшиво): это проверяет тест.

/** Спокойная ночь: ре мажор с септимами и нонами, без резких тяготений. */
export const CALM: Chord[] = [
  { name: 'Dmaj9', notes: [50, 57, 64, 61, 66], scale: D_MAJOR_PENTA },
  { name: 'Bm9', notes: [47, 54, 61, 57, 62], scale: D_MAJOR_PENTA },
  { name: 'Gmaj7#11', notes: [43, 50, 54, 61, 57], scale: D_MAJOR },
  { name: 'Em9', notes: [52, 59, 66, 62, 67], scale: D_MAJOR_PENTA },
  { name: 'Asus2', notes: [45, 52, 59, 64, 61], scale: [4, 6, 9, 11, 1] },
  { name: 'F#m7', notes: [54, 61, 64, 69, 57], scale: [6, 9, 11, 1, 4] },
];

/** Финальный квартал: ре минор, тёмные мажорные септаккорды на шестой и второй низкой ступени. */
export const TENSE: Chord[] = [
  { name: 'Dm9', notes: [50, 57, 64, 60, 65], scale: [2, 4, 5, 7, 9, 0] },
  { name: 'Bbmaj7', notes: [46, 53, 57, 62, 58], scale: [2, 5, 7, 9, 10, 0] },
  { name: 'Gm9', notes: [43, 50, 57, 53, 58], scale: [2, 5, 7, 9, 10, 0] },
  { name: 'Asus4', notes: [45, 52, 62, 64, 57], scale: [2, 4, 7, 9, 0] },
  { name: 'Fmaj7', notes: [41, 48, 52, 57, 53], scale: [2, 4, 5, 7, 9, 0] },
  { name: 'Ebmaj7', notes: [51, 58, 62, 67, 55], scale: [2, 3, 5, 7, 10, 0] },
];

/** Следующий аккорд: случайный, но не один из двух последних (без «качелей» туда-обратно). */
export function pickChord(rng: Rng, count: number, history: number[]): number {
  const recent = history.slice(-2);
  const options: number[] = [];
  for (let i = 0; i < count; i++) if (!recent.includes(i)) options.push(i);
  const pool = options.length > 0 ? options : [...Array(count).keys()];
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Голоса аккорда: первые n нот по важности; верхние иногда переносятся на октаву вверх для разнообразия. */
export function voicing(chord: Chord, voices: number, rng: Rng): number[] {
  const n = Math.max(2, Math.min(voices, chord.notes.length));
  return chord.notes.slice(0, n).map((m, i) => (i >= 2 && m < 62 && rng() < 0.35 ? m + 12 : m));
}

/** Диапазон редких нот: от ре первой октавы до ре третьей. */
export const MELODY_LOW = 62;
export const MELODY_HIGH = 86;

/** Ноты лада в диапазоне мелодии, по возрастанию. */
export function scaleNotes(scale: number[]): number[] {
  const out: number[] = [];
  for (let m = MELODY_LOW; m <= MELODY_HIGH; m++) if (scale.includes(m % 12)) out.push(m);
  return out;
}

/**
 * Следующая нота мелодии: шаг по ладу на 1-3 ступени от прошлой (изредка скачок), чаще на звуки аккорда.
 * Повтор той же ноты исключён.
 */
export function nextMelodyNote(rng: Rng, prev: number, chord: Chord): number {
  const notes = scaleNotes(chord.scale);
  let at = 0;
  for (let i = 0; i < notes.length; i++) if (Math.abs(notes[i] - prev) < Math.abs(notes[at] - prev)) at = i;
  const pcs = chord.notes.map((m) => m % 12);
  const cands: { m: number; w: number }[] = [];
  for (let step = -4; step <= 4; step++) {
    if (step === 0) continue;
    const j = at + step;
    if (j < 0 || j >= notes.length) continue;
    const m = notes[j];
    if (m === prev) continue;
    let w = Math.abs(step) <= 2 ? 3 : Math.abs(step) === 3 ? 1.5 : 0.6;
    if (pcs.includes(m % 12)) w *= 2;
    // тянем к середине диапазона, чтобы мелодия не уходила к краям
    const mid = (MELODY_LOW + MELODY_HIGH) / 2;
    if (Math.abs(m - mid) > Math.abs(prev - mid)) w *= 0.7;
    cands.push({ m, w });
  }
  if (cands.length === 0) return notes[Math.floor(notes.length / 2)];
  const total = cands.reduce((a, c) => a + c.w, 0);
  let r = rng() * total;
  for (const c of cands) {
    r -= c.w;
    if (r <= 0) return c.m;
  }
  return cands[cands.length - 1].m;
}

/** Промежуток до следующей ноты: случайный вокруг среднего (от 0,4 до 2,2 среднего), без ровного ритма. */
export function noteGap(rng: Rng, mean: number): number {
  return mean * (0.4 + rng() * 1.8);
}

export function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
