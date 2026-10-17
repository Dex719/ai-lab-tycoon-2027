// Вкладка «Рынок» (доли лабораторий, сегменты спроса, модели на рынке) и данные лабораторий для досье
// (labRows, recentMoves - вкладка «Лаборатории» в LabsDossier.tsx).

import { FlashNum } from '../FlashNum';
import { useMemo } from 'react';
import type { WindowProps } from '.';
import { personalityOf } from '../../data/labPersonalities';
import { HYPE_OWNERS, SEGMENT_DEF, SUBS_REF_PRICE } from '../../sim/constants';
import { bestElo } from '../../sim/leaderboard';
import {
  marketSnapshot,
  refPrice,
  subsOpen,
  type MarketEntry,
  type MarketSnapshot,
  type SegmentSnapshot,
} from '../../sim/market';
import { contextLabel } from '../../sim/research';
import { findRivalDefIn, labStance, lastMove, rivalDayIn, type HistoryRow } from '../../sim/rivalry';
import { monthPrices } from '../../sim/tick';
import { dayToDate } from '../../sim/time';
import { SEGMENT_IDS, type Channel, type GameState, type HypeOwner, type SegmentId, type Tier } from '../../sim/types';
import { Alert } from '../components/common';
import { TierBadge } from '../components/TierBadge';
import { tokensWord } from '../../sim/text';
import { fmtElo, fmtNum, fmtPrice, fmtShare, ruPlural } from '../format';
import {
  buildChartData,
  ChartPanel,
  finite,
  liveMonthLabel,
  ownerColor,
  ownerName,
  OwnerTag,
  safe,
  type SeriesDef,
} from './analyticsShared';
import './MarketWindow.css';

// ---------- Рынок ----------

const SHARE_SERIES: SeriesDef[] = [{ id: 'player', label: 'Ваша доля', color: '#2f80e4', pick: (r) => r.marketShare }];

const fmtAxisShare = (v: number): string => fmtShare(v, 1);

const CHANNEL_NAME: Record<Channel, string> = { api: 'API', subs: 'Подписка' };

const CHANNEL_TITLE: Record<Channel, string> = {
  api: 'Продажа через API: цена за 1 млн токенов',
  subs: 'Продажа подпиской на чат: цена в месяц за пользователя',
};

/** Текст вместо карточки обычных пользователей, пока канал подписок закрыт. */
export const SUBS_CLOSED = 'Подписки появятся позже.';

const NONE_TITLE = 'Часть спроса, которую не получила ни одна модель';

/** Сколько лучших моделей показывает карточка сегмента. */
export const SEGMENT_TOP_MODELS = 4;

/** «5 пользователей», «1,2 млн пользователей». */
export function usersLabel(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e4) return `${fmtNum(n)} пользователей`;
  const k = Math.round(n);
  return `${fmtNum(k)} ${ruPlural(k, 'пользователь', 'пользователя', 'пользователей')}`;
}

/** Спрос сегмента с единицей: «7 млн пользователей» или «1,2 млрд токенов в день». */
export function demandLabel(channel: Channel, n: number): string {
  return channel === 'subs' ? usersLabel(n) : `${fmtNum(n)} ${tokensWord(Math.round(n))} в день`;
}

// Доли сегмента: берём записанные в s.market.segments (после ограничения мощностью); пока их нет (первый день игры) -
// доли снимка до ограничения мощностью.
interface ShareSource {
  share: (e: MarketEntry) => number;
  lab: (owner: HypeOwner) => number;
  none: number;
}

function shareSource(s: GameState, seg: SegmentSnapshot): ShareSource {
  const st = s.market.segments?.[seg.id];
  if (st && st.total > 0 && Object.keys(st.shares).length > 0) {
    return { share: (e) => finite(st.shares[e.key]), lab: (o) => finite(st.labShares[o]), none: finite(st.labShares.none) };
  }
  const lab = new Map<HypeOwner, number>();
  for (const e of seg.entries) lab.set(e.owner, (lab.get(e.owner) ?? 0) + e.share);
  return { share: (e) => e.share, lab: (o) => lab.get(o) ?? 0, none: seg.noneShare };
}

