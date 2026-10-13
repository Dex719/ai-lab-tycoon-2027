// Цели года в боковой панели: три строки с прогрессом и наградой.

import { goalProgress, rewardText } from '../sim/goals';
import type { GameState } from '../sim/types';
import type { WindowAlias, WindowId } from './windows';
import './goals.css';

export function GoalsPanel({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const y = s.yearly;
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
          return (
            <div key={g.id} className={`goal-row${isDone ? ' done' : ''}`} onClick={() => open(p.def.id.startsWith('tech-') ? 'research' : 'analytics')}>
              <div className="gt">{p.def.title(y.year)}</div>
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
