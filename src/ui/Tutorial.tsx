// Окно «Обучение» внизу справа и подсветка цели текущего шага.

import { useEffect, useRef, useState } from 'react';
import type { GameState, Speed } from '../sim/types';
import { store } from './store';
import { stepTargets, TUTORIAL } from './tutorialSteps';
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
  // «Назад» на выполненный шаг сразу вернул бы сюда же: кнопка нужна, только если прошлый шаг можно перечитать.
  const prevStep = index > 0 ? TUTORIAL[index - 1] : null;
  const canBack = !!prevStep && !prevStep.done?.(s, { open, speed });
  // Свёрнутая панель - одна строка; на новом шаге панель разворачивается сама, чтобы игрок увидел подсказку.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(false), [index]);
  // Цели шага могут зависеть от состояния партии: таймер подсветки читает свежее состояние.
  const latest = useRef(s);
  latest.current = s;

  // Условие шага выполнено - переходим к следующему.
  useEffect(() => {
    if (!doneNow) return;
    if (index >= TUTORIAL.length - 1) store.dispatch(finish);
    else store.dispatch(setStep, index + 1);
  }, [doneNow, index]);

  // Подсветка первой найденной цели. Цель может появиться без перерисовки игры (диалог внутри окна),
  // поэтому поиск повторяется по таймеру.
  useEffect(() => {
    if (!active) return;
    let el: Element | null = null;
    const update = () => {
      let next: Element | null = null;
      for (const t of stepTargets(step, latest.current)) {
        next = document.querySelector(`[data-tutorial="${t}"]`);
        if (next) break;
      }
      if (next === el) return;
      el?.classList.remove('tutor-target');
      next?.classList.add('tutor-target');
      el = next;
    };
    update();
    const timer = setInterval(update, 400);
    return () => {
      clearInterval(timer);
      el?.classList.remove('tutor-target');
    };
  }, [active, step]);

  if (!active) return null;
  const last = index === TUTORIAL.length - 1;
  const stepText = `Шаг ${index + 1} из ${TUTORIAL.length}`;
  return (
    <div className={`tutor${collapsed ? ' collapsed' : ''}`} role="dialog" aria-label="Обучение игре">
      <div className="titlebar">
        <span className="t">{collapsed ? `Обучение игре: ${stepText.toLowerCase()}` : 'Обучение игре'}</span>
        <button
          type="button"
          className="wbtn tutor-collapse"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Развернуть' : 'Свернуть'}
          title={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {collapsed ? (
              <path d="M2.5 7.5L6 4l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            ) : (
              <path d="M2 9h8" stroke="currentColor" strokeWidth="1.6" />
            )}
          </svg>
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="body">
            <div className="step">{stepText}</div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
          <div className="foot">
            {/* Короткая подпись: в узкой панели три кнопки помещаются в одну строку, панель не меняет высоту. */}
            {last ? (
              <span className="skip" aria-hidden="true" />
            ) : (
              <button className="skip" title="Пропустить обучение игре" onClick={() => store.dispatch(finish)}>
                Пропустить
              </button>
            )}
            {canBack && (
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
        </>
      )}
    </div>
  );
}
