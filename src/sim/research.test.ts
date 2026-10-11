import { describe, expect, it } from 'vitest';
import { GPUS } from '../data/gpus';
import { setAllocation, setRent } from './compute';
import {
  ALGO_BASE_COST,
  ALGO_COST_GROWTH,
  CONTEXT_BASE_COST,
  CONTEXT_COST_GROWTH,
  CONTEXT_LEVELS,
  EARLY_PENALTY_PER_YEAR,
  RP_BASE,
  RP_K,
  TECH_COST,
  TECH_HISTORY_DATE,
  TECH_REQUIRES,
} from './constants';
import { addModifier, FOREVER } from './events';
import {
  canResearch,
  CONTEXT_MAX_LEVEL,
  contextLabel,
  earlyPenalty,
  maxContext,
  progressDay,
  researchBlockReason,
  rpPerDay,
  setResearch,
  TECHS,
  techCost,
  techHistoryDay,
} from './research';
import { createInitialState } from './state';
import { dateToDay } from './time';
import type { GameState, GpuId, TechId } from './types';
import { TECH_IDS } from './types';

/** Мощность GPU в H100e из данных (src/data/gpus.ts). */
function h100eOf(id: GpuId): number {
  const def = GPUS.find((g) => g.id === id);
  if (!def) throw new Error(`нет GPU ${id} в данных`);
  return def.h100e;
}

/** Опора из design.md: «2 H100e на эксперименты». Число P100 под неё считаем из данных (сейчас 93 шт. ≈ 1,99 H100e). */
const ANCHOR_P100 = Math.round(2 / h100eOf('p100'));

/** Новая игра с мощностью, полностью отданной экспериментам. */
function labWithExperiments(p100: number): GameState {
  const s = createInitialState('Тест', 1);
  setRent(s, 'p100', p100);
  setAllocation(s, { training: 0, contracts: 0, experiments: 1, api: 0, subs: 0 });
  return s;
}

/** Один игровой день без всего остального: исследование, затем день +1. */
function researchDay(s: GameState): void {
  progressDay(s);
  s.day += 1;
}

const researchMail = (s: GameState) => s.mail.filter((m) => m.kind === 'research');

describe('каталог технологий', () => {
  it('тринадцать технологий в порядке показа с русскими названиями', () => {
    expect(TECHS.map((t) => t.id)).toEqual([...TECH_IDS]);
    expect(TECHS.map((t) => t.name)).toEqual([
      'Механизм внимания',
      'Законы масштабирования',
      'Обучение на отзывах людей (RLHF)',
      'Алгоритмические улучшения',
      'Длинный контекст',
      'Дистилляция',
      'Смесь экспертов',
      'Обучение на коде',
      'Дообучение на инструкциях',
      'Цепочки рассуждений',
      'Квантизация',
      'Мультимодальность',
      'Синтетические данные',
    ]);
    for (const t of TECHS) {
      expect(t.description.length).toBeGreaterThan(20);
      // Без длинных и средних тире (правило текста).
      expect(t.description).not.toMatch(/[–—]/);
      expect(t.code.length).toBeGreaterThan(0);
    }
  });
});