export interface SegmentRow {
  key: string;
  owner: HypeOwner;
  name: string;
  tier: Tier;
  share: number;
}

export interface SegmentView {
  id: SegmentId;
  name: string;
  channel: Channel;
  /** «Что ценит» сегмент (SEGMENT_DEF.values). */
  values: string;
  /** false - канал сегмента ещё закрыт (подписки до чат-момента). */
  open: boolean;
  /** Спрос сегмента: пользователи (подписка) или токены в день (API). */
  demand: number;
  playerShare: number;
  /** Ваша доля в единицах спроса: пользователи или токены в день. */
  playerUnits: number;
  /** Лаборатория с наибольшей долей в сегменте; null - никто ничего не получил. */
  leader: { owner: HypeOwner; share: number } | null;
  /** Лучшие модели по доле; если ваших среди них нет, в конец добавляется ваша лучшая. */
  rows: SegmentRow[];
  /** Доля «вне рынка»: спрос, не доставшийся ни одной модели. */
  noneShare: number;
}

/** Три карточки сегментов: спрос из снимка рынка, доли из s.market.segments. */
export function segmentViews(s: GameState, snap: MarketSnapshot): SegmentView[] {
  return SEGMENT_IDS.map((id): SegmentView => {
    const def = SEGMENT_DEF[id];
    const seg = snap.segments[id];
    const open = def.channel === 'api' || subsOpen(s.day);
    const base = { id, name: def.name, channel: def.channel, values: def.values, open };
    if (!open) return { ...base, demand: 0, playerShare: 0, playerUnits: 0, leader: null, rows: [], noneShare: 1 };

    const src = shareSource(s, seg);
    const all: SegmentRow[] = seg.entries
      .map((e) => ({ key: e.key, owner: e.owner, name: e.name, tier: e.tier, share: src.share(e) }))
      .sort((a, b) => b.share - a.share);
    let rows = all.slice(0, SEGMENT_TOP_MODELS);
    if (!rows.some((r) => r.owner === 'player')) {
      const mine = all.find((r) => r.owner === 'player');
      if (mine) rows = [...rows, mine];
    }
    let leader: SegmentView['leader'] = null;
    for (const owner of HYPE_OWNERS) {
      const share = src.lab(owner);
      if (share > 0 && (leader === null || share > leader.share)) leader = { owner, share };
    }
    const playerShare = src.lab('player');
    return { ...base, demand: seg.total, playerShare, playerUnits: playerShare * seg.total, leader, rows, noneShare: src.none };
  });
}

export interface MarketRow {
  key: string;
  owner: HypeOwner;
  name: string;
  tier: Tier;
  elo: number;
  context: number;
  /** Цена по API ($ за 1 млн токенов); null - модель не продаётся по API. */
  apiPrice: number | null;
  /** Цена подписки ($ в месяц); null - модели нет в подписке. */
  subsPrice: number | null;
  /** Доля в сегменте; null - модели нет в канале этого сегмента. */
  seg: Record<SegmentId, number | null>;
  /** Общая доля (взвешена по выручке сегментов). */
  share: number;
  /** Общая целевая доля: к ней доля движется (клиенты переходят постепенно, market.ts SHARE_TAU_DAYS). */
  target: number;
  /** Спрос по API, токенов в день, до ограничения мощностью; null - нет в API. */
  apiTokens: number | null;
  /** Спрос подписчиков, пользователей, до ограничения мощностью; null - нет в подписке. */
  subsUsers: number | null;
}

