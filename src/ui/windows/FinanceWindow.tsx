// Вкладка «Финансы»: выручка и расходы по месяцам, показатели и таблица за 12 месяцев.

import { useMemo, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { rentPerDay } from '../../sim/compute';
import { BANKRUPT_DAYS, OVERHEAD_MONTHLY, OVERHEAD_REVENUE_SHARE } from '../../sim/constants';
import { overheadPerDay, revenueLast90 } from '../../sim/finance';
import { subsOpen } from '../../sim/market';
import { dayToDate, formatMonth } from '../../sim/time';
import type { ExpenseKind, IncomeKind, MonthLedger, MonthRecord } from '../../sim/types';
import { Alert } from '../components/common';
import { fmtDays, fmtMoney, fmtNum, fmtShare } from '../format';
import { EXPENSE_KINDS, EXPENSE_LABELS, INCOME_KINDS, INCOME_LABELS } from '../labels';
import { buildChartData, ChartPanel, currentMonthView, finite, StatStrip, type SeriesDef } from './analyticsShared';

const INCOME_COLS: { kind: IncomeKind; label: string; title?: string }[] = INCOME_KINDS.map((kind) => ({
  kind,
  label: INCOME_LABELS[kind],
  title: kind === 'investors' ? 'Вложения инвесторов: в «Итог без инвесторов» не входят' : undefined,
}));

const EXPENSE_TITLES: Record<ExpenseKind, string> = {
  rent: 'Оплата арендованных карт',
  overhead: `${fmtMoney(OVERHEAD_MONTHLY)} в месяц плюс ${fmtShare(OVERHEAD_REVENUE_SHARE, 0)} выручки прошлого месяца`,
  labelers: 'Оплата разметки ответов при обучении с RLHF',
  penalties: 'Штрафы за сорванные контракты',
  review: 'Оплата внешней проверки сильных моделей',
  capex: 'Стройка своих дата-центров, покупка карт и компаний, подъёмные командам, доработка моделей. В итог месяца не входит',
  power: 'Электричество и обслуживание своих дата-центров',
};
const EXPENSE_COLS: { kind: ExpenseKind; label: string; title: string }[] = EXPENSE_KINDS.map((kind) => ({
  kind,
  label: EXPENSE_LABELS[kind],
  title: EXPENSE_TITLES[kind],
}));

const TABLE_MONTHS = 12;

function sumValues(r: Record<string, number>): number {
  let t = 0;
  for (const v of Object.values(r)) t += finite(v);
  return t;
}

const revenueOf = (l: MonthLedger): number => finite(l.income.api) + finite(l.income.subs) + finite(l.income.contracts);

/** Итог месяца так же, как «/мес.» на верхней панели: продажа API, подписки и контракты минус все расходы, без инвесторов. */
const recurringExpense = (l: MonthLedger): number => sumValues(l.expense) - finite(l.expense.capex);
const netWithoutInvestors = (l: MonthLedger): number => revenueOf(l) - recurringExpense(l);

const FLOW_SERIES: SeriesDef[] = [
  { id: 'revenue', label: 'Выручка', color: '#2e9b4f', title: 'Продажа моделей и контракты, без вложений инвесторов', pick: revenueOf },
  { id: 'expense', label: 'Расходы', color: '#d64545', title: 'Текущие расходы, без разовых вложений в дата-центры и карты', pick: (r: MonthRecord) => recurringExpense(r) },
];

/** Сумма в ячейке таблицы: ноль показываем приглушённым тире. */
function Money({ value }: { value: number }) {
  return value > 0 ? <>{fmtMoney(value)}</> : <span className="muted">-</span>;
}

function LedgerRow({
  label,
  ledger,
  subscribers,
  current,
  subs,
}: {
  label: ReactNode;
  ledger: MonthLedger;
  subscribers: number;
  current?: boolean;
  /** Подписки уже открыты: колонки подписок видны. */
  subs: boolean;
}) {
  const net = netWithoutInvestors(ledger);
  return (
    <tr>
      <td className={current ? 'est' : undefined}>{label}</td>
      {INCOME_COLS.filter((c) => subs || c.kind !== 'subs').map((c) => (
        <td key={c.kind} className="num inc">
          <Money value={ledger.income[c.kind]} />
        </td>
      ))}
      {EXPENSE_COLS.map((c) => (
        <td key={c.kind} className="num exp">
          <Money value={ledger.expense[c.kind]} />
        </td>
      ))}
      <td className={`num ${net < 0 ? 'bad' : net > 0 ? 'good' : ''}`}>
        {net > 0 ? '+' : ''}
        {fmtMoney(net)}
      </td>
      {subs && <td className="num">{subscribers > 0 ? fmtNum(Math.round(subscribers)) : <span className="muted">-</span>}</td>}
    </tr>
  );
}

export default function FinanceTab({ s }: WindowProps) {
  const history = s.finance.history;
  const data = useMemo(() => buildChartData(history, FLOW_SERIES), [history, history.length]);

  const cur = dayToDate(s.day);
  const view = currentMonthView(s);
  const live = { revenue: revenueOf(view.ledger), expense: recurringExpense(view.ledger) };
  // Первая строка - идущий месяц, дальше до 12 закрытых, новые сверху.
  const closed = history.slice(-TABLE_MONTHS).reverse();
  const negDays = s.finance.negativeDays;
  // До открытия подписок их колонок и показателей нет: будущее не показываем.
  const subs = subsOpen(s.day) || history.some((r) => finite(r.income.subs) > 0);
  const incomeCols = INCOME_COLS.filter((c) => subs || c.kind !== 'subs');

  return (
    <div className="an-page">
      <StatStrip
        items={[
          { label: 'Деньги', value: <span className={s.cash < 0 ? 'bad' : undefined}>{fmtMoney(s.cash)}</span> },
          {
            label: 'Выручка за 90 дней',
            value: <span className="good">{fmtMoney(revenueLast90(s))}</span>,
            title: 'Продажа моделей и контракты',
          },
          ...(subs
            ? [
                {
                  label: 'Подписчиков',
                  value: fmtNum(Math.round(finite(s.market.playerSubs))),
                  title: 'Обслуженные вчера пользователи подписки',
                },
              ]
            : []),
          {
            label: 'Разовые вложения',
            value: <span className={finite(s.finance.month.expense.capex) > 0 ? 'bad' : undefined}>{fmtMoney(finite(s.finance.month.expense.capex))}</span>,
            title: 'За этот месяц: стройка дата-центров и покупка карт. В «за месяц» на верхней панели не входят',
          },
          { label: 'Аренда в день', value: <span className={rentPerDay(s) > 0 ? 'bad' : undefined}>{fmtMoney(rentPerDay(s))}</span> },
          { label: 'Накладные в день', value: <span className="bad">{fmtMoney(overheadPerDay(s))}</span> },
        ]}
      />

      {negDays > 0 && (
        <Alert tone="bad">
          Деньги в минусе {fmtDays(negDays)}. До банкротства осталось {fmtDays(Math.max(0, BANKRUPT_DAYS - negDays))}.
        </Alert>
      )}

      <section>
        <h2 className="an-h">Выручка и расходы по месяцам</h2>
        <ChartPanel data={data} yFormat={fmtMoney} live={live} liveLabel={view.label} />
      </section>

      <section>
        <h2 className="an-h">Последние 12 месяцев</h2>
        <table className="grid an-grid flat an-wrap">
          <thead>
            <tr className="grp">
              <th />
              <th colSpan={incomeCols.length} className="good">
                Доходы
              </th>
              <th colSpan={EXPENSE_COLS.length} className="bad">
                Расходы
              </th>
              <th />
              {subs && <th />}
            </tr>
            <tr>
              <th>Месяц</th>
              {incomeCols.map((c) => (
                <th key={c.kind} className="num" title={c.title}>
                  {c.label}
                </th>
              ))}
              {EXPENSE_COLS.map((c) => (
                <th key={c.kind} className="num" title={c.title}>
                  {c.label}
                </th>
              ))}
              <th
                className="num"
                title={`${subs ? 'Продажа API, подписки и контракты' : 'Продажа API и контракты'} минус текущие расходы за месяц, без вложений инвесторов и разовых вложений`}
              >
                Итог без инвесторов
              </th>
              {subs && (
                <th className="num" title="Обслуженные подписчики в последний день месяца">
                  Подписчики
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {!view.closed && (
            <LedgerRow
              label={
                <>
                  {formatMonth(cur.year, cur.month)}
                  <small className="an-note">идёт</small>
                </>
              }
              ledger={s.finance.month}
              subscribers={finite(s.market.playerSubs)}
              current
              subs={subs}
            />
            )}
            {closed.map((r) => (
              <LedgerRow key={`${r.year}-${r.month}`} label={formatMonth(r.year, r.month)} ledger={r} subscribers={finite(r.subscribers)} subs={subs} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
