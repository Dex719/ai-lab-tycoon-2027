// Фоновая музыка без файлов: мягкие аккорды, редкие ноты, в поздние годы - бас и тихий перебор,
// в финальном квартале - тёмные аккорды и тихий пульс. Решения - в musicScore.ts, здесь только Web Audio.
//
// Нагрузка: раз в секунду планируем ноты на 2,5 секунды вперёд (обычный таймер, без кадров анимации);
// одновременно звучит не больше двух аккордов (смена с наплывом). Музыка молчит и контекст засыпает, когда
// громкость музыки 0 или вкладка скрыта.

import { finaleOn } from '../sim/finale';
import { yearOf } from '../sim/time';
import {
  CALM,
  midiToHz,
  moodFor,
  nextMelodyNote,
  noteGap,
  pickChord,
  TENSE,
  voicing,
  type Chord,
  type Mood,
  type Rng,
} from './musicScore';
import { getSettings } from './settings';
import { audio, existingAudio, pageVisible, setKeepAwake, suspendWhenIdle, type AudioGraph } from './sound';
import { store } from './store';

/**
 * Общая поправка громкости музыки (-12 дБ). По замеру с К-взвешиванием при настройках по умолчанию (музыка 30 %,
 * звуки 50 %) музыка в среднем около -44 дБ, звуки -33 дБ: фон на 11 дБ тише звуков и не мешает им.
 */
export const MUSIC_TRIM = 0.25;
const TICK_MS = 1000;
const AHEAD = 2.5;

/** Узлы музыки поверх общего графа (эхо берётся после шины музыки, см. buildGraph). */
interface Voices {
  pad: GainNode; // аккорды -> фильтр -> шина музыки
  filter: BiquadFilterNode;
  notes: GainNode; // редкие ноты, бас, перебор, пульс -> шина музыки
  padWave: PeriodicWave; // тёплый тон аккордов: основной тон и тихие обертоны
  bellWave: PeriodicWave; // колокольчик: основной тон и тихая октава
}

/** Состояние композитора: что уже запланировано. */
export interface Composer {
  g: AudioGraph;
  v: Voices;
  rng: Rng;
  history: number[];
  /** Аккорды по времени начала: мелодия берёт лад аккорда, который звучит в момент ноты. */
  chords: { at: number; chord: Chord }[];
  nextChordAt: number;
  nextNoteAt: number;
  nextPulseAt: number;
  melody: number;
  /** Частота фильтра аккордов, к которой он уже идёт (меняем только при смене настроения). */
  cutoff: number;
  /** Запущенные генераторы: при остановке музыки гасим их сразу. */
  live: Set<OscillatorNode>;
}

function voices(g: AudioGraph): Voices {
  const c = g.ctx;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  filter.Q.value = 0.4;
  const pad = c.createGain();
  pad.connect(filter).connect(g.music);
  const notes = c.createGain();
  notes.connect(g.music);
  // Один генератор со своей формой волны вместо пары «синус + треугольник»: вдвое меньше узлов на ноту.
  const padWave = c.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.3, 0.12, 0.05, 0.02]));
  const bellWave = c.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.2, 0.04]));
  return { pad, filter, notes, padWave, bellWave };
}

export function newComposer(g: AudioGraph, rng: Rng = Math.random): Composer {
  return { g, v: voices(g), rng, history: [], chords: [], nextChordAt: 0, nextNoteAt: 0, nextPulseAt: 0, melody: 72, cutoff: 0, live: new Set() };
}

function osc(k: Composer, type: OscillatorType | PeriodicWave, f: number, t: number, end: number, dest: AudioNode): OscillatorNode {
  const o = k.g.ctx.createOscillator();
  if (typeof type === 'string') o.type = type as OscillatorType;
  else o.setPeriodicWave(type);
  o.frequency.setValueAtTime(f, t);
  o.connect(dest);
  o.start(t);
  o.stop(end);
  k.live.add(o);
  o.onended = () => k.live.delete(o);
  return o;
}

/** Голос аккорда: тёплый тон с медленным наплывом и медленным затуханием. */
function padVoice(k: Composer, f: number, t: number, hold: number, attack: number, release: number, amp: number): void {
  const c = k.g.ctx;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + attack);
  env.gain.setValueAtTime(amp, t + hold);
  env.gain.linearRampToValueAtTime(0, t + hold + release);
  env.connect(k.v.pad);
  const o = osc(k, k.v.padWave, f, t, t + hold + release + 0.05, env);
  o.detune.value = (k.rng() - 0.5) * 12; // ±6 центов у каждого голоса: соседние голоса медленно «дышат»
}

