// Окно «Итоги года»: цифры года, одна строка вывода и цели следующего года. Показывается один раз.

import { goalProgress, rewardText, unseenReview } from '../sim/goals';
import type { GameState } from '../sim/types';
import { useModalFocus } from './components/common';
import { fmtMoney, fmtShare } from './format';
import { fmtRank } from './labels';
import { actions, store } from './store';
import './goals.css';

export function YearReviewModal({ s }: { s: GameState }) {
  const r = unseenReview(s);
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(r ? String(r.year) : '');
  if (!r) return null;
  const next = s.yearly.goals;
  const allDone = r.goalsTotal > 0 && r.goalsDone === r.goalsTotal;
  const title = `Итоги ${r.year} года`;
  return (
    <div className="modal-backdrop">
      <div ref={ref} tabIndex={-1} className="dialog year-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">{title}</span>
        </div>
        <div className="body">
          <p className="year-comment">{r.comment}</p>
          <div className="kv year-kv">
            <span>Выручка за год</span>
            <span className={r.revenue > 0 ? 'good' : undefined}>{fmtMoney(r.revenue)}</span>
            <span>Расходы за год</span>
            <span>{fmtMoney(r.expense)}</span>
            <span>Деньги на счёте</span>
            <span className={r.cash < 0 ? 'bad' : undefined}>{fmtMoney(r.cash)}</span>
            <span>Выпущено моделей</span>
            <span>{r.models}</span>
            <span>Лучшее место среди моделей в продаже</span>
            <span>{r.bestRank !== null ? fmtRank(r.bestRank) : 'нет моделей'}</span>
            <span>Доля рынка</span>
            <span>{fmtShare(r.share)}</span>
            <span>Выполнено целей</span>
            <span className={allDone ? 'good' : undefined}>
              {r.goalsDone} из {r.goalsTotal}
            </span>
          </div>
          {next.length > 0 && (
            <>
              <div className="year-next">Цели на {s.yearly.year} год</div>
              {next.map((g) => {
                const p = goalProgress(s, g);
                return p ? (
                  <div className="year-goal" key={g.id}>
                    <span>{p.def.title(s.yearly.year)}</span>
                    <span className="rw">{rewardText(p.def.reward, s.yearly.year)}</span>
                  </div>
                ) : null;
              })}
            </>
          )}
        </div>
        <div className="foot">
          <button className="btn primary" onClick={() => store.dispatch(actions.ackYearReview)}>
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
