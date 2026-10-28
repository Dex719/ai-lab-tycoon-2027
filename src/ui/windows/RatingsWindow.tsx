// Вкладки «Бенчмарки» (баллы моделей по бенчмаркам) и «Арена» (рейтинг по Эло).

import { useState, type ReactNode } from 'react';
import { ModelEmblem } from '../components/ModelEmblem';
import { fmtGap } from '../ArenaFeedback';
import { raceMetricOf, raceRows, type RaceRow } from '../race';
import type { WindowProps } from '.';
import { BENCHMARKS } from '../../data/benchmarks';
import { expectedLeaderElo, leaderboard, marketArenaRank, type BoardRow, type RaceMetric } from '../../sim/leaderboard';
import { contextLabel } from '../../sim/research';
import { findRivalDefIn, rivalContextIn } from '../../sim/rivalry';
import { ARENA_PLACE_TITLE } from '../arena';
import { END_DAY, formatDateShort, yearOf } from '../../sim/time';
import type { BenchmarkDef, BenchmarkId, GameState, HypeOwner } from '../../sim/types';
import { fmtElo, fmtNum, fmtPct, ruPlural } from '../format';
import { useFlip } from '../alive';
import { IconAlert, IconLock } from '../icons';
import { finite, ownerColor, ownerName, OwnerTag, safe } from './analyticsShared';

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
  const flipRef = useFlip<HTMLTableSectionElement>({ enter: false });
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
          <tbody ref={flipRef}>
            {shown.map((r) => (
              <tr key={rowKey(r)} data-fk={rowKey(r)} className={r.owner === 'player' ? 'player' : undefined}>
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

const TIP_RANK = ARENA_PLACE_TITLE;
const TIP_NOT_SALE = 'Модель не продаётся через API: в зачёт цели не идёт';
const TIP_GOAL = 'Победа: ваша модель первая по Эло среди моделей в продаже 31.12.2024';
const TIP_EXPECTED = 'Лучший Эло среди моделей соперников, которые будут продаваться через API к концу 2024 года';
const TIP_MONTHS = 'Закрытые месяцы, когда ваша лучшая модель была первой среди моделей в продаже. Считаются только месяцы, когда соперники уже продают модели по API.';

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

/** Значок лаборатории соперника: круг её цвета с первой буквой. */
function LabBadge({ s, owner, size = 34 }: { s: GameState; owner: HypeOwner; size?: number }) {
  const bg = ownerColor(owner, true);
  const n = parseInt(bg.slice(1), 16);
  // На светлом цвете (жёлтый Moonshoot) буква тёмная, иначе белая.
  const light = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
  return (
    <span
      className="arn-lab"
      style={{ width: size, height: size, background: bg, color: light ? '#1f2023' : '#fff', fontSize: size * 0.45 }}
      aria-hidden="true"
    >
      {ownerName(s, owner).slice(0, 1)}
    </span>
  );
}

/** Эмблема модели игрока по строке рейтинга; у соперника - значок лаборатории. */
function RowBadge({ s, x, size }: { s: GameState; x: RaceRow; size: number }) {
  const m = x.row.ref.kind === 'player' ? s.models.find((pm) => pm.id === x.row.ref.id) : undefined;
  return m ? <ModelEmblem m={m} size={size} exposed={m.exposed} /> : <LabBadge s={s} owner={x.owner} size={size} />;
}

function gapText(metric: RaceMetric, gap: number): string {
  return metric.kind === 'arena' ? `${fmtGap(metric, gap)} Эло` : `${fmtGap(metric, gap)} балла`;
}

function valueText(metric: RaceMetric, v: number): string {
  return metric.kind === 'arena' ? fmtElo(v) : fmtPct(v, 1);
}

const MEDAL = ['gold', 'silver', 'bronze'] as const;

function Podium({ s, top, metric }: { s: GameState; top: RaceRow[]; metric: RaceMetric }) {
  // Порядок на пьедестале: второе, первое, третье.
  const order = [top[1], top[0], top[2]];
  return (
    <div className="arn-podium">
      {order.map((x, i) =>
        x ? (
          <div key={x.key} className={`arn-step p${x.rank}${x.owner === 'player' ? ' me' : ''}`}>
            <RowBadge s={s} x={x} size={x.rank === 1 ? 56 : 46} />
            <span className="arn-step-name" title={x.row.name}>
              {x.row.name}
            </span>
            <span className="arn-step-lab">
              <i className="own-dot" style={{ background: ownerColor(x.owner) }} />
              {ownerName(s, x.owner)}
            </span>
            <span className="arn-step-v">
              {x.estimated ? '≈' : ''}
              {valueText(metric, x.value)}
            </span>
            <span className={`arn-step-block ${MEDAL[(x.rank ?? 1) - 1]}`}>{x.rank}</span>
          </div>
        ) : (
          <div key={`empty-${i}`} className="arn-step empty" />
        ),
      )}
    </div>
  );
}

export function ArenaTab({ s }: WindowProps) {
  const flipRef = useFlip<HTMLTableSectionElement>({ enter: false });
  const [showAll, setShowAll] = useState(false);
  const metric = raceMetricOf(s);
  const rows = metric ? raceRows(s, metric) : [];
  const counted = rows.filter((x) => x.counted);
  const shownRows = showAll ? rows : counted;
  const leader = counted[0] ?? null;
  const mine = counted.find((x) => x.owner === 'player') ?? null;
  const myRank = mine?.rank ?? null;
  const first = myRank === 1;
  const rival = counted.find((x) => x.owner !== 'player') ?? null; // лучший соперник
  const runner = first ? rival : leader;
  const gap = mine && runner ? Math.abs(mine.value - runner.value) : null;
  const monthsFirst = finite(s.monthsFirst);
  const expected = yearOf(s.day) >= 2024 && metric?.kind === 'arena' ? expectedLeaderElo10(s) : null;
  const hi = shownRows.length > 0 ? Math.max(...shownRows.map((x) => x.value)) : 0;
  const lo = shownRows.length > 0 ? Math.min(...shownRows.map((x) => x.value)) : 0;
  const barWidth = (v: number): number => (hi > lo ? 8 + (92 * (v - lo)) / (hi - lo) : 100);
  const date = dateHeader(shownRows.map((x) => x.row));
  const arena = metric?.kind === 'arena';
  const mineModel = mine ? s.models.find((m) => m.id === mine.row.ref.id) : undefined;
  const hidden = rows.length - counted.length;

  if (!metric) {
    return (
      <div className="an-page fill">
        <div className="an-empty">Гонка начнётся, когда выйдет первый тест.</div>
      </div>
    );
  }

  return (
    <div className="an-page arn">
      <div
        className={`arn-hero${first ? ' first' : ''}`}
        title={arena ? TIP_RANK : `Пока соперники не продают модели по API, гонка идёт по тесту ${metric.name} среди всех вышедших моделей.`}
      >
        <div className="arn-cell arn-place">
          <span className="arn-k">{arena ? 'Место на «Арене»' : `Место по тесту ${metric.name}`}</span>
          <span className="arn-big">{myRank !== null ? `${fmtNum(myRank)}-е` : '-'}</span>
          <span className="arn-s">
            {myRank !== null
              ? `из ${fmtNum(counted.length)} ${arena ? ruPlural(counted.length, 'модели в продаже', 'моделей в продаже', 'моделей в продаже') : ruPlural(counted.length, 'модели', 'моделей', 'моделей')}`
              : arena
                ? 'Ваших моделей в продаже нет'
                : 'Ваших моделей с этим тестом нет'}
          </span>
        </div>
        <div className="arn-cell">
          <span className="arn-k">{first ? 'Отрыв от ближайшего соперника' : 'До лидера'}</span>
          <span className={`arn-mid ${first ? 'good' : 'bad'}`}>{gap !== null ? `${first ? '+' : '-'}${gapText(metric, gap)}` : '-'}</span>
          <span className="arn-s">
            {runner ? (
              <>
                <i className="own-dot" style={{ background: ownerColor(runner.owner, true) }} />
                {runner.row.name}, {ownerName(s, runner.owner)}
              </>
            ) : (
              'Соперников пока нет'
            )}
          </span>
        </div>
        <div className="arn-cell arn-best">
          {mineModel && <ModelEmblem m={mineModel} size={52} gold={first} />}
          <span className="arn-best-t">
            <span className="arn-k">Ваша лучшая модель</span>
            <span className="arn-best-n">{mine ? mine.row.name : '-'}</span>
            <span className="arn-s">{mine ? `${arena ? 'Эло' : metric.name} ${valueText(metric, mine.value)}` : 'Выпустите модель'}</span>
          </span>
        </div>
        {arena ? (
          <div className="arn-cell arn-meta">
            <span className="arn-k" title={TIP_MONTHS}>
              Месяцев на 1-м месте
            </span>
            <span className="arn-mid">{fmtNum(monthsFirst)}</span>
            <span className="arn-s" title={expected !== null ? TIP_EXPECTED : TIP_GOAL}>
              {expected !== null ? `Ожидаемый лидер к концу 2024: ≈ ${fmtElo(expected)} Эло` : `Цель: 1-е место на ${formatDateShort(END_DAY)}`}
            </span>
          </div>
        ) : (
          <div className="arn-cell arn-meta" title={TIP_GOAL}>
            <span className="arn-k">Цель партии</span>
            <span className="arn-mid">1-е место</span>
            <span className="arn-s">на «Арене» {formatDateShort(END_DAY)}</span>
          </div>
        )}
      </div>

      {counted.length > 0 && <Podium s={s} top={counted.slice(0, 3)} metric={metric} />}

      <div className="an-toolbar">
        <span className="arn-board-t">{arena ? 'Таблица «Арены»' : `Таблица по тесту ${metric.name}`}</span>
        <span className="muted">В зачёте: {fmtNum(counted.length)}</span>
        {hidden > 0 && (
          <label className="an-check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {arena ? `Модели не в продаже (${fmtNum(hidden)})` : `Только показанные модели (${fmtNum(hidden)})`}
          </label>
        )}
        <span className="grow" />
        <span className="an-key" title="Оценка: точный результат неизвестен или модель усилена под давлением">
          <b>≈</b> оценка
        </span>
      </div>
      {shownRows.length === 0 ? (
        <div className="an-empty">{arena ? 'Моделей в продаже нет.' : 'Выпущенных моделей нет.'}</div>
      ) : (
        <table className="grid an-grid arn-grid">
          <thead>
            <tr>
              <th className="num" title={arena ? TIP_RANK : undefined}>
                №
              </th>
              <th>Модель</th>
              <th>Лаборатория</th>
              <th title={arena ? 'Рейтинг Эло: чем выше, тем чаще пользователи выбирают ответы модели' : `Балл теста ${metric.name}`}>
                {arena ? 'Эло' : metric.name}
              </th>
              <th className="num" title="Насколько модель отстаёт от лидера">
                Разрыв
              </th>
              <th title={date.title}>{date.label}</th>
              <th className="num" title={TIP_CONTEXT}>
                Контекст
              </th>
            </tr>
          </thead>
          <tbody ref={flipRef}>
            {shownRows.map((x) => {
              const r = x.row;
              const boosted = isEloBoosted(s, r);
              const est = arena ? boosted || r.eloEstimated : x.estimated;
              const me = x.owner === 'player';
              const behind = leader && x !== leader ? leader.value - x.value : null;
              return (
                <tr key={x.key} data-fk={x.key} className={`${me ? 'player' : ''}${x.counted ? '' : ' arn-out'}${x.rank === 1 ? ' arn-lead' : ''}`}>
                  <td className="num arn-rank">
                    {x.rank !== null ? (
                      <span className={`arn-medal${x.rank <= 3 ? ` ${MEDAL[x.rank - 1]}` : ''}`}>{fmtNum(x.rank)}</span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>
                    <span className="arn-model">
                      <RowBadge s={s} x={x} size={22} />
                      <Flag row={r} />
                      <span className="arn-model-n">{r.name}</span>
                      {me && <span className="arn-you">Вы</span>}
                      {!x.counted && (
                        <span className="est" title={arena ? TIP_NOT_SALE : TIP_ANNOUNCED}>
                          {arena ? 'не в продаже' : 'показана'}
                        </span>
                      )}
                    </span>
                  </td>
                  <td>
                    <OwnerTag s={s} owner={r.owner} />
                  </td>
                  <td>
                    <div className="elo-cell">
                      <span className="elo-track">
                        <span className="elo-fill" style={{ width: `${barWidth(x.value)}%`, background: ownerColor(r.owner) }} />
                      </span>
                      {est ? (
                        <span className="est elo-val" title={arena ? (boosted ? TIP_ELO_BOOSTED : TIP_ELO_UNKNOWN) : TIP_ESTIMATE}>
                          ≈{valueText(metric, x.value)}
                        </span>
                      ) : (
                        <span className="elo-val">{valueText(metric, x.value)}</span>
                      )}
                    </div>
                  </td>
                  <td className={`num arn-gap${x === leader ? ' lead' : ''}`}>
                    {x === leader ? 'лидер' : behind !== null ? `-${fmtGap(metric, Math.max(0, behind))}` : '-'}
                  </td>
                  <DateCell row={r} />
                  <td className="num">{ctxLabel(rowContext(s, r))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
