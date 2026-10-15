// Окно «Итоги года» как страница годового отчёта: звёзды за цели, таблица «этот год - прошлый - изменение»,
// место в гонке и цели следующего года. Показывается один раз.

import { useEffect } from 'react';
import { goalProgress, rewardText, unseenReview } from '../sim/goals';
import type { GameState } from '../sim/types';
import { raceName, standingOf } from './ArenaFeedback';
import { useModalFocus } from './components/common';
import { fmtMoney, fmtShare } from './format';
import { IconClose } from './icons';
import { playSound } from './sound';
import { actions, store } from './store';
import './goals.css';

/** Звезда за цель: плоская, золотая - выполнена, серая - нет. */
function Star({ on, i }: { on: boolean; i: number }) {
  return (
    <svg className={`yr-star${on ? ' on' : ''}`} style={{ animationDelay: `${0.15 + i * 0.15}s` }} viewBox="0 0 24 24" width={30} height={30} aria-hidden="true">
      <path d="M12 2.2 L14.9 8.6 L21.8 9.3 L16.6 14 L18.1 20.9 L12 17.3 L5.9 20.9 L7.4 14 L2.2 9.3 L9.1 8.6 Z" />
    </svg>
  );
}

/** Изменение к прошлому году: «+24 %», зелёным или красным; invert - рост плохо (расходы). */
function Change({ v, unit, invert = false }: { v: number | null; unit: string; invert?: boolean }) {
  if (v === null || !Number.isFinite(v) || Math.abs(v) < 0.05) return <td className="num yr-ch">-</td>;
  const good = invert ? v < 0 : v > 0;
  // Целые (смена места) - без дробной части: «+1», а не «+1,0».
  const a = Math.abs(v);
  const n = a >= 10 || Number.isInteger(a) ? Math.round(a) : a.toFixed(1).replace('.', ',');
  return (
    <td className={`num yr-ch ${good ? 'good' : 'bad'}`}>
      {v > 0 ? '+' : '−'}
      {n}
      {unit}
    </td>
  );
}

function pct(cur: number, prev: number | undefined): number | null {
  return prev !== undefined && prev > 0 ? (cur / prev - 1) * 100 : null;
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
  const ob = s.market.labShares.openbrain ?? 0;
  const st = standingOf(s);
  const stars = Array.from({ length: Math.max(3, r.goalsTotal) }, (_, i) => i < r.goalsDone);
  const ack = () => store.dispatch(actions.ackYearReview);
  const rank = (v: number | null) => (v !== null ? `${v}-е` : '-');
  const rankChange = prev && prev.bestRank !== null && r.bestRank !== null ? r.bestRank - prev.bestRank : null;

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && ack()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`dialog yr${allDone ? ' all' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <div className="titlebar">
          <span className="t">{title}</span>
          <button className="wbtn close" onClick={ack} aria-label="Закрыть" title="Закрыть">
            <IconClose size={14} />
          </button>
        </div>
        <div className="body yr-body">
          <div className="yr-score">
            <div className="yr-stars" aria-label={`Выполнено целей: ${r.goalsDone} из ${r.goalsTotal}`}>
              {stars.map((on, i) => (
                <Star key={i} on={on} i={i} />
              ))}
            </div>
            <div className="yr-score-t">
              <b>
                Цели года: {r.goalsDone} из {r.goalsTotal}
              </b>
              <span className="yr-comment">{r.comment}</span>
            </div>
          </div>

          <table className="grid yr-table">
            <thead>
              <tr>
                <th />
                <th className="num">{r.year}</th>
                {prev && <th className="num">{prev.year}</th>}
                {prev && <th className="num">Изменение</th>}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Выручка</td>
                <td className="num yr-cur">{fmtMoney(r.revenue)}</td>
                {prev && <td className="num">{fmtMoney(prev.revenue)}</td>}
                {prev && <Change v={pct(r.revenue, prev.revenue)} unit=" %" />}
              </tr>
              <tr>
                <td>Расходы</td>
                <td className="num yr-cur">{fmtMoney(r.expense)}</td>
                {prev && <td className="num">{fmtMoney(prev.expense)}</td>}
                {prev && <Change v={pct(r.expense, prev.expense)} unit=" %" invert />}
              </tr>
              <tr>
                <td>Доля рынка</td>
                <td className="num yr-cur">{fmtShare(r.share, 1)}</td>
                {prev && <td className="num">{fmtShare(prev.share, 1)}</td>}
                {prev && <td className="num yr-ch" />}
              </tr>
              <tr>
                <td>Лучшее место в продаже</td>
                <td className={`num yr-cur${r.bestRank === 1 ? ' gold' : ''}`}>{rank(r.bestRank)}</td>
                {prev && <td className="num">{rank(prev.bestRank)}</td>}
                {prev && <Change v={rankChange === null ? null : -rankChange} unit="" />}
              </tr>
              <tr>
                <td>Деньги на счёте</td>
                <td className={`num yr-cur${r.cash < 0 ? ' bad' : ''}`}>{fmtMoney(r.cash)}</td>
                {prev && <td className="num">{fmtMoney(prev.cash)}</td>}
                {prev && <td className="num yr-ch" />}
              </tr>
              <tr>
                <td>Моделей выпущено</td>
                <td className="num yr-cur">{r.models}</td>
                {prev && <td className="num">{prev.models}</td>}
                {prev && <td className="num yr-ch" />}
              </tr>
            </tbody>
          </table>
          <div className="yr-note">
            {st ? `Сейчас: ${raceName(st.metric)}, ${st.rank}-е место${st.above ? `, впереди ${st.above.name}` : ''}` : 'Соперников в гонке пока нет'}
            {` · доля OpenBrain ${fmtShare(ob, 1)}`}
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
        </div>
        <div className="foot">
          <button className="btn primary" onClick={ack} autoFocus>
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
