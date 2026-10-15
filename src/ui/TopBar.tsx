// Верхняя панель (как в Processor Tycoon): деньги, изменение за месяц, дата, скорость; справа доля рынка и место на «Арене».

import { useEffect, useState , type ReactElement } from 'react';
import { pendingChoice } from '../sim/events';
import { overheadPerDay } from '../sim/finance';
import { rentPerDay } from '../sim/compute';
import { ArenaStrip } from './ArenaFeedback';
import { MoneyFlies, useCountUp } from './Juice';
import { LabStats } from './LabStats';
import { dcCostPerDay } from '../sim/datacenters';
import { END_DAY, formatDateShort } from '../sim/time';

/** С 1 октября 2024 года рядом с датой идёт отсчёт до конца партии. */
const FINAL_DAYS = 92;
import type { GameState, Speed } from '../sim/types';
import { fmtDays, fmtMoney } from './format';
import { subsOpen } from '../sim/market';
import { IconAlert, IconArrowUpDown, IconBank, IconCalendar, IconFast, IconFaster, IconLogo, IconPause, IconPlay } from './icons';
import { EXPENSE_KINDS, EXPENSE_LABELS, INCOME_KINDS, INCOME_LABELS } from './labels';
import { store, useSpeed } from './store';
import { isCoarsePointer } from './viewport';

const SPEEDS: { speed: Speed; title: string; Icon: () => ReactElement }[] = [
  { speed: 0, title: 'Пауза (пробел)', Icon: () => <IconPause /> },
  { speed: 1, title: 'Скорость ×1', Icon: () => <IconPlay /> },
  { speed: 2, title: 'Скорость ×2', Icon: () => <IconFast /> },
  { speed: 4, title: 'Скорость ×4', Icon: () => <IconFaster /> },
];

/** Изменение денег в месяц: итог прошлого месяца без инвесторов, а в первый месяц - текущие расходы. */
function monthlyRate(s: GameState): number {
  const h = s.finance.history.at(-1);
  if (h) {
    const inc = h.income.api + h.income.subs + h.income.contracts;
    const exp = EXPENSE_KINDS.reduce((sum, k) => (k === 'capex' ? sum : sum + (h.expense[k] ?? 0)), 0); // разовые вложения не в счёт
    return inc - exp;
  }
  return -(rentPerDay(s) + overheadPerDay(s) + dcCostPerDay(s)) * 30;
}

function MoneyPopup({ s }: { s: GameState }) {
  const m = s.finance.month;
  // Строки «Подписки» до их открытия нет: будущее не показываем.
  const kinds = INCOME_KINDS.filter((k) => k !== 'subs' || subsOpen(s.day) || m.income.subs > 0);
  return (
    <div className="money-pop" role="tooltip">
      <div className="r" style={{ color: '#f2f2f2' }}>
        <span>С начала месяца</span>
        <span />
      </div>
      {kinds.map((k) => (
        <div className="r" key={k} style={m.income[k] > 0 ? { color: 'var(--good-on-dark)' } : undefined}>
          <span>{INCOME_LABELS[k]}:</span>
          <span className="v">{fmtMoney(m.income[k])}</span>
        </div>
      ))}
      {EXPENSE_KINDS.filter((k) => k !== 'capex').map((k) => (
        <div className="r" key={k} style={m.expense[k] > 0 ? { color: 'var(--bad-on-dark)' } : undefined}>
          <span>{EXPENSE_LABELS[k]}:</span>
          <span className="v">{m.expense[k] > 0 ? '−' : ''}{fmtMoney(m.expense[k])}</span>
        </div>
      ))}
      {m.expense.capex > 0 && (
        <div className="r" style={{ color: '#f2f2f2' }} title="Стройка дата-центров и покупка карт. В изменение за месяц не входит">
          <span>Разовые вложения:</span>
          <span className="v">{fmtMoney(m.expense.capex)}</span>
        </div>
      )}
    </div>
  );
}

export function TopBar({ s, phone, sheetOpen, onToggleSheet }: { s: GameState; phone: boolean; sheetOpen: boolean; onToggleSheet: () => void }) {
  const speed = useSpeed();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false); // касание: сводку денег держим открытой до следующего нажатия мимо

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName;
      if (e.code !== 'Space' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      // Пробел на кнопке или ссылке нажимает её, а не ставит паузу.
      if (target?.closest('button, a[href], [role="button"], [role="menuitem"]')) return;
      if (target?.closest('[aria-modal="true"]')) return;
      e.preventDefault();
      store.togglePause();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!pinned) return;
    const off = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.tb-money')) setPinned(false);
    };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [pinned]);

  const rate = monthlyRate(s);
  const cashShown = useCountUp(s.cash);
  const locked = !!s.outcome || pendingChoice(s) !== null;
  const negative = s.finance.negativeDays > 0;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="tb-logo" aria-hidden="true">
          <IconLogo size={18} />
        </span>
        <b>{s.labName}</b>
        {s.founderName && <span className="tb-founder">{s.founderName}</span>}
        {store.autosaveError && (
          <span className="tb-bad" title={store.autosaveError} style={{ display: 'flex' }}>
            <IconAlert />
          </span>
        )}
      </div>
      <div className="topbar-center">
        <div
          className="tb-item tb-money"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={() => isCoarsePointer() && setPinned((v) => !v)}
          style={{ cursor: 'default' }}
        >
          <IconBank />
          <span className={s.cash < 0 ? 'tb-bad' : undefined}>{fmtMoney(cashShown)}</span>
          <MoneyFlies />
          {(hover || pinned) && <MoneyPopup s={s} />}
        </div>
        <i className="tb-sep" aria-hidden="true" />
        <div className="tb-item tb-rate" title="Доходы (API, подписки, контракты) минус текущие расходы за прошлый месяц. Вложения инвесторов и разовые вложения (дата-центры, карты) не входят">
          <IconArrowUpDown />
          <span className={rate >= 0 ? 'tb-good' : 'tb-bad'}>
            {rate >= 0 ? '' : '−'}
            {fmtMoney(Math.abs(rate))}/мес.
          </span>
        </div>
        <i className="tb-sep" aria-hidden="true" />
        <div className="tb-item tb-date">
          <IconCalendar />
          <span>{formatDateShort(s.day)}</span>
          {!s.outcome && END_DAY - s.day <= FINAL_DAYS && (
            <span className={`tb-final${END_DAY - s.day <= 30 ? ' hot' : ''}`} title="31.12.2024 партия заканчивается: побеждает первая модель на «Арене» среди моделей в продаже">
              <span className="tb-final-k">До финала </span>
              {fmtDays(Math.max(0, END_DAY - s.day))}
            </span>
          )}
        </div>
        <div className="speed" role="group" aria-label="Скорость">
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
      {phone && (
        <button
          className={`tb-side${sheetOpen ? ' on' : ''}`}
          onClick={onToggleSheet}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? 'Скрыть сводку' : 'Показать сводку'}
        >
          Сводка
        </button>
      )}
      <div className="topbar-right">
        <LabStats s={s} />
        <ArenaStrip s={s} />
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
