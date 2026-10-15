// Цели года в боковой панели: три строки с прогрессом и наградой.

import { useEffect, useRef, useState } from 'react';
import { goalProgress, rewardText } from '../sim/goals';
import type { GameState } from '../sim/types';
import type { WindowAlias, WindowId } from './windows';
import './goals.css';

export function GoalsPanel({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const y = s.yearly;
  const justDone = useJustDone(s);
  if (!y || y.goals.length === 0) return null;
  const done = y.goals.filter((g) => g.done).length;
  return (
    <>
      <div className="goal-head">
        <span>Цели {y.year} года</span>
        <span className="n">
          {done} из {y.goals.length}
        </span>
      </div>
      <div className="goal-list">
        {y.goals.map((g) => {
          const p = goalProgress(s, g);
          if (!p) return null;
          const isDone = g.done;
          // Условие уже выполнено, награду выдаст ближайший ход: это не «почти».
          const almost = !isDone && !p.progress.done && p.progress.fraction >= ALMOST;
          return (
            <div
              key={g.id}
              className={`goal-row${isDone ? ' done' : ''}${justDone.has(g.id) ? ' just-done' : ''}${almost ? ' almost' : ''}`}
              onClick={() => open(p.def.id.startsWith('tech-') ? 'research' : 'analytics')}>
              <div className="gt">
                {p.def.title(y.year)}
                {almost && <span className="goal-almost">Почти!</span>}
              </div>
              <div className="gp">{isDone ? 'Выполнено' : p.progress.text}</div>
              <div className="goal-bar">
                <div style={{ width: `${Math.round(p.progress.fraction * 100)}%` }} />
              </div>
              <div className={`gr${isDone ? ' ok' : ''}`}>
                {isDone ? 'Награда получена: ' : 'Награда: '}
                {rewardText(p.def.reward, y.year)}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Цель с полоской от 80 % получает метку «Почти!». */
const ALMOST = 0.8;
const FLASH_MS = 2600;

/** Цели, выполненные только что (в этой сессии): строка вспыхивает на 2,6 с. */
function useJustDone(s: GameState): Set<string> {
  const seen = useRef<{ state: GameState; year: number; done: Set<string> } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const doneKey = s.yearly.goals.filter((g) => g.done).map((g) => g.id).join(',');
  useEffect(() => {
    const now = new Set(s.yearly.goals.filter((g) => g.done).map((g) => g.id));
    const p = seen.current;
    seen.current = { state: s, year: s.yearly.year, done: now };
    if (!p || p.state !== s || p.year !== s.yearly.year) return;
    const fresh = [...now].filter((id) => !p.done.has(id));
    if (fresh.length === 0) return;
    setFlash((f) => new Set([...f, ...fresh]));
    const id = window.setTimeout(() => setFlash((f) => new Set([...f].filter((x) => !fresh.includes(x)))), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [s, doneKey]);
  return flash;
}
