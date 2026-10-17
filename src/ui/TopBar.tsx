// Верхняя панель (как в Processor Tycoon): деньги, изменение за месяц, дата, скорость; справа доля рынка и место на «Арене».
import { StageMark } from './LabFloor';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { pendingChoice } from '../sim/events';
import { ArenaStrip } from './ArenaFeedback';
import { MoneyFlies, useCountUp } from './Juice';
import { FlashNum } from './FlashNum';
import { LabStats } from './LabStats';
import { dayToDate, END_DAY, formatDateShort } from '../sim/time';

/** С 1 октября 2024 года рядом с датой идёт отсчёт до конца партии. */
const FINAL_DAYS = 92;
const MONTH3 = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
import type { GameState, Speed } from '../sim/types';
import { fmtDays, fmtMoney } from './format';
import { subsOpen } from '../sim/market';
import { IconAlert, IconArrowUpDown, IconBank, IconCalendar, IconFast, IconFaster, IconLogo, IconPause, IconPlay } from './icons';
import { EXPENSE_KINDS, EXPENSE_LABELS, INCOME_KINDS, INCOME_LABELS } from './labels';
import { store, useSpeed } from './store';
import { monthlyRate } from './runway';
import { isCoarsePointer } from './viewport';

const SPEEDS: { speed: Speed; title: string; Icon: () => ReactElement }[] = [
  { speed: 0, title: 'Пауза (пробел)', Icon: () => <IconPause /> },
  { speed: 1, title: 'Скорость ×1', Icon: () => <IconPlay /> },
  { speed: 2, title: 'Скорость ×2', Icon: () => <IconFast /> },
  { speed: 4, title: 'Скорость ×4', Icon: () => <IconFaster /> },
];


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

const SPEED_KEYS: Record<string, Speed> = { Digit1: 1, Digit2: 2, Digit3: 4, Numpad1: 1, Numpad2: 2, Numpad3: 4 };