describe('новые технологии: даты, цены, требования', () => {
  const NEW: [TechId, string, number, TechId[]][] = [
    ['distill', '2019-10-02', 8000, ['attention']],
    ['moe', '2021-01-11', 20_000, ['scaling']],
    ['codetrain', '2021-07-07', 12_000, ['attention']],
    ['instruct', '2021-09-03', 14_000, ['attention']],
    ['cot', '2022-01-28', 24_000, ['instruct']],
    ['quant', '2022-08-15', 16_000, ['distill']],
    ['multimodal', '2023-03-14', 40_000, ['instruct']],
    ['synthetic', '2023-06-20', 45_000, ['codetrain']],
  ];

  it.each(NEW)('%s: дата %s, цена %i, требования %j', (id, date, cost, req) => {
    const s = createInitialState('Тест', 1);
    expect(techHistoryDay(s, id)).toBe(dateToDay(date));
    expect(TECH_REQUIRES[id]).toEqual(req);
    s.day = dateToDay(date);
    expect(techCost(s, id)).toBe(cost);
    // За год до даты - × (1 + 2,5).
    s.day = dateToDay(date) - 365;
    expect(earlyPenalty(s, id)).toBeCloseTo(3.5, 6);
    expect(techCost(s, id)).toBeCloseTo(cost * 3.5, 6);
  });

  it.each(NEW)('%s: без требований нельзя, с требованиями можно, после изучения - в done', (id, date, cost, req) => {
    const s = createInitialState('Тест', 1);
    s.day = dateToDay(date);
    expect(canResearch(s, id)).toBe(false);
    expect(researchBlockReason(s, id)).toMatch(/^Требуется исследование: /);
    s.research.done.push(...req);
    expect(canResearch(s, id)).toBe(true);
    expect(setResearch(s, id).ok).toBe(true);
    s.research.points[id] = cost - 1;
    s.compute.alloc.experiments = 0;
    progressDay(s);
    expect(s.research.done).toContain(id);
    expect(s.research.current).toBeNull();
    expect(researchMail(s).at(-1)?.title).toBe(`Исследование завершено: ${TECHS.find((t) => t.id === id)!.name}`);
    expect(canResearch(s, id)).toBe(false);
  });

  it('у каждой технологии есть направление, требования ссылаются на существующие технологии без циклов', () => {
    for (const id of TECH_IDS) {
      for (const r of TECH_REQUIRES[id]) expect(TECH_IDS).toContain(r);
      // Требование появилось в истории не позже самой технологии (кроме цепочек).
      if (id === 'algo' || id === 'context') continue;
      for (const r of TECH_REQUIRES[id]) {
        if (r === 'algo' || r === 'context') continue;
        expect(dateToDay(TECH_HISTORY_DATE[r])).toBeLessThanOrEqual(dateToDay(TECH_HISTORY_DATE[id]));
      }
    }
  });
});

// Дата после всех исторических дат (в т.ч. 15-го уровня алгоритмов): штрафа за опережение нет.
const LATE = dateToDay('2027-06-01');

function lateState(): GameState {
  const s = createInitialState('Тест', 1);
  s.day = LATE;
  return s;
}

describe('techCost', () => {
  it('базовые цены из констант', () => {
    const s = lateState();
    expect(techCost(s, 'attention')).toBe(4000);
    expect(techCost(s, 'scaling')).toBe(15_000);
    expect(techCost(s, 'rlhf')).toBe(30_000);
    expect(techCost(s, 'attention')).toBe(TECH_COST.attention);
  });

  it('algo: 5000 × 1,6^уровень', () => {
    const s = lateState();
    expect(techCost(s, 'algo')).toBe(5000);
    s.research.algoLevel = 1;
    expect(techCost(s, 'algo')).toBeCloseTo(8000, 6);
    s.research.algoLevel = 2;
    expect(techCost(s, 'algo')).toBeCloseTo(12_800, 6);
    s.research.algoLevel = 4;
    expect(techCost(s, 'algo')).toBeCloseTo(ALGO_BASE_COST * ALGO_COST_GROWTH ** 4, 6);
  });

  it('модификатор researchCost с target меняет цену только этой технологии', () => {
    const s = lateState();
    addModifier(s, { id: 'paper', kind: 'researchCost', target: 'attention', mult: 0.4, untilDay: FOREVER });
    expect(techCost(s, 'attention')).toBeCloseTo(1600, 9);
    expect(techCost(s, 'scaling')).toBe(15_000);
    expect(techCost(s, 'algo')).toBe(5000);
  });

  it('общий модификатор researchCost действует на все технологии', () => {
    const s = lateState();
    addModifier(s, { id: 'boom', kind: 'researchCost', mult: 2, untilDay: FOREVER });
    expect(techCost(s, 'scaling')).toBe(30_000);
    expect(techCost(s, 'algo')).toBe(10_000);
  });

  it('раньше исторической даты дороже: × (1 + k × лет опережения), у RLHF k = 10, у остальных 2,5', () => {
    for (const id of TECH_IDS) expect(EARLY_PENALTY_PER_YEAR[id]).toBe(id === 'rlhf' ? 10 : 2.5);
    const s = createInitialState('Тест', 1);
    s.day = dateToDay('2021-01-27'); // RLHF - за год до InstructGTP (27.01.2022)
    expect(earlyPenalty(s, 'rlhf')).toBeCloseTo(1 + 10 * (365 / 365), 6);
    expect(techCost(s, 'rlhf')).toBeCloseTo(30_000 * 11, 6);
    s.day = dateToDay('2022-01-27');
    expect(techCost(s, 'rlhf')).toBe(30_000);
    s.day = dateToDay('2023-01-01');
    expect(techCost(s, 'rlhf')).toBe(30_000); // позже - без скидки

    s.day = dateToDay('2019-01-23'); // масштабирование - за год до 23.01.2020
    expect(earlyPenalty(s, 'scaling')).toBeCloseTo(3.5, 6);
    expect(techCost(s, 'scaling')).toBeCloseTo(15_000 * 3.5, 6);
  });

  it('алгоритмы: k-й уровень «исторически» через k × 243 дня от 01.01.2017', () => {
    const s = createInitialState('Тест', 1);
    s.research.algoLevel = 4;
    s.day = 4 * 243;
    expect(earlyPenalty(s, 'algo')).toBe(1);
    s.day = 4 * 243 - 365;
    expect(earlyPenalty(s, 'algo')).toBeCloseTo(3.5, 6);
  });
});

