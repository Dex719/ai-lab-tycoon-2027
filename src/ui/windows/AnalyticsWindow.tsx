// «Аналитика» с вкладками, как в Processor Tycoon: ваши модели, рынок, бенчмарки, арена, финансы, лаборатории.

import { useMemo, useState } from 'react';
import type { WindowProps } from '.';
import { TOKENS_PER_USER_DAY } from '../../sim/constants';
import { marketSnapshot, type MarketEntry } from '../../sim/market';
import { contextLabel } from '../../sim/research';
import { dayToDate, formatDateShort } from '../../sim/time';
import type { PlayerModel } from '../../sim/types';
import { Alert } from '../components/common';
import { fmtElo, fmtMoney, fmtNum, fmtPrice, fmtShare } from '../format';
import { INCOME_LABELS } from '../labels';
import './AnalyticsWindow.css';
import { buildChartData, ChartPanel, finite, liveMonthLabel, safe, type SeriesDef } from './analyticsShared';
import FinanceTab from './FinanceWindow';
import MarketTab, { LabsTab } from './MarketWindow';
import { ArenaTab, BenchmarksTab } from './RatingsWindow';

type TabId = 'yours' | 'market' | 'bench' | 'arena' | 'finance' | 'labs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'yours', label: 'Ваши модели' },
  { id: 'market', label: 'Рынок' },
  { id: 'bench', label: 'Бенчмарки' },
  { id: 'arena', label: 'Арена' },
  { id: 'finance', label: 'Финансы' },
  { id: 'labs', label: 'Лаборатории' },
];

/** Вкладки, которые сами занимают всю высоту окна: таблица внутри прокручивается отдельно. */
const FILL_TABS: ReadonlySet<TabId> = new Set(['bench', 'arena']);

export default function AnalyticsWindow(props: WindowProps) {
  const [tab, setTab] = useState<TabId>('yours');
  const fill = FILL_TABS.has(tab);
  return (
    <div className="an">
      <div className="an-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            className={`tab${t.id === tab ? ' on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={`an-body${fill ? ' fill' : ''}`}>
        {tab === 'yours' && <YourModelsTab {...props} />}
        {tab === 'market' && <MarketTab {...props} />}
        {tab === 'bench' && <BenchmarksTab {...props} />}
        {tab === 'arena' && <ArenaTab {...props} />}
        {tab === 'finance' && <FinanceTab {...props} />}
        {tab === 'labs' && <LabsTab {...props} />}
      </div>
    </div>
  );
}

// ---------- Ваши модели ----------

const REVENUE_SERIES: SeriesDef[] = [
  { id: 'api', label: INCOME_LABELS.api, color: '#4ea1ff', pick: (r) => r.income.api },
  { id: 'contracts', label: INCOME_LABELS.contracts, color: '#f2c14e', pick: (r) => r.income.contracts },
];

function YourModelsTab({ s, open }: WindowProps) {
  const history = s.finance.history;
  const data = useMemo(() => buildChartData(history, REVENUE_SERIES), [history, history.length]);
  const cur = dayToDate(s.day);
  const live = { api: s.finance.month.income.api, contracts: s.finance.month.income.contracts };

  // Сначала модели в продаже, внутри группы - новые сверху.
  const released = s.models
    .filter((m) => m.releasedDay !== null)
    .sort((a, b) => Number(b.onApi) - Number(a.onApi) || (b.releasedDay ?? 0) - (a.releasedDay ?? 0));
  const snap = released.length > 0 ? safe(() => marketSnapshot(s).segments.developers.entries) : null;
  const byKey = new Map<string, MarketEntry>((snap ?? []).map((e) => [e.key, e]));
  const lost = s.market.lostFraction;

  return (
    <div className="an-page">
      <section>
        <h2 className="an-h">Выручка по месяцам</h2>
        <ChartPanel data={data} yFormat={fmtMoney} live={live} liveLabel={liveMonthLabel(cur.year, cur.month)} />
      </section>

      <section>
        <h2 className="an-h">Выпущенные модели</h2>
        {lost > 0.01 && (
          <Alert tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
            Не хватает мощности: теряется {fmtShare(lost, 0)} спроса.
          </Alert>
        )}
        {released.length === 0 ? (
          <div className="an-empty">
            <div>Выпущенных моделей нет.</div>
            <button className="btn small" onClick={() => open('models')}>
              Открыть «Модели»
            </button>
          </div>
        ) : (
          <ModelsTable models={released} byKey={byKey} />
        )}
      </section>
    </div>
  );
}

const USERS_TIP = `Оценка: токены в день / ${TOKENS_PER_USER_DAY.toLocaleString('ru-RU')}`;

/** Контекст модели: «128 тыс.», «1 млн»; если контекст неизвестен - «-». */
const ctxLabel = (tokens: number): string => (tokens > 0 ? contextLabel(tokens) : '-');

/** Оценка числа пользователей в день по спросу в токенах. */
const fmtUsers = (tokens: number): string => fmtNum(Math.round(tokens / TOKENS_PER_USER_DAY));

function ModelsTable({ models, byKey }: { models: PlayerModel[]; byKey: Map<string, MarketEntry> }) {
  let share = 0;
  let tokens = 0;
  let earned = 0;
  for (const m of models) {
    const e = byKey.get(`player:${m.id}`);
    if (e) {
      share += e.share;
      tokens += e.tokens;
    }
    earned += finite(m.earned);
  }
  return (
    <table className="grid an-grid">
      <thead>
        <tr>
          <th>Модель</th>
          <th>Состояние</th>
          <th>Выпущена</th>
          <th className="num" title="Длина контекста, токенов">
            Контекст
          </th>
          <th className="num">Эло</th>
          <th className="num">Цена за 1 млн токенов</th>
          <th className="num">Доля рынка</th>
          <th className="num" title="Спрос на модель до ограничения вашей мощностью">
            Токенов в день
          </th>
          <th className="num" title={USERS_TIP}>
            Пользователей в день
          </th>
          <th className="num" title="Выручка API с момента выпуска">
            Заработала
          </th>
        </tr>
      </thead>
      <tbody>
        {models.map((m) => {
          const e = byKey.get(`player:${m.id}`);
          return (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.onApi ? <span className="good">В продаже</span> : <span className="muted">Снята с продажи</span>}</td>
              <td>{m.releasedDay !== null ? formatDateShort(m.releasedDay) : '-'}</td>
              <td className="num">{ctxLabel(m.plan.context)}</td>
              <td className="num">{fmtElo(m.arenaElo)}</td>
              <td className="num">{fmtPrice(m.price)}</td>
              <td className="num">{e ? fmtShare(e.share) : '-'}</td>
              <td className="num">{e ? fmtNum(e.tokens) : '-'}</td>
              <td className="num">{e ? fmtUsers(e.tokens) : '-'}</td>
              <td className="num">{fmtMoney(finite(m.earned))}</td>
            </tr>
          );
        })}
      </tbody>
      {models.length > 1 && (
        <tfoot>
          <tr>
            <td colSpan={6}>Всего</td>
            <td className="num">{fmtShare(share)}</td>
            <td className="num">{fmtNum(tokens)}</td>
            <td className="num">{fmtUsers(tokens)}</td>
            <td className="num">{fmtMoney(earned)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
