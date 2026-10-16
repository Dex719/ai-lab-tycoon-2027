// Звуки игры: синтез в браузере (Web Audio), без файлов. Громкость звуков и музыки - в настройках.
//
// Граф: звуки -> шина звуков -> мягкий фильтр -> общий выход; музыка (music.ts) -> шина музыки -> общий выход;
// обе шины понемногу посылают сигнал в общее «эхо комнаты», чтобы звуки и музыка звучали в одном пространстве.
// Тембры у всех звуков одни: синус и треугольник с плавной атакой (без «квадрата» и «пилы»), громкость
// выровнена по замеру (см. SFX_TRIM): ни один звук не громче другого больше чем на 2 дБ.

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
  | 'alert' // важное письмо, деньги в минусе
  | 'rack'; // карты арендованы или куплены: стойка встала на место

export interface AudioGraph {
  ctx: BaseAudioContext;
  /** Шина звуков: громкость = настройка «Звуки». */
  sfx: GainNode;
  /** Шина музыки: громкость = настройка «Музыка» × настроение (music.ts). */
  music: GainNode;
  /** Вход общего эха (задержка с затуханием и мягким фильтром); шины посылают в него сами. */
  room: GainNode;
}

let graph: AudioGraph | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Время контекста, до которого звучит последний запущенный звук. */
let busyUntil = 0;
/** Кто ещё держит контекст включённым (музыка). */
let keepAwake: () => boolean = () => false;
const lastPlayed = new Map<SoundId, number>();
/** Один и тот же звук не чаще, чем раз в столько мс: на ×4 события идут пачками. */
const MIN_GAP_MS = 140;

/** Вкладка видна (в тестах и без браузера - да). */
export function pageVisible(): boolean {
  return typeof document === 'undefined' || !document.hidden;
}

/** Собрать граф на любом контексте (в том числе OfflineAudioContext для замеров громкости). */
export function buildGraph(ctx: BaseAudioContext): AudioGraph {
  const out = ctx.destination;
  // Шина звуков: срезаем верх выше 5 кГц, чтобы высокие ноты не резали слух.
  const sfx = ctx.createGain();
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 5000;
  soft.Q.value = 0.5;
  sfx.connect(soft).connect(out);
  const music = ctx.createGain();
  music.gain.value = 0;
  music.connect(out);
  // Эхо комнаты: одна задержка с обратной связью через фильтр - дешевле свёртки и звучит мягко.
  const room = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.38;
  const fb = ctx.createGain();
  fb.gain.value = 0.38;
  const damp = ctx.createBiquadFilter();
  damp.type = 'lowpass';
  damp.frequency.value = 1700;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  room.connect(delay);
  delay.connect(damp).connect(fb).connect(delay);
  damp.connect(wet).connect(out);
  // Посылы в эхо - после шин: при громкости 0 молчит и эхо.
  const sfxSend = ctx.createGain();
  sfxSend.gain.value = 0.18;
  soft.connect(sfxSend).connect(room);
  const musicSend = ctx.createGain();
  musicSend.gain.value = 0.4;
  music.connect(musicSend).connect(room);
  return { ctx, sfx, music, room };
}

/**
 * Контекст на 24 кГц: все тембры игры мягкие (выше 5 кГц ничего нет), а работы у звукового потока вдвое
 * меньше, чем на 48 кГц. Если браузер не умеет такую частоту - обычный контекст.
 */
function newContext(AC: typeof AudioContext): AudioContext {
  try {
    return new AC({ latencyHint: 'playback', sampleRate: 24000 });
  } catch {
    return new AC({ latencyHint: 'playback' });
  }
}

/** Общий граф игры. Контекст создаётся при первом звуке или первом нажатии (политика автозапуска браузеров). */
export function audio(): AudioGraph | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!graph) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      graph = buildGraph(newContext(AC));
      graph.sfx.gain.value = Math.max(0, getSettings().volume);
    }
    const c = graph.ctx as AudioContext;
    if (c.state === 'suspended' && pageVisible()) void c.resume().catch(() => undefined);
    return graph;
  } catch {
    return null;
  }
}

/** Граф, если он уже создан (не создаёт контекст). */
export function existingAudio(): AudioGraph | null {
  return graph;
}

/** Музыка сообщает, держит ли она контекст включённым; без неё контекст засыпает после звука. */
export function setKeepAwake(fn: () => boolean): void {
  keepAwake = fn;
}

