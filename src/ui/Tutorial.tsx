// Окно «Обучение» внизу справа и подсветка цели текущего шага.
// Панель всегда поверх: пока открыт диалог с затемнением, она показывается копией над ним на том же месте.
// Выполненный шаг на секунду показывает «Готово» со звуком, затем появляется следующий.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { GameState, Speed } from '../sim/types';
import { IconCheck } from './icons';
import { playSound } from './sound';
import { store } from './store';
import { contractPowerEnough, ORDER_STEP_TITLE, stepTargets, stepText as textOf, TUTORIAL, tutorialPower } from './tutorialSteps';
import type { WindowId } from './windows';

/** Сколько показывать «Готово» перед следующим шагом. */
const DONE_MS = 1200;

function setStep(s: GameState, step: number): void {
  s.tutorial.step = Math.max(0, Math.min(TUTORIAL.length - 1, step));
}

function finish(s: GameState): void {
  s.tutorial.active = false;
}

/** Открыт диалог с затемнением (подтверждение, письмо с выбором, газета, карточка выпуска). */
function useOverlayOpen(enabled: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setOn(false);
      return;
    }
    const check = () => setOn(!!document.querySelector('.modal-backdrop'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [enabled]);
  return on;
}

export function TutorialPanel({ s, open, speed, docked = true }: { s: GameState; open: ReadonlySet<WindowId>; speed: Speed; docked?: boolean }) {
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

  // Условие шага выполнено: «Готово» со звуком, через секунду - следующий шаг.
  const [doneIndex, setDoneIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!doneNow || doneIndex === index) return;
    setDoneIndex(index);
    setCollapsed(false);
    playSound('goal');
  }, [doneNow, index, doneIndex]);
  useEffect(() => {
    if (doneIndex === null || doneIndex !== index) return;
    const t = window.setTimeout(() => {
      // Служебный шаг, не действие игрока: плашка «Пауза: …» от того же события (модель готова) остаётся.
      if (index >= TUTORIAL.length - 1) store.note(finish);
      else store.note(setStep, index + 1);
    }, DONE_MS);
    return () => window.clearTimeout(t);
  }, [doneIndex, index]);
  const showDone = doneIndex === index;

  // С шага «Первый заказ» мощность под заявку и контракт выделяет сама игра (tutorialPower): двигать доли новичку не нужно
  // (плейтест 19.10 - шаг «Мощность для контракта» никто не мог пройти). Раз в игровой день, пока доли не хватает.
  const orderStep = TUTORIAL.findIndex((t) => t.title === ORDER_STEP_TITLE);
  const autoPower = active && index >= orderStep && !contractPowerEnough(s);
  useEffect(() => {
    if (!autoPower) return;
    store.note(tutorialPower);
  }, [autoPower, s.day]);

  // Подсветка первой найденной цели. Цель может появиться без перерисовки игры (диалог внутри окна),
  // поэтому поиск повторяется по таймеру.
  useEffect(() => {
    // Пока шаг показывает «Готово», ничего не подсвечиваем: цели шага уже считаются по новому состоянию и прыгали.
    if (!active || !docked || showDone) return;
    let el: Element | null = null;
    const update = () => {
      if (document.hidden) return; // вкладка скрыта: искать цель незачем
      let next: Element | null = null;
      for (const t of stepTargets(step, latest.current)) {
        // Цель в окне, закрытом другим окном (или скрытом), не видна: берём следующую - обычно кнопку раздела.
        const found = document.querySelector(`[data-tutorial="${t}"]`);
        if (found && found.getClientRects().length > 0 && !found.closest('.fs-off')) {
          next = found;
          break;
        }
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
  }, [active, step, docked, showDone]);

  // Поверх затемнения: копия панели в body на месте закреплённой (основная панель внутри игры, которую диалог закрывает).
  const overlay = useOverlayOpen(active && docked);
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!overlay || !ref.current) {
      setRect(null);
      return;
    }
    setRect(ref.current.getBoundingClientRect());
  }, [overlay, collapsed, index, showDone]);
  // Диалог при открытой подсказке встаёт левее неё (tpc.css body.tutor-overlay), а не под неё.
  useEffect(() => {
    document.body.classList.toggle('tutor-overlay', !!rect);
    return () => document.body.classList.remove('tutor-overlay');
  }, [rect]);

  if (!active) return null;
  const last = index === TUTORIAL.length - 1;
  const stepLabel = `Шаг ${index + 1} из ${TUTORIAL.length}`;
  const body = (
    <>
      <div className="titlebar">
        <span className="t">{collapsed ? `Обучение игре: ${stepLabel.toLowerCase()}` : 'Обучение игре'}</span>
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
          {showDone ? (
            <div className="body tutor-done" role="status">
              <div className="step">{stepLabel}</div>
              <h3>
                <span className="tutor-check" aria-hidden="true">
                  <IconCheck size={14} />
                </span>
                Готово: {step.title.toLowerCase()}
              </h3>
              <p>{last ? 'Обучение пройдено.' : `Дальше: ${TUTORIAL[index + 1].title.toLowerCase()}.`}</p>
            </div>
          ) : (
            <div className="body tutor-step" key={index}>
              <div className="step">{stepLabel}</div>
              <h3>{step.title}</h3>
              <p>{textOf(step, s)}</p>
            </div>
          )}
          <div className="foot">
            {/* Короткая подпись: в узкой панели три кнопки помещаются в одну строку, панель не меняет высоту. */}
            {last ? (
              <span className="skip" aria-hidden="true" />
            ) : (
              <button className="btn small skip" title="Пропустить обучение игре" onClick={() => store.note(finish)}>
                Пропустить
              </button>
            )}
            {canBack && !showDone && (
              <button className="btn small" onClick={() => store.note(setStep, index - 1)}>
                Назад
              </button>
            )}
            {!step.done && (
              <button className="btn small primary" onClick={() => store.note(last ? finish : (st: GameState) => setStep(st, index + 1))}>
                {last ? 'Завершить' : 'Далее'}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );

  const cls = `tutor${collapsed ? ' collapsed' : ''}`;
  const floatStyle: CSSProperties | undefined = rect ? { left: rect.left, top: rect.top, width: rect.width } : undefined;
  return (
    <>
      <div ref={ref} className={cls} role="dialog" aria-label="Обучение игре" style={rect ? { visibility: 'hidden' } : undefined}>
        {body}
      </div>
      {rect &&
        createPortal(
          <div className={`${cls} tutor-float`} role="dialog" aria-label="Обучение игре" style={floatStyle}>
            {body}
          </div>,
          document.body,
        )}
    </>
  );
}
