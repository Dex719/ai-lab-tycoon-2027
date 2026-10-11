// Тесты бенчмарков (TSK-005): формула балла, обратная формула, появление по датам.

import { describe, expect, it, vi } from 'vitest';
import { BENCHMARKS } from '../data/benchmarks';
import { activeBenchmarks, benchDef, benchScore, capFromScore, introduceDue, introducedBenchmarks } from './benchmarks';
import { createInitialState } from './state';
import { dateToDay } from './time';
import type { GameState, Mail } from './types';
import { BENCHMARK_IDS } from './types';

// Почту подменяем простой копией, чтобы не тянуть данные событий.
vi.mock('./events', () => ({
  addMail: (s: GameState, m: Omit<Mail, 'id' | 'day' | 'read'>) => {
    const mail = { id: `m${s.nextMailNum++}`, day: s.day, read: false, ...m } as Mail;
    s.mail.push(mail);
    return mail;
  },
}));

function newState(day = 0): GameState {
  const s = createInitialState('Тест', 1);
  s.day = day;
  return s;
}

describe('benchDef', () => {
  it('возвращает описание из данных', () => {
    for (const b of BENCHMARKS) expect(benchDef(b.id)).toBe(b);
  });
  it('на неизвестный id бросает ошибку', () => {
    expect(() => benchDef('nope' as never)).toThrow();
  });
});

describe('benchScore', () => {
  it('при способности = сложности даёт середину между угадыванием и 100 %', () => {
    for (const b of BENCHMARKS) {
      expect(benchScore(b.id, b.difficulty)).toBeCloseTo(100 * (b.guess + (1 - b.guess) / 2), 6);
    }
  });

  it('растёт со способностью и остаётся между угадыванием и 100 %', () => {
    for (const b of BENCHMARKS) {
      let prev = -1;
      for (let cap = b.difficulty - 60; cap <= b.difficulty + 60; cap += 5) {
        const v = benchScore(b.id, cap);
        expect(v).toBeGreaterThan(prev);
        expect(v).toBeGreaterThanOrEqual(b.guess * 100);
        expect(v).toBeLessThanOrEqual(100);
        prev = v;
      }
    }
  });

  it('подгонка работает как прибавка к способности', () => {
    expect(benchScore('mmlu', 50, 10)).toBeCloseTo(benchScore('mmlu', 60), 9);
    expect(benchScore('mmlu', 50, 0)).toBeCloseTo(benchScore('mmlu', 50), 9);
    expect(benchScore('humaneval', 40, 12)).toBeGreaterThan(benchScore('humaneval', 40));
  });
});

describe('capFromScore', () => {
  it('обращает benchScore в рабочем диапазоне', () => {
    for (const b of BENCHMARKS) {
      for (const k of [-1.5, -1, 0, 1, 1.5]) {
        const cap = b.difficulty + k * b.spread;
        expect(capFromScore(b.id, benchScore(b.id, cap))).toBeCloseTo(cap, 6);
      }
    }
  });

  it('держит результат в пределах Dif ± 40 даже на крайних баллах', () => {
    for (const b of BENCHMARKS) {
      for (const score of [-10, 0, b.guess * 100, 100, 150]) {
        const cap = capFromScore(b.id, score);
        expect(Number.isFinite(cap)).toBe(true);
        expect(cap).toBeGreaterThanOrEqual(b.difficulty - 40);
        expect(cap).toBeLessThanOrEqual(b.difficulty + 40);
      }
    }
  });

  it('монотонна по баллу', () => {
    expect(capFromScore('mmlu', 80)).toBeGreaterThan(capFromScore('mmlu', 60));
    expect(capFromScore('gsm8k', 50)).toBeGreaterThan(capFromScore('gsm8k', 10));
  });

  it('реальные баллы дают правдоподобные способности', () => {
    // GPT-3 на MMLU около 44 %, GPT-4 около 86 %.
    expect(capFromScore('mmlu', 44)).toBeGreaterThan(45);
    expect(capFromScore('mmlu', 44)).toBeLessThan(55);
    expect(capFromScore('mmlu', 86.4)).toBeGreaterThan(75);
    expect(capFromScore('mmlu', 86.4)).toBeLessThan(83);
  });
});

