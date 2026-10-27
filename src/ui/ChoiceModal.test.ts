import { describe, expect, it } from 'vitest';
import { costlyChoice } from './ChoiceModal';

describe('costlyChoice: вариант письма с потерей идёт через подтверждение', () => {
  it('потеря денег, доли или репутации - да', () => {
    expect(costlyChoice('-$100 тыс., +2 репутации')).toBe(true);
    expect(costlyChoice('−1 п.п. доли основателя')).toBe(true);
    expect(costlyChoice('-3 репутации')).toBe(true);
    // Потеря внутри части, а не в начале: «репутация -3» в письме совета.
    expect(costlyChoice('доверие совета 80, шумиха +8, репутация -3')).toBe(true);
  });

  it('только выгоды или без изменений - нет', () => {
    expect(costlyChoice('+2 репутации')).toBe(false);
    expect(costlyChoice('+15 шумихи, если выпущена модель с RLHF')).toBe(false);
    expect(costlyChoice('без изменений')).toBe(false);
    expect(costlyChoice('аренда дешевле на 15 % на 365 дней')).toBe(false);
  });
});
