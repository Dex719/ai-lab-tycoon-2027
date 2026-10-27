// Исследования (FR-3).

import { staffEffect } from './staffEffects';
import {
  ALGO_BASE_COST,
  ALGO_COST_GROWTH,
  ALGO_HISTORY_START,
  ALGO_LEVEL_DAYS,
  ALGO_MULT,
  CONTEXT_BASE_COST,
  CONTEXT_COST_GROWTH,
  CODE_TRAIN_CAP,
  CONTEXT_LEVELS,
  COT_REASONING_CAP,
  DISTILL_LIGHT_CAP,
  EARLY_PENALTY_PER_YEAR,
  INSTRUCT_ELO,
  MOE_SERVING_MULT,
  QUANT_SERVING_COST,
  RESEARCH_QUEUE_MAX,
  RP_BASE,
  RP_K,
  SYNTHETIC_TOKENS_MULT,
  TECH_COST,
  TECH_HISTORY_DATE,
  TECH_REQUIRES,
} from './constants';
import { pool } from './compute';
import { addMail, modValue } from './events';
import { dateToDay } from './time';
import type { ChainTech, GameState, Result, TechId } from './types';
import { TECH_IDS } from './types';

/** Направление исследований: цвет рамки узла на карте. */
export type TechBranch = 'architecture' | 'scale' | 'alignment' | 'data' | 'efficiency' | 'product';

export const BRANCH_NAMES: Record<TechBranch, string> = {
  architecture: 'Архитектура',
  scale: 'Масштаб',
  alignment: 'Согласование',
  data: 'Данные',
  efficiency: 'Эффективность',
  product: 'Продукт',
};

export interface TechInfo {
  id: TechId;
  name: string; // «Механизм внимания»
  description: string; // что даёт, одна-две фразы
  branch: TechBranch;
  code: string; // короткая метка на карте: «ATT»
}

/** Все технологии в порядке показа. */
export const TECHS: TechInfo[] = [
  {
    id: 'attention',
    name: 'Механизм внимания',
    description: 'Архитектура «Трансформер» вместо LSTM. Обучение эффективнее примерно в 7 раз.',
    branch: 'architecture',
    code: 'ATT',
  },
  {
    id: 'scaling',
    name: 'Законы масштабирования',
    description: 'Прогноз баллов модели до начала обучения и оптимальный размер модели.',
    branch: 'scale',
    code: 'SCL',
  },
  {
    id: 'rlhf',
    name: 'Обучение на отзывах людей (RLHF)',
    description: 'Модели с RLHF получают более высокое Эло на «Арене». Открываются RLHF-тендеры.',
    branch: 'alignment',
    code: 'RLHF',
  },
  {
    id: 'algo',
    name: 'Алгоритмические улучшения',
    description: 'Каждый уровень повышает эффективность обучения в 1,25 раза. У моделей с RLHF растёт и Эло.',
    branch: 'efficiency',
    code: 'ALG',
  },
  {
    id: 'context',
    name: 'Длинный контекст',
    description: 'Каждый уровень увеличивает контекст новых моделей. Модели с длинным контекстом покупают охотнее.',
    branch: 'product',
    code: 'CTX',
  },
  {
    id: 'distill',
    name: 'Дистилляция',
    description: `Лёгкие модели учатся у больших: у новых лёгких моделей способности выше на ${DISTILL_LIGHT_CAP} по всем областям.`,
    branch: 'efficiency',
    code: 'DST',
  },
  {
    id: 'moe',
    name: 'Смесь экспертов',
    description: `Новые модели обслуживают в ${fmtFactor(MOE_SERVING_MULT)} раза больше токенов на ту же мощность.`,
    branch: 'architecture',
    code: 'MoE',
  },
  {
    id: 'codetrain',
    name: 'Обучение на коде',
    description: `У новых моделей способность «Код» выше на ${CODE_TRAIN_CAP}. Разработчики ценят баллы по коду.`,
    branch: 'data',
    code: 'CODE',
  },
  {
    id: 'instruct',
    name: 'Дообучение на инструкциях',
    description: `Новые модели лучше выполняют просьбы: +${INSTRUCT_ELO} Эло на «Арене» у моделей без RLHF.`,
    branch: 'alignment',
    code: 'INS',
  },
  {
    id: 'cot',
    name: 'Цепочки рассуждений',
    description: `Модель решает задачи по шагам: у новых моделей способность «Математика и наука» выше на ${COT_REASONING_CAP}.`,
    branch: 'alignment',
    code: 'CoT',
  },
  {
    id: 'quant',
    name: 'Квантизация',
    description: `Веса в 8 битах: мощность на обслуживание всех моделей ×${fmtFactor(QUANT_SERVING_COST)} сразу после исследования.`,
    branch: 'efficiency',
    code: 'INT8',
  },
  {
    id: 'multimodal',
    name: 'Мультимодальность',
    description: 'Новые модели понимают изображения. Обычные пользователи выбирают их охотнее.',
    branch: 'product',
    code: 'IMG',
  },
  {
    id: 'synthetic',
    name: 'Синтетические данные',
    description: `Данные, созданные моделями: наибольший объём данных года ×${fmtFactor(SYNTHETIC_TOKENS_MULT)}.`,
    branch: 'data',
    code: 'SYN',
  },
];

