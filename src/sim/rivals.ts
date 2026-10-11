// Модели соперников: способности по реальным баллам, оценки пропусков, выходы по календарю (FR-12). TSK-007.

import { LABS } from '../data/labs';
import { RIVAL_MODELS } from '../data/rivalModels';
import { benchDef, benchScore, capFromScore, introducedBenchmarks } from './benchmarks';
import { MARKET_MAX_AGE_DAYS, MARKET_MODELS_PER_LAB } from './constants';
import { addMail } from './events';
import { releaseHypeBonus } from './leaderboard';
import { byYear, dateToDay, START_DAY, yearOf } from './time';
import { DOMAINS, LAB_IDS } from './types';
import type { BenchmarkId, DomainId, GameState, LabId, RivalModelDef } from './types';

// ---------- Каталог ----------

const BY_ID = new Map<string, RivalModelDef>(RIVAL_MODELS.map((m) => [m.id, m]));

// Способность из Эло для моделей без опубликованных баллов: cap = (Эло − 374) / 11,7.
export const RIVAL_CAP_ELO_ZERO = 374;
export const RIVAL_CAP_ELO_PER_POINT = 11.7;
const LAB_NAME = new Map<LabId, string>(LABS.map((l) => [l.id, l.name]));

// День выхода по дате: строки дат повторяются, а разбор даты - не бесплатный.
const DAY_BY_DATE = new Map<string, number>();

/** Модель каталога или undefined (в сохранении мог остаться id, которого уже нет в каталоге). */
export function findRivalDef(id: string): RivalModelDef | undefined {
  return BY_ID.get(id);
}

export function rivalDef(id: string): RivalModelDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Нет модели соперника ${id}`);
  return def;
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

/** Смешанная цена (3·in + out)/4; если в каталоге пусто - defaultPricePer1M лаборатории на год дня day. */
export function rivalPrice(def: RivalModelDef, day: number): number {
  const { priceIn, priceOut } = def;
  if (priceIn !== null && priceOut !== null) return (3 * priceIn + priceOut) / 4;
  if (priceIn !== null) return priceIn;
  if (priceOut !== null) return priceOut;
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

  const specs: string[] = [];
  if (def.paramsB !== null) specs.push(fmtSize(def.paramsB));
  specs.push(...headlineScores(s, def));
  if (specs.length > 0) sentences.push(`${specs.join(', ')}.`);

  sentences.push(`Эло на «Арене» - ${def.arenaEstimated ? '≈' : ''}${Math.round(def.arenaElo)}.`);

  const access: string[] = [];
  if (def.api) access.push(`цена API - ${fmtPrice(rivalPrice(def, s.day))} за 1М токенов`);
  if (def.openWeights) access.push('веса открыты');
  if (access.length > 0) {
    const text = access.join(', ');
    sentences.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`);
  }
  return sentences.join(' ');
}

/**
 * Ежедневно: модели каталога с датой ≤ сегодня, которых нет в s.rivalsReleased, - выпустить:
 * добавить id, прибавить шумиху лаборатории (leaderboard.releaseHypeBonus), письмо kind 'rival'
 * с названием, лабораторией и 1-2 главными баллами по вышедшим бенчмаркам.
 * Модели, вышедшие до старта игры (день < 0), появляются молча: без письма и шумихи.
 */
export function releaseDue(s: GameState): void {
  const done = new Set(s.rivalsReleased);
  for (const def of RIVAL_MODELS) {
    if (done.has(def.id)) continue;
    const day = rivalDay(def);
    if (day > s.day) continue;
    s.rivalsReleased.push(def.id);
    done.add(def.id);
    if (day < START_DAY) continue;

    const bonus = releaseHypeBonus(s, { kind: 'rival', id: def.id });
    s.hype[def.lab] = Math.min(100, (s.hype[def.lab] ?? 0) + bonus);
    addMail(s, {
      kind: 'rival',
      title: `${LAB_NAME.get(def.lab) ?? def.lab} выпустила ${def.gameName}`,
      body: releaseBody(s, def),
    });
  }
}

/**
 * Модели соперников на рынке: выпущены, (api || openWeights), не старше MARKET_MAX_AGE_DAYS,
 * по MARKET_MODELS_PER_LAB новейших на лабораторию (при равной дате - с большим Эло).
 * Порядок: по лабораториям, внутри - от новых к старым.
 */
export function marketRivals(s: GameState): RivalModelDef[] {
  const perLab = new Map<LabId, RivalModelDef[]>();
  for (const id of s.rivalsReleased) {
    const def = BY_ID.get(id);
    if (!def || !(def.api || def.openWeights)) continue;
    if (s.day - rivalDay(def) > MARKET_MAX_AGE_DAYS) continue;
    const list = perLab.get(def.lab);
    if (list) list.push(def);
    else perLab.set(def.lab, [def]);
  }
  const out: RivalModelDef[] = [];
  for (const lab of LAB_IDS) {
    const list = perLab.get(lab);
    if (!list) continue;
    list.sort((a, b) => rivalDay(b) - rivalDay(a) || b.arenaElo - a.arenaElo || (a.id < b.id ? -1 : 1));
    out.push(...list.slice(0, MARKET_MODELS_PER_LAB));
  }
  return out;
}
