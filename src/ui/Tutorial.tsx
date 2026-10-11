// Окно «Обучение» внизу справа и подсветка цели текущего шага.

import { useEffect } from 'react';
import type { GameState, Speed } from '../sim/types';
import { store } from './store';
import { TUTORIAL } from './tutorialSteps';
import type { WindowId } from './windows';

function setStep(s: GameState, step: number): void {
  s.tutorial.step = Math.max(0, Math.min(TUTORIAL.length - 1, step));
}

function finish(s: GameState): void {
  s.tutorial.active = false;
}

export function TutorialPanel({ s, open, speed }: { s: GameState; open: ReadonlySet<WindowId>; speed: Speed }) {
  const active = s.tutorial.active && !s.outcome;
  const index = Math.min(s.tutorial.step, TUTORIAL.length - 1);
  const step = TUTORIAL[index];
  const doneNow = active && !!step.done?.(s, { open, speed });

  // Условие шага выполнено — переходим к следующему.
  useEffect(() => {
    if (!doneNow) return;
    if (index >= TUTORIAL.length - 1) store.dispatch(finish);
    else store.dispatch(setStep, index + 1);
  }, [doneNow, index]);

  // Подсветка первой найденной цели.
  useEffect(() => {
    if (!active) return;
    let el: Element | null = null;
    for (const t of step.targets) {
      el = document.querySelector(`[data-tutorial="${t}"]`);
      if (el) break;
    }
    el?.classList.add('tutor-target');
    return () => el?.classList.remove('tutor-target');
  });

  if (!active) return null;
  const last = index === TUTORIAL.length - 1;
  return (
    <div className="tutor" role="dialog" aria-label="Обучение">
      <div className="titlebar">
        <span className="t">Обучение</span>
      </div>
      <div className="body">
        <div className="step">
          Шаг {index + 1} из {TUTORIAL.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
      </div>
      <div className="foot">
        <button className="skip" onClick={() => store.dispatch(finish)}>
          Пропустить обучение
        </button>
        {index > 0 && (
          <button className="btn small" onClick={() => store.dispatch(setStep, index - 1)}>
            Назад
          </button>
        )}
        {!step.done && (
          <button className="btn small primary" onClick={() => store.dispatch(last ? finish : (st: GameState) => setStep(st, index + 1))}>
            {last ? 'Завершить' : 'Далее'}
          </button>
        )}
      </div>
    </div>
  );
}
