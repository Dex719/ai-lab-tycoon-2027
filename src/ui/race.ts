// Гонка в окнах: по какому показателю идёт борьба сейчас и таблица мест - те же правила, что у верхней панели
// (sim/leaderboard.arenaStanding): пока соперники не продают модели по API, место считается по главному тесту
// среди всех вышедших моделей (кроме только показанных), потом - по Эло на «Арене» среди моделей в продаже.

import { findRivalDefIn } from '../sim/rivalry';
import { arenaStanding, leaderboard, marketArenaRank, raceBenchmark, rivalsSellByApi, type BoardRow, type RaceMetric } from '../sim/leaderboard';
import { benchDef } from '../sim/benchmarks';
import type { GameState, HypeOwner, PlayerModel } from '../sim/types';

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

/** Показатель гонки сейчас; null - гонки ещё нет (тест не вышел). */
export function raceMetricOf(s: GameState): RaceMetric | null {
  const st = safe(() => arenaStanding(s));
  if (st) return st.metric;
  if (safe(() => rivalsSellByApi(s))) return { kind: 'arena' };
  const bid = raceBenchmark(s);
  return s.benchmarks[bid]?.introduced ? { kind: 'bench', bid, name: benchDef(bid).name } : null;
}

export interface RaceRow {
  row: BoardRow;
  key: string;
  owner: HypeOwner;
  /** Эло или балл теста. */
  value: number;
  estimated: boolean;
  /** Модель идёт в зачёт гонки: на «Арене» - продаётся по API, в гонке по тесту - не только показана. */
  counted: boolean;
  /** Место среди моделей в зачёте; null - не в зачёте. */
  rank: number | null;
}

function announced(r: BoardRow): boolean {
  return r.ref.kind === 'rival' && !!findRivalDefIn(r.ref.id)?.announcedOnly;
}

/** Модель в продаже: ваша - на API, соперника - с API и не только показана. */
function onSale(r: BoardRow): boolean {
  if (r.ref.kind === 'player') return r.onMarket;
  const def = findRivalDefIn(r.ref.id);
  return !!def && def.api && !def.announcedOnly;
}

/** Все вышедшие модели по убыванию показателя гонки: места только у моделей в зачёте. */
export function raceRows(s: GameState, metric: RaceMetric): RaceRow[] {
  const rows = safe(() => leaderboard(s)) ?? [];
  const list: RaceRow[] = [];
  for (const r of rows) {
    const key = `${r.ref.kind}:${r.ref.id}`;
    if (metric.kind === 'arena') {
      list.push({ row: r, key, owner: r.owner, value: r.elo, estimated: r.eloEstimated, counted: onSale(r), rank: null });
    } else {
      const sc = r.scores[metric.bid];
      if (!sc) continue;
      list.push({ row: r, key, owner: r.owner, value: sc.value, estimated: sc.estimated, counted: !announced(r), rank: null });
    }
  }
  // leaderboard идёт от новых к старым: при равенстве выше модель, вышедшая раньше.
  list.reverse().sort((a, b) => b.value - a.value || a.row.releasedDay - b.row.releasedDay);
  let place = 0;
  for (const x of list) {
    if (!x.counted) continue;
    place++;
    x.rank = metric.kind === 'arena' ? (safe(() => marketArenaRank(s, x.row.ref)) ?? place) : place;
  }
  return list;
}

/** Место одной модели игрока в гонке; null - модель не в зачёте или гонки нет. */
export function modelRacePlace(s: GameState, m: Pick<PlayerModel, 'id' | 'releasedDay'>, metric: RaceMetric | null): number | null {
  if (!metric || m.releasedDay === null) return null;
  return raceRows(s, metric).find((x) => x.row.ref.kind === 'player' && x.row.ref.id === m.id)?.rank ?? null;
}
