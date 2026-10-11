// Таблица бенчмарков и Арена: строки, места, шумиха выпуска, насыщение (FR-5, FR-6). TSK-007.

import { RIVAL_MODELS } from '../data/rivalModels';
import { activeBenchmarks, benchDef, introducedBenchmarks } from './benchmarks';
import { HYPE_ARENA_TOP_BONUS, HYPE_RANK_BONUS } from './constants';
import { addMail } from './events';
import { findRivalDef, marketRivals, rivalDay, rivalEloEstimated, rivalScore } from './rivals';
import { rivalDayIn, rivalEloIn } from './rivalry';
import { END_DAY } from './time';
import { modelScore } from './training';
import type { BenchmarkId, GameState, HypeOwner, ModelRef, PlayerModel, RivalModelDef } from './types';

export interface BoardRow {
  ref: ModelRef;
  name: string;
  owner: HypeOwner; // лаборатория или 'player'
  releasedDay: number;
  /** Только вышедшие на сегодня бенчмарки. Игрок: показанный балл (modelScore honest=false). */
  scores: Partial<Record<BenchmarkId, { value: number; estimated: boolean }>>;
  elo: number;
  eloEstimated: boolean;
  flagged: boolean; // ⚠: разоблачённая модель игрока или соперник с contaminated
  exposed: boolean; // модель игрока разоблачена (баллы честные)
  onMarket: boolean;
}

// ---------- Внутренний список выпущенных моделей ----------

// Лёгкая запись без баллов: места считаются по одному бенчмарку, поэтому баллы берём лениво.
interface Entry {
  ref: ModelRef;
  owner: HypeOwner;
  releasedDay: number;
  order: number; // порядок выхода: при равных днях вышедшая позже считается новее
  elo: number;
  rival: RivalModelDef | null;
  model: PlayerModel | null;
}

/**
 * Все выпущенные модели: соперники (каталог и ответные модели) в порядке выхода, затем модели игрока.
 * День выхода и Эло соперников - с поправками ходов (rivalDayIn, rivalEloIn). Неизвестные id пропускаются.
 */
function entries(s: GameState): Entry[] {
  const out: Entry[] = [];
  let order = 0;
  for (const id of s.rivalsReleased) {
    const def = findRivalDef(id);
    if (!def) continue;
    out.push({ ref: { kind: 'rival', id }, owner: def.lab, releasedDay: rivalDayIn(s, def), order: order++, elo: rivalEloIn(s, def), rival: def, model: null });
  }
  for (const m of s.models) {
    if (m.releasedDay === null) continue;
    out.push({ ref: { kind: 'player', id: m.id }, owner: 'player', releasedDay: m.releasedDay, order: order++, elo: m.arenaElo, rival: null, model: m });
  }
  return out;
}

function entryName(e: Entry): string {
  return e.rival ? e.rival.gameName : (e.model as PlayerModel).name;
}

/** Показанный балл: у соперника реальный или оценка, у игрока - с подгонкой (честный, если разоблачён). */
function shownScore(e: Entry, bid: BenchmarkId): { value: number; estimated: boolean } {
  if (e.rival) return rivalScore(e.rival, bid);
  return { value: modelScore(e.model as PlayerModel, bid, false), estimated: false };
}

