// Тесты мелких помощников для текстов.

import { describe, expect, it } from 'vitest';
import { endSentence } from './text';

describe('endSentence', () => {
  it('добавляет точку, если её нет', () => {
    expect(endSentence('$1,2 млн')).toBe('$1,2 млн.');
    expect(endSentence('$800')).toBe('$800.');
    expect(endSentence('-$250 млрд')).toBe('-$250 млрд.');
  });

  it('не удваивает точку после сокращения «тыс.»', () => {
    expect(endSentence('$350 тыс.')).toBe('$350 тыс.');
    expect(endSentence('на счету -$12 тыс.')).toBe('на счету -$12 тыс.');
  });

  it('пустая строка получает точку, текст с точкой в середине - тоже', () => {
    expect(endSentence('')).toBe('.');
    expect(endSentence('1. Один')).toBe('1. Один.');
  });
});