/** Таблица «Модели на рынке»: одна строка на модель, собранная из записей трёх сегментов. */
export function marketRows(s: GameState, snap: MarketSnapshot): MarketRow[] {
  const byKey = new Map<string, MarketRow>();
  const combined = new Map<string, number>();
  for (const id of SEGMENT_IDS) {
    const seg = snap.segments[id];
    const src = shareSource(s, seg);
    for (const e of seg.entries) {
      let r = byKey.get(e.key);
      if (!r) {
        r = {
          key: e.key,
          owner: e.owner,
          name: e.name,
          tier: e.tier,
          elo: e.elo,
          context: e.context,
          apiPrice: null,
          subsPrice: null,
          seg: { consumers: null, enterprise: null, developers: null },
          share: 0,
          target: 0,
          apiTokens: null,
          subsUsers: null,
        };
        byKey.set(e.key, r);
      }
      const share = src.share(e);
      r.seg[id] = share;
      combined.set(e.key, (combined.get(e.key) ?? 0) + seg.weight * share);
      r.target += seg.weight * (e.target ?? e.share);
      if (seg.channel === 'api') {
        r.apiPrice = e.price;
        r.apiTokens = (r.apiTokens ?? 0) + e.demand;
      } else {
        r.subsPrice = e.price;
        r.subsUsers = (r.subsUsers ?? 0) + e.demand;
      }
    }
  }
  const recorded = Object.keys(s.market.shares).length > 0;
  for (const r of byKey.values()) r.share = recorded ? finite(s.market.shares[r.key]) : (combined.get(r.key) ?? 0);
  return [...byKey.values()].sort((a, b) => b.share - a.share || b.elo - a.elo || (a.key < b.key ? -1 : 1));
}

/** Горизонтальные полосы долей: от самой большой доли к самой маленькой. Спрос, не доставшийся никому, - отдельной строкой. */
/** Вы и лаборатории, у которых уже вышла модель (не только анонс): остальных в долях не показываем - будущее не раскрываем. */
function releasedOwners(s: GameState): Set<HypeOwner> {
  const out = new Set<HypeOwner>(['player']);
  for (const id of s.rivalsReleased) {
    const def = findRivalDefIn(id);
    if (def && !def.announcedOnly) out.add(def.lab);
  }
  return out;
}

