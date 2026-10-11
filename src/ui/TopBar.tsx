// Верхняя панель (как в Processor Tycoon): деньги, изменение за месяц, дата, скорость; справа доля рынка и место на «Арене».

import { useEffect, useState , type ReactElement } from 'react';
import { pendingChoice } from '../sim/events';
import { overheadPerDay } from '../sim/finance';
import { rentPerDay } from '../sim/compute';
import { playerBestArenaRank } from '../sim/tick';
import { dayToDate } from '../sim/time';
import type { ExpenseKind, GameState, IncomeKind, Speed } from '../sim/types';
import { fmtMoney, fmtShare } from './format';
import { IconAlert, IconArrowUpDown, IconBank, IconCalendar, IconFast, IconFaster, IconPause, IconPlay } from './icons';
import { store, useSpeed } from './store';

const SPEEDS: { speed: Speed; title: string; Icon: () => ReactElement }[] = [
  { speed: 0, title: 'Пауза (пробел)', Icon: () => <IconPause /> },
  { speed: 1, title: 'Скорость ×1', Icon: () => <IconPlay /> },
  { speed: 2, title: 'Скорость ×2', Icon: () => <IconFast /> },
  { speed: 4, title: 'Скорость ×4', Icon: () => <IconFaster /> },
];

const INCOME: { k: IncomeKind; label: string }[] = [
  { k: 'api', label: 'Продажа API' },
  { k: 'contracts', label: 'Контракты' },
  { k: 'investors', label: 'Инвесторы' },
];
const EXPENSE: { k: ExpenseKind; label: string }[] = [
  { k: 'rent', label: 'Аренда мощностей' },
  { k: 'overhead', label: 'Зарплаты и офис' },
  { k: 'labelers', label: 'Разметчики' },
  { k: 'penalties', label: 'Штрафы' },
];

/** Изменение денег в месяц: итог прошлого месяца без инвесторов, а в первый месяц — текущие расходы. */
function monthlyRate(s: GameState): number {
  const h = s.finance.history.at(-1);
  if (h) {
    const inc = h.income.api + h.income.contracts;
    const exp = h.expense.rent + h.expense.overhead + h.expense.labelers + h.expense.penalties;
    return inc - exp;
  }
  return -(rentPerDay(s) + overheadPerDay(s)) * 30;
}

function dateText(day: number): string {
  const d = dayToDate(day);
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`;
}

function MoneyPopup({ s }: { s: GameState }) {
  const m = s.finance.month;
  return (
    <div className="money-pop" role="tooltip">
      <div className="r" style={{ color: '#f2f2f2' }}>
        <span>С начала месяца</span>
        <span />
      </div>
      {INCOME.map(({ k, label }) => (
        <div className="r" key={k} style={m.income[k] > 0 ? { color: 'var(--good-on-dark)' } : undefined}>
          <span>{label}:</span>
          <span className="v">{fmtMoney(m.income[k])}</span>
        </div>
      ))}
      {EXPENSE.map(({ k, label }) => (
        <div className="r" key={k} style={m.expense[k] > 0 ? { color: 'var(--bad-on-dark)' } : undefined}>
          <span>{label}:</span>
          <span className="v">{m.expense[k] > 0 ? '−' : ''}{fmtMoney(m.expense[k])}</span>
        </div>
      ))}
    </div>
  );
}

export function TopBar({ s }: { s: GameState }) {
  const speed = useSpeed();
  const [hover, setHover] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code !== 'Space' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if ((e.target as HTMLElement)?.closest('[aria-modal="true"]')) return;
      e.preventDefault();
      store.togglePause();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rate = monthlyRate(s);
  let rank: number | null = null;
  try {
    rank = playerBestArenaRank(s);
  } catch {
    rank = null;
  }
  const locked = !!s.outcome || pendingChoice(s) !== null;
  const negative = s.finance.negativeDays > 0;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <b>{s.labName}</b>
        {s.founderName && <span>{s.founderName}</span>}
        {store.autosaveError && (
          <span className="tb-bad" title={store.autosaveError} style={{ display: 'flex' }}>
            <IconAlert />
          </span>
        )}
      </div>
      <div className="topbar-center">
        <div className="tb-item" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor: 'default' }}>
          <IconBank />
          <span className={s.cash < 0 ? 'tb-bad' : undefined}>{fmtMoney(s.cash)}</span>
          {hover && <MoneyPopup s={s} />}
        </div>
        <div className="tb-item" title="Доходы минус расходы за прошлый месяц">
          <IconArrowUpDown />
          <span className={rate >= 0 ? 'tb-good' : 'tb-bad'}>
            {rate >= 0 ? '' : '−'}
            {fmtMoney(Math.abs(rate))}/мес.
          </span>
        </div>
        <div className="tb-item">
          <IconCalendar />
          <span>{dateText(s.day)}</span>
        </div>
        <div className="speed">
          {SPEEDS.map(({ speed: sp, title, Icon }) => (
            <button
              key={sp}
              className={speed === sp ? 'on' : undefined}
              title={title}
              aria-label={title}
              aria-pressed={speed === sp}
              disabled={locked && sp !== 0}
              data-tutorial={sp === 1 ? 'speed-play' : undefined}
              onClick={() => store.setSpeed(sp)}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>
      <div className="topbar-right">
        <span>Доля рынка: {fmtShare(s.market.labShares.player ?? 0, 2)}</span>
        <span>«Арена»: {rank !== null ? `${rank}-е место` : '—'}</span>
      </div>
      {(store.pauseReason || negative) && speed === 0 && (
        <div className="pause-note">
          {store.pauseReason ? `Пауза: ${store.pauseReason}` : 'Деньги в минусе'}
          {negative && ` · до банкротства ${Math.max(0, 60 - s.finance.negativeDays)} дн.`}
        </div>
      )}
    </header>
  );
}
