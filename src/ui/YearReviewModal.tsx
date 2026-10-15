// Окно «Итоги года» - страница отчёта: сколько целей выполнено, цифры года списком, итог каждой цели
// (награда или сколько не хватило), затем второй шаг - выбор трёх целей на следующий год. Показывается один раз.

import { useEffect, useState } from 'react';
import { capitalize } from '../data/questKit';
import { ackYearReview, goalOfferOpen, unseenReview } from '../sim/goals';
import type { GameState, YearReview } from '../sim/types';
import { raceName, standingOf } from './ArenaFeedback';
import { fmtMoney, fmtShare } from './format';
import { acceptGoals, GoalPicker, pickReason, useGoalPick } from './GoalChoice';
import { GuardButton, useModalFocus } from './components/common';
import { IconCheck, IconClose } from './icons';
import { playSound } from './sound';
import { store } from './store';
import './goals.css';

export function YearReviewModal({ s }: { s: GameState }) {
  const r = unseenReview(s);
  if (!r) return null;
  return <ReviewDialog key={r.year} s={s} r={r} />;
}

/** «+24 % к 2018 году» зелёным или «-12 % к 2018 году» красным. */
function Delta({ now, prev, year }: { now: number; prev: YearReview | null; year: number }) {
  if (!prev || !(prev.revenue > 0)) return null;
  const v = (now / prev.revenue - 1) * 100;
  if (!Number.isFinite(v) || Math.abs(v) < 0.5) return <small className="yr-d">как в {year} году</small>;
  return (
    <small className={`yr-d ${v > 0 ? 'good' : 'bad'}`}>
      {v > 0 ? '+' : '-'}
      {Math.round(Math.abs(v))} % к {year} году
    </small>
  );
}

function ReviewDialog({ s, r }: { s: GameState; r: YearReview }) {
  const nextOffer = goalOfferOpen(s) && s.quests.offer?.year === r.year + 1 ? s.quests.offer : null;
  const [step, setStep] = useState<'review' | 'goals'>('review');
  const pick = useGoalPick(s);
  const title = step === 'goals' && nextOffer ? `Цели ${nextOffer.year} года` : `Итоги ${r.year} года`;
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(title);
  const allDone = r.goalsTotal > 0 && r.goalsDone === r.goalsTotal;

  useEffect(() => {
    playSound(allDone ? 'first' : 'goal');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    acceptGoals(s, pick.picked);
    store.dispatch(ackYearReview);
  };

  const idx = s.yearly.reviews.indexOf(r);
  const prev = idx > 0 ? s.yearly.reviews[idx - 1] : null;
  const ob = s.market.labShares.openbrain ?? 0;
  const st = standingOf(s);

  return (
    <div className="modal-backdrop">
      <div ref={ref} tabIndex={-1} className="dialog wide yr-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">{title}</span>
          <button className="wbtn close" onClick={finish} aria-label="Закрыть" title="Закрыть">
            <IconClose size={14} />
          </button>
        </div>

        {step === 'review' || !nextOffer ? (
          <div className="body white yr-page">
            <div className="yr-lead">
              <div className={`yr-score${allDone ? ' all' : ''}`}>
                Выполнено целей года: {r.goalsDone} из {r.goalsTotal}
              </div>
              <p className="yr-comment">{r.comment}</p>
            </div>
            <div className="yr-cols">
              <section>
                <h3 className="yr-h">Цифры года</h3>
                <div className="kv yr-kv">
                  <span>Выручка за год</span>
                  <span>
                    {fmtMoney(r.revenue)}
                    <Delta now={r.revenue} prev={prev} year={r.year - 1} />
                  </span>
                  <span>Расходы</span>
                  <span>{fmtMoney(r.expense)}</span>
                  <span>Деньги на счёте</span>
                  <span className={r.cash < 0 ? 'bad' : undefined}>{fmtMoney(r.cash)}</span>
                  <span>Доля рынка</span>
                  <span>
                    {fmtShare(r.share, 1)}
                    {prev && <small className="yr-d">в {r.year - 1} году {fmtShare(prev.share, 1)}</small>}
                  </span>
                  {ob > 0 && (
                    <>
                      <span>Доля OpenBrain</span>
                      <span>{fmtShare(ob, 1)}</span>
                    </>
                  )}
                  {st && (
                    <>
                      <span>Место: {raceName(st.metric)}</span>
                      <span>
                        {st.rank}-е
                        <small className="yr-d">{st.above ? `впереди ${st.above.name}` : 'впереди никого'}</small>
                      </span>
                    </>
                  )}
                  <span>Моделей выпущено</span>
                  <span>{r.models}</span>
                </div>
              </section>
              {r.results && r.results.length > 0 && (
                <section>
                  <h3 className="yr-h">Цели {r.year} года</h3>
                  <ul className="yr-results">
                    {r.results.map((x, i) => (
                      <li key={i} className={x.done ? 'ok' : 'miss'}>
                        <span className="yr-mark" aria-label={x.done ? 'Выполнено' : 'Не выполнено'}>
                          {x.done ? <IconCheck size={16} /> : <IconClose size={14} />}
                        </span>
                        <span className="yr-rt">
                          {x.title}
                          {/* У невыполненной цели недостача стоит справа: строка прогресса её только повторила бы. */}
                          {x.done ? <small className="gold">Награда: {x.prize}</small> : !x.miss && x.text && <small>{x.text}</small>}
                        </span>
                        {!x.done && (
                          <span className="yr-rv">
                            <span className="bad">{x.miss ? capitalize(x.miss) : 'Не выполнено'}</span>
                            {x.penalty && <small className="bad">Штраф: {x.penalty}</small>}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        ) : (
          <div className="body white">
            <GoalPicker s={s} {...pick} />
          </div>
        )}

        <div className="foot">
          {nextOffer && step === 'review' && (
            <button className="btn primary" onClick={() => setStep('goals')}>
              Выбрать цели на {nextOffer.year} год
            </button>
          )}
          {nextOffer && step === 'goals' && (
            <>
              <button className="btn" onClick={() => setStep('review')}>
                Вернуться к итогам
              </button>
              <GuardButton className="btn primary" reason={pickReason(s, pick.picked)} onClick={finish}>
                Принять цели
              </GuardButton>
            </>
          )}
          {!nextOffer && (
            <button className="btn primary" onClick={finish}>
              Продолжить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