describe('rpPerDay', () => {
  it('без мощности - только базовая работа команды', () => {
    expect(rpPerDay(createInitialState('Тест', 1))).toBe(RP_BASE);
  });

  it('10 + 25 × sqrt(мощность экспериментов)', () => {
    const s = labWithExperiments(ANCHOR_P100); // ≈ 2 H100e
    expect(rpPerDay(s)).toBeCloseTo(RP_BASE + RP_K * Math.sqrt(ANCHOR_P100 * h100eOf('p100')), 9);
  });

  it('учитывает только долю «Эксперименты»', () => {
    const s = labWithExperiments(ANCHOR_P100);
    setAllocation(s, { training: 1, contracts: 0, experiments: 0, api: 0, subs: 0 });
    expect(rpPerDay(s)).toBe(RP_BASE);
  });

  it('отдача убывает: в 4 раза больше мощности - лишь вдвое больше сверх базы', () => {
    const a = rpPerDay(labWithExperiments(100)) - RP_BASE;
    const b = rpPerDay(labWithExperiments(400)) - RP_BASE;
    expect(b / a).toBeCloseTo(2, 9);
  });

  it('опорное число: ≈ 2 H100e на эксперименты дают ≈ 45 очков в день', () => {
    const rp = rpPerDay(labWithExperiments(ANCHOR_P100));
    expect(rp).toBeCloseTo(RP_BASE + RP_K * Math.sqrt(ANCHOR_P100 * h100eOf('p100')), 9);
    expect(rp).toBeCloseTo(45, 0);
  });

  it('половина мощности на эксперименты: корень считается от доли, а не от всей мощности', () => {
    const s = labWithExperiments(ANCHOR_P100);
    setAllocation(s, { training: 0.5, contracts: 0, experiments: 0.5, api: 0, subs: 0 });
    expect(rpPerDay(s)).toBeCloseTo(RP_BASE + RP_K * Math.sqrt(ANCHOR_P100 * h100eOf('p100') * 0.5), 9);
  });

  it('кривая доля (минус или NaN) не даёт NaN и не ломает очки', () => {
    const s = labWithExperiments(ANCHOR_P100);
    s.compute.alloc.experiments = Number.NaN;
    expect(rpPerDay(s)).toBe(RP_BASE);
    s.compute.alloc.experiments = -0.5;
    expect(rpPerDay(s)).toBe(RP_BASE);
  });
});