/** Технологии, которые нужны для исследования (из TECH_REQUIRES). */
export function techRequires(tech: TechId): TechId[] {
  return TECH_REQUIRES[tech] ?? [];
}

/** Требования, которые ещё не изучены. */
export function missingRequirements(s: GameState, tech: TechId): TechId[] {
  return techRequires(tech).filter((t) => !s.research.done.includes(t));
}

/** Наибольший контекст, доступный для обучения сейчас. */
export function maxContext(s: GameState): number {
  return CONTEXT_LEVELS[Math.min(s.research.contextLevel, CONTEXT_LEVELS.length - 1)][0];
}

/** Последний уровень «Длинного контекста». */
export const CONTEXT_MAX_LEVEL = CONTEXT_LEVELS.length - 1;

/**
 * 512 → «512», 2048 → «2 тыс.», 128000 → «128 тыс.», 1000000 → «1 млн».
 * Круглые числа считаются по 1000, остальные степени двойки - по 1024: 32768 → «32 тыс.», 131072 → «128 тыс.»,
 * 2097152 → «2 млн».
 */
export function contextLabel(tokens: number): string {
  const k = tokens % 1000 !== 0 && tokens % 1024 === 0 ? 1024 : 1000;
  if (tokens >= k * k) return `${String(Math.round((tokens / (k * k)) * 10) / 10).replace('.', ',')} млн`;
  if (tokens >= k) return `${Math.round(tokens / k)} тыс.`;
  return String(Math.round(tokens));
}

/** Одна строка о том, что изменилось, - для письма о завершении. */
const EFFECT_LINE: Record<Exclude<TechId, ChainTech>, string> = {
  attention: 'Доступна архитектура «Трансформер». Обучение эффективнее, чем на LSTM, примерно в 7 раз.',
  scaling: 'В окне «Новая модель» отображаются прогноз баллов до запуска и оптимальный размер модели.',
  rlhf: 'Доступно обучение с RLHF: Эло на «Арене» выше, открыты RLHF-тендеры.',
  distill: `Новые лёгкие модели получат +${DISTILL_LIGHT_CAP} к способностям по всем областям.`,
  moe: `Новые модели обслуживают в ${fmtFactor(MOE_SERVING_MULT)} раза больше токенов на ту же мощность.`,
  codetrain: `Новые модели получат +${CODE_TRAIN_CAP} к способности «Код».`,
  instruct: `Новые модели без RLHF получат +${INSTRUCT_ELO} Эло на «Арене».`,
  cot: `Новые модели получат +${COT_REASONING_CAP} к способности «Математика и наука».`,
  quant: `Мощность на обслуживание всех моделей уменьшилась: ×${fmtFactor(QUANT_SERVING_COST)}.`,
  multimodal: 'Новые модели понимают изображения: обычные пользователи выбирают их охотнее.',
  synthetic: `Наибольший объём данных для обучения вырос в ${fmtFactor(SYNTHETIC_TOKENS_MULT)} раза.`,
};

function techName(tech: TechId): string {
  return TECHS.find((t) => t.id === tech)?.name ?? tech;
}

