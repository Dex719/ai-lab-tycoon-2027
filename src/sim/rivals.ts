// Модели соперников: способности по реальным баллам, оценки пропусков, выходы по календарю (FR-12). TSK-007.

import { LABS } from '../data/labs';
import { RIVAL_MODELS } from '../data/rivalModels';
import { benchDef, benchScore, capFromScore, introducedBenchmarks } from './benchmarks';
import { MARKET_MAX_AGE_DAYS, MARKET_MODELS_PER_LAB, REF_PRICE } from './constants';
import { addMail } from './events';
import { releaseHypeBonus } from './leaderboard';
import { reactiveDefs, releaseShiftDays, rivalDayIn, rivalEloIn, rivalPriceIn } from './rivalry';
import { byYear, dateToDay, lerpByDate, START_DAY, yearOf } from './time';
import { DOMAINS, LAB_IDS } from './types';
import type { BenchmarkId, DomainId, GameState, LabId, RivalModelDef } from './types';

// ---------- Каталог ----------

const BY_ID = new Map<string, RivalModelDef>(RIVAL_MODELS.map((m) => [m.id, m]));

// Взаимный импорт с rivalry.ts безопасен: ни один модуль не обращается к экспортам другого на верхнем уровне.
// Шаблоны ответных моделей строятся через findRivalDef(базовая модель), поэтому поиск по шаблонам не должен
// запускаться повторно из самого построения: иначе шаблон без базовой модели зациклил бы поиск вместо ошибки.
let searchingTemplates = false;

// Способность из Эло для моделей без опубликованных баллов: cap = (Эло − 374) / 11,7.
export const RIVAL_CAP_ELO_ZERO = 374;
export const RIVAL_CAP_ELO_PER_POINT = 11.7;
const LAB_NAME = new Map<LabId, string>(LABS.map((l) => [l.id, l.name]));

// День выхода по дате: строки дат повторяются, а разбор даты - не бесплатный.
const DAY_BY_DATE = new Map<string, number>();

/**
 * Модель каталога или шаблон ответной модели (rivalry.reactiveDefs, сначала каталог); undefined - в сохранении
 * мог остаться id, которого уже нет.
 */
export function findRivalDef(id: string): RivalModelDef | undefined {
  const def = BY_ID.get(id);
  if (def || searchingTemplates) return def;
  searchingTemplates = true;
  try {
    return reactiveDefs().get(id);
  } finally {
    searchingTemplates = false;
  }
}

export function rivalDef(id: string): RivalModelDef {
  const def = findRivalDef(id);
  if (!def) throw new Error(`Нет модели соперника ${id}`);
  return def;
}

/** Эло в таблице - оценка: оценочное Эло каталога или поправка хода соперника (overrides.eloAdd). */
export function rivalEloEstimated(s: GameState, def: RivalModelDef): boolean {
  return def.arenaEstimated || rivalEloIn(s, def) !== def.arenaElo;
}

/** День выхода модели (от 01.01.2017); кешируется по дате. */
export function rivalDay(def: RivalModelDef): number {
  let day = DAY_BY_DATE.get(def.released);
  if (day === undefined) {
    day = dateToDay(def.released);
    DAY_BY_DATE.set(def.released, day);
  }
  return day;
}

// ---------- Способности и баллы ----------

// Кеш по id. Запоминаем и саму модель: если подставили другую модель с тем же id, считаем заново.
const capsCache = new Map<string, { def: RivalModelDef; caps: Record<DomainId, number> }>();

function computeCaps(def: RivalModelDef): Record<DomainId, number> {
  const sum: Record<DomainId, number> = { language: 0, code: 0, reasoning: 0 };
  const count: Record<DomainId, number> = { language: 0, code: 0, reasoning: 0 };
  for (const [bid, score] of Object.entries(def.scores) as [BenchmarkId, number | undefined][]) {
    if (typeof score !== 'number' || !Number.isFinite(score)) continue;
    const domain = benchDef(bid).domain;
    sum[domain] += capFromScore(bid, score);
    count[domain]++;
  }
  const known = DOMAINS.filter((d) => count[d] > 0);
  // Модель без баллов: способность из Эло, одинаковая во всех доменах.
  // Подогнано по моделям каталога с баллами: Эло 650 ≈ 24, 1100 ≈ 62, 1380 ≈ 86.
  if (known.length === 0) {
    const cap = (def.arenaElo - RIVAL_CAP_ELO_ZERO) / RIVAL_CAP_ELO_PER_POINT;
    return { language: cap, code: cap, reasoning: cap };
  }
  const caps = {} as Record<DomainId, number>;
  for (const d of known) caps[d] = sum[d] / count[d];
  // Домен без баллов берёт среднее остальных доменов.
  const fill = known.reduce((a, d) => a + caps[d], 0) / known.length;
  for (const d of DOMAINS) if (count[d] === 0) caps[d] = fill;
  return caps;
}

