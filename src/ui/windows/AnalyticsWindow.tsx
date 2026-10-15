// «Аналитика» с вкладками, как в Processor Tycoon: первой идёт «Арена» (главная цель игры), дальше ваши модели, рынок,
// бенчмарки, финансы, лаборатории.

import { Fragment, useMemo, useState } from 'react';
import type { WindowProps } from '.';
import { playerSales, subsOpen, type PlayerSales } from '../../sim/market';
import { contextLabel } from '../../sim/research';
import { formatDateShort } from '../../sim/time';
import type { GameState, PlayerModel } from '../../sim/types';
import { Alert } from '../components/common';
import { ModelEmblem } from '../components/ModelEmblem';
import { IconCaret, IconTrophy } from '../icons';
import { TierBadge } from '../components/TierBadge';
import { fmtElo, fmtMoney, fmtNum, fmtPrice, fmtShare } from '../format';
import { INCOME_LABELS, modelChannels, reviewNote } from '../labels';
import './AnalyticsWindow.css';
import { buildChartData, ChartPanel, currentMonthView, finite, StatStrip, type SeriesDef } from './analyticsShared';
import FinanceTab from './FinanceWindow';
import MarketTab, { LabsTab } from './MarketWindow';
import { ArenaTab, BenchmarksTab } from './RatingsWindow';

type TabId = 'yours' | 'market' | 'bench' | 'arena' | 'finance' | 'labs';

const TABS: { id: TabId; label: string }[] = [
  { id: 'arena', label: 'Арена' },
  { id: 'yours', label: 'Ваши модели' },
  { id: 'market', label: 'Рынок' },
  { id: 'bench', label: 'Бенчмарки' },
  { id: 'finance', label: 'Финансы' },
  { id: 'labs', label: 'Лаборатории' },
];

/** Вкладки, которые сами занимают всю высоту окна: таблица внутри прокручивается отдельно. */
const FILL_TABS: ReadonlySet<TabId> = new Set(['bench']);

