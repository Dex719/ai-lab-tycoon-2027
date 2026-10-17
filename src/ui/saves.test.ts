// Ячейки сохранений: сведения из хранилища проверяются, прежде чем их нарисует меню.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newGame } from '../sim/actions';
import { latestSlot, listSlots, writeSlot } from './saves';

let mem: Record<string, string> = {};

beforeEach(() => {
  mem = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem[k] ?? null,
    setItem: (k: string, v: string) => {
      mem[k] = v;
    },
    removeItem: (k: string) => {
      delete mem[k];
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Записать партию в ячейку и подменить в её сведениях поля. */
function writeWithMeta(id: 1 | 2, patch: Record<string, unknown>): void {
  expect(writeSlot(id, newGame('Тест', 1))).toBe(true);
  const key = `ailab.slot.${id}`;
  const data = JSON.parse(mem[key]) as { meta: Record<string, unknown> };
  Object.assign(data.meta, patch);
  mem[key] = JSON.stringify(data);
}

describe('сведения ячейки', () => {
  it('неизвестная сложность (ячейка новой версии) читается как «Обычная», меню не падает', () => {
    writeWithMeta(1, { difficulty: 'nightmare' });
    const slot = listSlots().find((x) => x.id === 1)!;
    expect(slot.broken).toBe(false);
    expect(slot.meta?.difficulty).toBe('normal');
  });

  it('битые сведения - ячейка повреждена, а не белый экран', () => {
    writeWithMeta(1, { labName: 5 });
    writeWithMeta(2, { day: 'вчера' });
    const slots = listSlots();
    expect(slots.find((x) => x.id === 1)).toMatchObject({ meta: null, broken: true });
    expect(slots.find((x) => x.id === 2)).toMatchObject({ meta: null, broken: true });
    expect(latestSlot(slots)).toBeNull();
  });

  it('нормальная ячейка читается как раньше', () => {
    writeWithMeta(1, {});
    const slots = listSlots();
    expect(slots.find((x) => x.id === 1)?.meta?.labName).toBe('Тест');
    expect(latestSlot(slots)).toBe(1);
  });
});