describe('introducedBenchmarks / activeBenchmarks', () => {
  it('различают вышедшие и насыщенные', () => {
    const s = newState();
    expect(introducedBenchmarks(s)).toEqual([]);
    s.benchmarks.squad.introduced = true;
    s.benchmarks.glue.introduced = true;
    s.benchmarks.glue.saturated = true;
    expect(introducedBenchmarks(s)).toEqual(['squad', 'glue']);
    expect(activeBenchmarks(s)).toEqual(['squad']);
  });

  it('идут по порядку данных', () => {
    const s = newState();
    for (const id of BENCHMARK_IDS) s.benchmarks[id].introduced = true;
    expect(introducedBenchmarks(s)).toEqual(BENCHMARKS.map((b) => b.id));
  });
});

describe('introduceDue', () => {
  it('в первый день вводит только бенчмарки до 2017 года и пишет письмо', () => {
    const s = newState(0);
    introduceDue(s);
    expect(introducedBenchmarks(s)).toEqual(['squad']);
    expect(s.mail).toHaveLength(1);
    expect(s.mail[0].kind).toBe('benchmark');
    expect(s.mail[0].title).toBe('Новый бенчмарк: SQuAT');
  });

  it('не повторяет письмо для уже вышедших', () => {
    const s = newState(0);
    introduceDue(s);
    introduceDue(s);
    expect(s.mail).toHaveLength(1);
  });

  it('вводит бенчмарк ровно в его дату', () => {
    const s = newState(0);
    introduceDue(s);
    s.day = dateToDay('2018-04-19');
    introduceDue(s);
    expect(s.benchmarks.glue.introduced).toBe(false);
    s.day = dateToDay('2018-04-20');
    introduceDue(s);
    expect(s.benchmarks.glue.introduced).toBe(true);
    expect(s.mail.map((m) => m.title)).toContain('Новый бенчмарк: GLUU');
  });

  it('в письме есть описание и область по-русски, но нет настоящего названия', () => {
    const s = newState(dateToDay('2024-12-31'));
    introduceDue(s);
    expect(s.mail).toHaveLength(BENCHMARKS.length);
    const domainRu = { language: 'Язык', code: 'Код', reasoning: 'Рассуждения' };
    for (const def of BENCHMARKS) {
      const mail = s.mail.find((m) => m.title === `Новый бенчмарк: ${def.name}`);
      expect(mail).toBeDefined();
      expect(mail!.body).toContain(def.description);
      expect(mail!.body).toContain(domainRu[def.domain].toLowerCase());
      expect(mail!.body).not.toContain(def.realName);
      expect(mail!.title).not.toContain(def.realName);
    }
  });

  it('догоняет пропущенные бенчмарки, если день уже далеко', () => {
    const s = newState(dateToDay('2021-12-01'));
    introduceDue(s);
    expect(introducedBenchmarks(s)).toEqual(['squad', 'glue', 'mmlu', 'humaneval', 'gsm8k']);
    expect(s.benchmarks.gpqa.introduced).toBe(false);
  });

  it('не снимает насыщение', () => {
    const s = newState(0);
    s.benchmarks.squad.introduced = true;
    s.benchmarks.squad.saturated = true;
    introduceDue(s);
    expect(s.benchmarks.squad.saturated).toBe(true);
    expect(s.mail).toHaveLength(0);
  });
});

describe('числовые контрольные значения', () => {
  it('benchScore даёт ожидаемые баллы в характерных точках', () => {
    // σ(ln 3) = 0,75: на HumanEvol (g = 0) это 75 %, на MMLO (g = 0,25) это 25 + 75 × 0,75 = 81,25 %
    expect(benchScore('humaneval', 73.4 + 5.2 * Math.log(3))).toBeCloseTo(75, 6);
    expect(benchScore('mmlu', 62 + 11.3 * Math.log(3))).toBeCloseTo(81.25, 6);
    // SQuAT: на способности −30 ровно половина
    expect(benchScore('squad', -30)).toBeCloseTo(50, 9);
    // GSM8C: на четверть ниже середины
    expect(benchScore('gsm8k', 64.6 - 5.1 * Math.log(3))).toBeCloseTo(25, 6);
    // очень слабая модель на GPQE не опускается ниже угадывания (25 %)
    expect(benchScore('gpqa', -100)).toBeCloseTo(25, 6);
    // очень сильная модель упирается в 100 %
    expect(benchScore('swebench', 300)).toBeCloseTo(100, 6);
  });

  it('capFromScore даёт ожидаемую способность в характерных точках', () => {
    expect(capFromScore('humaneval', 75)).toBeCloseTo(73.4 + 5.2 * Math.log(3), 6);
    expect(capFromScore('mmlu', 81.25)).toBeCloseTo(62 + 11.3 * Math.log(3), 6);
    expect(capFromScore('squad', 50)).toBeCloseTo(-30, 9);
    // балл на уровне угадывания и ниже не даёт бесконечность
    expect(Number.isFinite(capFromScore('gpqa', 25))).toBe(true);
    expect(Number.isFinite(capFromScore('gpqa', 0))).toBe(true);
  });

  it('подгонка прибавляет к способности, а не к баллу: сдвиг в пунктах зависит от места на кривой', () => {
    // В середине кривой подгонка даёт больший прирост балла, чем у самого края
    const mid = benchScore('humaneval', 73.4, 5) - benchScore('humaneval', 73.4);
    const edge = benchScore('humaneval', 40, 5) - benchScore('humaneval', 40);
    expect(mid).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(0);
  });
});

