// Словарь «игровое название -> настоящее». Нужен только для показа (настройка «Оригинальные названия»):
// симуляция и сохранения всегда хранят игровые названия.
// Подстановка идёт по словам: записи - это целые названия или их части (так «DeepSeak-V2 Lito» превращается
// в «DeepSeek-V2 Lite», а «GTP-4o Mino» - в «GPT-4o mini», без отдельной записи на каждую производную модель).
// Слово считается целым, если перед ним нет латинской буквы или цифры, а после него нет латинской буквы,
// поэтому русский текст и посторонние слова не затрагиваются.

/** Пары [игровое название, настоящее]. Порядок не важен: при сборке они сортируются по длине, длинные первыми. */
export const REAL_NAME_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Лаборатории
  ['Gogle DeepMynd', 'Google DeepMind'],
  ['DeepMynd', 'DeepMind'],
  ['Gogle', 'Google'],
  ['OpenBrain', 'OpenAI'],
  ['Antropik', 'Anthropic'],
  ['Zhipo', 'Zhipu AI'],
  ['Moonshoot AI', 'Moonshot AI'],
  ['Moonshoot', 'Moonshot AI'],
  ['moonshoot', 'moonshot'],
  ['DeepCent', 'DeepSeek'],
  ['Alibabo', 'Alibaba'],

  // Поставщик ускорителей
  ['Fermi Systems', 'NVIDIA'],
  ['Fermi', 'NVIDIA'],

  // Бенчмарки
  ['SQuAT', 'SQuAD'],
  ['GLUU', 'GLUE'],
  ['MMLO', 'MMLU'],
  ['HumanEvol', 'HumanEval'],
  ['GSM8C', 'GSM8K'],
  ['SWE-banch', 'SWE-bench'],
  ['GPQE', 'GPQA'],

  // Семейства моделей и их части
  ['Tixt-Davanci', 'text-davinci'],
  ['InstructGTP', 'InstructGPT'],
  ['ChatGTP', 'ChatGPT'],
  ['GTP', 'GPT'],
  ['Davanci', 'davinci'],
  ['Turbu', 'Turbo'],
  ['Clade', 'Claude'],
  ['Opos', 'Opus'],
  ['Sonet', 'Sonnet'],
  ['Haiko', 'Haiku'],
  ['Gemeni', 'Gemini'],
  ['Ultro', 'Ultra'],
  ['Flesh', 'Flash'],
  ['Gemmo', 'Gemma'],
  ['PaLN', 'PaLM'],
  ['LaMBA', 'LaMDA'],
  ['BORT', 'BERT'],
  ['T5x', 'T5'],
  ['Meeno', 'Meena'],
  ['Gopler', 'Gopher'],
  ['Chinchella', 'Chinchilla'],
  ['KodeGeeX', 'CodeGeeX'],
  ['Kodex', 'Codex'],
  ['Berd', 'Bard'],
  ['ChatGML', 'ChatGLM'],
  ['GML', 'GLM'],
  ['Plos', 'Plus'],
  ['Aer', 'Air'],
  ['Zeru', 'Zero'],
  ['Qwin', 'Qwen'],
  ['QwK', 'QwQ'],
  ['Kimo', 'Kimi'],
  ['maths', 'math'],
  ['DeepSeak', 'DeepSeek'],
  ['Lito', 'Lite'],
  ['Previow', 'Preview'],
  ['Mino', 'mini'],
  ['q1', 'o1'],

  // Исторические события (data/historyEvents.ts)
  ['AlfaGo', 'AlphaGo'],
  ['AlfaFold', 'AlphaFold'],
  ['LLaMo', 'LLaMA'],
  ['Soru', 'Sora'],
  ['DALL-I', 'DALL-E'],
  ['Stabil Diffuzion', 'Stable Diffusion'],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAP = new Map(REAL_NAME_PAIRS);
const PATTERN = new RegExp(
  '(?<![A-Za-z0-9])(' +
    [...MAP.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRe)
      .join('|') +
    ')(?![A-Za-z])',
  'g',
);

/** Заменяет игровые названия в тексте на настоящие. Повторное применение ничего не меняет. */
export function toRealNames(text: string): string {
  if (!text) return text;
  return text.replace(PATTERN, (m) => MAP.get(m) ?? m);
}
