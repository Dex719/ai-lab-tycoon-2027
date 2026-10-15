// Цели года и короткие задачи в боковой панели. Строка цели: название и награда, прогресс, полоска;
// выполненная - галочкой. Ниже - действующие бонусы наград (скидки на время) и короткие задачи.

import { useEffect, useRef, useState } from 'react';
import { STYLE_NAMES } from '../data/goals';
import { activeBonuses, capitalize, untilText } from '../data/questKit';
import { goalPenaltyText, goalProgress, goalRewardShort, goalRewardText } from '../sim/goals';
import type { GameState } from '../sim/types';
import { IconCheck } from './icons';
import { TasksPanel } from './TasksPanel';
import type { WindowAlias, WindowId } from './windows';
import './goals.css';

/** Какое окно открывает строка цели. */
function opensFor(id: string): WindowId | WindowAlias {
  if (id.startsWith('r-') || id.startsWith('tech-')) return 'research';
  if (id === 'k-tenders') return 'contracts';
  if (id.startsWith('g-') || id === 'x-first' || id.startsWith('rank-')) return 'ratings';
  return 'analytics';
}

export function GoalsPanel({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const y = s.yearly;
  const justDone = useJustDone(s);
  const bonuses = activeBonuses(s);
  const hasGoals = !!y && y.goals.length > 0;
  const done = hasGoals ? y.goals.filter((g) => g.done).length : 0;
  return (
    <div className="quests-zone">
      {hasGoals && (
        <>
          <div className="goal-head">
            <span>Цели {y.year} года</span>
            <span className="n">
              {done} из {y.goals.length}
            </span>
          </div>
          <div className="goal-list">
            {y.goals.map((g) => {
              const v = goalProgress(s, g);
              if (!v) return null;
              const isDone = g.done;
              const reward = goalRewardText(g, y.year);
              const penalty = isDone ? '' : goalPenaltyText(g);
              const style = v.def.style ? STYLE_NAMES[v.def.style] : '';
              return (
                <div
                  key={g.id}
                  className={`goal-row${isDone ? ' done' : ''}${justDone.has(`${y.year}:${g.id}`) ? ' just-done' : ''}`}
                  onClick={() => open(opensFor(g.id))}
                  title={style ? `${style}. Награда: ${reward}` : `Награда: ${reward}`}
                >
                  <div className="gt">
                    {isDone && <IconCheck size={14} className="gt-ok" />}
                    <span className="gt-name">{v.title}</span>
                    <span className={`gt-reward${isDone ? ' ok' : ''}`}>{capitalize(goalRewardShort(g, y.year))}</span>
                  </div>
                  <div className="gp">
                    {justDone.has(`${y.year}:${g.id}`) ? (
                      <span className="gp-flash">Цель выполнена</span>
                    ) : (
                      <>
                        {isDone ? 'Выполнено' : v.progress.text}
                        {v.progress.almost && <span className="gp-almost"> - почти</span>}
                      </>
                    )}
                  </div>
                  {penalty && <div className="gp-risk">Если не выйдет к 31 декабря: {penalty}</div>}
                  <div className="goal-bar">
                    <div style={{ width: `${Math.round(v.progress.fraction * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {bonuses.length > 0 && (
        <div className="goal-bonuses">
          {bonuses.map((b) => (
            <div key={b.id} className="goal-bonus">
              {b.text} {untilText(b.untilDay)}
            </div>
          ))}
        </div>
      )}
      <TasksPanel s={s} open={open} />
    </div>
  );
}

const FLASH_MS = 2600;

/** Цели, выполненные только что (в этой сессии): строка вспыхивает на 2,6 с. Ключ - «год:цель»: у целей разных лет id совпадают. */
function useJustDone(s: GameState): Set<string> {
  const seen = useRef<{ state: GameState; year: number; done: Set<string> } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const doneKey = s.yearly.goals
    .filter((g) => g.done)
    .map((g) => g.id)
    .join(',');
  useEffect(() => {
    const now = new Set(s.yearly.goals.filter((g) => g.done).map((g) => g.id));
    const p = seen.current;
    seen.current = { state: s, year: s.yearly.year, done: now };
    if (!p || p.state !== s || p.year !== s.yearly.year) return;
    const fresh = [...now].filter((id) => !p.done.has(id)).map((id) => `${s.yearly.year}:${id}`);
    if (fresh.length === 0) return;
    setFlash((f) => new Set([...f, ...fresh]));
    const id = window.setTimeout(() => setFlash((f) => new Set([...f].filter((x) => !fresh.includes(x)))), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [s, doneKey]);
  return flash;
}