export function TopBar({ s, phone, sheetOpen, onToggleSheet }: { s: GameState; phone: boolean; sheetOpen: boolean; onToggleSheet: () => void }) {
  const speed = useSpeed();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false); // касание: сводку денег держим открытой до следующего нажатия мимо

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName;
      // Пробел - пауза; 1, 2, 3 - скорость ×1, ×2, ×4.
      const speedKey = SPEED_KEYS[e.code];
      if ((e.code !== 'Space' && speedKey === undefined) || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (speedKey !== undefined) {
        if (target?.closest('[aria-modal="true"]')) return;
        e.preventDefault();
        store.setSpeed(speedKey);
        return;
      }
      // Пробел на кнопке, выбранной с клавиатуры, нажимает её; после щелчка мышью фокус остаётся на кнопке,
      // и тогда пробел - всё равно пауза (плейтест 16.10: пробел нажимал значок «Контракты»).
      const control = target?.closest('button, a[href], [role="button"], [role="menuitem"]');
      if (control && control.matches(':focus-visible')) return;
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

  // Смена месяца и года на верхней панели - короткий «удар»: дата проявляется заново, на новый год заметнее.
  const ymd = dayToDate(s.day);
  const dateSeen = useRef<{ state: GameState; y: number; m: number } | null>(null);
  const [beat, setBeat] = useState<{ n: number; year: boolean }>({ n: 0, year: false });
  useEffect(() => {
    const p = dateSeen.current;
    dateSeen.current = { state: s, y: ymd.year, m: ymd.month };
    if (p && p.state === s && (p.y !== ymd.year || p.m !== ymd.month)) setBeat((b) => ({ n: b.n + 1, year: p.y !== ymd.year }));
  }, [s, ymd.year, ymd.month]);

  const rate = monthlyRate(s);
  const cashShown = useCountUp(s.cash);
  const locked = !!s.outcome || pendingChoice(s) !== null;
  const negative = s.finance.negativeDays > 0;
  // Пауза и ожидание ответа на письмо выглядят одинаково: игра стоит.
  const paused = (speed === 0 || locked) && !s.outcome;

  const speedButtons = (
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
  );
  const pauseNote = (store.pauseReason || negative) && speed === 0 && (
    <div className="pause-note">
      {store.pauseReason ? `Пауза: ${store.pauseReason}` : 'Деньги в минусе'}
      {negative && ` · до банкротства ${Math.max(0, 60 - s.finance.negativeDays)} дн.`}
    </div>
  );

  // Компьютер: лента лаборатории слева сверху, плашка денег, даты и скорости справа снизу (по образцу Two Point Campus).
  if (!phone)
    return (
      <header className={`topbar tpc${paused ? ' paused' : ''}`}>
        <div className="topbar-left">
          <span className="tb-logo" aria-hidden="true">
            <IconLogo size={18} />
          </span>
          <b>{s.labName}</b>
          {s.founderName && <span className="tb-founder">{s.founderName}</span>}
          <StageMark s={s} />
          {store.autosaveError && (
            <span className="tb-bad" title={store.autosaveError} style={{ display: 'flex' }}>
              <IconAlert />
            </span>
          )}
        </div>
        <div className="hud-stats">
          <LabStats s={s} />
          <ArenaStrip s={s} />
        </div>
        <div className="hud-br">
          <div className="hb-date" title={formatDateShort(s.day)}>
            <b>{ymd.year}</b>
            <span key={beat.n} className={beat.n > 0 ? `tb-date-v beat${beat.year ? ' year' : ''}` : 'tb-date-v'}>
              {MONTH3[ymd.month - 1]}
            </span>
            <small>{ymd.day}</small>
          </div>
          <div className="hb-main">
            <div
              className="tb-money hb-money"
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              onClick={() => isCoarsePointer() && setPinned((v) => !v)}
            >
              <span className="hb-coin" aria-hidden="true">
                $
              </span>
              <span className="hb-pill">
                <FlashNum value={s.cash}>
                  <span className={s.cash < 0 ? 'tb-bad' : undefined}>{fmtMoney(cashShown)}</span>
                </FlashNum>
              </span>
              <MoneyFlies />
              {(hover || pinned) && <MoneyPopup s={s} />}
            </div>
            <div className="hb-row">
              {speedButtons}
              <span
                className={`hb-rate ${rate >= 0 ? 'good' : 'bad'}`}
                title="Средний доход за 3 месяца (API, подписки, контракты) минус постоянные расходы: аренда, зарплаты, дата-центры. Инвесторы и разовые платежи не входят"
              >
                {rate >= 0 ? '+' : '−'}
                {fmtMoney(Math.abs(rate))}/мес.
              </span>
            </div>
            <div className="hb-row hb-sub">
              <Runway cash={s.cash} rate={rate} />
              {!s.outcome && END_DAY - s.day <= FINAL_DAYS && (
                <span className={`tb-final${END_DAY - s.day <= 30 ? ' hot' : ''}`} title="31.12.2024 партия заканчивается: побеждает первая модель на «Арене» среди моделей в продаже">
                  До финала {fmtDays(Math.max(0, END_DAY - s.day))}
                </span>
              )}
            </div>
          </div>
        </div>
        {pauseNote}
      </header>
    );

  return (
    <header className={`topbar${paused ? ' paused' : ''}`}>
      <div className="topbar-left">
        <span className="tb-logo" aria-hidden="true">
          <IconLogo size={18} />
        </span>
        <b>{s.labName}</b>
        {s.founderName && <span className="tb-founder">{s.founderName}</span>}
        {!phone && <StageMark s={s} />}
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
          <FlashNum value={s.cash}>
            <span className={s.cash < 0 ? 'tb-bad' : undefined}>{fmtMoney(cashShown)}</span>
          </FlashNum>
          <MoneyFlies />
          {(hover || pinned) && <MoneyPopup s={s} />}
        </div>
        <i className="tb-sep" aria-hidden="true" />
        <div className="tb-item tb-rate" title="Средний доход за 3 месяца (API, подписки, контракты) минус постоянные расходы: аренда, зарплаты, дата-центры. Инвесторы и разовые платежи (покупки, штрафы, разметчики) не входят">
          <IconArrowUpDown />
          <span className={rate >= 0 ? 'tb-good' : 'tb-bad'}>
            {rate >= 0 ? '' : '−'}
            {fmtMoney(Math.abs(rate))}/мес.
          </span>
          <Runway cash={s.cash} rate={rate} />
        </div>
        <i className="tb-sep" aria-hidden="true" />
        <div className="tb-item tb-date">
          <IconCalendar />
          <span key={beat.n} className={beat.n > 0 ? `tb-date-v beat${beat.year ? ' year' : ''}` : 'tb-date-v'}>
            {formatDateShort(s.day)}
          </span>
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

/** Запас денег при нынешнем расходе: «хватит на 4 мес.»; жёлтым меньше полугода, красным меньше трёх месяцев. */
function Runway({ cash, rate }: { cash: number; rate: number }) {
  if (rate >= 0 || cash <= 0) return null;
  const months = cash / -rate;
  if (months >= 12) return null; // запас на год и больше не тревожит и не занимает место на панели
  const n = Math.floor(months);
  const text = n < 1 ? 'хватит < 1 мес.' : `хватит на ${n} мес.`;
  const tone = months < 3 ? 'tb-bad' : months < 6 ? 'tb-warn' : 'tb-dim';
  return (
    <span className={`tb-runway ${tone}`} title="На сколько хватит денег на счёте при нынешнем темпе: средний доход за 3 месяца минус постоянные расходы">
      {text}
    </span>
  );
}