export default function AnalyticsWindow(props: WindowProps) {
  const [tab, setTab] = useState<TabId>('arena');
  const fill = FILL_TABS.has(tab);
  return (
    <div className="an">
      <div className="an-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            className={`tab${t.id === tab ? ' on' : ''}${t.id === 'arena' ? ' an-tab-arena' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.id === 'arena' && <IconTrophy size={16} />}
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

/** Цвет подписок на графике: бирюзовый, как панель канала «Подписка» в «Моделях». */
const SUBS_COLOR = '#1fa8a0';

const REVENUE_SERIES: SeriesDef[] = [
  { id: 'api', label: INCOME_LABELS.api, color: '#2f80e4', pick: (r) => r.income.api },
  { id: 'subs', label: INCOME_LABELS.subs, color: SUBS_COLOR, pick: (r) => r.income.subs },
  { id: 'contracts', label: INCOME_LABELS.contracts, color: '#d9822b', pick: (r) => r.income.contracts },
];

const SUBSCRIBERS_SERIES: SeriesDef[] = [
  {
    id: 'subscribers',
    label: 'Подписчиков',
    color: SUBS_COLOR,
    title: 'Обслуженные подписчики в последний день месяца',
    pick: (r) => r.subscribers,
  },
];

/** Потери спроса по каналам: показываем, когда теряется больше 1 %. */
function lostChannels(s: GameState): { label: string; lost: number }[] {
  const out: { label: string; lost: number }[] = [];
  if (finite(s.market.lostApi) > 0.01) out.push({ label: 'API', lost: s.market.lostApi });
  if (finite(s.market.lostSubs) > 0.01) out.push({ label: 'Подписки', lost: s.market.lostSubs });
  return out;
}

function YourModelsTab({ s, open }: WindowProps) {
  const history = s.finance.history;
  // До открытия подписок ряда «Подписки» нет: будущее не показываем.
  const subsEver = subsOpen(s.day) || history.some((r) => finite(r.income.subs) > 0);
  const data = useMemo(
    () => buildChartData(history, subsEver ? REVENUE_SERIES : REVENUE_SERIES.filter((d) => d.id !== 'subs')),
    [history, history.length, subsEver],
  );
  const subsData = useMemo(() => buildChartData(history, SUBSCRIBERS_SERIES), [history, history.length]);
  const view = currentMonthView(s);
  const live = {
    api: view.ledger.income.api,
    subs: view.ledger.income.subs,
    contracts: view.ledger.income.contracts,
  };
  const subsAvailable = subsOpen(s.day);
  const showSubsChart = subsAvailable || history.some((r) => finite(r.subscribers) > 0);

  // Сначала модели в продаже, внутри группы - новые сверху.
  const released = s.models
    .filter((m) => m.releasedDay !== null)
    .sort(
      (a, b) =>
        Number(b.onApi || b.onSubs) - Number(a.onApi || a.onSubs) || (b.releasedDay ?? 0) - (a.releasedDay ?? 0),
    );
  const sales = new Map<string, PlayerSales>(released.map((m) => [m.id, playerSales(s, m.id)]));
  let apiDay = 0;
  let subsDay = 0;
  for (const v of sales.values()) {
    apiDay += v.apiRevenueDay;
    subsDay += v.subsRevenueDay;
  }
  const lost = lostChannels(s);

  return (
    <div className="an-page">
      <StatStrip
        items={[
          ...(subsOpen(s.day) || s.market.playerSubs > 0 ? [{
            label: 'Подписчиков',
            value: <span className={s.market.playerSubs > 0 ? 'good' : undefined}>{fmtNum(Math.round(finite(s.market.playerSubs)))}</span>,
            title: 'Обслуженные вчера пользователи подписки',
          },
          {
            label: 'Выручка подписок в день',
            value: <span className={subsDay > 0 ? 'good' : undefined}>{fmtMoney(subsDay)}</span>,
            title: 'Подписчики × цена подписки / 30',
          }] : []),
          {
            label: 'Выручка API в день',
            value: <span className={apiDay > 0 ? 'good' : undefined}>{fmtMoney(apiDay)}</span>,
            title: 'Токены в день × цена за 1 млн токенов',
          },
          { label: 'Доля рынка', value: fmtShare(finite(s.market.labShares.player)), title: 'Общая доля по всем сегментам' },
        ]}
      />

      <section>
        <h2 className="an-h">Выручка по месяцам</h2>
        <ChartPanel data={data} yFormat={fmtMoney} live={live} liveLabel={view.label} />
      </section>

      {showSubsChart && (
        <section>
          <h2 className="an-h">Подписчики по месяцам</h2>
          <ChartPanel
            data={subsData}
            yFormat={fmtNum}
            live={{ subscribers: finite(s.market.playerSubs) }}
            liveLabel={view.label}
            height={200}
          />
        </section>
      )}

      <section>
        <h2 className="an-h">Выпущенные модели</h2>
        {lost.map((c) => (
          <Alert key={c.label} tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
            Не хватает мощности «{c.label}»: теряется {fmtShare(c.lost, 0)} спроса.
          </Alert>
        ))}
        {released.length === 0 ? (
          <div className="an-empty">
            <div>Выпущенных моделей нет.</div>
            <button className="btn small" onClick={() => open('models')}>
              Открыть «Модели»
            </button>
          </div>
        ) : (
          <ModelsTable s={s} models={released} sales={sales} subsAvailable={subsAvailable} />
        )}
      </section>
    </div>
  );
}

/** Контекст модели: «128 тыс.», «1 млн»; если контекст неизвестен - «-». */
const ctxLabel = (tokens: number): string => (tokens > 0 ? contextLabel(tokens) : '-');

const Dash = () => <span className="muted">-</span>;

function ModelsTable({
  s,
  models,
  sales,
  subsAvailable,
}: {
  s: GameState;
  models: PlayerModel[];
  sales: Map<string, PlayerSales>;
  subsAvailable: boolean;
}) {
  let share = 0;
  let tokens = 0;
  let subscribers = 0;
  let earned = 0;
  let earnedSubs = 0;
  for (const m of models) {
    share += finite(s.market.shares[`player:${m.id}`]);
    const v = sales.get(m.id);
    tokens += v?.apiTokens ?? 0;
    subscribers += v?.subsUsers ?? 0;
    earned += finite(m.earned);
    earnedSubs += finite(m.earnedSubs);
  }
  const [open, setOpen] = useState<string | null>(null);
  let revenueDay = 0;
  for (const m of models) {
    const v = sales.get(m.id);
    revenueDay += (v?.apiRevenueDay ?? 0) + (v?.subsRevenueDay ?? 0);
  }
  return (
    <table className="grid an-grid flat an-wrap">
      <thead>
        <tr>
          <th>Модель</th>
          <th title="Где продаётся модель: API, подписка или оба канала">Продажа</th>
          <th className="num">Эло</th>
          <th className="num" title="Общая доля по всем сегментам">
            Доля рынка
          </th>
          <th className="num" title="Выручка API и подписок за вчерашний день">
            Выручка в день
          </th>
          <th className="num" title="Выручка API и подписок с момента выпуска">
            Заработала
          </th>
        </tr>
      </thead>
      <tbody>
        {models.map((m) => {
          const v = sales.get(m.id);
          const channels = modelChannels(m, subsAvailable);
          const note = reviewNote(m);
          const onSubs = m.onSubs && subsAvailable;
          const isOpen = open === m.id;
          const day = (v?.apiRevenueDay ?? 0) + (v?.subsRevenueDay ?? 0);
          return (
            <Fragment key={m.id}>
              <tr
                className={`an-click${isOpen ? ' open' : ''}`}
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setOpen(isOpen ? null : m.id);
                  }
                }}
              >
                <td>
                  <span className="an-mname">
                    <IconCaret size={14} className={`an-caret${isOpen ? ' open' : ''}`} />
                    <ModelEmblem m={m} size={24} exposed={m.exposed} faded={!channels} />
                    {m.name}
                    <span className="an-tier">
                      <TierBadge tier={m.plan.tier} plain />
                    </span>
                  </span>
                </td>
                <td>
                  {channels ? <span className="good">{channels}</span> : <span className="muted">Снята с продажи</span>}
                  {note && <small className={`an-note ${note.tone}`}>{note.text}</small>}
                </td>
                <td className="num">{fmtElo(m.arenaElo)}</td>
                <td className="num">{fmtShare(finite(s.market.shares[`player:${m.id}`]))}</td>
                <td className="num">{day > 0 ? fmtMoney(day) : <Dash />}</td>
                <td className="num">
                  {fmtMoney(finite(m.earned))}
                  {finite(m.earnedSubs) > 0 && <small className="an-note">подписки {fmtMoney(finite(m.earnedSubs))}</small>}
                </td>
              </tr>
              {isOpen && (
                <tr className="an-detail">
                  <td colSpan={6}>
                    <dl className="an-dl">
                      <dt>Выпущена</dt>
                      <dd>{m.releasedDay !== null ? formatDateShort(m.releasedDay) : '-'}</dd>
                      <dt>Контекст</dt>
                      <dd>{ctxLabel(m.plan.context)}</dd>
                      <dt title="Доллары за 1 млн токенов">Цена API</dt>
                      <dd>{m.onApi ? fmtPrice(m.price) : <Dash />}</dd>
                      <dt title="Доллары в месяц за пользователя">Цена подписки</dt>
                      <dd>{onSubs ? fmtPrice(m.subsPrice) : <Dash />}</dd>
                      <dt title="Токены API, обслуженные вчера">Токенов в день</dt>
                      <dd>{m.onApi && v ? fmtNum(v.apiTokens) : <Dash />}</dd>
                      <dt title="Пользователи подписки, обслуженные вчера">Подписчиков</dt>
                      <dd>{onSubs && v ? fmtNum(Math.round(v.subsUsers)) : <Dash />}</dd>
                    </dl>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
      {models.length > 1 && (
        <tfoot>
          <tr>
            <td colSpan={3}>Всего</td>
            <td className="num">{fmtShare(share)}</td>
            <td className="num">{revenueDay > 0 ? fmtMoney(revenueDay) : <Dash />}</td>
            <td className="num">
              {fmtMoney(earned)}
              {earnedSubs > 0 && <small className="an-note">подписки {fmtMoney(earnedSubs)}</small>}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