/** 1.5 → «1,5»: множитель без лишних нулей. */
function fmtFactor(x: number): string {
  return String(x).replace('.', ',');
}

/** 1,25 → «1,25» (запятая, как принято в тексте игры). */
function fmtMult(x: number): string {
  return x.toFixed(2).replace('.', ',');
}

/** День, когда технология (для algo - следующий уровень) появилась в истории. */
export function techHistoryDay(s: GameState, tech: TechId): number {
  if (tech === 'algo') return dateToDay(ALGO_HISTORY_START) + s.research.algoLevel * ALGO_LEVEL_DAYS;
  if (tech === 'context') return dateToDay(CONTEXT_LEVELS[Math.min(s.research.contextLevel + 1, CONTEXT_MAX_LEVEL)][1]);
  return dateToDay(TECH_HISTORY_DATE[tech]);
}

/** Насколько лет игрок опережает историю с этой технологией (0 - не опережает). */
export function yearsEarly(s: GameState, tech: TechId): number {
  return Math.max(0, (techHistoryDay(s, tech) - s.day) / 365);
}

/** Множитель цены за опережение истории: 1 + EARLY_PENALTY_PER_YEAR[tech] × лет (у RLHF надбавка выше). */
export function earlyPenalty(s: GameState, tech: TechId): number {
  return 1 + (EARLY_PENALTY_PER_YEAR[tech] ?? 0) * yearsEarly(s, tech);
}

/**
 * Цена в очках: TECH_COST × модификатор researchCost(target = tech); algo - ALGO_BASE_COST × ALGO_COST_GROWTH^algoLevel.
 * Всё × earlyPenalty: раньше исторической даты исследовать дороже. Цена пересчитывается каждый день,
 * поэтому с приближением исторической даты она падает.
 */
export function techCost(s: GameState, tech: TechId): number {
  const base =
    tech === 'algo'
      ? ALGO_BASE_COST * ALGO_COST_GROWTH ** s.research.algoLevel
      : tech === 'context'
        ? CONTEXT_BASE_COST * CONTEXT_COST_GROWTH ** s.research.contextLevel
        : TECH_COST[tech];
  return base * modValue(s, 'researchCost', tech).mult * earlyPenalty(s, tech);
}

/** Дальше этого срока (дней) прогноз не считаем: в интерфейсе «больше 10 лет». */
export const RESEARCH_FORECAST_MAX_DAYS = 3650;

/**
 * Сколько дней до конца технологии при скорости rp очков в день. Цена падает каждый день, пока игра приближается
 * к исторической дате, поэтому прогноз считает её по дням, а не по сегодняшней цене. Infinity - дольше
 * RESEARCH_FORECAST_MAX_DAYS или очки не копятся.
 */
export function researchDaysLeft(s: GameState, tech: TechId, rp: number): number {
  if (!(rp > 0)) return Infinity;
  const penaltyNow = earlyPenalty(s, tech);
  const base = techCost(s, tech) / penaltyNow;
  const k = EARLY_PENALTY_PER_YEAR[tech] ?? 0;
  const histDay = techHistoryDay(s, tech);
  let points = s.research.points[tech] ?? 0;
  for (let d = 0; d <= RESEARCH_FORECAST_MAX_DAYS; d++) {
    points += rp;
    const cost = base * (1 + k * Math.max(0, (histDay - (s.day + d)) / 365));
    if (points >= cost) return d + 1;
  }
  return Infinity;
}

/** Почему сейчас нельзя исследовать (null - можно). Текст готов для показа игроку. */
export function researchBlockReason(s: GameState, tech: TechId): string | null {
  if (!TECH_IDS.includes(tech)) return 'Нет такого исследования';
  if (tech === 'context' && s.research.contextLevel >= CONTEXT_MAX_LEVEL) return 'Достигнут наибольший контекст';
  if (tech !== 'algo' && s.research.done.includes(tech)) return 'Это исследование уже завершено';
  const missing = missingRequirements(s, tech);
  if (missing.length > 0) return `Требуется исследование: ${missing.map(techName).join(', ')}`;
  return null;
}

/** Требования выполнены и (кроме algo) ещё не изучено. */
export function canResearch(s: GameState, tech: TechId): boolean {
  return researchBlockReason(s, tech) === null;
}

