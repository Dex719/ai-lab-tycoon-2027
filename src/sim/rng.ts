// Детерминированный генератор mulberry32. Его состояние живёт в state.rng и попадает в сохранения.

/** Следующее число в [0, 1); продвигает state.rng. */
export function nextRandom(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Целое в [a, b] включительно. */
export function randInt(s: { rng: number }, a: number, b: number): number {
  return a + Math.floor(nextRandom(s) * (b - a + 1));
}

/** Вещественное в [a, b). */
export function randRange(s: { rng: number }, a: number, b: number): number {
  return a + nextRandom(s) * (b - a);
}

export function pick<T>(s: { rng: number }, arr: readonly T[]): T {
  return arr[Math.floor(nextRandom(s) * arr.length)];
}

export function chance(s: { rng: number }, p: number): boolean {
  return nextRandom(s) < p;
}