/** Нота-колокольчик (или тихий треугольник для баса и перебора): быстрая атака и долгое затухание. */
function bell(k: Composer, f: number, t: number, amp: number, decay: number, type?: OscillatorType): void {
  const c = k.g.ctx;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  env.connect(k.v.notes);
  osc(k, type ?? k.v.bellWave, f, t, t + decay + 0.05, env);
}

function chordAt(k: Composer, t: number): Chord {
  let cur = k.chords[0]?.chord ?? CALM[0];
  for (const e of k.chords) if (e.at <= t) cur = e.chord;
  return cur;
}

function scheduleChord(k: Composer, t: number, mood: Mood): void {
  const set = mood.tension ? TENSE : CALM;
  // Смена набора (начался финальный квартал): история прежнего набора не мешает выбору.
  if (k.chords.length > 0 && !set.includes(k.chords[k.chords.length - 1].chord)) k.history = [];
  const idx = pickChord(k.rng, set.length, k.history);
  k.history.push(idx);
  if (k.history.length > 4) k.history.shift();
  const chord = set[idx];
  k.chords.push({ at: t, chord });
  while (k.chords.length > 3) k.chords.shift();
  const [lo, hi] = mood.chordLen;
  const len = lo + k.rng() * (hi - lo);
  const notes = voicing(chord, mood.voices, k.rng);
  const amp = 0.11 / Math.sqrt(notes.length);
  const attack = Math.min(4, len * 0.35);
  for (const m of notes) padVoice(k, midiToHz(m), t, len, attack, 4, amp * (m < 48 ? 0.8 : 1));
  if (mood.bass) {
    const root = chord.notes[0];
    bell(k, midiToHz(root >= 48 ? root - 12 : root), t + 0.05, 0.06, Math.min(len, 6), 'triangle');
  }
  if (k.rng() < mood.arpChance) arpeggio(k, chord, t + len * (0.3 + k.rng() * 0.3));
  k.nextChordAt = t + len;
}

/** Тихий перебор вверх-вниз по звукам аккорда (поздние годы). */
function arpeggio(k: Composer, chord: Chord, t: number): void {
  const up = [...new Set(chord.notes.map((m) => (m < 60 ? m + 12 : m)))].sort((a, b) => a - b).slice(0, 4);
  const seq = [...up, ...up.slice(1, -1).reverse()];
  const step = 0.28 + k.rng() * 0.08;
  seq.forEach((m, i) => bell(k, midiToHz(m + 12), t + i * step, 0.028, 0.9, 'triangle'));
}

function schedulePhrase(k: Composer, t: number, mood: Mood): void {
  const count = 1 + Math.floor(k.rng() * mood.phraseMax);
  let at = t;
  for (let i = 0; i < count; i++) {
    k.melody = nextMelodyNote(k.rng, k.melody, chordAt(k, at));
    bell(k, midiToHz(k.melody), at, 0.05 + k.rng() * 0.035, 2.4 + k.rng() * 1.4);
    at += 0.45 + k.rng() * 0.5;
  }
  k.nextNoteAt = at + noteGap(k.rng, mood.noteGap);
}

/** Пульс финального квартала: низкий двойной удар, как сердце, раз в 1,3 секунды. */
function schedulePulse(k: Composer, t: number): void {
  const c = k.g.ctx;
  for (const [dt, a] of [
    [0, 0.12],
    [0.27, 0.07],
  ] as const) {
    const env = c.createGain();
    env.gain.setValueAtTime(0, t + dt);
    env.gain.linearRampToValueAtTime(a, t + dt + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.45);
    env.connect(k.v.notes);
    const o = osc(k, 'sine', 70, t + dt, t + dt + 0.5, env);
    o.frequency.exponentialRampToValueAtTime(52, t + dt + 0.4);
  }
  k.nextPulseAt = t + 1.3;
}

/** Запланировать всё, что должно зазвучать до момента until. */
export function compose(k: Composer, mood: Mood, until: number): void {
  const now = k.g.ctx.currentTime;
  if (k.cutoff !== mood.cutoff) {
    k.v.filter.frequency.cancelScheduledValues(now);
    k.v.filter.frequency.setValueAtTime(k.v.filter.frequency.value, now);
    k.v.filter.frequency.linearRampToValueAtTime(mood.cutoff, now + 6);
    k.cutoff = mood.cutoff;
  }
  if (k.nextChordAt < now) k.nextChordAt = now + 0.05;
  if (k.nextNoteAt < now) k.nextNoteAt = now + 1.5 + k.rng() * 2;
  while (k.nextChordAt < until) scheduleChord(k, k.nextChordAt, mood);
  while (k.nextNoteAt < until) schedulePhrase(k, k.nextNoteAt, mood);
  if (mood.pulse) {
    if (k.nextPulseAt < now) k.nextPulseAt = now + 0.1;
    while (k.nextPulseAt < until) schedulePulse(k, k.nextPulseAt);
  } else k.nextPulseAt = 0;
}

