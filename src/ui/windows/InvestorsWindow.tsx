// Окно «Инвесторы» (FR-10): оценка компании, её разбор, доля основателя и раунды инвестиций.

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { MANIA, REV_MULT, ROUND_COOLDOWN_DAYS, ROUND_FRACTIONS, VALUATION_FLOOR } from '../../sim/constants';
import { canRaise, valuation } from '../../sim/investors';
import type { Valuation } from '../../sim/investors';
import { byYear, formatDateShort, lerpByDate, yearOf } from '../../sim/time';
import type { GameState } from '../../sim/types';
import { Dialog, ErrorText } from '../components/common';
import { fmtMoney, fmtMult, fmtNum, fmtShare } from '../format';
import { actions, store } from '../store';
import './InvestorsWindow.css';

function safeValuation(s: GameState): Valuation | null {
  try {
    return valuation(s);
  } catch {
    return null;
  }
}

/** Причина недоступности раунда в виде «Следующий раунд через N дн.» или null. */
function cooldownText(s: GameState, blocked: string | null): string | null {
  if (blocked === null) return null;
  if (s.lastRoundDay === null) return blocked;
  const left = s.lastRoundDay + ROUND_COOLDOWN_DAYS - s.day;
  return left > 0 ? `Следующий раунд через ${fmtNum(left)} дн.` : blocked;
}

// ---------- Разбор оценки ----------

function Row(props: { label: string; calc?: ReactNode; value: ReactNode; kind?: 'sub' | 'total'; title?: string }) {
  return (
    <div className={`inv-bd-row${props.kind ? ` ${props.kind}` : ''}`} title={props.title}>
      <span className="lab">{props.label}</span>
      <span className="calc">{props.calc}</span>
      <span className="val">{props.value}</span>
    </div>
  );
}

function Breakdown({ s, v }: { s: GameState; v: Valuation }) {
  const revMult = byYear(REV_MULT, yearOf(s.day));
  const mania = lerpByDate(MANIA, s.day, true);
  const sum = v.revenuePart + v.techPart;

  return (
    <div className="inv-bd">
      <Row
        label="Годовая выручка × множитель года"
        calc={`${fmtMoney(v.annualRevenue)} × ${fmtMult(revMult)}`}
        value={fmtMoney(v.revenuePart)}
        title="Выручка за последние 90 дней в пересчёте на год"
      />
      <Row
        label="Место на «Арене» × «ИИ-лихорадка» года"
        calc={v.bestRank === null ? 'Нет моделей на рынке' : `${v.bestRank}-е место: ×${fmtMult(v.rankFactor)} от ${fmtMoney(mania)}`}
        value={fmtMoney(v.techPart)}
        title="Учитывается лучшая модель, которая продаётся по API"
      />
      <Row
        kind="sub"
        label="База оценки"
        calc={sum < VALUATION_FLOOR ? `Применён минимум ${fmtMoney(VALUATION_FLOOR)}` : `Минимум ${fmtMoney(VALUATION_FLOOR)}`}
        value={fmtMoney(Math.max(VALUATION_FLOOR, sum))}
      />
      <Row
        label="Шумиха"
        calc={`Уровень ${fmtNum(s.hype.player)} из 100`}
        value={`×${fmtMult(v.hypeMult)}`}
        title="Множитель оценки: чем выше шумиха, тем выше оценка"
      />
      <Row
        label="Репутация"
        calc={`Уровень ${fmtNum(s.reputation)} из 100`}
        value={`×${fmtMult(v.repMult)}`}
        title="Множитель оценки: чем выше репутация, тем выше оценка"
      />
      <Row kind="total" label="Итого" value={fmtMoney(v.total)} />
    </div>
  );
}

// ---------- Раунды ----------

/** Кольцо с долей компании, которая уходит инвесторам. */
function ShareRing({ fraction }: { fraction: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg width="38" height="38" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--line)" strokeWidth="5" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="5"
        strokeDasharray={`${c * fraction} ${c}`}
        transform="rotate(-90 18 18)"
      />
    </svg>
  );
}

