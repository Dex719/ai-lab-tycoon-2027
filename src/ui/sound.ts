// Звуки игры: синтез в браузере (Web Audio), без файлов. Громкость - в настройках.

import { getSettings } from './settings';

export type SoundId =
  | 'coin' // оплата контракта, награда
  | 'cash' // крупное поступление: инвесторы, большой контракт
  | 'spend' // штраф, крупная покупка
  | 'ready' // модель обучена
  | 'release' // модель выпущена
  | 'rankUp'
  | 'rankDown'
  | 'first' // 1-е место
  | 'goal' // цель года выполнена
  | 'research' // исследование завершено
  | 'alert'; // важное письмо, деньги в минусе

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const lastPlayed = new Map<SoundId, number>();
/** Один и тот же звук не чаще, чем раз в столько мс: на ×4 события идут пачками. */
const MIN_GAP_MS = 140;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, out: master as GainNode };
  } catch {
    return null;
  }
}

interface Note {
  f: number; // частота, Гц
  t: number; // начало от момента запуска, с
  d: number; // длительность, с
  type?: OscillatorType;
  v?: number; // громкость 0..1
  slide?: number; // частота в конце (глиссандо)
}

function play(notes: Note[]): void {
  const a = audio();
  if (!a) return;
  const { ctx: c, out } = a;
  const now = c.currentTime + 0.01;
  for (const n of notes) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = n.type ?? 'triangle';
    osc.frequency.setValueAtTime(n.f, now + n.t);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, now + n.t + n.d);
    const v = (n.v ?? 0.5) * 0.35;
    g.gain.setValueAtTime(0.0001, now + n.t);
    g.gain.exponentialRampToValueAtTime(v, now + n.t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
    osc.connect(g).connect(out);
    osc.start(now + n.t);
    osc.stop(now + n.t + n.d + 0.05);
  }
}

// Ноты: C5 = 523,25 Гц.
const N = { C4: 261.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568 };

const SOUNDS: Record<SoundId, () => Note[]> = {
  coin: () => [
    { f: N.B5, t: 0, d: 0.08, type: 'square', v: 0.25 },
    { f: N.E6, t: 0.07, d: 0.32, type: 'square', v: 0.25 },
  ],
  cash: () => [
    { f: N.C6, t: 0, d: 0.09, type: 'square', v: 0.22 },
    { f: N.E6, t: 0.06, d: 0.09, type: 'square', v: 0.22 },
    { f: N.G6, t: 0.12, d: 0.4, type: 'square', v: 0.22 },
    { f: N.C5, t: 0, d: 0.5, type: 'triangle', v: 0.35 },
  ],
  spend: () => [
    { f: 220, t: 0, d: 0.18, type: 'sawtooth', v: 0.18, slide: 140 },
    { f: 150, t: 0.12, d: 0.25, type: 'triangle', v: 0.4, slide: 90 },
  ],
  ready: () => [N.C5, N.E5, N.G5, N.C6].map((f, i) => ({ f, t: i * 0.08, d: 0.35, v: 0.45 })),
  release: () => [
    { f: N.G4, t: 0, d: 0.14, v: 0.45 },
    { f: N.C5, t: 0.12, d: 0.14, v: 0.45 },
    { f: N.E5, t: 0.24, d: 0.14, v: 0.45 },
    { f: N.G5, t: 0.36, d: 0.7, v: 0.5 },
    { f: N.C5, t: 0.36, d: 0.7, v: 0.3 },
    { f: N.E5, t: 0.36, d: 0.7, v: 0.3 },
  ],
  rankUp: () => [
    { f: N.E5, t: 0, d: 0.12, type: 'square', v: 0.22 },
    { f: N.A5, t: 0.1, d: 0.12, type: 'square', v: 0.22 },
    { f: N.C6, t: 0.2, d: 0.35, type: 'square', v: 0.22 },
  ],
  rankDown: () => [
    { f: N.A4, t: 0, d: 0.16, type: 'sawtooth', v: 0.18 },
    { f: N.F5 / 2, t: 0.14, d: 0.16, type: 'sawtooth', v: 0.18 },
    { f: N.D5 / 2, t: 0.28, d: 0.45, type: 'sawtooth', v: 0.18, slide: 270 },
  ],
  first: () => [
    { f: N.C5, t: 0, d: 0.12, type: 'square', v: 0.22 },
    { f: N.C5, t: 0.12, d: 0.12, type: 'square', v: 0.22 },
    { f: N.C5, t: 0.24, d: 0.12, type: 'square', v: 0.22 },
    { f: N.G5, t: 0.36, d: 0.3, type: 'square', v: 0.24 },
    { f: N.E5, t: 0.66, d: 0.12, type: 'square', v: 0.22 },
    { f: N.C6, t: 0.8, d: 0.8, type: 'square', v: 0.26 },
    { f: N.C4, t: 0.8, d: 0.8, type: 'triangle', v: 0.45 },
    { f: N.G4, t: 0.8, d: 0.8, type: 'triangle', v: 0.35 },
  ],
  goal: () => [N.G5, N.C6, N.E6, N.G6].map((f, i) => ({ f, t: i * 0.06, d: 0.25, type: 'sine' as const, v: 0.5 })),
  research: () => [
    { f: N.E5, t: 0, d: 0.9, type: 'sine', v: 0.45 },
    { f: N.B5, t: 0.09, d: 0.9, type: 'sine', v: 0.3 },
  ],
  alert: () => [
    { f: N.A5, t: 0, d: 0.12, type: 'square', v: 0.2 },
    { f: N.E5, t: 0.16, d: 0.18, type: 'square', v: 0.2 },
  ],
};

/** Сыграть звук с громкостью из настроек; при громкости 0 молчим. */
export function playSound(id: SoundId): void {
  const vol = getSettings().volume;
  if (!(vol > 0)) return;
  const nowMs = Date.now();
  if (nowMs - (lastPlayed.get(id) ?? 0) < MIN_GAP_MS) return;
  lastPlayed.set(id, nowMs);
  const a = audio();
  if (!a) return;
  a.out.gain.value = vol;
  play(SOUNDS[id]());
}
