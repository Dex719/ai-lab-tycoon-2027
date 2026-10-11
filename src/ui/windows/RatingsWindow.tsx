// Вкладки «Бенчмарки» (баллы моделей по бенчмаркам) и «Арена» (рейтинг по Эло).

import { useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { BENCHMARKS } from '../../data/benchmarks';
import { expectedLeaderElo, leaderboard, marketArenaRank, type BoardRow } from '../../sim/leaderboard';
import { contextLabel } from '../../sim/research';
import { findRivalDefIn, rivalContextIn } from '../../sim/rivalry';
import { playerBestArenaRank } from '../../sim/tick';
import { END_DAY, formatDateShort } from '../../sim/time';
import type { BenchmarkDef, BenchmarkId, GameState } from '../../sim/types';
import { fmtElo, fmtNum, fmtPct } from '../format';
import { IconAlert, IconLock } from '../icons';
import { fmtRank } from '../labels';
import { finite, ownerColor, ownerName, OwnerTag, safe, StatStrip } from './analyticsShared';

type SortKey = 'name' | 'owner' | 'date' | 'context' | BenchmarkId;
type SortDir = 'asc' | 'desc';
interface Sort {
  key: SortKey;
  dir: SortDir;
}

const TIP_ESTIMATE = 'Оценка: лаборатория не публиковала этот балл';
const TIP_SATURATED = 'Бенчмарк насыщен: не влияет на шумиху и тендеры.';

const rowKey = (r: BoardRow) => `${r.ref.kind}:${r.ref.id}`;

const TIP_CONTEXT = 'Длина контекста, токенов';
const TIP_ELO_UNKNOWN = 'Оценка: точный рейтинг неизвестен';
const TIP_ELO_BOOSTED = 'Оценка: модель усилена под давлением';

/**
 * Контекст модели из строки рейтинга: у соперника - из каталога с поправкой хода соперника (rivalContextIn),
 * у вашей - из плана обучения; 0, если неизвестен.
 */
export function rowContext(s: GameState, r: BoardRow): number {
  if (r.ref.kind === 'rival') {
    const def = findRivalDefIn(r.ref.id);
    return def ? rivalContextIn(s, def) : 0;
  }
  const id = r.ref.id;
  return s.models.find((m) => m.id === id)?.plan.context ?? 0;
}

/** Эло соперника поднято ходом соперника (rivalry.overrides[id].eloAdd): в таблице оно показывается как оценка «≈». */
export function isEloBoosted(s: GameState, r: BoardRow): boolean {
  return r.ref.kind === 'rival' && (s.rivalry.overrides[r.ref.id]?.eloAdd ?? 0) > 0;
}

/** Контекст модели: «128 тыс.», «1 млн»; если контекст неизвестен - «-». */
const ctxLabel = (tokens: number): string => (tokens > 0 ? contextLabel(tokens) : '-');

/** Модель соперника, которую только показали (статья, демо): в продажу она не выходила, дата в строке - дата анонса. */
export function isAnnouncedRow(r: BoardRow): boolean {
  return r.ref.kind === 'rival' && !!findRivalDefIn(r.ref.id)?.announcedOnly;
}

const TIP_DATE_MIXED = 'Дата выпуска; у показанных моделей - дата анонса';
const TIP_ANNOUNCED = 'Модель только показали: в продажу она не выходила';

/** Заголовок столбца даты: «Выпущена», а если среди строк есть только показанные модели - «Дата». */
export function dateHeader(rows: BoardRow[]): { label: string; title?: string } {
  return rows.some(isAnnouncedRow) ? { label: 'Дата', title: TIP_DATE_MIXED } : { label: 'Выпущена' };
}

/** Ячейка даты: у показанной модели рядом пометка «показана». */
function DateCell({ row }: { row: BoardRow }) {
  return (
    <td>
      {formatDateShort(row.releasedDay)}
      {isAnnouncedRow(row) && (
        <span className="est" title={TIP_ANNOUNCED}>
          {' '}
          показана
        </span>
      )}
    </td>
  );
}

/** Подсказка к значку предупреждения: у вашей модели - раскрытая подгонка, у соперника - сообщения об утечке. */
function flagTitle(r: BoardRow): string {
  return r.owner === 'player' ? 'Подгонка под бенчмарки раскрыта' : 'Были сообщения об утечке бенчмарка';
}

function Flag({ row }: { row: BoardRow }) {
  return row.flagged ? (
    <span className="flag" title={flagTitle(row)}>
      <IconAlert size={14} />
    </span>
  ) : null;
}

// ---------- Бенчмарки ----------

/** Сортировка по умолчанию: новейший ещё не насыщенный бенчмарк (если все насыщены, то новейший из вышедших), по убыванию. */
function defaultSort(s: GameState, active: BenchmarkDef[]): Sort {
  if (active.length === 0) return { key: 'date', dir: 'desc' };
  const live = active.filter((b) => !s.benchmarks[b.id].saturated);
  const pool = live.length > 0 ? live : active;
  return { key: pool.reduce((a, b) => (b.introduced > a.introduced ? b : a)).id, dir: 'desc' };
}

function isStaticKey(k: SortKey): boolean {
  return k === 'name' || k === 'owner' || k === 'date' || k === 'context';
}

function Th(props: {
  id: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  num?: boolean;
  muted?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const on = props.sort.key === props.id;
  return (
    <th
      className={`sortable${props.num ? ' num' : ''}${props.muted ? ' sat' : ''}`}
      title={props.title}
      aria-sort={on ? (props.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button className="th-btn" onClick={() => props.onSort(props.id)}>
        {props.children}
        {on && <i className={`sort-mark ${props.sort.dir}`} />}
      </button>
    </th>
  );
}

function compareRows(s: GameState, sort: Sort, a: BoardRow, b: BoardRow): number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  switch (sort.key) {
    case 'name':
      return sign * a.name.localeCompare(b.name, 'ru');
    case 'owner':
      return sign * ownerName(s, a.owner).localeCompare(ownerName(s, b.owner), 'ru');
    case 'date':
      return sign * (a.releasedDay - b.releasedDay);
    case 'context':
      return sign * (rowContext(s, a) - rowContext(s, b));
    default: {
      const va = a.scores[sort.key]?.value;
      const vb = b.scores[sort.key]?.value;
      if (va === undefined && vb === undefined) return 0;
      if (va === undefined) return 1; // пустые всегда внизу
      if (vb === undefined) return -1;
      return sign * (va - vb);
    }
  }
}

export function BenchmarksTab({ s }: WindowProps) {
  const [sortState, setSort] = useState<Sort | null>(null);
  const [onlyMarket, setOnlyMarket] = useState(false);

  const rows = safe(() => leaderboard(s));
  const active = BENCHMARKS.filter((b) => s.benchmarks[b.id]?.introduced);
  const sort: Sort =
    sortState && (isStaticKey(sortState.key) || active.some((b) => b.id === sortState.key))
      ? sortState
      : defaultSort(s, active);

  const onSort = (key: SortKey) =>
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'name' || key === 'owner' ? 'asc' : 'desc' },
    );

  const shown = (rows ?? []).filter((r) => !onlyMarket || r.onMarket).sort((a, b) => compareRows(s, sort, a, b));

  // Лучший опубликованный балл в каждом столбце.
  const best: Partial<Record<BenchmarkId, number>> = {};
  for (const r of shown) {
    for (const b of active) {
      const sc = r.scores[b.id];
      if (sc && !sc.estimated && sc.value > (best[b.id] ?? -Infinity)) best[b.id] = sc.value;
    }
  }

  const date = dateHeader(shown);

  let body: ReactNode;
  if (rows === null) body = <div className="an-empty">Не удалось построить таблицу.</div>;
  else if (active.length === 0) body = <div className="an-empty">Бенчмарки пока не вышли.</div>;
  else if (shown.length === 0)
    body = <div className="an-empty">{onlyMarket ? 'На рынке нет моделей.' : 'Выпущенных моделей нет.'}</div>;
  else
    body = (
      <div className="an-scroll">
        <table className="grid an-grid">
          <thead>
            <tr>
              <Th id="name" sort={sort} onSort={onSort}>
                Модель
              </Th>
              <Th id="owner" sort={sort} onSort={onSort}>
                Лаборатория
              </Th>
              <Th id="date" sort={sort} onSort={onSort} title={date.title}>
                {date.label}
              </Th>
              <Th id="context" sort={sort} onSort={onSort} num title={TIP_CONTEXT}>
                Контекст
              </Th>
              {active.map((b) => {
                const saturated = s.benchmarks[b.id].saturated;
                return (
                  <Th
                    key={b.id}
                    id={b.id}
                    sort={sort}
                    onSort={onSort}
                    num
                    muted={saturated}
                    title={saturated ? `${b.description} ${TIP_SATURATED}` : b.description}
                  >
                    {saturated && <IconLock size={12} />}
                    {b.name}
                  </Th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)} className={r.owner === 'player' ? 'player' : undefined}>
                <td>
                  <Flag row={r} />
                  {r.name}
                </td>
                <td>
                  <OwnerTag s={s} owner={r.owner} />
                </td>
                <DateCell row={r} />
                <td className="num">{ctxLabel(rowContext(s, r))}</td>
                {active.map((b) => {
                  const sc = r.scores[b.id];
                  const cls = `num${s.benchmarks[b.id].saturated ? ' sat' : ''}`;
                  if (!sc) {
                    return (
                      <td key={b.id} className={`${cls} muted`}>
                        -
                      </td>
                    );
                  }
                  if (sc.estimated) {
                    return (
                      <td key={b.id} className={cls}>
                        <span className="est" title={TIP_ESTIMATE}>
                          ≈{fmtPct(sc.value, 1)}
                        </span>
                      </td>
                    );
                  }
                  const top = sc.value === best[b.id];
                  return (
                    <td key={b.id} className={`${cls}${top ? ' top' : ''}`} title={top ? 'Лучший результат в таблице' : undefined}>
                      {fmtPct(sc.value, 1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="an-page fill">
      <div className="an-toolbar">
        <label className="an-check">
          <input type="checkbox" checked={onlyMarket} onChange={(e) => setOnlyMarket(e.target.checked)} />
          Только на рынке
        </label>
        <span className="muted">Моделей: {fmtNum(shown.length)}</span>
        <span className="grow" />
        <span className="an-key">
          <b>≈</b> оценка
        </span>
        <span className="an-key">
          <span className="flag">
            <IconAlert size={14} />
          </span>
          утечка бенчмарка или подгонка
        </span>
      </div>
      {body}
    </div>
  );
}

// ---------- Арена ----------

const TIP_RANK = 'Место среди моделей в продаже: тех, что продаются через API';
const TIP_NOT_SALE = 'Модель не продаётся через API: в зачёт цели не идёт';
const TIP_GOAL = 'Победа: ваша модель первая по Эло среди моделей в продаже 31.12.2024';
const TIP_EXPECTED = 'Лучший Эло среди моделей соперников, которые будут продаваться через API к концу 2024 года';
const TIP_MONTHS = 'Закрытые месяцы, когда ваша лучшая модель была первой среди моделей в продаже';

/** Модель в продаже: ваша - выпущена и на API, соперника - выпущена с API и не только показана. Только такие идут в зачёт цели. */
export function inSaleRow(r: BoardRow): boolean {
  if (r.ref.kind === 'player') return r.onMarket;
  const def = findRivalDefIn(r.ref.id);
  return !!def && def.api && !def.announcedOnly;
}

export interface ArenaRow {
  row: BoardRow;
  inSale: boolean;
  /** Место среди моделей в продаже (sim/leaderboard.marketArenaRank); null - модель не в продаже. */
  rank: number | null;
}

/** Строки Арены: больше Эло - выше; при равенстве выше модель, вышедшая раньше (порядок как в sim/leaderboard). */
export function arenaRows(s: GameState, rows: BoardRow[]): ArenaRow[] {
  return rows
    .slice()
    .reverse()
    .sort((a, b) => b.elo - a.elo || a.releasedDay - b.releasedDay)
    .map((row) => {
      const inSale = inSaleRow(row);
      return { row, inSale, rank: inSale ? marketArenaRank(s, row.ref) : null };
    });
}

/** Эло ожидаемого лидера, округлённое до десятков; null - рассчитать не удалось. */
export function expectedLeaderElo10(s: GameState): number | null {
  const elo = safe(() => expectedLeaderElo(s));
  return elo !== null && Number.isFinite(elo) ? Math.round(elo / 10) * 10 : null;
}

export function ArenaTab({ s }: WindowProps) {
  const rows = safe(() => leaderboard(s));

  const ranked = arenaRows(s, rows ?? []);
  const onSale = ranked.filter((x) => x.inSale).length;
  const mine = ranked.find((x) => x.row.owner === 'player') ?? null;
  const myRank = safe(() => playerBestArenaRank(s));
  const expected = expectedLeaderElo10(s);
  const monthsFirst = finite(s.monthsFirst);

  const hi = ranked.length > 0 ? ranked[0].row.elo : 0;
  const lo = ranked.length > 0 ? ranked[ranked.length - 1].row.elo : 0;
  const barWidth = (elo: number): number => (hi > lo ? 8 + (92 * (elo - lo)) / (hi - lo) : 100);
  const date = dateHeader(ranked.map((x) => x.row));

  let body: ReactNode;
  if (rows === null) body = <div className="an-empty">Не удалось построить рейтинг.</div>;
  else if (ranked.length === 0) body = <div className="an-empty">Выпущенных моделей нет.</div>;
  else
    body = (
      <div className="an-scroll">
        <table className="grid an-grid">
          <thead>
            <tr>
              <th className="num" title={TIP_RANK}>
                №
              </th>
              <th>Модель</th>
              <th>Лаборатория</th>
              <th title="Рейтинг Эло: чем выше, тем чаще пользователи выбирают ответы модели">Эло</th>
              <th title={date.title}>{date.label}</th>
              <th className="num" title={TIP_CONTEXT}>
                Контекст
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ row: r, rank, inSale }) => {
              const boosted = isEloBoosted(s, r);
              return (
                <tr key={rowKey(r)} className={r.owner === 'player' ? 'player' : undefined}>
                  <td className={`num${rank === null ? ' muted' : ''}`}>{rank !== null ? fmtNum(rank) : '-'}</td>
                  <td>
                    <Flag row={r} />
                    {r.name}
                    {!inSale && (
                      <span className="est" title={TIP_NOT_SALE}>
                        {' '}
                        не в продаже
                      </span>
                    )}
                  </td>
                  <td>
                    <OwnerTag s={s} owner={r.owner} />
                  </td>
                  <td>
                    <div className="elo-cell">
                      <span className="elo-track">
                        <span className="elo-fill" style={{ width: `${barWidth(r.elo)}%`, background: ownerColor(r.owner) }} />
                      </span>
                      {boosted || r.eloEstimated ? (
                        <span className="est elo-val" title={boosted ? TIP_ELO_BOOSTED : TIP_ELO_UNKNOWN}>
                          ≈{fmtElo(r.elo)}
                        </span>
                      ) : (
                        <span className="elo-val">{fmtElo(r.elo)}</span>
                      )}
                    </div>
                  </td>
                  <DateCell row={r} />
                  <td className="num">{ctxLabel(rowContext(s, r))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="an-page fill">
      <StatStrip
        items={[
          {
            value: myRank !== null ? fmtRank(myRank) : '-',
            label: myRank !== null ? `Сейчас среди ${fmtNum(onSale)} моделей в продаже` : 'Ваших моделей в продаже нет',
            title: TIP_RANK,
          },
          { value: fmtRank(1), label: `Цель: среди моделей в продаже на ${formatDateShort(END_DAY)}`, title: TIP_GOAL },
          {
            value: expected !== null ? `≈ ${fmtElo(expected)}` : '-',
            label: 'Ожидаемый лидер к концу 2024, Эло',
            title: TIP_EXPECTED,
          },
          {
            value: mine ? fmtElo(mine.row.elo) : '-',
            label: mine ? `Ваша лучшая: ${mine.row.name}` : 'Ваша лучшая модель, Эло',
          },
          { value: fmtNum(monthsFirst), label: 'Месяцев на 1-м месте', title: TIP_MONTHS },
        ]}
      />
      <div className="an-toolbar">
        <span className="muted">Моделей: {fmtNum(ranked.length)}</span>
        <span className="muted">В продаже: {fmtNum(onSale)}</span>
        <span className="grow" />
        <span className="an-key" title="Оценка: точный рейтинг неизвестен или модель усилена под давлением">
          <b>≈</b> оценка
        </span>
        <span className="an-key">
          <span className="est">не в продаже</span>
          <span className="an-key-s">нет API: не в зачёт цели</span>
        </span>
      </div>
      {body}
    </div>
  );
}
