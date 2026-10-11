// Вкладка «Финансы»: выручка и расходы по месяцам, показатели и таблица за 12 месяцев.

import { useMemo } from 'react';
import type { WindowProps } from '.';
import { rentPerDay } from '../../sim/compute';
import { BANKRUPT_DAYS, OVERHEAD_MONTHLY, OVERHEAD_REVENUE_SHARE } from '../../sim/constants';
import { overheadPerDay, revenueLast90 } from '../../sim/finance';
import { dayToDate, formatMonth } from '../../sim/time';
import type { ExpenseKind, IncomeKind, MonthLedger, MonthRecord } from '../../sim/types';
import { Alert } from '../components/common';
import { fmtMoney, fmtNum, fmtShare } from '../format';
import { EXPENSE_KINDS, EXPENSE_LABELS, INCOME_KINDS, INCOME_LABELS } from '../labels';
import { buildChartData, ChartPanel, finite, liveMonthLabel, StatStrip, type SeriesDef } from './analyticsShared';

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

const revenueOf = (l: MonthLedger): number => finite(l.income.api) + finite(l.income.contracts);

/** Итог месяца так же, как «/мес.» на верхней панели: продажа API и контракты минус все расходы, без инвесторов. */
const netWithoutInvestors = (l: MonthLedger): number => revenueOf(l) - sumValues(l.expense);

const FLOW_SERIES: SeriesDef[] = [
  { id: 'revenue', label: 'Выручка', color: '#5ed37f', title: 'API и контракты, без вложений инвесторов', pick: revenueOf },
  { id: 'expense', label: 'Расходы', color: '#ff6b6b', pick: (r: MonthRecord) => sumValues(r.expense) },
];

/** Сумма в ячейке таблицы: ноль показываем приглушённым тире. */
function Money({ value }: { value: number }) {
  return value > 0 ? <>{fmtMoney(value)}</> : <span className="muted">-</span>;
}

function LedgerRow({ label, ledger, current }: { label: string; ledger: MonthLedger; current?: boolean }) {
  const net = netWithoutInvestors(ledger);
  return (
    <tr>
      <td className={current ? 'est' : undefined}>{label}</td>
      {INCOME_COLS.map((c) => (
        <td key={c.kind} className="num">
          <Money value={ledger.income[c.kind]} />
        </td>
      ))}
      {EXPENSE_COLS.map((c) => (
        <td key={c.kind} className="num">
          <Money value={ledger.expense[c.kind]} />
        </td>
      ))}
      <td className={`num ${net < 0 ? 'bad' : net > 0 ? 'good' : ''}`}>
        {net > 0 ? '+' : ''}
        {fmtMoney(net)}
      </td>
    </tr>
  );
}

export default function FinanceTab({ s }: WindowProps) {
  const history = s.finance.history;
  const data = useMemo(() => buildChartData(history, FLOW_SERIES), [history, history.length]);

  const cur = dayToDate(s.day);
  const live = { revenue: revenueOf(s.finance.month), expense: sumValues(s.finance.month.expense) };
  // Первая строка - идущий месяц, дальше до 12 закрытых, новые сверху.
  const closed = history.slice(-TABLE_MONTHS).reverse();
  const negDays = s.finance.negativeDays;

  return (
    <div className="an-page">
      <StatStrip
        items={[
          { label: 'Деньги', value: <span className={s.cash < 0 ? 'bad' : undefined}>{fmtMoney(s.cash)}</span> },
          { label: 'Выручка за 90 дней', value: fmtMoney(revenueLast90(s)), title: 'API и контракты' },
          { label: 'Аренда в день', value: fmtMoney(rentPerDay(s)) },
          { label: 'Накладные в день', value: fmtMoney(overheadPerDay(s)) },
        ]}
      />

      {negDays > 0 && (
        <Alert tone="bad">
          Деньги в минусе {fmtNum(negDays)} дн. До банкротства осталось {fmtNum(Math.max(0, BANKRUPT_DAYS - negDays))} дн.
        </Alert>
      )}

      <section>
        <h2 className="an-h">Выручка и расходы по месяцам</h2>
        <ChartPanel data={data} yFormat={fmtMoney} live={live} liveLabel={liveMonthLabel(cur.year, cur.month)} />
      </section>

      <section>
        <h2 className="an-h">Последние 12 месяцев</h2>
        <table className="grid an-grid flat">
          <thead>
            <tr className="grp">
              <th />
              <th colSpan={INCOME_COLS.length} className="good">
                Доходы
              </th>
              <th colSpan={EXPENSE_COLS.length} className="bad">
                Расходы
              </th>
              <th />
            </tr>
            <tr>
              <th>Месяц</th>
              {INCOME_COLS.map((c) => (
                <th key={c.kind} className="num" title={c.title}>
                  {c.label}
                </th>
              ))}
              {EXPENSE_COLS.map((c) => (
                <th key={c.kind} className="num" title={c.title}>
                  {c.label}
                </th>
              ))}
              <th className="num" title="Продажа API и контракты минус расходы за месяц, без вложений инвесторов">
                Итог без инвесторов
              </th>
            </tr>
          </thead>
          <tbody>
            <LedgerRow label={`${formatMonth(cur.year, cur.month)} (идёт)`} ledger={s.finance.month} current />
            {closed.map((r) => (
              <LedgerRow key={`${r.year}-${r.month}`} label={formatMonth(r.year, r.month)} ledger={r} />
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