/** RP_BASE + RP_K × sqrt(pool(experiments)). */
export function rpPerDay(s: GameState): number {
  const power = pool(s, 'experiments');
  // Кривая доля (минус или NaN) не должна давать NaN: тогда исследование завершилось бы мгновенно.
  // Исследователи в команде ускоряют исследования (staffEffects.ts).
  return (RP_BASE + RP_K * Math.sqrt(power > 0 ? power : 0)) * (1 + staffEffect(s, 'research'));
}

/** Действие: выбрать текущее исследование (null - остановить). Очки по технологиям сохраняются. */
export function setResearch(s: GameState, tech: TechId | null): Result {
  if (tech === null) {
    // Остановка: очередь не запускается сама на следующий день и ничего из неё не теряется.
    s.research.current = null;
    s.research.stopped = true;
    return { ok: true };
  }
  const reason = researchBlockReason(s, tech);
  if (reason) return { ok: false, error: reason };
  s.research.current = tech;
  delete s.research.stopped;
  // Выбранное сейчас в очереди не нужно.
  s.research.queue = s.research.queue.filter((t) => t !== tech);
  return { ok: true };
}

/**
 * Почему технологию нельзя поставить в очередь (null - можно). Требования могут быть выполнены позже,
 * чем технология попадёт в очередь: достаточно, чтобы они были изучены, идут сейчас или стоят в очереди раньше.
 */
export function queueBlockReason(s: GameState, tech: TechId): string | null {
  if (!TECH_IDS.includes(tech)) return 'Нет такого исследования';
  if (tech === 'context' && s.research.contextLevel >= CONTEXT_MAX_LEVEL) return 'Достигнут наибольший контекст';
  if (tech !== 'algo' && s.research.done.includes(tech)) return 'Это исследование уже завершено';
  if (s.research.current === tech) return 'Это исследование уже идёт';
  if (s.research.queue.includes(tech)) return 'Уже в очереди';
  if (s.research.queue.length >= RESEARCH_QUEUE_MAX) return `В очереди уже ${RESEARCH_QUEUE_MAX} исследования`;
  const ahead = new Set<TechId>([...s.research.done, ...s.research.queue]);
  if (s.research.current) ahead.add(s.research.current);
  const missing = techRequires(tech).filter((t) => !ahead.has(t));
  if (missing.length > 0) return `Требуется исследование: ${missing.map(techName).join(', ')}`;
  return null;
}

/** Действие: поставить технологию в конец очереди. */
export function queueResearch(s: GameState, tech: TechId): Result {
  const reason = queueBlockReason(s, tech);
  if (reason) return { ok: false, error: reason };
  s.research.queue.push(tech);
  return { ok: true };
}

/** Действие: убрать технологию из очереди вместе с теми, что ждут её (они без неё не откроются). */
export function unqueueResearch(s: GameState, tech: TechId): Result {
  const at = s.research.queue.indexOf(tech);
  if (at < 0) return { ok: false, error: 'Этого исследования нет в очереди' };
  s.research.queue.splice(at, 1);
  pruneQueue(s);
  return { ok: true };
}

/**
 * Убрать из очереди то, что уже нельзя исследовать или чьи требования больше не выполняются.
 * Возвращает убранное из-за требований (изученное и повторы не в счёт).
 */
function pruneQueue(s: GameState): TechId[] {
  const have = new Set<TechId>(s.research.done);
  if (s.research.current) have.add(s.research.current);
  const kept: TechId[] = [];
  const dropped: TechId[] = [];
  for (const t of s.research.queue) {
    const dead = (t !== 'algo' && s.research.done.includes(t)) || (t === 'context' && s.research.contextLevel >= CONTEXT_MAX_LEVEL);
    if (dead || t === s.research.current || kept.includes(t)) continue;
    if (techRequires(t).some((r) => !have.has(r))) {
      dropped.push(t);
      continue;
    }
    kept.push(t);
    have.add(t);
  }
  s.research.queue = kept;
  return dropped;
}

