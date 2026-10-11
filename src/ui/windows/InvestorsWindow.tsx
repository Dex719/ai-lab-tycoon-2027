// Окно «Инвесторы» (FR-10): оценка компании, её разложение, доля основателя и раунды инвестиций.

import { useState } from 'react';
import type { WindowProps } from '.';
import { MANIA, REV_MULT, ROUND_COOLDOWN_DAYS, ROUND_FRACTIONS, VALUATION_FLOOR } from '../../sim/constants';
import { canRaise, valuation } from '../../sim/investors';
import type { Valuation } from '../../sim/investors';
import { byYear, lerpByDate, yearOf } from '../../sim/time';
import { ErrorText } from '../components/common';
import { fmtMoney, fmtNum, fmtShare } from '../format';
import { actions, store } from '../store';

function safeValuation(s: WindowProps['s']): Valuation | null {
  try {
    return valuation(s);
  } catch {
    return null;
  }
}

function Breakdown({ s, v }: { s: WindowProps['s']; v: Valuation }) {
  const revMult = byYear(REV_MULT, yearOf(s.day));
  const mania = lerpByDate(MANIA, s.day, true);
  const sum = v.revenuePart + v.techPart;
  const base = Math.max(VALUATION_FLOOR, sum);
  const wrap = { whiteSpace: 'normal' } as const;

  const tech =
    v.bestRank === null
      ? 'нет моделей на рынке: выпустите модель и держите её в продаже по API'
      : `${v.bestRank}-е место на Арене: ×${fmtNum(v.rankFactor)} от «ИИ-лихорадки» года (${fmtMoney(mania)})`;

  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Что учитывается</th>
          <th>Как считается</th>
          <th className="num">Итог</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Выручка</td>
          <td style={wrap}>
            годовая выручка {fmtMoney(v.annualRevenue)} × множитель года ×{fmtNum(revMult)}
          </td>
          <td className="num">{fmtMoney(v.revenuePart)}</td>
        </tr>
        <tr>
          <td>Технологии</td>
          <td style={wrap}>{tech}</td>
          <td className="num">{fmtMoney(v.techPart)}</td>
        </tr>
        <tr>
          <td>База</td>
          <td className="muted" style={wrap}>
            {base > sum ? `выручка + технологии, но не меньше ${fmtMoney(VALUATION_FLOOR)}` : 'выручка + технологии'}
          </td>
          <td className="num">{fmtMoney(base)}</td>
        </tr>
        <tr>
          <td>Шумиха</td>
          <td className="muted" style={wrap}>
            шумиха {fmtNum(s.hype.player)} из 100
          </td>
          <td className="num">×{fmtNum(v.hypeMult)}</td>
        </tr>
        <tr>
          <td>Репутация</td>
          <td className="muted" style={wrap}>
            репутация {fmtNum(s.reputation)} из 100
          </td>
          <td className="num">×{fmtNum(v.repMult)}</td>
        </tr>
        <tr className="player">
          <td>Итого</td>
          <td />
          <td className="num">{fmtMoney(v.total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function RoundOption({ fraction, v, share, blocked }: { fraction: number; v: Valuation | null; share: number; blocked: string | null }) {
  const [err, setErr] = useState<string | null>(null);
  const money = v ? v.total * fraction : null;
  const left = share * (1 - fraction);
  const disabledWhy = blocked ?? (v ? null : 'Оценка пока недоступна');

  function sell() {
    if (money === null) return;
    const ok = window.confirm(
      `Продать ${fmtShare(fraction, 0)} компании инвесторам?\n` +
        `Вы получите ${fmtMoney(money)} сразу, а ваша доля уменьшится с ${fmtShare(share)} до ${fmtShare(left)}.\n` +
        `Следующий раунд будет возможен через ${ROUND_COOLDOWN_DAYS} дн.`,
    );
    if (!ok) return;
    const r = store.dispatch(actions.raiseRound, fraction);
    setErr(r.ok ? null : r.error);
  }

  return (
    <div className="card col grow" style={{ gap: 4, minWidth: 130 }}>
      <button className="btn primary" disabled={disabledWhy !== null} title={disabledWhy ?? undefined} onClick={sell}>
        Продать {fmtShare(fraction, 0)}
      </button>
      <div className="small num" style={{ textAlign: 'left' }}>
        {money !== null ? (
          <>
            <span className="good">+{fmtMoney(money)}</span>, останется {fmtShare(left)}
          </>
        ) : (
          '—'
        )}
      </div>
      <ErrorText error={err} />
    </div>
  );
}

export default function InvestorsWindow({ s }: WindowProps) {
  const v = safeValuation(s);
  const blocked = canRaise(s);

  return (
    <div className="col">
      <div className="card">
        <div className="muted small">Оценка вашей лаборатории</div>
        <div className="num" style={{ fontSize: 28, fontWeight: 700, textAlign: 'left' }}>
          {v ? fmtMoney(v.total) : '—'}
        </div>
        <div className="small">
          <span className="muted">Ваша доля: </span>
          <b className="num">{fmtShare(s.founderShare)}</b>
          {v && (
            <>
              <span className="muted"> · стоит </span>
              <b className="num">{fmtMoney(v.total * s.founderShare)}</b>
            </>
          )}
        </div>
      </div>

      <div>
        <div className="section-title">Из чего сложилась оценка</div>
        {v ? <Breakdown s={s} v={v} /> : <div className="muted">Оценка пока недоступна.</div>}
      </div>

      <div>
        <div className="section-title">Привлечь деньги</div>
        <div className="row" style={{ alignItems: 'stretch' }}>
          {ROUND_FRACTIONS.map((f) => (
            <RoundOption key={f} fraction={f} v={v} share={s.founderShare} blocked={blocked} />
          ))}
        </div>
        {blocked && <div className="small warn" style={{ marginTop: 6 }}>{blocked}</div>}
      </div>

      <div className="muted small">
        Инвесторы платят за выручку, место вашей лучшей модели на Арене и шумиху. Шумиху дают места в таблицах бенчмарков:
        подгонка под тесты повышает оценку, пока её не раскрыли. Деньги приходят сразу, но доля уменьшается навсегда.
        Раунд можно проводить раз в {ROUND_COOLDOWN_DAYS} дней.
      </div>
    </div>
  );
}
