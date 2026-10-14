// Достижения: плашка при получении (в партии) и список всех значков (главное меню).

import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../sim/types';
import { ACHIEVEMENTS, checkAchievements, loadUnlocked, type AchievementDef } from './achievementList';
import { Dialog } from './components/common';
import { playSound } from './sound';
import './achievementsUi.css';

const SHOW_MS = 4500;

/** Следит за партией и показывает полученные достижения. Уже случившееся в загруженной партии тоже засчитывается. */
export function AchievementToasts({ s }: { s: GameState }) {
  const [items, setItems] = useState<{ key: number; at: number; a: AchievementDef }[]>([]);
  const key = useRef(0);
  const releasedCount = s.models.filter((m) => m.releasedDay !== null).length;

  useEffect(() => {
    const fresh = checkAchievements(s);
    if (fresh.length === 0) return;
    const now = Date.now();
    const next = fresh.map((a) => ({ key: ++key.current, at: now, a }));
    setItems((cur) => [...cur, ...next].slice(-3));
    playSound('goal');
  }, [s, s.day, s.outcome, releasedCount]);

  // Скрытие - своим таймером: смена игрового дня не должна его сбрасывать.
  useEffect(() => {
    if (items.length === 0) return;
    const oldest = items[0];
    const wait = Math.max(0, oldest.at + SHOW_MS - Date.now());
    const id = window.setTimeout(() => setItems((cur) => cur.filter((x) => x.key !== oldest.key)), wait);
    return () => window.clearTimeout(id);
  }, [items]);

  if (items.length === 0) return null;
  return (
    <div className="ach-toasts" aria-live="polite">
      {items.map(({ key: k, a }) => (
        <div key={k} className="ach-toast" role="status">
          <span className="ach-medal" aria-hidden="true">★</span>
          <span className="ach-tt">
            <small>Достижение</small>
            <b>{a.title}</b>
            <span>{a.how}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function dateText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU');
}

/** Окно со всеми достижениями: полученные цветные, остальные серые с условием. */
export function AchievementsDialog({ onClose }: { onClose: () => void }) {
  const unlocked = loadUnlocked();
  const got = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
  return (
    <Dialog title={`Достижения: ${got} из ${ACHIEVEMENTS.length}`} onClose={onClose} wide>
      <div className="ach-grid">
        {ACHIEVEMENTS.map((a) => {
          const when = unlocked[a.id];
          return (
            <div key={a.id} className={`ach-card${when ? ' on' : ''}`}>
              <span className="ach-medal" aria-hidden="true">{when ? '★' : '☆'}</span>
              <span className="ach-tt">
                <b>{a.title}</b>
                <span>{a.how}</span>
                {when && <small>Получено {dateText(when)}</small>}
              </span>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