/**
 * Способности по доменам: среднее capFromScore по реальным баллам домена; домен без баллов - среднее
 * остальных доменов; модель без баллов - (arenaElo − 374) / 11,7 во всех доменах. Кешируется по id.
 */
export function rivalCaps(def: RivalModelDef): Record<DomainId, number> {
  const hit = capsCache.get(def.id);
  if (hit && hit.def === def) return hit.caps;
  const caps = computeCaps(def);
  capsCache.set(def.id, { def, caps });
  return caps;
}

/** Реальный балл, если есть; иначе benchScore(bid, cap домена) с estimated = true. */
export function rivalScore(def: RivalModelDef, bid: BenchmarkId): { value: number; estimated: boolean } {
  const real = def.scores[bid];
  if (typeof real === 'number' && Number.isFinite(real)) return { value: real, estimated: false };
  return { value: benchScore(bid, rivalCaps(def)[benchDef(bid).domain]), estimated: true };
}

/** Смешанная цена каталога (3·in + out)/4 на день выхода; null - цен в каталоге нет. */
export function catalogPrice(def: RivalModelDef): number | null {
  const { priceIn, priceOut } = def;
  if (priceIn !== null && priceOut !== null) return (3 * priceIn + priceOut) / 4;
  if (priceIn !== null) return priceIn;
  if (priceOut !== null) return priceOut;
  return null;
}

/** Опорная цена рынка $ за 1М токенов на день (та же кривая, что в market.refPrice; здесь - чтобы не замыкать импорты). */
function marketRefPrice(day: number): number {
  return lerpByDate(REF_PRICE, day, true);
}

/**
 * Во сколько раз цена модели упала с дня выхода вместе с рынком: refPrice(day) / refPrice(день выхода), не выше 1
 * (до выхода и в день выхода - каталожная цена).
 */
export function rivalPriceDecay(def: RivalModelDef, day: number): number {
  const ratio = marketRefPrice(day) / marketRefPrice(rivalDay(def));
  return Number.isFinite(ratio) ? Math.min(1, ratio) : 1;
}

/**
 * Цена соперника $ за 1М токенов на день day. Из каталога - смешанная цена на день выхода, а дальше она падает
 * вместе с рынком (× rivalPriceDecay): старые модели не продаются по ценам своего года.
 * Без цен в каталоге - defaultPricePer1M лаборатории на год дня day (эта таблица тоже падает по годам).
 */
export function rivalPrice(def: RivalModelDef, day: number): number {
  const catalog = catalogPrice(def);
  if (catalog !== null) return catalog * rivalPriceDecay(def, day);
  const lab = LABS.find((l) => l.id === def.lab);
  return lab ? byYear(lab.defaultPricePer1M, yearOf(day)) : 0;
}

// ---------- Письмо о выходе ----------

