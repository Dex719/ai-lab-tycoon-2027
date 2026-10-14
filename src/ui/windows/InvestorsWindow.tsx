// Окно «Инвесторы» (FR-10): тёмная полоса с оценкой и долей основателя, под ней шкала контроля с порогами;
// ниже слева столбик оценки из частей, справа раунды-сделки. Наведение на сделку показывает на шкале, какая часть уйдёт.

import { useState } from 'react';
import type { WindowProps } from '.';
import { FOUNDER_BOARD_SHARE, FOUNDER_WARN_SHARE, MANIA, ROUND_COOLDOWN_DAYS, ROUND_FRACTIONS, VALUATION_FLOOR } from '../../sim/constants';
import { canRaise, valuation } from '../../sim/investors';
import type { Valuation } from '../../sim/investors';
import { formatDateShort, lerpByDate } from '../../sim/time';
import type { GameState } from '../../sim/types';
import { Alert, ConfirmDialog, ErrorText, GuardButton } from '../components/common';
import { fmtDays, fmtMoney, fmtNum, fmtShare } from '../format';
import { IconLock } from '../icons';
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

/** Дней до следующего раунда (0 - можно сейчас). */
function cooldownLeft(s: GameState): number {
  if (s.lastRoundDay === null) return 0;
  return Math.max(0, s.lastRoundDay + ROUND_COOLDOWN_DAYS - s.day);
}