/** Усыпить контекст, когда ничего не звучит: без звука браузер не тратит процессор на пустой поток. */
export function suspendWhenIdle(delayMs = 2500): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    const g = graph;
    if (!g) return;
    const c = g.ctx as AudioContext;
    if (c.state !== 'running' || keepAwake()) return;
    if (c.currentTime < busyUntil + 1.5) {
      suspendWhenIdle(1000);
      return;
    }
    void c.suspend().catch(() => undefined);
  }, delayMs);
}

/** Отметить, что контекст занят до момента t (для засыпания). */
export function markBusy(t: number): void {
  if (t > busyUntil) busyUntil = t;
}

interface Note {
  f: number; // частота, Гц
  t: number; // начало от момента запуска, с
  d: number; // длительность, с
  type?: 'sine' | 'triangle';
  v?: number; // громкость 0..1
  slide?: number; // частота в конце (глиссандо)
  a?: number; // атака, с (по умолчанию 10 мс)
}

/** Треугольник звучит громче синуса той же амплитуды (обертоны): выравниваем. */
const TYPE_GAIN = { sine: 1, triangle: 0.82 } as const;
const PEAK = 0.3;

function play(g: AudioGraph, notes: Note[], trim: number, when: number): number {
  const c = g.ctx;
  let end = when;
  for (const n of notes) {
    const osc = c.createOscillator();
    const env = c.createGain();
    const type = n.type ?? 'triangle';
    const t0 = when + n.t;
    const a = n.a ?? 0.01;
    osc.type = type;
    osc.frequency.setValueAtTime(n.f, t0);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, t0 + n.d);
    const v = (n.v ?? 0.5) * PEAK * TYPE_GAIN[type] * trim;
    // Плавная атака с нуля (без щелчка) и затухание до тишины к концу ноты.
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(v, t0 + a);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(n.d, a + 0.02));
    osc.connect(env).connect(g.sfx);
    osc.start(t0);
    osc.stop(t0 + n.d + 0.05);
    end = Math.max(end, t0 + n.d + 0.05);
  }
  return end;
}

// Ноты: C5 = 523,25 Гц.
const N = { C4: 261.63, D4: 293.66, F4: 349.23, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568 };

/** Ноты звуков. Хорошее - вверх и мажор, плохое - вниз и ниже; везде мягкий треугольник или синус. */
export const SOUNDS: Record<SoundId, () => Note[]> = {
  coin: () => [
    { f: N.B5, t: 0, d: 0.09, v: 0.5 },
    { f: N.E6, t: 0.07, d: 0.38, v: 0.5 },
  ],
  cash: () => [
    { f: N.C6, t: 0, d: 0.1, v: 0.42 },
    { f: N.E6, t: 0.06, d: 0.1, v: 0.42 },
    { f: N.G6, t: 0.12, d: 0.45, v: 0.42 },
    { f: N.C5, t: 0, d: 0.55, type: 'sine', v: 0.45 },
  ],
  spend: () => [
    { f: 330, t: 0, d: 0.2, v: 0.5, slide: 220 },
    { f: 196, t: 0.13, d: 0.32, type: 'sine', v: 0.6, slide: 147 },
  ],
  ready: () => [N.C5, N.E5, N.G5, N.C6].map((f, i) => ({ f, t: i * 0.08, d: 0.35, v: 0.45 })),
  release: () => [
    { f: N.G4, t: 0, d: 0.14, v: 0.45 },
    { f: N.C5, t: 0.12, d: 0.14, v: 0.45 },
    { f: N.E5, t: 0.24, d: 0.14, v: 0.45 },
    { f: N.G5, t: 0.36, d: 0.7, v: 0.5 },
    { f: N.C5, t: 0.36, d: 0.7, type: 'sine', v: 0.3 },
    { f: N.E5, t: 0.36, d: 0.7, type: 'sine', v: 0.3 },
  ],
  rankUp: () => [
    { f: N.E5, t: 0, d: 0.13, v: 0.45 },
    { f: N.A5, t: 0.1, d: 0.13, v: 0.45 },
    { f: N.C6, t: 0.2, d: 0.4, v: 0.45 },
  ],
  rankDown: () => [
    { f: N.A4, t: 0, d: 0.18, v: 0.5 },
    { f: N.F4, t: 0.15, d: 0.18, v: 0.5 },
    { f: N.D4, t: 0.3, d: 0.5, type: 'sine', v: 0.6, slide: 247 },
  ],
  first: () => [
    { f: N.C5, t: 0, d: 0.12, v: 0.4 },
    { f: N.C5, t: 0.12, d: 0.12, v: 0.4 },
    { f: N.C5, t: 0.24, d: 0.12, v: 0.4 },
    { f: N.G5, t: 0.36, d: 0.3, v: 0.42 },
    { f: N.E5, t: 0.66, d: 0.12, v: 0.4 },
    { f: N.C6, t: 0.8, d: 0.85, v: 0.45 },
    { f: N.C4, t: 0.8, d: 0.85, type: 'sine', v: 0.45 },
    { f: N.G4, t: 0.8, d: 0.85, type: 'sine', v: 0.35 },
  ],
  goal: () => [N.G5, N.C6, N.E6, N.G6].map((f, i) => ({ f, t: i * 0.06, d: 0.3, type: 'sine' as const, v: 0.5 })),
  research: () => [
    { f: N.E5, t: 0, d: 0.9, type: 'sine', v: 0.45 },
    { f: N.B5, t: 0.09, d: 0.9, type: 'sine', v: 0.3 },
  ],
  // Два мягких удара «динь-дон» вместо писка: важно, но не тревожная сирена
  alert: () => [
    { f: N.A5, t: 0, d: 0.32, type: 'sine', v: 0.55 },
    { f: N.A4, t: 0, d: 0.32, v: 0.25 },
    { f: N.E5, t: 0.18, d: 0.5, type: 'sine', v: 0.55 },
    { f: N.E5 / 2, t: 0.18, d: 0.5, v: 0.25 },
  ],
  // Глухой стук стойки и щелчок защёлки, затем ровный подъём - «карты включились»
  rack: () => [
    { f: 120, t: 0, d: 0.16, type: 'sine', v: 0.8, slide: 70, a: 0.004 },
    { f: 1760, t: 0.09, d: 0.035, v: 0.16, a: 0.002 },
    { f: N.C5, t: 0.16, d: 0.42, type: 'sine', v: 0.32, slide: N.G5 },
    { f: N.E5, t: 0.22, d: 0.4, type: 'sine', v: 0.22, slide: N.C6 },
  ],
};