/** Включить следующее исследование из очереди (current должен быть свободен). Возвращает его или null. */
function startNext(s: GameState): TechId | null {
  const dropped = pruneQueue(s);
  if (dropped.length > 0) {
    addMail(s, {
      kind: 'research',
      title: `Убрано из очереди исследований: ${dropped.map((t) => `«${techName(t)}»`).join(', ')}`,
      body: 'Для них не изучено нужное исследование. Поставьте их в очередь снова, когда оно будет готово.',
    });
  }
  while (s.research.queue.length > 0) {
    const next = s.research.queue.shift() as TechId;
    if (canResearch(s, next)) {
      s.research.current = next;
      return next;
    }
  }
  return null;
}

/** Фраза в письмо о завершении: что пойдёт дальше по очереди (пусто, если очередь не сработала). */
function nextLine(next: TechId | null): string {
  return next ? ` Дальше по очереди: «${techName(next)}».` : '';
}

/**
 * Очередь пуста, current свободен, а «Алгоритмические улучшения» уже начаты (есть уровень) и не остановлены:
 * они продолжаются сами. Возвращает фразу для письма или ''.
 */
function resumeAlgo(s: GameState): string {
  if (s.research.current !== null || s.research.stopped || s.research.algoLevel <= 0 || !canResearch(s, 'algo')) return '';
  s.research.current = 'algo';
  return ` Дальше: «${techName('algo')}».`;
}

/**
 * Ежедневно: прибавить rpPerDay к points[current]. По достижении цены - изучено, письмо (kind 'research').
 * algo: algoLevel += 1, points.algo = 0, current остаётся 'algo' (очередь уходит вперёд, если в ней что-то есть).
 * Остальные: в done, current = null; если очередь пуста, а algo начат - algo снова текущий (resumeAlgo).
 */
export function progressDay(s: GameState): void {
  if (s.research.current === null) {
    if (s.research.stopped) return;
    startNext(s);
  }
  const tech = s.research.current;
  if (tech === null) return;
  // Защита от кривого состояния: нельзя вести то, что уже изучено или ещё не открыто.
  if (!canResearch(s, tech)) {
    s.research.current = null;
    startNext(s);
    return;
  }
  s.research.points[tech] += rpPerDay(s);
  if (s.research.points[tech] < techCost(s, tech)) return;

  if (tech === 'context') {
    s.research.contextLevel += 1;
    s.research.points.context = 0;
    s.research.current = null;
    const level = s.research.contextLevel;
    const last = level >= CONTEXT_MAX_LEVEL;
    if (last) s.research.done.push('context');
    const next = startNext(s);
    const resumed = next ? '' : resumeAlgo(s);
    addMail(s, {
      kind: 'research',
      title: `Исследование завершено: ${techName(tech)}, ${contextLabel(maxContext(s))} токенов`,
      tag: 'research-done',
      reward: true,
      body:
        `Новые модели можно обучать с контекстом до ${contextLabel(maxContext(s))} токенов. Контекст выбирается в окне «Новая модель».` +
        nextLine(next) +
        resumed +
        (next || last ? '' : ' Следующий уровень можно начать в окне «Исследования».'),
    });
    return;
  }
  if (tech === 'algo') {
    s.research.algoLevel += 1;
    s.research.points.algo = 0;
    const level = s.research.algoLevel;
    // Следующий уровень «Алгоритмических улучшений» идёт сам; очередь передвигается, только если в ней что-то есть.
    // Очередь чистит startNext: про убранное из-за требований придёт письмо.
    let next: TechId | null = null;
    if (s.research.queue.length > 0) {
      s.research.current = null;
      next = startNext(s);
      if (next === null) s.research.current = 'algo';
    }
    addMail(s, {
      kind: 'research',
      title: `Исследование завершено: ${techName(tech)}, уровень ${level}`,
      tag: 'research-done',
      reward: true,
      body: `Эффективность обучения новых проектов выросла в ${fmtMult(ALGO_MULT ** level)} раза по сравнению с исходной.${nextLine(next)}`,
    });
    return;
  }
  s.research.done.push(tech);
  s.research.current = null;
  const next = startNext(s);
  const resumed = next ? '' : resumeAlgo(s);
  addMail(s, {
    kind: 'research',
    title: `Исследование завершено: ${techName(tech)}`,
    tag: 'research-done',
    reward: true,
    body: EFFECT_LINE[tech] + nextLine(next) + resumed,
  });
}
