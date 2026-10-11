// Окно «Рейтинги» (FR-5, FR-6, FR-7.3/4): вкладки «Бенчмарки» и «Арена».

import { useState } from 'react';
import type { WindowProps } from '.';
import { BENCHMARKS } from '../../data/benchmarks';
import { LABS, PLAYER_COLOR } from '../../data/labs';
import { ARENA_OPEN_DATE } from '../../sim/constants';
import { leaderboard, type BoardRow } from '../../sim/leaderboard';
import { dateToDay, formatDateShort } from '../../sim/time';
import type { BenchmarkDef, BenchmarkId, GameState } from '../../sim/types';
import { Empty, Stat, Tabs } from '../components/common';
import { fmtElo, fmtNum, fmtPct } from '../format';

type TabId = 'bench' | 'arena';
type SortDir = 'asc' | 'desc';

const BENCH_ROW_LIMIT = 40;
const ARENA_ROW_LIMIT = 60;

const TIP_ESTIMATE = 'оценка: лаборатория не публиковала этот балл';
const TIP_ELO_ESTIMATE = 'оценка: точный рейтинг этой модели на Арене неизвестен';
const TIP_SATURATED =
  'Бенчмарк насыщен: лучшие модели уже набирают почти максимум, поэтому он больше не влияет на шумиху и тендеры.';

const rowKey = (r: BoardRow) => `${r.ref.kind}:${r.ref.id}`;

function ownerInfo(s: GameState, r: BoardRow): { name: string; color: string } {
  if (r.owner === 'player') return { name: s.labName, color: PLAYER_COLOR };
  const lab = LABS.find((l) => l.id === r.owner);
  return { name: lab ? lab.name : String(r.owner), color: lab ? lab.color : PLAYER_COLOR };
}

function OwnerCell({ s, row }: { s: GameState; row: BoardRow }) {
  const o = ownerInfo(s, row);
  return <td style={{ color: o.color }}>{o.name}</td>;
}

function NameCell({ row, withFlag }: { row: BoardRow; withFlag: boolean }) {
  const flagTitle = row.owner === 'player' ? 'подгонка под тесты' : 'есть сообщения об утечке тестов';
  return (
    <td>
      {withFlag && row.flagged && (
        <span className="warn" title={flagTitle} style={{ marginRight: 4 }}>
          ⚠
        </span>
      )}
      {row.name}
    </td>
  );
}

/** Новейший активный (ненасыщенный) бенчмарк; если все насыщены — новейший из вышедших. */
function defaultSortKey(s: GameState, active: BenchmarkDef[]): BenchmarkId | null {
  if (active.length === 0) return null;
  const live = active.filter((b) => !s.benchmarks[b.id].saturated);
  const pool = live.length > 0 ? live : active;
  return pool.reduce((a, b) => (b.introduced > a.introduced ? b : a)).id;
}

