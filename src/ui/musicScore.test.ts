import { describe, expect, it } from 'vitest';
import { CALM, MELODY_HIGH, MELODY_LOW, moodFor, nextMelodyNote, pickChord, scaleNotes, TENSE, voicing } from './musicScore';

/** Повторяемый генератор для тестов (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('настроение музыки', () => {
  const at = (year: number, extra: Partial<Parameters<typeof moodFor>[0]> = {}) =>
    moodFor({ inGame: true, year, finale: false, paused: false, ...extra });

  it('2017 - тише и проще, к 2024 - плотнее', () => {
    const early = at(2017);
    const late = at(2024);
    expect(early.density).toBe(0);
    expect(late.density).toBe(1);
    expect(late.voices).toBeGreaterThan(early.voices);
    expect(late.level).toBeGreaterThan(early.level);
    expect(late.noteGap).toBeLessThan(early.noteGap);
    expect(early.bass).toBe(false);
    expect(late.bass).toBe(true);
    expect(early.arpChance).toBe(0);
    expect(late.arpChance).toBeGreaterThan(0);
    // плотность растёт по годам без скачков назад
    for (let y = 2017; y < 2024; y++) expect(at(y + 1).density).toBeGreaterThanOrEqual(at(y).density);
  });

  it('финальный квартал - напряжённее: тёмные аккорды, пульс, быстрее смена', () => {
    const m = at(2024, { finale: true });
    expect(m.tension).toBe(true);
    expect(m.pulse).toBe(true);
    expect(m.chordLen[1]).toBeLessThan(at(2024).chordLen[1]);
  });

  it('на паузе тише и реже, без пульса и перебора', () => {
    const m = at(2024, { finale: true, paused: true });
    expect(m.level).toBeLessThan(at(2024).level);
    expect(m.pulse).toBe(false);
    expect(m.arpChance).toBe(0);
    expect(m.noteGap).toBeGreaterThan(at(2024, { finale: true }).noteGap);
  });

  it('главное меню - самое тихое и простое', () => {
    const m = moodFor({ inGame: false, year: 2030, finale: true, paused: true });
    expect(m.density).toBe(0);
    expect(m.tension).toBe(false);
    expect(m.level).toBeLessThan(1);
  });
});

describe('аккорды и ноты', () => {
  it('аккорд не повторяет ни один из двух последних', () => {
    const r = rng(7);
    const hist: number[] = [];
    for (let i = 0; i < 500; i++) {
      const c = pickChord(r, CALM.length, hist);
      expect(hist.slice(-2)).not.toContain(c);
      hist.push(c);
    }
    // за 500 смен звучат все аккорды набора
    expect(new Set(hist).size).toBe(CALM.length);
  });

  it('последовательность аккордов не зацикливается', () => {
    const r = rng(11);
    const hist: number[] = [];
    for (let i = 0; i < 64; i++) hist.push(pickChord(r, TENSE.length, hist));
    const first = hist.slice(0, 8).join();
    const repeats = [8, 16, 24, 32, 40, 48, 56].filter((s) => hist.slice(s, s + 8).join() === first);
    expect(repeats.length).toBe(0);
  });

  it('голоса аккорда в разумном диапазоне', () => {
    const r = rng(3);
    for (const c of [...CALM, ...TENSE]) {
      for (const n of [3, 4, 5]) {
        const v = voicing(c, n, r);
        expect(v.length).toBe(n);
        for (const m of v) expect(m >= 38 && m <= 74).toBe(true);
      }
    }
  });

  it('мелодия идёт по ладу, без повторов одной ноты и без выхода из диапазона', () => {
    const r = rng(5);
    for (const c of [...CALM, ...TENSE]) {
      const allowed = new Set(scaleNotes(c.scale));
      let m = 72;
      for (let i = 0; i < 200; i++) {
        const next = nextMelodyNote(r, m, c);
        expect(next).not.toBe(m);
        expect(allowed.has(next)).toBe(true);
        expect(next >= MELODY_LOW && next <= MELODY_HIGH).toBe(true);
        expect(Math.abs(next - m)).toBeLessThanOrEqual(12);
        m = next;
      }
    }
  });

  it('ни одна нота мелодии не стоит в полутоне от звука аккорда (нет фальши)', () => {
    for (const c of [...CALM, ...TENSE]) {
      const pcs = new Set(c.notes.map((m) => m % 12));
      for (const pc of c.scale) {
        if (pcs.has(pc)) continue;
        expect(pcs.has((pc + 1) % 12) || pcs.has((pc + 11) % 12), `${c.name}: ${pc}`).toBe(false);
      }
    }
  });
});
