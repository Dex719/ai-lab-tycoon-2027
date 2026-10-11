// Окно «Финансы» (FR-14.5): деньги, график остатка по месяцам и таблица доходов и расходов по статьям.

import { memo, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { WindowProps } from '.';
import { rentPerDay } from '../../sim/compute';
import { BANKRUPT_DAYS, OVERHEAD_MONTHLY, OVERHEAD_REVENUE_SHARE } from '../../sim/constants';
import { overheadPerDay } from '../../sim/finance';
import { dayToDate, formatMonth } from '../../sim/time';
import type { ExpenseKind, IncomeKind, MonthLedger, MonthRecord } from '../../sim/types';
import { Empty, Stat } from '../components/common';
import { fmtMoney, fmtShare } from '../format';

const INCOME_COLS: { kind: IncomeKind; label: string }[] = [
  { kind: 'api', label: 'API' },
  { kind: 'contracts', label: 'Контракты' },
  { kind: 'investors', label: 'Инвесторы' },
];

const EXPENSE_COLS: { kind: ExpenseKind; label: string }[] = [
  { kind: 'rent', label: 'Аренда' },
  { kind: 'overhead', label: 'Накладные' },
  { kind: 'labelers', label: 'Разметчики' },
  { kind: 'penalties', label: 'Штрафы' },
];

const TABLE_MONTHS = 12;

function sumValues(r: Record<string, number>): number {
  let t = 0;
  for (const v of Object.values(r)) t += Number.isFinite(v) ? v : 0;
  return t;
}

/** Подпись месяца для оси: «03.21». */
function monthLabel(r: Pick<MonthRecord, 'year' | 'month'>): string {
  return `${String(r.month).padStart(2, '0')}.${String(r.year % 100).padStart(2, '0')}`;
}

/** Сумма в ячейке таблицы: ноль показываем приглушённым тире. */
function Money({ value }: { value: number }) {
  return value > 0 ? <>{fmtMoney(value)}</> : <span className="muted">—</span>;
}

function LedgerRow({ label, ledger, current }: { label: string; ledger: MonthLedger; current?: boolean }) {
  const income = sumValues(ledger.income);
  const expense = sumValues(ledger.expense);
  const net = income - expense;
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
      <td className={`num ${net < 0 ? 'bad' : 'good'}`}>
        {net > 0 ? '+' : ''}
        {fmtMoney(net)}
      </td>
    </tr>
  );
}

// Перерисовывается только при закрытии месяца (len меняется), а не на каждом тике.
const CashChart = memo(
  function CashChart({ history }: { history: MonthRecord[]; len: number }) {
    // История меняется на месте (push раз в месяц), поэтому пересчитываем по длине.
    const data = useMemo(
      () => history.map((r) => ({ label: monthLabel(r), cash: r.cashEnd })),
      [history, history.length],
    );

    if (data.length < 2) return <Empty>График появится через пару месяцев.</Empty>;
    return (
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#3a4656" strokeDasharray="3 3" />
          <XAxis dataKey="label" stroke="#8d9aab" tick={{ fill: '#8d9aab', fontSize: 11 }} minTickGap={16} />
          <YAxis
            stroke="#8d9aab"
            tick={{ fill: '#8d9aab', fontSize: 11 }}
            width={78}
            tickFormatter={(v: number) => fmtMoney(v)}
          />
          <Tooltip
            contentStyle={{ background: '#232c38', border: '1px solid #4d5b6e', fontSize: 12 }}
            labelStyle={{ color: '#dbe2ea' }}
            itemStyle={{ color: '#dbe2ea' }}
            formatter={(v) => [fmtMoney(Number(v)), 'Деньги на конец месяца']}
            labelFormatter={(l) => `Конец месяца ${String(l)}`}
          />
          <ReferenceLine y={0} stroke="#ff6b6b" strokeDasharray="4 3" />
          <Area
            type="monotone"
            dataKey="cash"
            stroke="#4ea1ff"
            strokeWidth={2}
            fill="#4ea1ff"
            fillOpacity={0.2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  },
  (a, b) => a.len === b.len,
);

export default function FinanceWindow({ s }: WindowProps) {
  const income = sumValues(s.finance.month.income);
  const expense = sumValues(s.finance.month.expense);
  const rent = rentPerDay(s);
  const overhead = overheadPerDay(s);

  const cur = dayToDate(s.day);
  // Первая строка — идущий месяц, дальше до 12 закрытых месяцев, новые сверху.
  const closed = s.finance.history.slice(-TABLE_MONTHS).reverse();

  const negDays = s.finance.negativeDays;

  return (
    <div className="col">
      <div className="row" style={{ alignItems: 'stretch' }}>
        <Stat
          label="Деньги"
          value={<span className={s.cash < 0 ? 'bad' : undefined}>{fmtMoney(s.cash)}</span>}
        />
        <Stat label="Доход за месяц" value={<span className="good">{fmtMoney(income)}</span>} hint="с начала месяца" />
        <Stat label="Расход за месяц" value={fmtMoney(expense)} hint="с начала месяца" />
        <Stat label="Аренда" value={fmtMoney(rent)} hint="в день" />
        <Stat label="Накладные" value={fmtMoney(overhead)} hint="в день" />
      </div>

      {negDays > 0 && (
        <div className="card" style={{ borderColor: 'var(--bad)' }}>
          <span className="bad">
            Деньги в минусе уже {negDays} дн. До банкротства осталось {Math.max(0, BANKRUPT_DAYS - negDays)} дн.
          </span>
        </div>
      )}

      <div>
        <div className="section-title">Деньги на конец месяца</div>
        <CashChart history={s.finance.history} len={s.finance.history.length} />
      </div>

      <div>
        <div className="section-title">Доходы и расходы по месяцам</div>
        <table className="grid">
          <thead>
            <tr>
              <th style={{ position: 'static' }} />
              <th colSpan={INCOME_COLS.length} className="num good" style={{ position: 'static' }}>
                Доходы
              </th>
              <th colSpan={EXPENSE_COLS.length} className="num bad" style={{ position: 'static' }}>
                Расходы
              </th>
              <th style={{ position: 'static' }} />
            </tr>
            <tr>
              <th>Месяц</th>
              {INCOME_COLS.map((c) => (
                <th key={c.kind} className="num">
                  {c.label}
                </th>
              ))}
              {EXPENSE_COLS.map((c) => (
                <th key={c.kind} className="num">
                  {c.label}
                </th>
              ))}
              <th className="num">Итог</th>
            </tr>
          </thead>
          <tbody>
            <LedgerRow label={`${formatMonth(cur.year, cur.month)} (идёт)`} ledger={s.finance.month} current />
            {closed.map((r) => (
              <LedgerRow key={`${r.year}-${r.month}`} label={formatMonth(r.year, r.month)} ledger={r} />
            ))}
          </tbody>
        </table>
        <div className="muted small" style={{ marginTop: 4 }}>
          «Итог» — доходы минус расходы за месяц. Накладные: {fmtMoney(OVERHEAD_MONTHLY)} в месяц плюс{' '}
          {fmtShare(OVERHEAD_REVENUE_SHARE, 0)} выручки прошлого месяца. Разметчики — люди, которые оценивают ответы
          модели при обучении с обратной связью (RLHF). Штрафы — за сорванные контракты.
        </div>
      </div>

      <div className="muted small">
        Если деньги будут в минусе {BANKRUPT_DAYS} дней подряд, лаборатория обанкротится и игра будет проиграна.
        Сократите аренду, возьмите контракты или привлеките инвесторов.
      </div>
    </div>
  );
}