function BenchTable(props: {
  s: GameState;
  rows: BoardRow[];
  active: BenchmarkDef[];
  sortKey: BenchmarkId | null;
  dir: SortDir;
  onSort: (id: BenchmarkId) => void;
  onlyMarket: boolean;
  setOnlyMarket: (v: boolean) => void;
}) {
  const { s, rows, active, sortKey, dir, onSort, onlyMarket, setOnlyMarket } = props;

  const filtered = onlyMarket ? rows.filter((r) => r.onMarket) : rows;
  const sorted = filtered.slice();
  if (sortKey) {
    sorted.sort((a, b) => {
      const va = a.scores[sortKey]?.value;
      const vb = b.scores[sortKey]?.value;
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // пустые всегда внизу
      if (vb == null) return -1;
      return dir === 'desc' ? vb - va : va - vb;
    });
  }
  const shown = sorted.slice(0, BENCH_ROW_LIMIT);
  const hidden = sorted.length - shown.length;

  return (
    <div className="col">
      <div className="row">
        <label className="row" style={{ gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyMarket} onChange={(e) => setOnlyMarket(e.target.checked)} />
          Только модели на рынке
        </label>
      </div>
      <div className="muted small">
        Нажмите на название бенчмарка, чтобы отсортировать таблицу (ещё раз — в обратную сторону). Значок «≈» — оценка:
        лаборатория этот балл не публиковала. Значок «⚠» — подгонка под тесты или сообщения об утечке тестов.
      </div>
      {active.length === 0 ? (
        <Empty>Пока не вышел ни один бенчмарк.</Empty>
      ) : shown.length === 0 ? (
        <Empty>{onlyMarket ? 'Сейчас на рынке нет ни одной модели.' : 'Пока ни одна модель не выпущена.'}</Empty>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Модель</th>
              <th>Владелец</th>
              <th>Выпущена</th>
              {active.map((b) => {
                const saturated = s.benchmarks[b.id].saturated;
                const arrow = sortKey === b.id ? (dir === 'desc' ? ' ▼' : ' ▲') : '';
                const title = saturated ? `${b.description} ${TIP_SATURATED}` : b.description;
                return (
                  <th key={b.id} className={`sortable num${saturated ? ' dim' : ''}`} title={title} onClick={() => onSort(b.id)}>
                    {b.name}
                    {saturated ? ' (насыщен)' : ''}
                    {arrow}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)} className={r.owner === 'player' ? 'player' : undefined}>
                <NameCell row={r} withFlag />
                <OwnerCell s={s} row={r} />
                <td>{formatDateShort(r.releasedDay)}</td>
                {active.map((b) => {
                  const sc = r.scores[b.id];
                  if (!sc) {
                    return (
                      <td key={b.id} className="num muted">
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={b.id} className="num">
                      {sc.estimated ? (
                        <span className="est" title={TIP_ESTIMATE}>
                          ≈{fmtPct(sc.value, 1)}
                        </span>
                      ) : (
                        fmtPct(sc.value, 1)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hidden > 0 && (
        <div className="muted small">
          Показаны первые {fmtNum(shown.length)} моделей, ещё {fmtNum(hidden)} скрыто. Включите фильтр «Только модели на
          рынке» или смените сортировку, чтобы увидеть остальные.
        </div>
      )}
    </div>
  );
}

function ArenaTable({ s, rows }: { s: GameState; rows: BoardRow[] }) {
  const arenaOpen = s.day >= dateToDay(ARENA_OPEN_DATE);

  // Места считаются по всему списку, даже если часть строк скрыта.
  const ranked = rows
    .slice()
    .sort((a, b) => b.elo - a.elo)
    .map((r, i) => ({ row: r, rank: i + 1 }));
  const shown = ranked.filter((x) => x.rank <= ARENA_ROW_LIMIT || x.row.owner === 'player');
  const hidden = ranked.length - shown.length;

  const bestPlayer = ranked.find((x) => x.row.owner === 'player') ?? null;
  const leader = ranked[0] ?? null;

  return (
    <div className="col">
      <div className="muted small">
        «Арена» — пользователи вслепую сравнивают ответы моделей; подгонка под тесты здесь не помогает. Цель игры — №1 к
        концу 2024 года.
        {!arenaOpen && ' Арена откроется в мае 2023 года; до этого здесь оценка качества по отзывам клиентов.'}
      </div>
      <div className="row">
        <Stat
          label="Ваше лучшее место"
          value={bestPlayer ? `№${fmtNum(bestPlayer.rank)}` : '—'}
          hint={
            bestPlayer
              ? `из ${fmtNum(ranked.length)} моделей · Эло ${fmtElo(bestPlayer.row.elo)}`
              : 'у вас пока нет выпущенных моделей'
          }
        />
        <Stat
          label="Лидер рейтинга"
          value={leader ? fmtElo(leader.row.elo) : '—'}
          hint={leader ? `${leader.row.name} · ${ownerInfo(s, leader.row).name}` : undefined}
        />
      </div>
      {shown.length === 0 ? (
        <Empty>Пока ни одна модель не выпущена.</Empty>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th className="num">№</th>
              <th>Модель</th>
              <th>Владелец</th>
              <th className="num" title="Рейтинг Эло: чем выше, тем чаще пользователи выбирают ответы модели">
                Эло
              </th>
              <th>Выпущена</th>
              <th>Рынок</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row: r, rank }) => (
              <tr key={rowKey(r)} className={r.owner === 'player' ? 'player' : undefined}>
                <td className="num">{fmtNum(rank)}</td>
                <NameCell row={r} withFlag={false} />
                <OwnerCell s={s} row={r} />
                <td className="num">
                  {r.eloEstimated ? (
                    <span className="est" title={TIP_ELO_ESTIMATE}>
                      ≈{fmtElo(r.elo)}
                    </span>
                  ) : (
                    fmtElo(r.elo)
                  )}
                </td>
                <td>{formatDateShort(r.releasedDay)}</td>
                <td>
                  {r.onMarket ? (
                    <span className="good small" title="Модель сейчас продаётся клиентам">
                      на рынке
                    </span>
                  ) : (
                    ''
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hidden > 0 && (
        <div className="muted small">
          Показаны первые {fmtNum(ARENA_ROW_LIMIT)} моделей (и все ваши), ещё {fmtNum(hidden)} скрыто — это самые слабые
          модели рейтинга.
        </div>
      )}
    </div>
  );
}

export default function RatingsWindow({ s }: WindowProps) {
  const [tab, setTab] = useState<TabId>('bench');
  const [sortKey, setSortKey] = useState<BenchmarkId | null>(null);
  const [dir, setDir] = useState<SortDir>('desc');
  const [onlyMarket, setOnlyMarket] = useState(false);

  let rows: BoardRow[] | null = null;
  try {
    rows = leaderboard(s);
  } catch {
    rows = null;
  }

  const active = BENCHMARKS.filter((b) => s.benchmarks[b.id]?.introduced);
  const defKey = defaultSortKey(s, active);
  const effKey = sortKey && active.some((b) => b.id === sortKey) ? sortKey : defKey;

  const onSort = (id: BenchmarkId) => {
    if (effKey === id) {
      setSortKey(id);
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(id);
      setDir('desc');
    }
  };

  return (
    <div className="col">
      <Tabs
        tabs={[
          { id: 'bench' as const, label: 'Бенчмарки' },
          { id: 'arena' as const, label: 'Арена' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {rows === null ? (
        <Empty>Не удалось построить таблицу рейтингов. Попробуйте открыть окно ещё раз чуть позже.</Empty>
      ) : tab === 'bench' ? (
        <BenchTable
          s={s}
          rows={rows}
          active={active}
          sortKey={effKey}
          dir={dir}
          onSort={onSort}
          onlyMarket={onlyMarket}
          setOnlyMarket={setOnlyMarket}
        />
      ) : (
        <ArenaTable s={s} rows={rows} />
      )}
    </div>
  );
}
