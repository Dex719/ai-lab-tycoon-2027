// Окно «Итоги года»: звёзды за цели, главные числа отсчётом со сравнением с прошлым годом и с OpenBrain,
// цели следующего года. Показывается один раз.

import { useEffect, useState } from 'react';
import { goalProgress, rewardText, unseenReview } from '../sim/goals';
import type { GameState } from '../sim/types';
import { raceName, standingOf } from './ArenaFeedback';
import { useModalFocus } from './components/common';
import { fmtMoney, fmtShare } from './format';
import { useCountUp } from './Juice';
import { playSound } from './sound';
import { actions, store } from './store';
import './goals.css';

/** Число, которое растёт от 0 до value при открытии окна. */
function Rise({ value, fmt }: { value: number; fmt: (v: number) => string }) {
  const [target, setTarget] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setTarget(value), 200);
    return () => window.clearTimeout(id);
  }, [value]);
  return <>{fmt(useCountUp(target, 900))}</>;
}

/** «▲ +24 % к прошлому году». */
function Delta({ v }: { v: number | null }) {
  if (v === null || !Number.isFinite(v) || Math.abs(v) < 0.5) return <span className="yr-sub">Как в прошлом году</span>;
  return (
    <span className={`yr-delta ${v > 0 ? 'good' : 'bad'}`}>
      {v > 0 ? '▲ +' : '▼ −'}
      {Math.round(Math.abs(v))} % к прошлому году
    </span>
  );
}

export function YearReviewModal({ s }: { s: GameState }) {
  const r = unseenReview(s);
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(r ? String(r.year) : '');
  const allDone = !!r && r.goalsTotal > 0 && r.goalsDone === r.goalsTotal;

  useEffect(() => {
    if (r) playSound(allDone ? 'first' : 'goal');
  }, [r?.year]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!r) return null;
  const idx = s.yearly.reviews.indexOf(r);
  const prev = idx > 0 ? s.yearly.reviews[idx - 1] : null;
  const next = s.yearly.goals;
  const title = `Итоги ${r.year} года`;
  const revDelta = prev && prev.revenue > 0 ? (r.revenue / prev.revenue - 1) * 100 : null;
  const ob = s.market.labShares.openbrain ?? 0;
  const st = standingOf(s);
  const stars = Array.from({ length: Math.max(3, r.goalsTotal) }, (_, i) => i < r.goalsDone);

  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        tabIndex={-1}
        className={`yr${allDone ? ' all' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <div className="yr-head">
          <div className="yr-title">{title}</div>
          <div className="yr-stars" aria-label={`Выполнено целей: ${r.goalsDone} из ${r.goalsTotal}`}>
            {stars.map((on, i) => (
              <span key={i} className={on ? 'on' : undefined} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
                ★
              </span>
            ))}
          </div>
          <div className="yr-comment">{r.comment}</div>
        </div>

        <div className="yr-tiles">
          <div className="yr-tile">
            <span className="yr-l">Выручка за год</span>
            <span className="yr-big">
              <Rise value={r.revenue} fmt={fmtMoney} />
            </span>
            {prev ? <Delta v={revDelta} /> : <span className="yr-sub">Первый год</span>}
          </div>
          <div className="yr-tile">
            <span className="yr-l">Доля рынка</span>
            <span className="yr-big">
              <Rise value={r.share} fmt={(v) => fmtShare(v, 1)} />
            </span>
            <span className="yr-sub">
              {prev ? `В прошлом году ${fmtShare(prev.share, 1)} · ` : ''}OpenBrain {fmtShare(ob, 1)}
            </span>
          </div>
          <div className="yr-tile">
            <span className="yr-l">{st ? `Место: ${raceName(st.metric)}` : 'Место в гонке'}</span>
            <span className={`yr-big${st?.rank === 1 ? ' gold' : ''}`}>{st ? `${st.rank}-е` : '-'}</span>
            <span className="yr-sub">{st ? (st.above ? `Впереди ${st.above.name}` : 'Впереди никого') : 'Соперников пока нет'}</span>
          </div>
          <div className="yr-tile">
            <span className="yr-l">Деньги на счёте</span>
            <span className={`yr-big${r.cash < 0 ? ' bad' : ''}`}>
              <Rise value={r.cash} fmt={fmtMoney} />
            </span>
            <span className="yr-sub">
              Расходы {fmtMoney(r.expense)} · моделей {r.models}
            </span>
          </div>
        </div>

        {next.length > 0 && (
          <div className="yr-next">
            <div className="yr-next-h">Цели на {s.yearly.year} год</div>
            {next.map((g) => {
              const p = goalProgress(s, g);
              return p ? (
                <div className="yr-goal" key={g.id}>
                  <span>{p.def.title(s.yearly.year)}</span>
                  <span className="rw">{rewardText(p.def.reward, s.yearly.year)}</span>
                </div>
              ) : null;
            })}
          </div>
        )}

        <div className="yr-foot">
          <button className="btn primary" onClick={() => store.dispatch(actions.ackYearReview)}>
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
