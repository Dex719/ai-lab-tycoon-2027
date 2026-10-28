// Подсказки к терминам при первом показе: одна строка в подсказке игры (title, см. Tooltip.tsx).
// glossFor берёт текст игрока и возвращает подсказки всех терминов, которые в нём есть. Границы слова - буквы
// Юникода, поэтому «Эло» не находится внутри «Эловый». Термины - слова игрока, имена бенчмарков берутся из BENCHMARKS.

import { BENCHMARKS } from '../data/benchmarks';

export interface Term {
  re: RegExp;
  tip: string;
}

/** Слово целиком: не внутри другого слова (границы - буквы Юникода). */
function word(w: string): RegExp {
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<!\\p{L})${esc}(?!\\p{L})`, 'u');
}

export const TERMS: Term[] = [
  { re: word('Эло'), tip: 'Эло - балл модели на «Арене»: чем выше, тем чаще люди выбирают её ответы.' },
  { re: word('H100e'), tip: 'H100e - единица мощности: столько считает одна карта H100.' },
  { re: /токен/iu, tip: 'Токен - кусочек текста, примерно слово. Клиенты платят за миллион токенов.' },
  { re: word('LSTM'), tip: 'LSTM - старая схема модели, до Трансформера: учится медленнее.' },
  { re: word('API'), tip: 'API - продажа доступа к модели разработчикам, оплата за токены.' },
  { re: /бенчмарк/iu, tip: 'Бенчмарк - общий тест, по которому сравнивают модели.' },
  { re: word('Законы масштабирования'), tip: 'Законы масштабирования - исследование: как размер модели и данные меняют её силу.' },
  ...BENCHMARKS.filter((b) => b.about).map((b) => ({ re: word(b.name), tip: b.about as string })),
];

/** Подсказки всех терминов, найденных в тексте, через пробел; undefined, если терминов нет. */
export function glossFor(text: string): string | undefined {
  const tips = TERMS.filter((t) => t.re.test(text)).map((t) => t.tip);
  return tips.length > 0 ? tips.join(' ') : undefined;
}
