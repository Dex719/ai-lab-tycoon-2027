// Выбор целей года: пять строк разного стиля, отмечены три. Список стоит в «Итогах года» (второй шаг) и в окне
// «Цели {год} года» в начале партии. Светлое окно, строки как в бланке: флажок, стиль, цель, награда.

import { useCallback, useState } from 'react';
import { findGoal, STYLE_NAMES } from '../data/goals';
import { capitalize } from '../data/questKit';
import { chooseGoals, goalOfferOpen, goalPenaltyText, goalRewardText, goalTitle, GOALS_PER_YEAR, unseenReview } from '../sim/goals';
import type { GameState } from '../sim/types';
import { DenyNote, GuardButton, useFlash, useModalFocus } from './components/common';
import { Term } from './components/Term';
import { IconClose } from './icons';
import { store } from './store';
import './goals.css';

/** «три цели», «две цели». */
const GOALS_WORD: Record<number, string> = { 1: 'одна цель', 2: 'две цели', 3: 'три цели' };
const GOALS_ACC: Record<number, string> = { 1: 'одну цель', 2: 'две цели', 3: 'три цели' };
const OF_WORD: Record<number, string> = { 2: 'двух', 3: 'трёх', 4: 'четырёх', 5: 'пяти' };

/** Отмеченные цели: сначала ни одной, игрок выбирает сам; крестик принимает цели по умолчанию. */
export function useGoalPick(s: GameState): {
  picked: string[];
  toggle: (id: string) => void;
  note: string | null;
} {
  const offer = s.quests.offer;
  const [picked, setPicked] = useState<string[]>(() => []);
  const [note, flash] = useFlash();
  const need = Math.min(GOALS_PER_YEAR, offer?.goals.length ?? 0);
  const toggle = useCallback(
    (id: string) => {
      if (picked.includes(id)) setPicked(picked.filter((x) => x !== id));
      else if (picked.length >= need) flash(`Уже отмечены ${GOALS_WORD[need] ?? need}: снимите отметку с одной`);
      else setPicked([...picked, id]);
    },
    [picked, need, flash],
  );
  return { picked, toggle, note };
}

/** Причина, по которой выбор ещё нельзя принять, или null. */
export function pickReason(s: GameState, picked: string[]): string | null {
  const need = Math.min(GOALS_PER_YEAR, s.quests.offer?.goals.length ?? 0);
  const left = need - picked.length;
  if (left <= 0) return null;
  return `Отметьте ещё ${left} ${left === 1 ? 'цель' : 'цели'}`;
}

/** Принять отмеченные цели; если отмечено не три (окно закрыли крестиком) - цели по умолчанию. */
export function acceptGoals(s: GameState, picked: string[]): void {
  if (!goalOfferOpen(s)) return;
  const ids = pickReason(s, picked) === null ? picked : s.yearly.goals.map((g) => g.id);
  store.dispatch(chooseGoals, ids);
}

/** Список пяти целей с флажками. */
export function GoalPicker({ s, picked, toggle, note }: { s: GameState; picked: string[]; toggle: (id: string) => void; note: string | null }) {
  const offer = s.quests.offer;
  if (!offer) return null;
  const year = offer.year;
  const need = Math.min(GOALS_PER_YEAR, offer.goals.length);
  return (
    <div className="gc">
      <div className="gc-top">
        <span className="gc-ask">
          Выберите {GOALS_ACC[need] ?? need} из {OF_WORD[offer.goals.length] ?? offer.goals.length}
        </span>
        <span className={`gc-count${picked.length === need ? ' full' : ''}`}>
          Отмечено: {picked.length} из {need}
          <DenyNote text={note} />
        </span>
      </div>
      <div className="gc-list" role="group" aria-label={`Цели ${year} года`}>
        {offer.goals.map((g) => {
          const def = findGoal(g.id);
          if (!def) return null;
          const on = picked.includes(g.id);
          const style = def.style ?? 'money';
          const hint = def.hint?.(s, g) ?? '';
          const penalty = goalPenaltyText(g);
          return (
            <label key={g.id} className={`gc-row${on ? ' on' : ''}${style === 'risk' ? ' risk' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(g.id)} />
              <span className="gc-style">{STYLE_NAMES[style]}</span>
              <span className="gc-main">
                <span className="gc-title">
                  <Term text={goalTitle(g, year)}>{goalTitle(g, year)}</Term>
                </span>
                {hint && <span className="gc-hint">{hint}</span>}
              </span>
              <span className="gc-prize">
                <span className="gc-reward">{capitalize(goalRewardText(g, year))}</span>
                {penalty && <span className="gc-penalty">Если не выйдет: {penalty}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Окно выбора целей без итогов года: в начале партии (цели 2017 года) и в сохранении, где выбор остался открытым.
 * Крестик принимает отмеченные цели (или цели по умолчанию): время без целей не идёт.
 */
export function GoalChoiceModal({ s }: { s: GameState }) {
  const offer = s.quests.offer;
  const show = goalOfferOpen(s) && !unseenReview(s);
  if (!show || !offer) return null;
  return <GoalChoiceDialog key={offer.year} s={s} />;
}

function GoalChoiceDialog({ s }: { s: GameState }) {
  const year = s.quests.offer!.year;
  const title = `Цели ${year} года`;
  const pick = useGoalPick(s);
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(title);
  const reason = pickReason(s, pick.picked);
  return (
    <div className="modal-backdrop">
      <div ref={ref} tabIndex={-1} className="dialog wide yr-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">{title}</span>
          <button className="wbtn close" onClick={() => acceptGoals(s, pick.picked)} aria-label="Закрыть" title="Закрыть">
            <IconClose size={14} />
          </button>
        </div>
        <div className="body white">
          <GoalPicker s={s} {...pick} />
        </div>
        <div className="foot">
          <GuardButton className="btn primary" data-tutorial="goals-accept" reason={reason} onClick={() => acceptGoals(s, pick.picked)}>
            Принять цели
          </GuardButton>
        </div>
      </div>
    </div>
  );
}