describe('данные бенчмарков согласованы с реальными баллами моделей', () => {
  // Если сложности бенчмарков подогнаны верно, один и тот же настоящий уровень модели
  // по разным бенчмаркам даёт близкую способность (разброс не больше нескольких очков).
  const spread = (scores: Record<string, number>): number => {
    const caps = Object.entries(scores).map(([id, v]) => capFromScore(id as never, v));
    return Math.max(...caps) - Math.min(...caps);
  };

  it('GPT-4-подобная модель: MMLU 86,4 %, HumanEval 67 %, GSM8K 92 %', () => {
    expect(spread({ mmlu: 86.4, humaneval: 67, gsm8k: 92 })).toBeLessThan(3);
  });

  it('GPT-4o-подобная модель: баллы по всем пяти активным бенчмаркам', () => {
    expect(spread({ mmlu: 88.7, humaneval: 90.2, gsm8k: 96.1, gpqa: 53.6, swebench: 33.2 })).toBeLessThan(5);
  });

  it('GPT-3-подобная модель: MMLU 43,9 % даёт способность около 50', () => {
    const cap = capFromScore('mmlu', 43.9);
    expect(cap).toBeGreaterThan(48);
    expect(cap).toBeLessThan(52);
  });

  it('у данных нет дублей id и порядок совпадает с хронологией', () => {
    expect(new Set(BENCHMARKS.map((b) => b.id)).size).toBe(BENCHMARKS.length);
    const days = BENCHMARKS.map((b) => dateToDay(b.introduced));
    expect(days).toEqual([...days].sort((a, b) => a - b));
    for (const b of BENCHMARKS) {
      expect(b.spread).toBeGreaterThan(0);
      expect(b.guess).toBeGreaterThanOrEqual(0);
      expect(b.guess).toBeLessThan(1);
      expect(b.saturation).toBeGreaterThan(b.guess * 100);
      expect(b.saturation).toBeLessThanOrEqual(100);
    }
  });
});

describe('introduceDue: письмо', () => {
  it('письмо непрочитанное, датировано сегодняшним днём и без выбора', () => {
    const s = newState(dateToDay('2018-04-20'));
    s.benchmarks.squad.introduced = true;
    introduceDue(s);
    expect(s.mail).toHaveLength(1);
    const m = s.mail[0];
    expect(m.day).toBe(s.day);
    expect(m.read).toBe(false);
    expect(m.choices).toBeUndefined();
    expect(m.kind).toBe('benchmark');
  });

  it('несколько бенчмарков в один день дают по письму на каждый, в порядке данных', () => {
    const s = newState(dateToDay('2021-12-01'));
    introduceDue(s);
    expect(s.mail.map((m) => m.title)).toEqual(
      ['SQuAT', 'GLUU', 'MMLO', 'HumanEvol', 'GSM8C'].map((n) => `Новый бенчмарк: ${n}`),
    );
  });

  it('не трогает вышедшие позже бенчмарки и чужие поля состояния', () => {
    const s = newState(dateToDay('2019-01-01'));
    const cash = s.cash;
    introduceDue(s);
    expect(s.benchmarks.mmlu).toEqual({ introduced: false, saturated: false });
    expect(s.cash).toBe(cash);
    expect(s.rng).toBe(1);
  });
});