function RoundCard(props: { fraction: number; v: Valuation | null; share: number; blocked: string | null; onSell: () => void }) {
  const { fraction, v, share, blocked } = props;
  const money = v ? v.total * fraction : null;
  const why = blocked ?? (v ? null : 'Оценка недоступна');
  return (
    <div className="inv-round">
      <div className="inv-round-head">
        <ShareRing fraction={fraction} />
        <span className="inv-round-pct">{fmtShare(fraction, 0)}</span>
      </div>
      <div className="kv">
        <span>Сумма</span>
        <span className="good">{money === null ? '—' : `+${fmtMoney(money)}`}</span>
        <span>Доля после</span>
        <span>{fmtShare(share * (1 - fraction))}</span>
      </div>
      <button
        className="btn primary wide"
        disabled={why !== null}
        title={why ?? `Продать ${fmtShare(fraction, 0)} компании за ${fmtMoney(money ?? 0)}`}
        onClick={props.onSell}
      >
        Продать долю
      </button>
    </div>
  );
}

function SellDialog(props: { fraction: number; v: Valuation; share: number; onClose: () => void }) {
  const { fraction, v, share } = props;
  const [err, setErr] = useState<string | null>(null);

  function confirm() {
    const r = store.dispatch(actions.raiseRound, fraction);
    if (r.ok) props.onClose();
    else setErr(r.error);
  }

  return createPortal(
    <Dialog
      title="Продажа доли"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={confirm}>
            Продать долю
          </button>
        </>
      }
    >
      <div className="kv inv-confirm">
        <span>Продаётся</span>
        <span>{fmtShare(fraction, 0)}</span>
        <span>Сумма</span>
        <span className="good">+{fmtMoney(v.total * fraction)}</span>
        <span>Доля сейчас</span>
        <span>{fmtShare(share)}</span>
        <span>Доля после</span>
        <span>{fmtShare(share * (1 - fraction))}</span>
        <span>Следующий раунд</span>
        <span>через {ROUND_COOLDOWN_DAYS} дн.</span>
      </div>
      <ErrorText error={err} />
    </Dialog>,
    document.body,
  );
}

// ---------- Окно ----------

export default function InvestorsWindow({ s }: WindowProps) {
  const v = safeValuation(s);
  const blocked = canRaise(s);
  const reason = cooldownText(s, blocked);
  const [selling, setSelling] = useState<number | null>(null);

  const ownPct = Math.max(0, Math.min(100, s.founderShare * 100));

  return (
    <div className="inv">
      <div className="inv-top">
        <div className="label">Оценка компании</div>
        <div className="inv-value num">{v ? fmtMoney(v.total) : '—'}</div>
        <div className="inv-share">
          Ваша доля: <b className="num">{fmtShare(s.founderShare)}</b>
          {v && (
            <>
              {' '}
              (≈ <b className="num">{fmtMoney(v.total * s.founderShare)}</b>)
            </>
          )}
        </div>
        <div className="inv-bar" title="Синим показана доля основателя">
          <div style={{ width: `${ownPct}%` }} />
        </div>
        <div className="inv-bar-cap">Продано инвесторам: {fmtShare(1 - s.founderShare)}</div>
      </div>

      <div className="inv-body">
        <section className="inv-section">
          <div className="inv-head">
            <div className="section-title">Раунд инвестиций</div>
            {reason ? (
              <span className="small warn">{reason}</span>
            ) : (
              s.lastRoundDay !== null && <span className="small muted">Последний раунд: {formatDateShort(s.lastRoundDay)}</span>
            )}
          </div>
          <div className="inv-rounds">
            {ROUND_FRACTIONS.map((f) => (
              <RoundCard key={f} fraction={f} v={v} share={s.founderShare} blocked={reason} onSell={() => setSelling(f)} />
            ))}
          </div>
        </section>

        <section className="inv-section">
          <div className="section-title">Из чего складывается оценка</div>
          {v ? <Breakdown s={s} v={v} /> : <div className="muted">Оценка недоступна.</div>}
        </section>
      </div>

      {selling !== null && v && <SellDialog fraction={selling} v={v} share={s.founderShare} onClose={() => setSelling(null)} />}
    </div>
  );
}