/**
 * Поправка громкости каждого звука (множитель). Подобрана замером в OfflineAudioContext: громкость за самые
 * громкие 400 мс с приближённым К-взвешиванием (как в LUFS: ухо слышит высокие ноты громче низких).
 * До правки звуки расходились на 13 дБ (тише всех «место ниже» и «важное письмо», громче всех «цель»),
 * теперь все на одном уровне -27 дБ ±0,5; самый частый звук «оплата» на 1 дБ тише остальных.
 */
export const SFX_TRIM: Record<SoundId, number> = {
  coin: 1.55,
  cash: 1.08,
  spend: 1.27,
  ready: 1.27,
  release: 1,
  rankUp: 1.76,
  rankDown: 1.06,
  first: 0.79,
  goal: 0.76,
  research: 0.92,
  alert: 0.91,
  rack: 1.15,
};

/** Запланировать звук на графе (в том числе офлайн-графе для замеров). Возвращает время конца. */
export function scheduleSound(g: AudioGraph, id: SoundId, when: number): number {
  return play(g, SOUNDS[id](), SFX_TRIM[id], when);
}

/** Применить громкость звуков из настроек к уже созданному графу. */
export function applySfxVolume(): void {
  const g = graph;
  if (!g) return;
  g.sfx.gain.setTargetAtTime(Math.max(0, getSettings().volume), g.ctx.currentTime, 0.02);
}

/** Сыграть звук с громкостью из настроек; при громкости 0 и в скрытой вкладке молчим. */
/** Подписчики на звуки: визуальный отклик (feel.ts) играет в тот же момент, что и звук, и не зависит от громкости. */
const soundListeners = new Set<(id: SoundId) => void>();
export function onSound(l: (id: SoundId) => void): () => void {
  soundListeners.add(l);
  return () => soundListeners.delete(l);
}

export function playSound(id: SoundId): void {
  for (const l of soundListeners) l(id);
  const vol = getSettings().volume;
  if (!(vol > 0) || !pageVisible()) return;
  const nowMs = Date.now();
  if (nowMs - (lastPlayed.get(id) ?? 0) < MIN_GAP_MS) return;
  lastPlayed.set(id, nowMs);
  const g = audio();
  if (!g) return;
  g.sfx.gain.setValueAtTime(vol, g.ctx.currentTime);
  markBusy(scheduleSound(g, id, g.ctx.currentTime + 0.01));
  suspendWhenIdle();
}
