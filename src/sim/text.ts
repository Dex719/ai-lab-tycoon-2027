// Мелкие помощники для текстов писем и сообщений об ошибках.

/** Ставит точку в конце предложения, если её там ещё нет: после «$350 тыс.» вторая точка не нужна. */
export function endSentence(text: string): string {
  return text.endsWith('.') ? text : `${text}.`;
}

// ---------- Склонения: одно место для всей игры ----------

/** Форма слова по числу: ruPlural(1, 'карта', 'карты', 'карт') → «карта», 3 → «карты», 5 и 11 → «карт», 21 → «карта». */
export function ruPlural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n));
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** «очко / очка / очков» по числу. */
export function pointsWord(n: number): string {
  return ruPlural(n, 'очко', 'очка', 'очков');
}

/** «1 день», «3 дня», «45 дней». */
export function daysWord(n: number): string {
  return `${n} ${ruPlural(n, 'день', 'дня', 'дней')}`;
}

/** «письмо / письма / писем» по числу. */
export function lettersWord(n: number): string {
  return ruPlural(n, 'письмо', 'письма', 'писем');
}

/** «токен / токена / токенов»; числа от 1000 в игре пишут с «тыс.» и «млн», после них - «токенов». */
export function tokensWord(n: number): string {
  return n >= 1000 ? 'токенов' : ruPlural(n, 'токен', 'токена', 'токенов');
}

/** «в 1,6 раза», «в 4 раза», «в 5 раз»: после дробного числа всегда «раза». */
export function timesWord(x: number): string {
  const r = Math.round(x * 10) / 10;
  const text = String(r).replace('.', ',');
  return `в ${text} ${Number.isInteger(r) ? ruPlural(r, 'раз', 'раза', 'раз') : 'раза'}`;
}
