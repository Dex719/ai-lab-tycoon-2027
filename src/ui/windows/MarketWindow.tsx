// Окно «Рынок» (FR-8.4): размер рынка, доли лабораторий, модели на рынке и график доли игрока.

import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WindowProps } from '.';
import { LABS, PLAYER_COLOR } from '../../data/labs';
import { marketSnapshot, refPrice } from '../../sim/market';
import type { MarketEntry } from '../../sim/market';
import type { GameState, HypeOwner, MonthRecord } from '../../sim/types';
import { Empty, Stat } from '../components/common';
import { fmtElo, fmtNum, fmtPct, fmtPrice, fmtShare } from '../format';

type ShareKey = HypeOwner | 'none';

const NONE_LABEL = 'Никому (модели недостаточно хороши или дороги)';
const CHART_MONTHS = 24;

/** Подпись месяца для оси: «03.21». */
function monthLabel(r: Pick<MonthRecord, 'year' | 'month'>): string {
  return `${String(r.month).padStart(2, '0')}.${String(r.year % 100).padStart(2, '0')}`;
}

function ownerName(s: GameState, owner: HypeOwner): string {
  return owner === 'player' ? s.labName : (LABS.find((l) => l.id === owner)?.name ?? owner);
}

function ownerColor(owner: HypeOwner): string {
  return owner === 'player' ? PLAYER_COLOR : (LABS.find((l) => l.id === owner)?.color ?? PLAYER_COLOR);
}

function safeSnapshot(s: GameState): MarketEntry[] | null {
  try {
    return marketSnapshot(s).entries;
  } catch {
    return null;
  }
}

function LabSharesTable({ s }: { s: GameState }) {
  const rows = (Object.entries(s.market.labShares) as [ShareKey, number][])
    .map(([owner, share]) => ({ owner, share: Number.isFinite(share) ? share : 0 }))
    .sort((a, b) => b.share - a.share);

  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Лаборатория</th>
          <th className="num">Доля рынка</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ owner, share }) => {
          const isPlayer = owner === 'player';
          return (
            <tr key={owner} className={isPlayer ? 'player' : share <= 0 ? 'dim' : undefined}>
              <td>
                {owner === 'none' ? (
                  <span className="muted">{NONE_LABEL}</span>
                ) : (
                  <span style={{ color: ownerColor(owner) }}>{ownerName(s, owner)}</span>
                )}
              </td>
              <td className="num">{fmtShare(share)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ModelsTable({ s, entries }: { s: GameState; entries: MarketEntry[] | null }) {
  if (entries === null) return <Empty>Не удалось рассчитать список моделей.</Empty>;
  if (entries.length === 0) return <Empty>На рынке пока нет ни одной модели.</Empty>;
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Модель</th>
          <th>Владелец</th>
          <th className="num">Цена за 1 млн токенов</th>
          <th className="num">Эло</th>
          <th className="num">Доля</th>
          <th className="num">Токенов/день</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.key} className={e.owner === 'player' ? 'player' : undefined}>
            <td>{e.name}</td>
            <td>
              <span style={{ color: ownerColor(e.owner) }}>{ownerName(s, e.owner)}</span>
            </td>
            <td className="num">{fmtPrice(e.price)}</td>
            <td className="num">{fmtElo(e.elo)}</td>
            <td className="num">{fmtShare(e.share)}</td>
            <td className="num">{fmtNum(e.tokens)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShareChart({ history }: { history: MonthRecord[] }) {
  // История меняется на месте (push раз в месяц), поэтому пересчитываем по длине.
  const data = useMemo(
    () => history.slice(-CHART_MONTHS).map((r) => ({ label: monthLabel(r), share: r.marketShare * 100 })),
    [history, history.length],
  );

  if (data.length < 2) return <Empty>График появится через пару месяцев.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#3a4656" strokeDasharray="3 3" />
        <XAxis dataKey="label" stroke="#8d9aab" tick={{ fill: '#8d9aab', fontSize: 11 }} minTickGap={16} />
        <YAxis
          stroke="#8d9aab"
          tick={{ fill: '#8d9aab', fontSize: 11 }}
          width={56}
          domain={[0, 'auto']}
          tickFormatter={(v: number) => fmtPct(v, 1)}
        />
        <Tooltip
          contentStyle={{ background: '#232c38', border: '1px solid #4d5b6e', fontSize: 12 }}
          labelStyle={{ color: '#dbe2ea' }}
          itemStyle={{ color: '#dbe2ea' }}
          formatter={(v) => [fmtPct(Number(v), 2), 'Ваша доля рынка']}
          labelFormatter={(l) => `Конец месяца ${String(l)}`}
        />
        <Line
          type="monotone"
          dataKey="share"
          stroke="#4ea1ff"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function MarketWindow({ s, open }: WindowProps) {
  const entries = safeSnapshot(s);
  const lost = s.market.lostFraction;
  const hasPlayerOnMarket = entries?.some((e) => e.owner === 'player') ?? false;

  return (
    <div className="col">
      <div className="row" style={{ alignItems: 'stretch' }}>
        <Stat label="Размер рынка" value={fmtNum(s.market.totalTokens)} hint="токенов/день" />
        <Stat label="Опорная цена" value={fmtPrice(refPrice(s.day))} hint="за 1 млн токенов" />
        <Stat label="Ваша доля" value={fmtShare(s.market.labShares.player ?? 0)} hint="от всего спроса" />
        <Stat label="Вы обслуживаете" value={fmtNum(s.market.playerTokens)} hint="токенов/день" />
      </div>

      {lost > 0.01 && (
        <div className="card row" style={{ borderColor: 'var(--bad)' }}>
          <span className="bad grow">
            Не хватает мощности для клиентов: теряете {fmtShare(lost, 0)} спроса. Лишние клиенты уходят, а шумиха падает.
          </span>
          <button className="btn small" onClick={() => open('compute')}>
            Открыть «Мощности»
          </button>
        </div>
      )}

      {!hasPlayerOnMarket && entries !== null && (
        <div className="card row">
          <span className="muted small grow">
            У вас пока нет моделей, продающихся через API, поэтому выручки с рынка нет.
          </span>
          <button className="btn small" onClick={() => open('models')}>
            Открыть «Модели»
          </button>
        </div>
      )}

      <div>
        <div className="section-title">Ваша доля рынка по месяцам</div>
        <ShareChart history={s.finance.history} />
      </div>

      <div>
        <div className="section-title">Доли лабораторий</div>
        <LabSharesTable s={s} />
        <div className="muted small" style={{ marginTop: 4 }}>
          Весь спрос рынка делится между моделями: чем выше качество, ниже цена, сильнее бренд и шумиха — тем больше доля.
        </div>
      </div>

      <div>
        <div className="section-title">Модели на рынке</div>
        <ModelsTable s={s} entries={entries} />
        <div className="muted small" style={{ marginTop: 4 }}>
          «Токенов/день» — спрос на модель до ограничения вашей мощностью.
        </div>
      </div>
    </div>
  );
}
