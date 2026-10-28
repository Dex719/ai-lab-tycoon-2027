// Форматирование чисел по-русски: $1,2 млн, 43,9 %, 1,2·10²⁵.

import { GPUS } from '../data/gpus';
import { availableGpus } from '../sim/compute';
import { ruPlural } from '../sim/text';
import type { GameState } from '../sim/types';

// Форматтеры создаются один раз на число знаков: toLocaleString с параметрами строит новый на каждый вызов,
// а таблицы окон печатают сотни чисел за кадр.
const formatters = new Map<number, Intl.NumberFormat>();

function dec(n: number, digits: number): string {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits });
    formatters.set(digits, f);
  }
  return f.format(n);
}

// Границы единиц чуть ниже круглых чисел: значение, которое округлится до «1000» в своей единице,
// сразу переходит в следующую («$999,6 тыс.» → «$1 млн», а не «$1 000 тыс.»).

/** $950, $12 тыс., $1,2 млн, $3,4 млрд, $1,1 трлн */
export function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a < 999.5) return `${sign}$${dec(a, 0)}`;
  if (a < 999_500) return `${sign}$${dec(a / 1e3, a < 1e4 ? 1 : 0)} тыс.`;
  if (a < 999_500_000) return `${sign}$${dec(a / 1e6, a < 1e8 ? 1 : 0)} млн`;
  if (a < 999_500_000_000) return `${sign}$${dec(a / 1e9, a < 1e11 ? 1 : 0)} млрд`;
  return `${sign}$${dec(a / 1e12, 1)} трлн`;
}

/** Знаков после запятой у цены за 1М токенов: до $1 - три, до $10 - два, дальше целые. */
export function priceDigits(n: number): number {
  return n < 1 ? 3 : n < 10 ? 2 : 0;
}

/** Цена за 1М токенов: $0,25, $2,5, $60 */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return `$${dec(n, priceDigits(n))}`;
}

/** value в процентах (43.9 → «43,9 %») */
export function fmtPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '-';
  return `${dec(value, digits)} %`;
}

/** доля 0..1 → «12,5 %» */
export function fmtShare(fraction: number, digits = 1): string {
  return fmtPct(fraction * 100, digits);
}

/** 1 234 567 → «1,2 млн»; маленькие - целиком с пробелами */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a < 1e4) return sign + dec(a, a < 10 ? 2 : 0);
  if (a < 999_950) return `${sign}${dec(a / 1e3, 1)} тыс.`;
  if (a < 999_950_000) return `${sign}${dec(a / 1e6, 1)} млн`;
  if (a < 999_950_000_000) return `${sign}${dec(a / 1e9, 1)} млрд`;
  return `${sign}${dec(a / 1e12, 1)} трлн`;
}

/** Множитель без потери точности: 1,25 → «1,25», 14,55 → «14,6», 120 → «120». */
/** Целое число полностью, с разрядами: «1 024», «32 768». */
export function fmtInt(n: number): string {
  return Number.isFinite(n) ? dec(Math.round(n), 0) : '-';
}

export function fmtMult(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  return dec(n, a < 10 ? 2 : a < 100 ? 1 : 0);
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

/** 1.2e25 → «1,2·10²⁵» */
export function fmtSci(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  let e = Math.floor(Math.log10(n));
  let m = n / 10 ** e;
  if (Number(m.toFixed(1)) >= 10) {
    // 9,96·10²⁵ округляется до 10,0 - переносим в следующий порядок
    m /= 10;
    e += 1;
  }
  const exp = String(e).split('').map((c) => SUP[c] ?? c).join('');
  return `${dec(m, 1)}·10${exp}`;
}

/** Параметры в млрд: 0.117 → «117 млн», 175 → «175 млрд», 1500 → «1,5 трлн» */
export function fmtParams(paramsB: number): string {
  if (paramsB < 0.9995) return `${dec(paramsB * 1000, 0)} млн`;
  if (paramsB < 999.5) return `${dec(paramsB, paramsB < 10 ? 1 : 0)} млрд`;
  return `${dec(paramsB / 1000, 1)} трлн`;
}

/** Токены в млрд - как параметры. */
export const fmtTokens = fmtParams;

/** Точка в конце предложения, если значение (например, «$57 тыс.») уже закончилось точкой. */
export function endSentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

/** Эло целым с разрядами, как везде в игре: «987», «1 354». */
export function fmtElo(elo: number): string {
  return Number.isFinite(elo) ? dec(Math.round(elo), 0) : '-';
}

export { ruPlural };

/** «1 день», «3 дня», «45 дней». */
export function fmtDays(n: number): string {
  return `${dec(n, 0)} ${ruPlural(n, 'день', 'дня', 'дней')}`;
}

// Мощность одной карты - доли H100e (0,021), у всей аренды - десятки и тысячи: знаков нужно по-разному.
const H_FORMATS = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d }));

/** Мощность в H100e без единицы: «0,021», «2,03», «45,6», «1 234», «12 тыс.» */
export function fmtH100e(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e4) return fmtNum(n);
  const digits = n < 1 ? 3 : n < 10 ? 2 : n < 1000 ? 1 : 0;
  return H_FORMATS[digits].format(n);
}

/** Подпись числа карт: «≈ 17 карт», «≈ 1 карта», «≈ 3 карты», «≈ 12,5 тыс. карт»; ноль - «0 карт», меньше половины карты - «< 1 карты». */
export function cardsLabel(cards: number): string {
  if (!Number.isFinite(cards) || cards <= 0) return '0 карт';
  if (cards < 0.5) return '< 1 карты';
  const n = Math.round(cards);
  if (n >= 10_000) return `≈ ${fmtNum(n)} карт`;
  return `≈ ${dec(n, 0)} ${ruPlural(n, 'карта', 'карты', 'карт')}`;
}

/**
 * Мощность одной карты в H100e для пересчёта в число карт: средняя по арендованному набору;
 * если ничего не арендовано - лучшая из карт, доступных в этот день.
 */
export function h100ePerCard(s: GameState): number {
  let cards = 0;
  let h100e = 0;
  for (const g of GPUS) {
    const n = s.compute.rented[g.id];
    if (n > 0) {
      cards += n;
      h100e += n * g.h100e;
    }
  }
  if (cards > 0) return h100e / cards;
  const best = availableGpus(s).reduce((m, g) => Math.max(m, g.h100e), 0);
  return best > 0 ? best : GPUS[0].h100e;
}

/** Сколько карт даёт мощность h100e при текущей аренде: «≈ 17 карт». */
export function fmtCards(s: GameState, h100e: number): string {
  return cardsLabel(h100e / h100ePerCard(s));
}