/** 1,5 → «1,5»; 175 → «175». */
function fmtDec(x: number): string {
  return x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

function fmtPct(x: number): string {
  return `${x.toFixed(1).replace('.', ',')} %`;
}

function fmtSize(paramsB: number): string {
  if (paramsB >= 1000) return `${fmtDec(paramsB / 1000)} трлн параметров`;
  if (paramsB >= 1) return `${fmtDec(paramsB)} млрд параметров`;
  return `${Math.max(1, Math.round(paramsB * 1000))} млн параметров`;
}

/** «$60», «$0,14», «$13,95». */
function fmtPrice(x: number): string {
  return `$${String(Number(x.toFixed(2))).replace('.', ',')}`;
}

/** «1 день», «3 дня», «45 дней». */
function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

/**
 * Цена для письма: обе цены каталога, если они разные («$30 за 1 млн входных и $60 за 1 млн выходных токенов»),
 * иначе одна («$60 за 1 млн токенов»; без цен в каталоге - defaultPricePer1M лаборатории). Если цену изменил ход
 * соперника (модификатор rivalPrice, цена ответной модели), показываем одну фактическую цену (rivalPriceIn).
 */
function priceText(s: GameState, def: RivalModelDef): string {
  const { priceIn, priceOut } = def;
  const price = rivalPriceIn(s, def);
  if (priceIn !== null && priceOut !== null && priceIn !== priceOut && price === rivalPrice(def, s.day)) {
    return `${fmtPrice(priceIn)} за 1 млн входных и ${fmtPrice(priceOut)} за 1 млн выходных токенов`;
  }
  return `${fmtPrice(price)} за 1 млн токенов`;
}

/** До двух реальных баллов по вышедшим бенчмаркам: сначала не насыщенные, потом самые трудные. */
function headlineScores(s: GameState, def: RivalModelDef): string[] {
  const list: { name: string; value: number; saturated: boolean; difficulty: number }[] = [];
  for (const bid of introducedBenchmarks(s)) {
    const value = def.scores[bid];
    if (typeof value !== 'number') continue;
    const b = benchDef(bid);
    list.push({ name: b.name, value, saturated: s.benchmarks[bid].saturated, difficulty: b.difficulty });
  }
  list.sort((a, b) => Number(a.saturated) - Number(b.saturated) || b.difficulty - a.difficulty);
  return list.slice(0, 2).map((x) => `${x.name} ${fmtPct(x.value)}`);
}

function releaseBody(s: GameState, def: RivalModelDef): string {
  const sentences: string[] = [];

  // Ход соперника ускорил выход (overrides.dayShift < 0).
  const shift = releaseShiftDays(s, def);
  if (shift > 0) sentences.push(`Вышла на ${daysWord(shift)} раньше, чем ожидалось.`);

  const specs: string[] = [];
  if (def.paramsB !== null) specs.push(fmtSize(def.paramsB));
  specs.push(...headlineScores(s, def));
  if (specs.length > 0) sentences.push(`${specs.join(', ')}.`);

  sentences.push(`Эло на «Арене» - ${rivalEloEstimated(s, def) ? '≈' : ''}${Math.round(rivalEloIn(s, def))}.`);

  const access: string[] = [];
  if (def.api) access.push(`цена API - ${priceText(s, def)}`);
  if (def.openWeights) access.push('веса открыты');
  if (access.length > 0) {
    const text = access.join(', ');
    sentences.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`);
  }
  return sentences.join(' ');
}

/**
 * Выпустить модель соперника (каталога или шаблона): добавить id в s.rivalsReleased, прибавить шумиху
 * лаборатории (leaderboard.releaseHypeBonus), письмо kind 'rival' с названием, лабораторией и 1-2 главными
 * баллами по вышедшим бенчмаркам; если ход соперника ускорил выход - «на N дней раньше».
 * Модель, которую только показали (announcedOnly), в заголовке «показала», а не «выпустила».
 * Модель, вышедшая до старта игры (день < 0), появляется молча: без письма и шумихи.
 * Уже выпущенную модель не трогает (false). Для ответных моделей rivalry.ts может вызывать её вместо своего кода.
 */
export function releaseRival(s: GameState, def: RivalModelDef): boolean {
  if (s.rivalsReleased.includes(def.id)) return false;
  s.rivalsReleased.push(def.id);
  if (rivalDayIn(s, def) < START_DAY) return true;

  const bonus = releaseHypeBonus(s, { kind: 'rival', id: def.id });
  s.hype[def.lab] = Math.min(100, (s.hype[def.lab] ?? 0) + bonus);
  addMail(s, {
    kind: 'rival',
    title: `${LAB_NAME.get(def.lab) ?? def.lab} ${def.announcedOnly ? 'показала' : 'выпустила'} ${def.gameName}`,
    body: releaseBody(s, def),
  });
  return true;
}

/**
 * Ежедневно: модели каталога с днём выхода ≤ сегодня (с учётом сдвига ходом соперника, rivalDayIn), которых нет
 * в s.rivalsReleased, - выпустить (releaseRival). Шаблоны ответных моделей выпускает сам rivalry.ts.
 */
export function releaseDue(s: GameState): void {
  const done = new Set(s.rivalsReleased);
  for (const def of RIVAL_MODELS) {
    if (done.has(def.id) || rivalDayIn(s, def) > s.day) continue;
    releaseRival(s, def);
  }
}

/**
 * Модели соперников на рынке: выпущены (каталог и ответные модели из rivalsReleased), (api || openWeights),
 * не только показаны (announcedOnly), не старше MARKET_MAX_AGE_DAYS по фактическому дню выхода (rivalDayIn),
 * по MARKET_MODELS_PER_LAB новейших на лабораторию (при равной дате - с большим Эло с поправками, rivalEloIn).
 * Порядок: по лабораториям, внутри - от новых к старым.
 */
export function marketRivals(s: GameState): RivalModelDef[] {
  interface Row {
    def: RivalModelDef;
    day: number;
    elo: number;
  }
  const perLab = new Map<LabId, Row[]>();
  for (const id of s.rivalsReleased) {
    const def = findRivalDef(id);
    if (!def || !(def.api || def.openWeights) || def.announcedOnly) continue;
    const day = rivalDayIn(s, def);
    if (s.day - day > MARKET_MAX_AGE_DAYS) continue;
    const row: Row = { def, day, elo: rivalEloIn(s, def) };
    const list = perLab.get(def.lab);
    if (list) list.push(row);
    else perLab.set(def.lab, [row]);
  }
  const out: RivalModelDef[] = [];
  for (const lab of LAB_IDS) {
    const list = perLab.get(lab);
    if (!list) continue;
    list.sort((a, b) => b.day - a.day || b.elo - a.elo || (a.def.id < b.def.id ? -1 : 1));
    for (const row of list.slice(0, MARKET_MODELS_PER_LAB)) out.push(row.def);
  }
  return out;
}
