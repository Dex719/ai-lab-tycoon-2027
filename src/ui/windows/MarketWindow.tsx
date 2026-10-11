// Вкладки «Рынок» (доли лабораторий, модели на рынке) и «Лаборатории» (таблица соперников).

import { useMemo } from 'react';
import type { WindowProps } from '.';
import { HYPE_OWNERS } from '../../sim/constants';
import { bestElo } from '../../sim/leaderboard';
import { marketSnapshot, refPrice, type MarketEntry } from '../../sim/market';
import { contextLabel } from '../../sim/research';
import { findRivalDef, rivalDay } from '../../sim/rivals';
import { dayToDate, formatDateShort } from '../../sim/time';
import type { GameState, HypeOwner } from '../../sim/types';
import { fmtElo, fmtNum, fmtPrice, fmtShare } from '../format';
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

// ---------- Рынок ----------

const SHARE_SERIES: SeriesDef[] = [{ id: 'player', label: 'Ваша доля', color: '#4ea1ff', pick: (r) => r.marketShare }];

const fmtAxisShare = (v: number): string => fmtShare(v, 1);

/** Горизонтальные полосы долей: от самой большой доли к самой маленькой. Спрос, не доставшийся никому, - отдельной строкой. */
function ShareBars({ s, demand }: { s: GameState; demand: number }) {
  const rows = HYPE_OWNERS.map((owner) => ({ owner, share: finite(s.market.labShares[owner]) })).sort(
    (a, b) => b.share - a.share,
  );
  const none = finite(s.market.labShares.none);
  const maxShare = Math.max(0.0001, ...rows.map((r) => r.share));

  return (
    <div className="bars">
      {rows.map(({ owner, share }) => (
        <div key={owner} className={`bar-row${owner === 'player' ? ' me' : ''}`}>
          <span className="bar-name" title={ownerName(s, owner)}>
            <i className={`own-dot${owner === 'player' ? ' me' : ''}`} style={{ background: ownerColor(owner, true) }} />
            {ownerName(s, owner)}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{ width: `${share > 0 ? Math.max(1, (share / maxShare) * 100) : 0}%`, background: ownerColor(owner, true) }}
            />
          </span>
          <span className="bar-val">{fmtShare(share)}</span>
        </div>
      ))}
      <div className="bar-row none" title="Часть спроса, которую не получила ни одна модель">
        <span className="bar-name">Никому</span>
        <span className="bar-track" />
        <span className="bar-val">{fmtShare(none)}</span>
      </div>
      <div className="bars-meta">
        <div className="r">
          <span>Спрос на рынке</span>
          <span>{fmtNum(demand)} токенов в день</span>
        </div>
        <div className="r">
          <span>Опорная цена</span>
          <span>{fmtPrice(refPrice(s.day))} за 1 млн токенов</span>
        </div>
      </div>
    </div>
  );
}

/** Контекст модели: «128 тыс.», «1 млн»; если контекст неизвестен - «-». */
const ctxLabel = (tokens: number): string => (tokens > 0 ? contextLabel(tokens) : '-');

function MarketTable({ s, entries }: { s: GameState; entries: MarketEntry[] | null }) {
  if (entries === null) return <div className="an-empty">Не удалось рассчитать список моделей.</div>;
  if (entries.length === 0) return <div className="an-empty">На рынке нет моделей.</div>;
  return (
    <table className="grid an-grid">
      <thead>
        <tr>
          <th>Модель</th>
          <th>Лаборатория</th>
          <th className="num">Эло</th>
          <th className="num" title="Длина контекста, токенов">
            Контекст
          </th>
          <th className="num">Цена за 1 млн токенов</th>
          <th className="num">Доля</th>
          <th className="num" title="Спрос на модель до ограничения мощностью">
            Токенов в день
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.key} className={e.owner === 'player' ? 'player' : undefined}>
            <td>{e.name}</td>
            <td>
              <OwnerTag s={s} owner={e.owner} />
            </td>
            <td className="num">{fmtElo(e.elo)}</td>
            <td className="num">{ctxLabel(e.context)}</td>
            <td className="num">{fmtPrice(e.price)}</td>
            <td className="num">{fmtShare(e.share)}</td>
            <td className="num">{fmtNum(e.tokens)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function MarketTab({ s, open }: WindowProps) {
  const history = s.finance.history;
  const data = useMemo(() => buildChartData(history, SHARE_SERIES), [history, history.length]);
  const cur = dayToDate(s.day);

  const snap = safe(() => marketSnapshot(s));
  const entries = snap ? snap.entries : null;
  const hasPlayer = entries?.some((e) => e.owner === 'player') ?? false;

  return (
    <div className="an-page">
      <div className="an-two">
        <section>
          <h2 className="an-h">Доли лабораторий</h2>
          <ShareBars s={s} demand={snap ? snap.totalTokens : s.market.totalTokens} />
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
        <h2 className="an-h">Модели на рынке</h2>
        <MarketTable s={s} entries={entries} />
        {entries !== null && !hasPlayer && (
          <div className="an-note">
            <span className="grow">Ваших моделей на рынке нет.</span>
            <button className="btn small" onClick={() => open('models')}>
              Открыть «Модели»
            </button>
          </div>
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
}

/** По каждому владельцу: число выпущенных моделей, лучший Эло, доля рынка, последняя модель и дата первой. */
function labRows(s: GameState): LabRow[] {
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
    const def = findRivalDef(id);
    if (def) add(def.lab, def.gameName, rivalDay(def));
  }
  for (const m of s.models) if (m.releasedDay !== null) add('player', m.name, m.releasedDay);

  return HYPE_OWNERS.map((owner) => {
    const a = acc.get(owner);
    return {
      owner,
      count: a?.count ?? 0,
      best: bestElo(s, owner),
      share: finite(s.market.labShares[owner]),
      lastName: a?.lastName ?? null,
      since: a?.since ?? null,
    };
  }).sort((a, b) => b.share - a.share || b.best - a.best);
}

export function LabsTab({ s }: WindowProps) {
  const rows = labRows(s);
  return (
    <div className="an-page">
      <table className="grid an-grid">
        <thead>
          <tr>
            <th>Лаборатория</th>
            <th className="num">Моделей выпущено</th>
            <th className="num">Лучший Эло</th>
            <th className="num">Доля рынка</th>
            <th>Последняя модель</th>
            <th title="Дата выхода первой модели">На рынке с</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.owner} className={r.owner === 'player' ? 'player' : undefined}>
              <td>
                <OwnerTag s={s} owner={r.owner} />
              </td>
              <td className="num">{fmtNum(r.count)}</td>
              <td className="num">{r.best > 0 ? fmtElo(r.best) : '-'}</td>
              <td className="num">{fmtShare(r.share)}</td>
              <td>{r.lastName ?? '-'}</td>
              <td>{r.since !== null ? formatDateShort(r.since) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