function sameRef(a: ModelRef, b: ModelRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** a обходит b при равных значениях: вышла раньше, а в один день - раньше по порядку. */
function earlier(a: Entry, b: Entry): boolean {
  return a.releasedDay < b.releasedDay || (a.releasedDay === b.releasedDay && a.order < b.order);
}

/** Место (с 1) модели ref среди list по value, по убыванию; null - модели нет в списке. */
function rankIn(list: Entry[], ref: ModelRef, value: (e: Entry) => number): number | null {
  const target = list.find((e) => sameRef(e.ref, ref));
  if (!target) return null;
  const mine = value(target);
  let rank = 1;
  for (const e of list) {
    if (e === target) continue;
    const v = value(e);
    if (v > mine || (v === mine && earlier(e, target))) rank++;
  }
  return rank;
}

/** Модель соперника продаётся по API: в каталоге api, и её не только показали. */
function rivalOnApi(def: RivalModelDef): boolean {
  return def.api && !def.announcedOnly;
}

/**
 * Модели, которые можно купить по API: выпущенные модели игрока с onApi и выпущенные модели соперников
 * с api (не announcedOnly). Возраст и число моделей на лабораторию не ограничены: это место «среди всех,
 * кого можно купить», а не среди витрины рынка (marketRivals).
 */
function onApiOnly(list: Entry[]): Entry[] {
  return list.filter((e) => (e.rival ? rivalOnApi(e.rival) : (e.model as PlayerModel).onApi));
}

// ---------- Таблица ----------

/** Все выпущенные модели (соперники из rivalsReleased + модели игрока с releasedDay), новые сверху. */
export function leaderboard(s: GameState): BoardRow[] {
  const list = entries(s);
  if (list.length === 0) return [];
  list.sort((a, b) => b.releasedDay - a.releasedDay || b.order - a.order);

  const shown = introducedBenchmarks(s);
  const market = new Set(marketRivals(s).map((d) => d.id));
  return list.map((e): BoardRow => {
    const scores: BoardRow['scores'] = {};
    for (const bid of shown) scores[bid] = shownScore(e, bid);
    if (e.rival) {
      return {
        ref: e.ref,
        name: e.rival.gameName,
        owner: e.owner,
        releasedDay: e.releasedDay,
        scores,
        elo: e.elo,
        eloEstimated: rivalEloEstimated(s, e.rival), // «≈»: оценочное Эло каталога или поправка хода соперника
        flagged: e.rival.contaminated,
        exposed: false,
        onMarket: market.has(e.rival.id),
      };
    }
    const m = e.model as PlayerModel;
    return {
      ref: e.ref,
      name: m.name,
      owner: 'player',
      releasedDay: e.releasedDay,
      scores,
      elo: e.elo,
      eloEstimated: false,
      flagged: m.exposed,
      exposed: m.exposed,
      onMarket: m.onApi,
    };
  });
}

/** Место (1 = лучший) по показанному баллу среди выпущенных моделей; null - бенчмарк не вышел или модели нет. */
export function benchRank(s: GameState, ref: ModelRef, bid: BenchmarkId): number | null {
  if (!s.benchmarks[bid]?.introduced) return null;
  return rankIn(entries(s), ref, (e) => shownScore(e, bid).value);
}

/** Место на Арене по Эло среди всех выпущенных моделей. */
export function arenaRank(s: GameState, ref: ModelRef): number | null {
  return rankIn(entries(s), ref, (e) => e.elo);
}

/**
 * Место на Арене среди моделей, доступных по API на день s.day (см. onApiOnly): по нему считаются
 * победа в конце игры, месяцы на 1-м месте (monthsFirst) и оценка инвесторов. null - модели нет среди них.
 */
export function marketArenaRank(s: GameState, ref: ModelRef): number | null {
  return rankIn(onApiOnly(entries(s)), ref, (e) => e.elo);
}

/**
 * Планка победы: наибольшее Эло среди моделей соперников с API (не announcedOnly), которые выйдут
 * до конца игры включительно. Столько нужно обойти к 31.12.2024; от текущего состояния не зависит.
 * Считается по каталогу без поправок и ответных моделей (в интерфейсе: «или выше, если соперники ускорятся»).
 */
export function expectedLeaderElo(_s: GameState): number {
  let best = 0;
  for (const def of RIVAL_MODELS) {
    if (!rivalOnApi(def) || rivalDay(def) > END_DAY) continue;
    if (def.arenaElo > best) best = def.arenaElo;
  }
  return best;
}

/** Бонус шумихи при выпуске модели: по активным бенчмаркам места 1/2/3 → HYPE_RANK_BONUS, №1 Арены → +HYPE_ARENA_TOP_BONUS. */
export function releaseHypeBonus(s: GameState, ref: ModelRef): number {
  const list = entries(s);
  let bonus = 0;
  for (const bid of activeBenchmarks(s)) {
    const rank = rankIn(list, ref, (e) => shownScore(e, bid).value);
    if (rank !== null && rank <= HYPE_RANK_BONUS.length) bonus += HYPE_RANK_BONUS[rank - 1];
  }
  if (rankIn(list, ref, (e) => e.elo) === 1) bonus += HYPE_ARENA_TOP_BONUS;
  return bonus;
}

/** Лучший Эло среди выпущенных моделей владельца (или 0); у соперников - с поправками ходов (rivalEloIn). */
export function bestElo(s: GameState, owner: HypeOwner): number {
  let best = 0;
  if (owner === 'player') {
    for (const m of s.models) if (m.releasedDay !== null && m.arenaElo > best) best = m.arenaElo;
    return best;
  }
  for (const id of s.rivalsReleased) {
    const def = findRivalDef(id);
    if (!def || def.lab !== owner) continue;
    const elo = rivalEloIn(s, def);
    if (elo > best) best = elo;
  }
  return best;
}

// ---------- Насыщение ----------

// Оценочные баллы соперников (≈) насыщения не вызывают: «почти максимум» должен быть опубликованным результатом,
// а не нашей догадкой по Эло (иначе GPQE и SWE-banch «насытились» бы моделью, у которой нет ни одного балла).
// true - считать и оценки, как «показанные» баллы таблицы.
const SATURATION_COUNTS_ESTIMATES = false;

function fmtPct(x: number): string {
  return `${x.toFixed(1).replace('.', ',')} %`;
}

/**
 * Балл для проверки насыщения: у соперника - опубликованный (оценки не в счёт, см. SATURATION_COUNTS_ESTIMATES),
 * у игрока - честный, без подгонки. Иначе подогнанная модель сама «насыщала» бы свой бенчмарк и уходила
 * от разоблачения.
 */
function saturationScore(e: Entry, bid: BenchmarkId): { value: number; estimated: boolean } {
  if (e.rival) return rivalScore(e.rival, bid);
  return { value: modelScore(e.model as PlayerModel, bid, true), estimated: false };
}

/**
 * Проверить насыщение активных бенчмарков по лучшему баллу (saturationScore); насыщенные - флаг и письмо
 * kind 'benchmark'. Повторно письмо не приходит.
 */
export function updateSaturation(s: GameState): void {
  const active = activeBenchmarks(s);
  if (active.length === 0) return;
  const list = entries(s);
  if (list.length === 0) return;
  for (const bid of active) {
    const def = benchDef(bid);
    let best = -Infinity;
    let leader: Entry | null = null;
    for (const e of list) {
      const sc = saturationScore(e, bid);
      if (sc.estimated && !SATURATION_COUNTS_ESTIMATES) continue;
      if (sc.value > best) {
        best = sc.value;
        leader = e;
      }
    }
    if (leader === null || best < def.saturation) continue;
    s.benchmarks[bid].saturated = true;
    addMail(s, {
      kind: 'benchmark',
      title: `Бенчмарк ${def.name} насыщен`,
      body:
        `Лучший результат на ${def.name} - ${fmtPct(best)} (${entryName(leader)}). ` +
        'Бенчмарк больше не различает сильные модели и не влияет на шумиху и тендеры. ' +
        'В таблице он отмечен серым.',
    });
  }
}
