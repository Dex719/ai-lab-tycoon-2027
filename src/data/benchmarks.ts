// Бенчмарки среза. Названия отличаются от реальных на 1-2 буквы.
// difficulty/spread подогнаны под опоры из design.md («Бенчмарки»); даты - по research/catalog/meta.json.

import type { BenchmarkDef } from '../sim/types';

export const BENCHMARKS: BenchmarkDef[] = [
  // SQuAT: при нулевой способности 50 % (логистическая регрессия 2016 года давала F1 51 %), 91 % - со способности ≈ 49.
  // Так первая LSTM игрока (способность ≈ 28, 2017 год) не насыщает бенчмарк; насыщает BORT (91,8 %) в ноябре 2018-го.
  {
    id: 'squad', name: 'SQuAT', realName: 'SQuAD 1.1', domain: 'language', introduced: '2016-06-16',
    guess: 0, difficulty: 0, spread: 21, saturation: 91,
    description: 'Ответы на вопросы по прочитанному тексту (F1).',
  },
  {
    id: 'glue', name: 'GLUU', realName: 'GLUE', domain: 'language', introduced: '2018-04-20',
    guess: 0.5, difficulty: 21.5, spread: 17, saturation: 90,
    description: 'Набор из девяти задач на понимание языка.',
  },
  {
    id: 'mmlu', name: 'MMLO', realName: 'MMLU', domain: 'language', introduced: '2020-09-07',
    guess: 0.25, difficulty: 62, spread: 11.3, saturation: 90,
    description: 'Знания по 57 предметам, тест с четырьмя вариантами ответа.',
  },
  {
    id: 'humaneval', name: 'HumanEvol', realName: 'HumanEval', domain: 'code', introduced: '2021-07-07',
    guess: 0, difficulty: 73.4, spread: 5.2, saturation: 90,
    description: '164 задачи на Python: доля решений, прошедших тесты с первой попытки.',
  },
  {
    id: 'gsm8k', name: 'GSM8C', realName: 'GSM8K', domain: 'reasoning', introduced: '2021-10-27',
    guess: 0, difficulty: 64.6, spread: 5.1, saturation: 95,
    description: 'Школьные текстовые задачи по математике.',
  },
  {
    // Дата - выход исходного SWE-bench (10.10.2023); подмножество Verified вышло только в августе 2024 года.
    id: 'swebench', name: 'SWE-banch', realName: 'SWE-bench', domain: 'code', introduced: '2023-10-10',
    guess: 0, difficulty: 85.2, spread: 2.1, saturation: 75,
    description: 'Реальные задачи из GitHub: исправление ошибок в чужих репозиториях.',
  },
  {
    id: 'gpqa', name: 'GPQE', realName: 'GPQA Diamond', domain: 'reasoning', introduced: '2023-11-20',
    guess: 0.25, difficulty: 84.3, spread: 4.1, saturation: 80,
    description: 'Вопросы уровня аспирантуры по физике, химии и биологии.',
  },
];