// ---------- Живая музыка в игре ----------

let composer: Composer | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** Громкость шины музыки, к которой она уже идёт: новое событие автоматизации - только при её смене. */
let gainTarget = -1;
/** Игрок уже нажимал на страницу: браузер разрешает звук только после этого. */
let unlocked = false;

/** Настроение по текущей партии: год, финальный квартал, пауза; без партии - главное меню. */
export function currentMood(): Mood {
  const s = store.state;
  if (!s) return moodFor({ inGame: false, year: 2017, finale: false, paused: false });
  return moodFor({ inGame: true, year: yearOf(s.day), finale: finaleOn(s) && !s.outcome, paused: store.speed === 0 || !!s.outcome });
}

function wanted(): boolean {
  return unlocked && pageVisible() && getSettings().music > 0;
}

function tick(): void {
  timer = null;
  if (!wanted()) {
    stopMusic();
    return;
  }
  const g = audio();
  if (!g) {
    running = false; // браузер без Web Audio: молчим, следующая попытка - при следующем нажатии на ползунок
    return;
  }
  if (!composer || composer.g !== g) composer = newComposer(g);
  const mood = currentMood();
  const target = getSettings().music * mood.level * MUSIC_TRIM;
  if (target !== gainTarget) {
    g.music.gain.cancelScheduledValues(g.ctx.currentTime);
    g.music.gain.setTargetAtTime(target, g.ctx.currentTime, target < gainTarget ? 0.8 : 1.5);
    gainTarget = target;
  }
  compose(composer, mood, g.ctx.currentTime + AHEAD);
  timer = setTimeout(tick, TICK_MS);
}

function startMusic(): void {
  if (running || !wanted()) return;
  running = true;
  tick();
}

/** Остановить музыку: быстро убрать громкость, погасить запланированные ноты, дать контексту уснуть. */
function stopMusic(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const wasRunning = running;
  running = false;
  const g = existingAudio();
  if (!g) return;
  const now = g.ctx.currentTime;
  g.music.gain.cancelScheduledValues(now);
  g.music.gain.setTargetAtTime(0, now, 0.08);
  gainTarget = 0;
  if (composer) {
    for (const o of composer.live) {
      try {
        o.stop(now + 0.5);
      } catch {
        // уже остановлен
      }
    }
    composer.nextChordAt = 0;
    composer.nextNoteAt = 0;
    composer.nextPulseAt = 0;
  }
  if (wasRunning) suspendWhenIdle(900);
}

/** Громкость музыки изменилась в настройках: применить сразу. */
export function musicSettingsChanged(): void {
  unlocked = true;
  if (!wanted()) {
    stopMusic();
    return;
  }
  const g = existingAudio();
  if (running && g) {
    gainTarget = getSettings().music * currentMood().level * MUSIC_TRIM;
    g.music.gain.cancelScheduledValues(g.ctx.currentTime);
    g.music.gain.setTargetAtTime(gainTarget, g.ctx.currentTime, 0.05);
  }
  startMusic();
}

/** Подключить музыку: старт после первого нажатия, тишина в скрытой вкладке. Вызывается один раз. */
export function initMusic(): void {
  if (typeof window === 'undefined') return;
  setKeepAwake(() => running);
  const unlock = (): void => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    startMusic();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopMusic();
      // Скрытая вкладка: контекст засыпает целиком (и звуки, и эхо), процессор не занят.
      const g = existingAudio();
      if (g) void (g.ctx as AudioContext).suspend().catch(() => undefined);
    } else startMusic();
  });
  // Страница уходит в кэш или замораживается браузером - тоже тишина.
  window.addEventListener('pagehide', () => stopMusic());
  document.addEventListener('freeze', () => stopMusic());
}

/** Для проверки в браузере: идёт ли музыка и что звучит. */
export function musicDebug(): { running: boolean; unlocked: boolean; state: string; gain: number; live: number; mood: Mood } {
  const g = existingAudio();
  return {
    running,
    unlocked,
    state: g ? (g.ctx as AudioContext).state : 'none',
    gain: g ? g.music.gain.value : 0,
    live: composer?.live.size ?? 0,
    mood: currentMood(),
  };
}
