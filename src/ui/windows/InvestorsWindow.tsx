// Окно «Инвесторы» (FR-10): оценка компании, её разбор, доля основателя и раунды инвестиций.

import { useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import {
  FOUNDER_BOARD_SHARE,
  FOUNDER_WARN_SHARE,
  MANIA,
  REV_MULT,
  ROUND_COOLDOWN_DAYS,
  ROUND_FRACTIONS,
  VALUATION_FLOOR,
} from '../../sim/constants';
import { canRaise, valuation } from '../../sim/investors';
import type { Valuation } from '../../sim/investors';
import { byYear, formatDateShort, lerpByDate, yearOf } from '../../sim/time';
import type { GameState } from '../../sim/types';
import { Alert, ConfirmDialog, ErrorText, GuardButton } from '../components/common';
import { fmtMoney, fmtMult, fmtNum, fmtShare } from '../format';
import { fmtRank } from '../labels';
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

// ---------- Доля основателя ----------

/** Состояние доли: ok - контроль у основателя; warn - ниже порога совета директоров; bad - ниже порога потери контроля. */
export type ShareTone = 'ok' | 'warn' | 'bad';

export function shareTone(share: number): ShareTone {
  if (share < FOUNDER_WARN_SHARE) return 'bad';
  if (share < FOUNDER_BOARD_SHARE) return 'warn';
  return 'ok';
}

/** Класс цвета для числа доли (ниже порогов - жёлтый или красный). */
function toneClass(share: number): string | undefined {
  const t = shareTone(share);
  return t === 'ok' ? undefined : t;
}

/** Предупреждение о доле под долей основателя; при доле не ниже порога - ничего. */
function ShareAlert({ share }: { share: number }) {
  const t = shareTone(share);
  if (t === 'ok') return null;
  if (t === 'bad') {
    return (
      <Alert tone="bad">
        Доля ниже {fmtShare(FOUNDER_WARN_SHARE, 0)}: контроль над компанией у совета директоров
      </Alert>
    );
  }
  return (
    <Alert tone="warn">
      Доля ниже {fmtShare(FOUNDER_BOARD_SHARE, 0)}: совет директоров влияет на решения
    </Alert>
  );
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
        calc={v.bestRank === null ? 'Нет моделей на рынке' : `${fmtRank(v.bestRank)}: ×${fmtMult(v.rankFactor)} от ${fmtMoney(mania)}`}
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
  const after = share * (1 - fraction);
  const why = blocked ?? (v ? null : 'Оценка недоступна');
  return (
    <div className="inv-round">
      <div className="inv-round-head">
        <ShareRing fraction={fraction} />
        <span className="inv-round-pct">{fmtShare(fraction, 0)}</span>
      </div>
      <div className="kv">
        <span>Сумма</span>
        <span className="good">{money === null ? '-' : `+${fmtMoney(money)}`}</span>
        <span>Доля после</span>
        <span className={toneClass(after)}>{fmtShare(after)}</span>
      </div>
      <GuardButton
        className="btn primary wide"
        reason={why}
        title={why === null ? `Продать ${fmtShare(fraction, 0)} компании за ${fmtMoney(money ?? 0)}` : undefined}
        onClick={props.onSell}
      >
        Продать долю
      </GuardButton>
    </div>
  );
}

/** Подтверждение продажи доли: сводка последствий, кнопка «Продать долю». */
function SellConfirm(props: { fraction: number; v: Valuation; share: number; onClose: () => void }) {
  const { fraction, v, share } = props;
  const [err, setErr] = useState<string | null>(null);
  const money = v.total * fraction;
  const after = share * (1 - fraction);
  // Продажа опускает долю ниже порога: совет директоров получает влияние (50 %) или контроль (25 %).
  const crossesBoard = share >= FOUNDER_BOARD_SHARE && after < FOUNDER_BOARD_SHARE;
  const crossesControl = share >= FOUNDER_WARN_SHARE && after < FOUNDER_WARN_SHARE;

  function confirm() {
    const r = store.dispatch(actions.raiseRound, fraction);
    if (r.ok) props.onClose();
    else setErr(r.error);
  }

  return (
    <ConfirmDialog
      title="Продажа доли"
      confirmLabel="Продать долю"
      danger={crossesBoard || crossesControl}
      onConfirm={confirm}
      onClose={props.onClose}
    >
      <div className="kv inv-confirm">
        <span>Оценка компании</span>
        <span>{fmtMoney(v.total)}</span>
        <span>Продаётся</span>
        <span>{fmtShare(fraction, 0)}</span>
        <span>Сумма</span>
        <span className="good">+{fmtMoney(money)}</span>
        <span>Доля до</span>
        <span>{fmtShare(share)}</span>
        <span>Доля после</span>
        <span className={toneClass(after)}>{fmtShare(after)}</span>
        <span>Следующий раунд</span>
        <span>через {ROUND_COOLDOWN_DAYS} дн.</span>
      </div>
      {crossesControl ? (
        <Alert tone="bad">
          После продажи доля ниже {fmtShare(FOUNDER_WARN_SHARE, 0)}: контроль над компанией перейдёт к совету директоров
        </Alert>
      ) : crossesBoard ? (
        <Alert tone="warn">
          После продажи доля ниже {fmtShare(FOUNDER_BOARD_SHARE, 0)}: совет директоров будет влиять на решения
        </Alert>
      ) : null}
      <ErrorText error={err} />
    </ConfirmDialog>
  );
}

// ---------- Окно ----------

export default function InvestorsWindow({ s }: WindowProps) {
  const v = safeValuation(s);
  const blocked = canRaise(s);
  const reason = cooldownText(s, blocked);
  const [selling, setSelling] = useState<number | null>(null);

  const share = s.founderShare;
  const tone = shareTone(share);
  const ownPct = Math.max(0, Math.min(100, share * 100));

  return (
    <div className="inv">
      <div className="inv-top">
        <div className="inv-top-grid">
          <div className="inv-stat">
            <div className="label">Оценка компании</div>
            <div className="inv-value num">{v ? fmtMoney(v.total) : '-'}</div>
            <div className="inv-sub" title="Оценка компании × доля основателя">
              Ваша часть: {v ? fmtMoney(v.total * share) : '-'}
            </div>
          </div>
          <div className={`inv-stat inv-own${tone === 'ok' ? '' : ` ${tone}`}`}>
            <div className="label">Доля основателя</div>
            <div className="inv-value num">{fmtShare(share)}</div>
            <div className="inv-sub">Продано инвесторам: {fmtShare(1 - share)}</div>
          </div>
        </div>
        <div className={`inv-bar${tone === 'ok' ? '' : ` ${tone}`}`} title="Цветом показана доля основателя">
          <div style={{ width: `${ownPct}%` }} />
          <span
            className="inv-bar-mark"
            style={{ left: `${FOUNDER_BOARD_SHARE * 100}%` }}
            title={`${fmtShare(FOUNDER_BOARD_SHARE, 0)}: ниже совет директоров влияет на решения`}
          />
          <span
            className="inv-bar-mark"
            style={{ left: `${FOUNDER_WARN_SHARE * 100}%` }}
            title={`${fmtShare(FOUNDER_WARN_SHARE, 0)}: ниже контроль у совета директоров`}
          />
        </div>
        <ShareAlert share={share} />
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
              <RoundCard key={f} fraction={f} v={v} share={share} blocked={reason} onSell={() => setSelling(f)} />
            ))}
          </div>
        </section>

        <section className="inv-section">
          <div className="section-title">Из чего складывается оценка</div>
          {v ? <Breakdown s={s} v={v} /> : <div className="muted">Оценка недоступна.</div>}
        </section>
      </div>

      {selling !== null && v && <SellConfirm fraction={selling} v={v} share={share} onClose={() => setSelling(null)} />}
    </div>
  );
}