function ShareBars({ s, snap }: { s: GameState; snap: MarketSnapshot | null }) {
  const shown = releasedOwners(s);
  const rows = HYPE_OWNERS.map((owner) => ({ owner, share: finite(s.market.labShares[owner]) }))
    .filter((r) => shown.has(r.owner) || r.share > 0)
    .sort((a, b) => b.share - a.share);
  const none = finite(s.market.labShares.none);
  const maxShare = Math.max(0.0001, ...rows.map((r) => r.share));
  const api = snap ? snap.totalTokens : s.market.totalTokens;
  const subs = snap ? snap.totalSubs : s.market.totalSubs;
  const open = subsOpen(s.day);

  return (
    <div className="bars">
      {rows.map(({ owner, share }) => (
        <div key={owner} className={`bar-row${owner === 'player' ? ' me' : ''}`}>
          <span className="bar-name" title={ownerName(s, owner)}>
            <i className={`own-dot${owner === 'player' ? ' me' : ''}`} style={{ background: ownerColor(owner) }} />
            {ownerName(s, owner)}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${share > 0 ? Math.max(1, (share / maxShare) * 100) : 0}%`, background: ownerColor(owner) }}
            />
          </span>
          <span className="bar-val">{fmtShare(share)}</span>
        </div>
      ))}
      <div className="bar-row none" title={NONE_TITLE}>
        <span className="bar-name">Вне рынка</span>
        <span className="bar-track" />
        <span className="bar-val">{fmtShare(none)}</span>
      </div>
      <div className="bars-meta">
        <div className="r">
          <span>Спрос по API</span>
          <span>{fmtNum(api)} {tokensWord(Math.round(api))} в день</span>
        </div>
        {open && (
          <div className="r">
            <span>Спрос на подписки</span>
            <FlashNum value={subs} frac={0.02} className="on-light">{usersLabel(subs)}</FlashNum>
          </div>
        )}
        <div className="r">
          <span>Опорная цена API</span>
          <span>{fmtPrice(refPrice(s.day))} за 1 млн токенов</span>
        </div>
        {open && (
          <div className="r">
            <span>Опорная цена подписки</span>
            <span>{fmtPrice(SUBS_REF_PRICE)} в месяц</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Контекст модели: «128 тыс.», «1 млн»; если контекст неизвестен - «-». */
const ctxLabel = (tokens: number): string => (tokens > 0 ? contextLabel(tokens) : '-');

// ---------- Сегменты ----------

function SegmentCard({ s, v }: { s: GameState; v: SegmentView }) {
  const top = Math.max(0.0001, ...v.rows.map((r) => r.share));
  return (
    <div className={`seg-card ${v.id}`}>
      <div className="seg-head">
        <h3 className="seg-name">{v.name}</h3>
        <span className="seg-chan" title={CHANNEL_TITLE[v.channel]}>
          {CHANNEL_NAME[v.channel]}
        </span>
      </div>
      <div className="seg-values">Ценит: {v.values}</div>
      {!v.open ? (
        <div className="seg-closed">{SUBS_CLOSED}</div>
      ) : (
        <>
          <dl className="seg-kv">
            <dt title={v.channel === 'subs' ? 'Платёжеспособные пользователи чата' : 'Токены API в день'}>Спрос</dt>
            <dd>{demandLabel(v.channel, v.demand)}</dd>
            <dt title="Доля вашего спроса в сегменте после ограничения мощностью">Ваша доля</dt>
            <dd>
              <b className="seg-mine">{fmtShare(v.playerShare)}</b>
              {v.playerShare > 0 && <small>≈ {demandLabel(v.channel, v.playerUnits)}</small>}
            </dd>
            <dt>Лидер</dt>
            <dd>
              {v.leader ? (
                <>
                  <OwnerTag s={s} owner={v.leader.owner} /> <span className="seg-lead-val">{fmtShare(v.leader.share)}</span>
                </>
              ) : (
                <span className="muted">-</span>
              )}
            </dd>
          </dl>
          {v.rows.length === 0 ? (
            <div className="seg-empty">В сегменте нет моделей.</div>
          ) : (
            <div className="seg-list">
              {v.rows.map((r) => (
                <div key={r.key} className={`seg-m${r.owner === 'player' ? ' me' : ''}`}>
                  <span className="seg-m-name" title={`${r.name}, ${ownerName(s, r.owner)}`}>
                    <i className="own-dot" style={{ background: ownerColor(r.owner) }} />
                    <span className="n">{r.name}</span>
                    <span className="seg-m-lab">{ownerName(s, r.owner)}</span>
                  </span>
                  <span className="seg-m-val">{fmtShare(r.share)}</span>
                  <span className="seg-m-bar">
                    <span
                      className="seg-m-fill"
                      style={{ width: `${r.share > 0 ? Math.max(1, (r.share / top) * 100) : 0}%`, background: ownerColor(r.owner) }}
                    />
                  </span>
                </div>
              ))}
              <div className="seg-none" title={NONE_TITLE}>
                <span>Вне рынка</span>
                <span>{fmtShare(v.noneShare)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Segments({ s, views }: { s: GameState; views: SegmentView[] | null }) {
  if (views === null) return <div className="an-empty">Не удалось рассчитать сегменты.</div>;
  // Сегмент закрытого канала (подписки до чат-момента) не показываем: будущее не раскрываем.
  const open = views.filter((v) => v.open);
  return (
    <div className={`seg-grid n${open.length}`}>
      {open.map((v) => (
        <SegmentCard key={v.id} s={s} v={v} />
      ))}
    </div>
  );
}

// ---------- Модели на рынке ----------

const Dash = () => <span className="muted">-</span>;

function MarketTable({ s, rows }: { s: GameState; rows: MarketRow[] | null }) {
  if (rows === null) return <div className="an-empty">Не удалось рассчитать список моделей.</div>;
  if (rows.length === 0) return <div className="an-empty">На рынке нет моделей.</div>;
  // До открытия подписок их колонок нет: будущее не показываем.
  const subs = subsOpen(s.day) || rows.some((r) => r.subsPrice !== null);
  const segs = SEGMENT_IDS.filter((id) => subs || SEGMENT_DEF[id].channel === 'api');
  return (
    <div className="an-hscroll">
      <table className="grid an-grid flat mk-grid">
        <thead>
          <tr className="mk-h1">
            <th rowSpan={2} title="Название модели и лаборатория">
              Модель
            </th>
            <th rowSpan={2}>Уровень</th>
            <th rowSpan={2} className="num">
              Эло
            </th>
            <th rowSpan={2} className="num" title="Длина контекста, токенов">
              Контекст
            </th>
            <th colSpan={subs ? 2 : 1} className="gh" title="У соперников цена API - средняя: (3 × входные + выходные) / 4">
              Цена
            </th>
            <th colSpan={segs.length} className="gh" title="Доля модели в спросе сегмента после ограничения мощностью">
              Доля в сегменте
            </th>
            <th rowSpan={2} className="num" title="По всем сегментам, с весом по выручке сегментов">
              Общая доля
            </th>
            <th colSpan={subs ? 2 : 1} className="gh" title="Спрос на модель до ограничения мощностью">
              Спрос
            </th>
          </tr>
          <tr>
            <th className="num" title="Доллары за 1 млн токенов">
              API
            </th>
            {subs && (
              <th className="num" title="Доллары в месяц за пользователя">
                Подписка
              </th>
            )}
            {segs.map((id) => (
              <th key={id} className="num mk-seg">
                {SEGMENT_DEF[id].name}
              </th>
            ))}
            <th className="num">Токенов в день</th>
            {subs && <th className="num">Пользователей</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.owner === 'player' ? 'player' : undefined}>
              <td>
                <div>{r.name}</div>
                <div className="mk-lab">
                  <i className="own-dot" style={{ background: ownerColor(r.owner) }} />
                  {ownerName(s, r.owner)}
                </div>
              </td>
              <td>
                <TierBadge tier={r.tier} plain />
              </td>
              <td className="num">{fmtElo(r.elo)}</td>
              <td className="num">{ctxLabel(r.context)}</td>
              <td className="num">{r.apiPrice !== null ? fmtPrice(r.apiPrice) : <Dash />}</td>
              {subs && <td className="num">{r.subsPrice !== null ? fmtPrice(r.subsPrice) : <Dash />}</td>}
              {segs.map((id) => (
                <td key={id} className="num">
                  {r.seg[id] !== null ? fmtShare(r.seg[id] as number) : <Dash />}
                </td>
              ))}
              <td className="num">
                {fmtShare(r.share)}
                {Math.abs(r.target - r.share) >= 0.005 && (
                  <small className="mk-trend" title="Клиенты переходят к лучшей модели постепенно: за месяц доля проходит около двух третей пути к этой цифре">
                    {r.target > r.share ? 'растёт' : 'падает'} к {fmtShare(r.target)}
                  </small>
                )}
              </td>
              <td className="num">{r.apiTokens !== null ? fmtNum(r.apiTokens) : <Dash />}</td>
              {subs && <td className="num">{r.subsUsers !== null ? fmtNum(r.subsUsers) : <Dash />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Цены за 1 млн токенов по месяцам: самая сильная модель каждой лаборатории в продаже и ваша (шкала логарифмическая). */
function PriceChart({ s }: { s: GameState }) {
  const history = s.finance.history;
  const live = safe(() => monthPrices(s)) ?? {};
  const owners = HYPE_OWNERS.filter((o) => live[o] !== undefined || history.some((h) => h.prices?.[o] !== undefined));
  const defs: SeriesDef[] = owners.map((o) => ({
    id: o,
    label: ownerName(s, o),
    color: ownerColor(o),
    pick: (r) => r.prices?.[o] ?? 0,
  }));
  const data = useMemo(() => buildChartData(history, defs), [history, history.length, owners.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = dayToDate(s.day);
  if (owners.length === 0) return null;
  return (
    <section>
      <h2 className="an-h" title="Цена самой сильной модели лаборатории в продаже по API. Шкала логарифмическая: каждое деление - в 10 раз">
        Цены за 1 млн токенов
      </h2>
      <ChartPanel
        data={data}
        yFormat={(v) => fmtPrice(v)}
        live={live}
        liveLabel={liveMonthLabel(cur.year, cur.month)}
        legendWidth={200}
        height={240}
        log
      />
    </section>
  );
}

export default function MarketTab({ s, open }: WindowProps) {
  const history = s.finance.history;
  const data = useMemo(() => buildChartData(history, SHARE_SERIES), [history, history.length]);
  const cur = dayToDate(s.day);

  const snap = safe(() => marketSnapshot(s));
  const views = snap ? safe(() => segmentViews(s, snap)) : null;
  const rows = snap ? safe(() => marketRows(s, snap)) : null;
  const hasPlayer = rows?.some((r) => r.owner === 'player') ?? false;

  return (
    <div className="an-page">
      <div className="an-two">
        <section>
          <h2 className="an-h" title="Общие доли: по всем сегментам, с весом по выручке сегментов">
            Доли лабораторий
          </h2>
          <ShareBars s={s} snap={snap} />
        </section>
        <section>
          <h2 className="an-h">Ваша доля по месяцам</h2>
          <ChartPanel
            data={data}
            yFormat={fmtAxisShare}
            live={{ player: finite(s.market.labShares.player) }}
            liveLabel={liveMonthLabel(cur.year, cur.month)}
            legendWidth={180}
            height={240}
          />
        </section>
      </div>

      <section>
        <h2 className="an-h">Сегменты</h2>
        <Segments s={s} views={views} />
      </section>

      <PriceChart s={s} />

      <section>
        <h2 className="an-h">Модели на рынке</h2>
        <MarketTable s={s} rows={rows} />
        {rows !== null && !hasPlayer && (
          <Alert tone="info" action={{ label: 'Открыть «Модели»', onClick: () => open('models') }}>
            Ваших моделей на рынке нет.
          </Alert>
        )}
      </section>
    </div>
  );
}

// ---------- Лаборатории ----------

interface LabRow {
  owner: HypeOwner;
  count: number;
  best: number;
  share: number;
  lastName: string | null;
  since: number | null;
  /** Характер соперника и подсказка к нему; у вашей лаборатории - null. */
  character: { archetype: string; description: string } | null;
  /** Настрой соперника к вам: подпись и подсказка; null - у вашей лаборатории или если рассчитать не удалось. */
  stance: { label: string; hint: string } | null;
  /** Последний исполненный ход соперника; null - ходов не было или это ваша лаборатория. */
  lastMove: HistoryRow | null;
}

/** Сколько последних ходов соперников показывает блок «Последние ходы». */
export const RECENT_MOVES = 10;

/**
 * По каждому владельцу: число выпущенных моделей, лучший Эло, доля рынка, последняя модель и дата первой;
 * у соперников ещё характер, настрой и последний ход. Модели, которые соперник только показал (announcedOnly),
 * выпущенными не считаются. День выхода - с поправками ходов соперников (rivalDayIn), ответные модели тоже считаются.
 */
export function labRows(s: GameState): LabRow[] {
  const acc = new Map<HypeOwner, { count: number; lastDay: number; lastName: string | null; since: number | null }>();
  const add = (owner: HypeOwner, name: string, day: number) => {
    const a = acc.get(owner) ?? { count: 0, lastDay: -Infinity, lastName: null, since: null };
    a.count++;
    if (day >= a.lastDay) {
      a.lastDay = day;
      a.lastName = name;
    }
    if (a.since === null || day < a.since) a.since = day;
    acc.set(owner, a);
  };
  for (const id of s.rivalsReleased) {
    const def = findRivalDefIn(id);
    if (def && !def.announcedOnly) add(def.lab, def.gameName, rivalDayIn(s, def));
  }
  for (const m of s.models) if (m.releasedDay !== null) add('player', m.name, m.releasedDay);

  return HYPE_OWNERS.map((owner) => {
    const a = acc.get(owner);
    const rival = owner !== 'player';
    const p = rival ? personalityOf(owner) : null;
    return {
      owner,
      count: a?.count ?? 0,
      best: bestElo(s, owner),
      share: finite(s.market.labShares[owner]),
      lastName: a?.lastName ?? null,
      since: a?.since ?? null,
      character: p ? { archetype: p.archetype, description: p.description } : null,
      stance: rival ? safe(() => labStance(s, owner)) : null,
      lastMove: rival ? lastMove(s, owner) : null,
    };
  }).sort((a, b) => b.share - a.share || b.best - a.best);
}

/** Последние ходы соперников, новые сверху, не больше RECENT_MOVES. */
export function recentMoves(s: GameState): HistoryRow[] {
  return s.rivalry.history.slice(-RECENT_MOVES).reverse();
}