describe('требования и выбор исследования', () => {
  it('без «Механизма внимания» нельзя взять масштабирование и RLHF', () => {
    const s = createInitialState('Тест', 1);
    expect(canResearch(s, 'attention')).toBe(true);
    expect(canResearch(s, 'scaling')).toBe(false);
    expect(canResearch(s, 'rlhf')).toBe(false);
    expect(canResearch(s, 'algo')).toBe(true);

    for (const tech of ['scaling', 'rlhf'] as const) {
      const r = setResearch(s, tech);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('Механизм внимания');
    }
    expect(s.research.current).toBeNull();
  });

  it('тексты отказов: что именно изучить сначала и что уже изучено', () => {
    const s = createInitialState('Тест', 1);
    expect(setResearch(s, 'scaling')).toEqual({ ok: false, error: 'Требуется исследование: Механизм внимания' });
    expect(setResearch(s, 'rlhf')).toEqual({ ok: false, error: 'Требуется исследование: Механизм внимания' });
    expect(researchBlockReason(s, 'attention')).toBeNull();
    expect(researchBlockReason(s, 'algo')).toBeNull();

    s.research.done.push('attention');
    expect(setResearch(s, 'attention')).toEqual({ ok: false, error: 'Это исследование уже завершено' });
    expect(researchBlockReason(s, 'attention')).toBe('Это исследование уже завершено');
  });

  it('отказ не меняет ни текущее исследование, ни очки', () => {
    const s = labWithExperiments(ANCHOR_P100);
    setResearch(s, 'attention');
    researchDay(s);
    const before = JSON.stringify(s.research);
    expect(setResearch(s, 'scaling').ok).toBe(false);
    expect(setResearch(s, 'bogus' as TechId).ok).toBe(false);
    expect(JSON.stringify(s.research)).toBe(before);
    expect(s.research.current).toBe('attention');
  });

  it('неизвестное исследование - отказ, а не падение', () => {
    const s = createInitialState('Тест', 1);
    expect(setResearch(s, 'bogus' as TechId)).toEqual({ ok: false, error: 'Нет такого исследования' });
    expect(canResearch(s, 'bogus' as TechId)).toBe(false);
    s.research.current = 'bogus' as TechId;
    expect(() => progressDay(s)).not.toThrow();
    expect(s.research.current).toBeNull();
  });

  it('цепочка на настоящем ходу: изучили внимание - тут же открылись масштабирование и RLHF', () => {
    const s = createInitialState('Тест', 1);
    setResearch(s, 'attention');
    s.research.points.attention = techCost(s, 'attention');
    progressDay(s);
    expect(s.research.done).toEqual(['attention']);
    expect(setResearch(s, 'scaling')).toEqual({ ok: true });
    expect(setResearch(s, 'rlhf')).toEqual({ ok: true });
    expect(s.research.current).toBe('rlhf');
  });

  it('после «Механизма внимания» масштабирование и RLHF открываются', () => {
    const s = createInitialState('Тест', 1);
    s.research.done.push('attention');
    expect(canResearch(s, 'scaling')).toBe(true);
    expect(canResearch(s, 'rlhf')).toBe(true);
    expect(setResearch(s, 'rlhf')).toEqual({ ok: true });
    expect(s.research.current).toBe('rlhf');
  });

  it('изученное нельзя взять снова, кроме algo', () => {
    const s = createInitialState('Тест', 1);
    s.research.done.push('attention', 'scaling');
    expect(canResearch(s, 'attention')).toBe(false);
    const r = setResearch(s, 'attention');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    expect(canResearch(s, 'algo')).toBe(true);
    expect(setResearch(s, 'algo')).toEqual({ ok: true });
  });

  it('null останавливает исследование, очки сохраняются', () => {
    const s = labWithExperiments(ANCHOR_P100);
    setResearch(s, 'attention');
    researchDay(s);
    researchDay(s);
    const saved = s.research.points.attention;
    expect(saved).toBeGreaterThan(0);

    expect(setResearch(s, null)).toEqual({ ok: true });
    expect(s.research.current).toBeNull();
    expect(s.research.points.attention).toBe(saved);

    researchDay(s); // ничего не выбрано - очки не растут
    expect(s.research.points.attention).toBe(saved);

    setResearch(s, 'attention');
    expect(s.research.points.attention).toBe(saved);
  });

  it('очки другой технологии не теряются при переключении', () => {
    const s = labWithExperiments(ANCHOR_P100);
    s.research.done.push('attention');
    setResearch(s, 'scaling');
    researchDay(s);
    const scalingPoints = s.research.points.scaling;
    setResearch(s, 'algo');
    researchDay(s);
    expect(s.research.points.scaling).toBe(scalingPoints);
    expect(s.research.points.algo).toBeGreaterThan(0);
  });
});

