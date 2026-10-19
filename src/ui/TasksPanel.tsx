// Короткие задачи в боковой панели: одна-две строки - задача и награда, прогресс и срок, полоска.
// Выполненная задача на несколько секунд остаётся строкой «Задача выполнена» с наградой, проваленная - «Не успели»
// с тем, сколько не хватило; потом строка уходит.

import { useEffect, useRef, useState } from 'react';
import { capitalize } from '../data/questKit';
import { activeTasks, taskDaysLeft, taskProgress, taskRewardShort, taskRewardText, taskTitle } from '../sim/tasks';
import { yearOf } from '../sim/time';
import type { GameState, TaskState } from '../sim/types';
import { fmtDays } from './format';
import type { WindowAlias, WindowId } from './windows';
import './goals.css';

/** Сколько секунд закрытая задача видна в панели. */
const FLASH_MS = 3200;
/** Сколько строк итога закрытых задач видно сразу. */
const MAX_CLOSED_SHOWN = 2;
/** Срок от стольких дней и меньше - красным. */
const URGENT_DAYS = 10;

/** Какое окно открывает строка задачи. */
const OPENS: Record<string, WindowId | WindowAlias> = {
  tender: 'contracts',
  deliver: 'contracts',
  release: 'models',
  beat: 'ratings',
  earn: 'finance',
  research: 'research',
  share: 'market',
  subs: 'market',
};

/** Задачи, закрытые в этой сессии: их строка видна FLASH_MS, даже если игра ушла вперёд. */
function useClosedFlash(s: GameState): TaskState[] {
  const seen = useRef<{ state: GameState; active: Set<string> } | null>(null);
  const [shown, setShown] = useState<TaskState[]>([]);
  const activeKey = activeTasks(s)
    .map((t) => t.id)
    .join(',');
  useEffect(() => {
    const now = new Set(activeTasks(s).map((t) => t.id));
    const p = seen.current;
    seen.current = { state: s, active: now };
    if (!p || p.state !== s) {
      setShown([]);
      return;
    }
    const closed = s.quests.tasks.filter((t) => p.active.has(t.id) && t.status !== 'active');
    if (closed.length === 0) return;
    const copies = closed.map((t) => ({ ...t }));
    // Не больше двух строк итога сразу: на большой скорости задачи могут закрываться чаще, чем гаснут строки.
    setShown((cur) => [...cur.filter((x) => !copies.some((c) => c.id === x.id)), ...copies].slice(-MAX_CLOSED_SHOWN));
    const ids = copies.map((c) => c.id);
    window.setTimeout(() => setShown((cur) => cur.filter((x) => !ids.includes(x.id))), FLASH_MS);
  }, [s, activeKey]);
  return shown;
}

export function TasksPanel({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const closed = useClosedFlash(s);
  const active = activeTasks(s);
  const year = yearOf(s.day);
  const rows = [...closed, ...active];
  return (
    <>
      <div className="task-head">
        <span>Задачи</span>
        {s.quests.done > 0 && <span className="n">выполнено: {s.quests.done}</span>}
      </div>
      <div className="task-list">
        {rows.length === 0 && <div className="task-empty">Новых задач пока нет</div>}
        {rows.map((t) => {
          const title = taskTitle(s, t);
          const reward = taskRewardText(t, year);
          if (t.status !== 'active') {
            const ok = t.status === 'done';
            return (
              <div key={t.id} className={`task-row closed ${ok ? 'ok' : 'fail'}`}>
                <div className="tr-top">
                  <span className="tr-title">{title}</span>
                </div>
                <div className="tr-sub">{ok ? `Задача выполнена: ${reward}` : `Не успели: ${t.result.charAt(0).toLowerCase()}${t.result.slice(1)}`}</div>
              </div>
            );
          }
          const p = taskProgress(s, t);
          const left = taskDaysLeft(s, t);
          const urgent = left <= URGENT_DAYS;
          return (
            <div
              key={t.id}
              className="task-row"
              onClick={() => open(OPENS[t.kind] ?? 'analytics')}
              title={`Награда: ${reward}`}
            >
              <div className="tr-top">
                <span className="tr-title">{title}</span>
                <span className="tr-reward">{capitalize(taskRewardShort(t, year))}</span>
              </div>
              <div className="tr-sub">
                <span className="tr-text">
                  {p?.text ?? ''}
                  {p?.almost && <span className="tr-almost"> - почти</span>}
                </span>
                {/* Срок задачи, а не обучения: «ещё 22 дня» рядом с «Обучение: 94 %» читалось как срок модели (QA 19.10). */}
                <span className={`tr-left${urgent ? ' urgent' : ''}`} title="Сколько осталось до конца срока задачи">
                  срок: {fmtDays(left)}
                </span>
              </div>
              <div className="task-bar">
                <div className="pb" style={{ ['--p' as string]: Math.min(1, Math.max(0, p?.fraction ?? 0)) }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