/** Причина недоступности раунда в виде «Следующий раунд через N дней» или null. */
function cooldownText(s: GameState, blocked: string | null): string | null {
  if (blocked === null) return null;
  const left = cooldownLeft(s);
  return left > 0 ? `Следующий раунд через ${fmtDays(left)}` : blocked;
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

/** Что означает доля: подпись зоны на шкале контроля. */
const ZONE_TEXT: Record<ShareTone, string> = {
  ok: 'Решения за вами',
  warn: 'Совет директоров влияет на решения',
  bad: 'Контроль у совета директоров',
};

/**
 * Шкала контроля: заливка - доля основателя, под ней три зоны (контроль у совета, совет влияет, решения за вами).
 * sell - доля компании, которую предлагают продать: эта часть заливки заштрихована.
 */
function ControlBar({ share, sell }: { share: number; sell: number | null }) {
  const tone = shareTone(share);
  const after = sell === null ? share : share * (1 - sell);
  const pct = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;
  const afterTone = shareTone(after);
  return (
    <div className="inv-ctl">
      <div className={`inv-ctl-bar ${tone}`}>
        <div className="inv-ctl-fill" style={{ width: pct(after) }} />
        {sell !== null && <div className="inv-ctl-sold" style={{ left: pct(after), width: pct(share - after) }} />}
        <i className="inv-ctl-mark" style={{ left: pct(FOUNDER_WARN_SHARE) }} />
        <i className="inv-ctl-mark" style={{ left: pct(FOUNDER_BOARD_SHARE) }} />
        <span className="inv-ctl-inv" style={{ left: pct(share) }}>
          {share >= 0.97 ? '' : share > 0.7 ? fmtShare(1 - share, 0) : `инвесторы ${fmtShare(1 - share, 0)}`}
        </span>
      </div>
      <div className="inv-zones">
        <span className={`z bad${(sell === null ? tone : afterTone) === 'bad' ? ' on' : ''}`} style={{ width: pct(FOUNDER_WARN_SHARE) }}>
          Контроль у совета
        </span>
        <span className={`z warn${(sell === null ? tone : afterTone) === 'warn' ? ' on' : ''}`} style={{ width: pct(FOUNDER_BOARD_SHARE - FOUNDER_WARN_SHARE) }}>
          Совет влияет
        </span>
        <span className={`z ok${(sell === null ? tone : afterTone) === 'ok' ? ' on' : ''}`} style={{ width: pct(1 - FOUNDER_BOARD_SHARE) }}>
          Решения за вами
        </span>
      </div>
    </div>
  );
}

// ---------- Оценка из частей ----------

interface Part {
  key: string;
  label: string;
  sub: string;
  value: number;
}

/** Части оценки в деньгах: база (продажи, модель, добавка до минимума) и поправки за шумиху, репутацию и план совета. */
export function valuationParts(s: GameState, v: Valuation): Part[] {
  const mania = lerpByDate(MANIA, s.day, true);
  const floorFill = Math.max(0, VALUATION_FLOOR - v.revenuePart - v.techPart);
  const base = v.revenuePart + v.techPart + floorFill;
  const hype = base * (v.hypeMult - 1);
  const rep = base * v.hypeMult * (v.repMult - 1);
  const board = base * v.hypeMult * v.repMult * (v.boardMult - 1);
  const rank =
    v.bestRank === null
      ? 'нет моделей в продаже'
      : `${fmtRank(v.bestRank)} среди моделей в продаже${v.bestRank > 1 ? ` · на 1-м: ${fmtMoney(mania)}` : ''}`;
  const parts: Part[] = [
    { key: 'rev', label: 'Продажи', sub: v.annualRevenue > 0 ? `выручка ${fmtMoney(v.annualRevenue)} в год` : 'продаж пока нет', value: v.revenuePart },
    { key: 'tech', label: 'Лучшая модель', sub: rank, value: v.techPart },
    { key: 'floor', label: 'Минимальная оценка', sub: `оценка не ниже ${fmtMoney(VALUATION_FLOOR)}`, value: floorFill },
    { key: 'hype', label: 'Шумиха', sub: `уровень ${fmtNum(s.hype.player)} из 100`, value: hype },
    { key: 'rep', label: 'Репутация', sub: `уровень ${fmtNum(s.reputation)} из 100`, value: rep },
    { key: 'board', label: 'План совета директоров', sub: 'скидка до следующего раунда', value: board },
  ];
  return parts.filter((p) => Math.abs(p.value) >= 1);
}

function signed(x: number): string {
  return x < 0 ? fmtMoney(x) : `+${fmtMoney(x)}`;
}

/** Столбик оценки: снизу вверх части оценки; минусы - красная штриховка сверху, черта - итог. */
function ValueTower({ s, v }: { s: GameState; v: Valuation }) {
  const parts = valuationParts(s, v);
  const plus = parts.filter((p) => p.value > 0);
  const gross = plus.reduce((a, p) => a + p.value, 0);
  const net = v.total;
  const H = 230;
  const k = gross > 0 ? H / gross : 0;
  let y = 0;
  const minus = Math.max(0, gross - net);
  // Подписи - сверху вниз, как части лежат в столбике; минусы - над итогом.
  const legend = [...plus].reverse().concat(parts.filter((p) => p.value < 0));
  return (
    <div className="inv-vt">
      <div className="inv-tower" style={{ height: H }} aria-hidden="true">
        {plus.map((p) => {
          const h = Math.max(2, p.value * k);
          const seg = <div key={p.key} className={`inv-seg ${p.key}`} style={{ bottom: y, height: h }} />;
          y += p.value * k;
          return seg;
        })}
        {minus > 0 && <div className="inv-seg minus" style={{ bottom: net * k, height: minus * k }} />}
        <div className="inv-total-line" style={{ bottom: net * k }} />
      </div>
      <div className="inv-legend">
        {legend.map((p) => (
          <div key={p.key} className={`inv-lg${p.value < 0 ? ' neg' : ''}`}>
            <i className={`inv-sw ${p.value < 0 ? 'minus' : p.key}`} />
            <span className="inv-lg-t">
              <span className="inv-lg-l">{p.label}</span>
              <span className="inv-lg-s">{p.sub}</span>
            </span>
            <b className="inv-lg-v num">{p.value < 0 || p.key === 'hype' || p.key === 'rep' || p.key === 'board' ? signed(p.value) : fmtMoney(p.value)}</b>
          </div>
        ))}
        <div className="inv-lg total">
          <i className="inv-sw line" />
          <span className="inv-lg-t">
            <span className="inv-lg-l">Оценка компании</span>
          </span>
          <b className="inv-lg-v num">{fmtMoney(v.total)}</b>
        </div>
      </div>
    </div>
  );
}

// ---------- Раунды ----------

function Deal(props: {
  fraction: number;
  v: Valuation | null;
  share: number;
  blocked: string | null;
  onSell: () => void;
  onHover: (f: number | null) => void;
}) {
  const { fraction, v, share, blocked, onHover } = props;
  const money = v ? v.total * fraction : null;
  const after = share * (1 - fraction);
  const why = blocked ?? (v ? null : 'Оценка недоступна');
  const crossControl = share >= FOUNDER_WARN_SHARE && after < FOUNDER_WARN_SHARE;
  const crossBoard = share >= FOUNDER_BOARD_SHARE && after < FOUNDER_BOARD_SHARE;
  return (
    <div
      className={`inv-deal${why ? ' locked' : ''}`}
      onMouseEnter={() => onHover(fraction)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(fraction)}
      onBlur={() => onHover(null)}
    >
      <span className="inv-deal-pct">{fmtShare(fraction, 0)}</span>
      <span className="inv-deal-t">
        <b className="inv-deal-money">{money === null ? '-' : `+${fmtMoney(money)}`}</b>
        <span className="inv-deal-share">
          ваша доля {fmtShare(share)} → <b className={toneClass(after)}>{fmtShare(after)}</b>
        </span>
        <span className={`inv-deal-warn ${crossControl ? 'bad' : crossBoard ? 'warn' : ''}`}>
          {crossControl ? 'Контроль перейдёт к совету директоров' : crossBoard ? 'Совет директоров получит влияние' : ' '}
        </span>
      </span>
      <GuardButton
        className="btn primary inv-sell"
        reason={why}
        title={why === null ? `Продать ${fmtShare(fraction, 0)} компании за ${fmtMoney(money ?? 0)}` : undefined}
        onClick={props.onSell}
      >
        Продать {fmtShare(fraction, 0)}
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
    <ConfirmDialog title="Продажа доли" confirmLabel="Продать долю" danger={crossesBoard || crossesControl} onConfirm={confirm} onClose={props.onClose}>
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
        <span>через {fmtDays(ROUND_COOLDOWN_DAYS)}</span>
      </div>
      {crossesControl ? (
        <Alert tone="bad">После продажи доля ниже {fmtShare(FOUNDER_WARN_SHARE, 0)}: контроль над компанией перейдёт к совету директоров</Alert>
      ) : crossesBoard ? (
        <Alert tone="warn">После продажи доля ниже {fmtShare(FOUNDER_BOARD_SHARE, 0)}: совет директоров будет влиять на решения</Alert>
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
  const [hover, setHover] = useState<number | null>(null);

  const share = s.founderShare;
  const tone = shareTone(share);
  const left = cooldownLeft(s);
  const waited = left > 0 ? 1 - left / ROUND_COOLDOWN_DAYS : 1;

  return (
    <div className="inv">
      <div className="inv-hero">
        <div className="inv-kpis">
          <div className="inv-kpi">
            <div className="inv-kpi-l">Оценка компании</div>
            <div className="inv-kpi-v gold">{v ? fmtMoney(v.total) : '-'}</div>
            <div className="inv-kpi-s">Ваша часть: {v ? fmtMoney(v.total * share) : '-'}</div>
          </div>
          <div className={`inv-kpi inv-own ${tone}`}>
            <div className="inv-kpi-l">Доля основателя</div>
            <div className="inv-kpi-v">{fmtShare(share)}</div>
            <div className="inv-kpi-s">{ZONE_TEXT[tone]}</div>
          </div>
        </div>
        <ControlBar share={share} sell={hover} />
      </div>

      <div className="inv-body">
        <section className="inv-col inv-val">
          <h3 className="inv-h">Из чего складывается оценка</h3>
          {v ? <ValueTower s={s} v={v} /> : <div className="muted">Оценка недоступна.</div>}
        </section>

        <section className="inv-col inv-rounds">
          <h3 className="inv-h">Раунд инвестиций</h3>
          <div className={`inv-cd${reason ? ' wait' : ' ready'}`}>
            {reason ? <IconLock size={14} /> : <i className="inv-cd-dot" />}
            <span className="inv-cd-t">
              {reason ?? 'Раунд можно провести сейчас'}
              {left > 0 && <small> · {formatDateShort(s.day + left)}</small>}
              {!reason && s.lastRoundDay !== null && <small> · прошлый {formatDateShort(s.lastRoundDay)}</small>}
            </span>
            {left > 0 && (
              <span className="inv-cd-bar" aria-hidden="true">
                <i style={{ width: `${waited * 100}%` }} />
              </span>
            )}
          </div>
          <div className="inv-deals">
            {ROUND_FRACTIONS.map((f) => (
              <Deal key={f} fraction={f} v={v} share={share} blocked={reason} onSell={() => setSelling(f)} onHover={setHover} />
            ))}
          </div>
        </section>
      </div>

      {selling !== null && v && <SellConfirm fraction={selling} v={v} share={share} onClose={() => setSelling(null)} />}
    </div>
  );
}