describe('progressDay', () => {
  it('без текущего исследования ничего не меняет', () => {
    const s = labWithExperiments(ANCHOR_P100);
    const before = JSON.stringify(s);
    progressDay(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('прибавляет rpPerDay к текущей технологии', () => {
    const s = labWithExperiments(ANCHOR_P100);
    setResearch(s, 'attention');
    const rp = rpPerDay(s);
    progressDay(s);
    expect(s.research.points.attention).toBeCloseTo(rp, 9);
    expect(s.research.points.scaling).toBe(0);
    expect(researchMail(s)).toHaveLength(0);
  });

  it('по достижении цены технология изучена, письмо «research», выбор снят', () => {
    const s = createInitialState('Тест', 1);
    setResearch(s, 'attention');
    s.research.points.attention = techCost(s, 'attention') - 1;
    progressDay(s);

    expect(s.research.done).toEqual(['attention']);
    expect(s.research.current).toBeNull();
    const mails = researchMail(s);
    expect(mails).toHaveLength(1);
    expect(mails[0].title).toContain('Механизм внимания');
    expect(mails[0].body).toContain('Трансформер');
    expect(mails[0].read).toBe(false);
  });

  it('письма о масштабировании и RLHF называют эффект', () => {
    const s = createInitialState('Тест', 1);
    s.research.done.push('attention');

    setResearch(s, 'scaling');
    s.research.points.scaling = techCost(s, 'scaling');
    progressDay(s);
    setResearch(s, 'rlhf');
    s.research.points.rlhf = techCost(s, 'rlhf');
    progressDay(s);

    expect(s.research.done).toEqual(['attention', 'scaling', 'rlhf']);
    const [scaling, rlhf] = researchMail(s);
    expect(scaling.title).toContain('Законы масштабирования');
    expect(scaling.body).toContain('прогноз');
    expect(rlhf.title).toContain('RLHF');
    expect(rlhf.body).toContain('RLHF-тендеры');
  });

  it('скидка на «Механизм внимания» учитывается сразу', () => {
    const s = lateState();
    setResearch(s, 'attention');
    s.research.points.attention = 2000;
    progressDay(s);
    expect(s.research.done).toEqual([]); // цена пока 4000
    addModifier(s, { id: 'paper', kind: 'researchCost', target: 'attention', mult: 0.4, untilDay: FOREVER });
    progressDay(s);
    expect(s.research.done).toEqual(['attention']); // цена стала 1600
  });

  it('кривое состояние: нельзя вести то, что ещё не открыто', () => {
    const s = labWithExperiments(ANCHOR_P100);
    s.research.current = 'scaling'; // внимание не изучено
    progressDay(s);
    expect(s.research.current).toBeNull();
    expect(s.research.points.scaling).toBe(0);
  });

  it('кривое состояние: уже изученное не ведётся, очки и письма не растут', () => {
    const s = labWithExperiments(ANCHOR_P100);
    s.research.done.push('attention');
    s.research.current = 'attention';
    progressDay(s);
    expect(s.research.current).toBeNull();
    expect(s.research.points.attention).toBe(0);
    expect(s.research.done).toEqual(['attention']);
    expect(researchMail(s)).toHaveLength(0);
  });

  it('граница цены: не хватает чуть-чуть - не готово, хватает ровно - готово', () => {
    const s = createInitialState('Тест', 1);
    const rp = rpPerDay(s);
    setResearch(s, 'attention');
    s.research.points.attention = techCost(s, 'attention') - rp - 0.5;
    progressDay(s);
    expect(s.research.done).toEqual([]);
    expect(s.research.current).toBe('attention');

    s.research.points.attention = techCost(s, 'attention') - rp;
    progressDay(s);
    expect(s.research.done).toEqual(['attention']);
  });

  it('за один день завершается не больше одной технологии, избыток очков не переносится', () => {
    const s = createInitialState('Тест', 1);
    s.research.done.push('attention');
    setResearch(s, 'scaling');
    s.research.points.scaling = 1e9;
    s.research.points.rlhf = 1e9;
    progressDay(s);
    expect(s.research.done).toEqual(['attention', 'scaling']);
    expect(s.research.current).toBeNull();
    expect(researchMail(s)).toHaveLength(1);
  });

  it('письмо приходит в день завершения и сразу непрочитанное', () => {
    const s = createInitialState('Тест', 1);
    s.day = 88;
    setResearch(s, 'attention');
    s.research.points.attention = 1e9;
    progressDay(s);
    const [mail] = researchMail(s);
    expect(mail.day).toBe(88);
    expect(mail.read).toBe(false);
    expect(mail.choices).toBeUndefined();
  });

  it('без модификаторов и при одинаковом состоянии ход даёт один и тот же результат', () => {
    const run = () => {
      const s = labWithExperiments(ANCHOR_P100);
      setResearch(s, 'attention');
      for (let i = 0; i < 120; i++) researchDay(s);
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});

describe('алгоритмические улучшения повторяются', () => {
  it('уровень растёт, очки обнуляются, исследование продолжается, цена дорожает', () => {
    const s = lateState();
    setResearch(s, 'algo');

    const costs: number[] = [];
    for (let level = 0; level < 4; level++) {
      costs.push(techCost(s, 'algo'));
      s.research.points.algo = techCost(s, 'algo');
      progressDay(s);
      expect(s.research.algoLevel).toBe(level + 1);
      expect(s.research.points.algo).toBe(0);
      expect(s.research.current).toBe('algo');
      expect(s.research.done).not.toContain('algo');
    }
    expect(costs[0]).toBe(5000);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeCloseTo(costs[i - 1] * 1.6, 6);

    const mails = researchMail(s);
    expect(mails).toHaveLength(4);
    expect(mails[0].title).toContain('уровень 1');
    expect(mails[3].title).toContain('уровень 4');
    expect(mails[0].body).toContain('1,25');
    expect(mails[1].body).toContain('1,56'); // 1,25² ≈ 1,5625
    expect(mails[2].body).toContain('1,95'); // 1,25³ ≈ 1,953
    expect(mails[3].body).toContain('2,44'); // 1,25⁴ ≈ 2,441
    for (const m of mails) expect(m.body).not.toMatch(/\d\.\d/); // в числах запятая, не точка
  });

  it('algo не требует «Механизма внимания» и не попадает в изученные', () => {
    const s = createInitialState('Тест', 1);
    expect(setResearch(s, 'algo')).toEqual({ ok: true });
    s.research.points.algo = techCost(s, 'algo');
    progressDay(s);
    expect(s.research.algoLevel).toBe(1);
    expect(s.research.done).toEqual([]);
    expect(canResearch(s, 'algo')).toBe(true);
  });

  it('очки algo не переносятся в следующий уровень (по JSDoc - сброс в 0)', () => {
    const s = createInitialState('Тест', 1);
    setResearch(s, 'algo');
    s.research.points.algo = 1e9;
    progressDay(s);
    expect(s.research.algoLevel).toBe(1);
    expect(s.research.points.algo).toBe(0);
  });

  it('реальный ход: уровень 1 за 5000 очков, затем уровень 2 дольше', () => {
    const s = labWithExperiments(ANCHOR_P100);
    setResearch(s, 'algo');
    const rp = rpPerDay(s);

    let days = 0;
    while (s.research.algoLevel < 1 && days < 1000) {
      researchDay(s);
      days++;
    }
    expect(s.research.algoLevel).toBe(1);
    expect(days).toBe(Math.ceil(5000 / rp));

    let days2 = 0;
    while (s.research.algoLevel < 2 && days2 < 1000) {
      researchDay(s);
      days2++;
    }
    expect(s.research.algoLevel).toBe(2);
    expect(days2).toBe(Math.ceil(8000 / rp));
    expect(days2).toBeGreaterThan(days);
  });
});

describe('опорный сценарий: внимание успеть до 12.06.2017', () => {
  it('≈ 2 H100e на эксперименты с 01.01.2017 - внимание готово до 12.06.2017', () => {
    const s = createInitialState('Тест', 1);
    expect(setRent(s, 'p100', ANCHOR_P100)).toEqual({ ok: true });
    expect(setAllocation(s, { training: 0, contracts: 0, experiments: 1, api: 0, subs: 0 })).toEqual({ ok: true });
    expect(setResearch(s, 'attention')).toEqual({ ok: true });

    const deadline = dateToDay('2017-06-12');
    while (s.day < deadline && !s.research.done.includes('attention')) researchDay(s);

    expect(s.research.done).toContain('attention');
    expect(s.day).toBeLessThan(deadline);
    // sanity: не мгновенно - 4000 очков при ≈45 в день это около трёх месяцев
    expect(s.day).toBeGreaterThan(60);
    expect(researchMail(s)).toHaveLength(1);
  });

  it('готово до статьи Gogle с запасом больше месяца (цена падает с приближением 12.06.2017)', () => {
    const s = labWithExperiments(ANCHOR_P100);
    setResearch(s, 'attention');
    const rp = rpPerDay(s);
    let days = 0;
    while (!s.research.done.includes('attention') && days < 1000) {
      researchDay(s);
      days++;
    }
    // В первый день цена выше 4000 (опережение почти на полгода), к 12.06.2017 падает до 4000.
    expect(days).toBeGreaterThan(Math.ceil(4000 / rp));
    // Письмо «Вы первые» пойдёт 12.06.2017 (день 162): запас - не меньше месяца.
    expect(dateToDay('2017-06-12') - days).toBeGreaterThanOrEqual(30);
    expect(researchMail(s)[0].day).toBe(days - 1);
  });

  it('без экспериментов (только база команды) успеть нельзя', () => {
    const s = createInitialState('Тест', 1);
    setAllocation(s, { training: 1, contracts: 0, experiments: 0, api: 0, subs: 0 });
    setResearch(s, 'attention');
    const deadline = dateToDay('2017-06-12');
    while (s.day < deadline) researchDay(s);
    expect(s.research.done).toEqual([]);
  });
});

describe('длинный контекст', () => {
  function withAttention(): GameState {
    const s = labWithExperiments(ANCHOR_P100);
    s.research.done.push('attention');
    return s;
  }

  it('нужен «Механизм внимания»', () => {
    const s = labWithExperiments(ANCHOR_P100);
    expect(researchBlockReason(s, 'context')).toContain('Механизм внимания');
    expect(canResearch(withAttention(), 'context')).toBe(true);
  });

  it('цена растёт с уровнем, историческая дата - дата следующего уровня', () => {
    const s = withAttention();
    s.day = dateToDay('2024-12-31'); // без надбавки за опережение
    expect(techCost(s, 'context')).toBeCloseTo(CONTEXT_BASE_COST, 6);
    s.research.contextLevel = 2;
    expect(techCost(s, 'context')).toBeCloseTo(CONTEXT_BASE_COST * CONTEXT_COST_GROWTH ** 2, 6);
    expect(techHistoryDay(s, 'context')).toBe(dateToDay(CONTEXT_LEVELS[3][1]));
  });

  it('уровень повышает наибольший контекст, исследование останавливается, приходит письмо', () => {
    const s = withAttention();
    expect(maxContext(s)).toBe(512);
    setResearch(s, 'context');
    s.research.points.context = techCost(s, 'context');
    progressDay(s);
    expect(s.research.contextLevel).toBe(1);
    expect(maxContext(s)).toBe(CONTEXT_LEVELS[1][0]);
    expect(s.research.current).toBeNull();
    expect(s.research.points.context).toBe(0);
    expect(researchMail(s).at(-1)!.title).toContain('1 тыс.');
  });

  it('после последнего уровня исследование закрыто', () => {
    const s = withAttention();
    s.research.contextLevel = CONTEXT_MAX_LEVEL - 1;
    setResearch(s, 'context');
    s.research.points.context = techCost(s, 'context');
    progressDay(s);
    expect(maxContext(s)).toBe(1_000_000);
    expect(s.research.done).toContain('context');
    expect(canResearch(s, 'context')).toBe(false);
  });

  it('подписи контекста', () => {
    expect(contextLabel(512)).toBe('512');
    expect(contextLabel(2048)).toBe('2 тыс.');
    expect(contextLabel(128000)).toBe('128 тыс.');
    expect(contextLabel(1_000_000)).toBe('1 млн');
  });

  it('подписи контекста: степени двойки считаются по 1024, круглые числа - по 1000', () => {
    expect(contextLabel(1024)).toBe('1 тыс.');
    expect(contextLabel(32_768)).toBe('32 тыс.');
    expect(contextLabel(131_072)).toBe('128 тыс.');
    expect(contextLabel(1_048_576)).toBe('1 млн');
    expect(contextLabel(2_097_152)).toBe('2 млн');
    expect(contextLabel(100_000)).toBe('100 тыс.');
    expect(contextLabel(200_000)).toBe('200 тыс.');
    expect(contextLabel(2_000_000)).toBe('2 млн');
    expect(contextLabel(1_500_000)).toBe('1,5 млн');
    // Все уровни «Длинного контекста» подписаны без хвостов вроде «33 тыс.» или «2,1 млн».
    for (const [tokens] of CONTEXT_LEVELS) expect(contextLabel(tokens), String(tokens)).toMatch(/^(\d+|\d+ тыс\.|\d+ млн)$/);
  });
});
