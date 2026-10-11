// Форматирование чисел по-русски: $1,2 млн, 43,9 %, 1,2·10²⁵.

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
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a < 999.5) return `${sign}$${dec(a, 0)}`;
  if (a < 999_500) return `${sign}$${dec(a / 1e3, a < 1e4 ? 1 : 0)} тыс.`;
  if (a < 999_500_000) return `${sign}$${dec(a / 1e6, a < 1e8 ? 1 : 0)} млн`;
  if (a < 999_500_000_000) return `${sign}$${dec(a / 1e9, a < 1e11 ? 1 : 0)} млрд`;
  return `${sign}$${dec(a / 1e12, 1)} трлн`;
}

/** Цена за 1М токенов: $0,25, $2,5, $60 */
export function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `$${dec(n, n < 1 ? 3 : n < 10 ? 2 : 0)}`;
}

/** value в процентах (43.9 → «43,9 %») */
export function fmtPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${dec(value, digits)} %`;
}

/** доля 0..1 → «12,5 %» */
export function fmtShare(fraction: number, digits = 1): string {
  return fmtPct(fraction * 100, digits);
}

/** 1 234 567 → «1,2 млн»; маленькие — целиком с пробелами */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a < 1e4) return sign + dec(a, a < 10 ? 2 : 0);
  if (a < 999_950) return `${sign}${dec(a / 1e3, 1)} тыс.`;
  if (a < 999_950_000) return `${sign}${dec(a / 1e6, 1)} млн`;
  if (a < 999_950_000_000) return `${sign}${dec(a / 1e9, 1)} млрд`;
  return `${sign}${dec(a / 1e12, 1)} трлн`;
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };

/** 1.2e25 → «1,2·10²⁵» */
export function fmtSci(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  let e = Math.floor(Math.log10(n));
  let m = n / 10 ** e;
  if (Number(m.toFixed(1)) >= 10) {
    // 9,96·10²⁵ округляется до 10,0 — переносим в следующий порядок
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

/** Токены в млрд — как параметры. */
export const fmtTokens = fmtParams;

export function fmtElo(elo: number): string {
  return Number.isFinite(elo) ? String(Math.round(elo)) : '—';
}
