// Достижения: плашка при получении (в партии) и список всех значков (главное меню).

import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../sim/types';
import { ACHIEVEMENTS, checkAchievements, loadUnlocked, type AchievementDef } from './achievementList';
import { Dialog } from './components/common';
import { playSound } from './sound';
import './achievementsUi.css';

const SHOW_MS = 4500;

/** Медаль: плоский круг на ленте, звезда вырезана фигурой. Получена - золото, нет - серая. */
function Medal({ on, size = 34 }: { on: boolean; size?: number }) {
  return (
    <svg className={`ach-medal${on ? ' on' : ''}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path className="ach-ribbon" d="M10 2 H15 L13 12 H8 Z M17 2 H22 L24 12 H19 Z" />
      <circle className="ach-disc" cx={16} cy={20} r={10} />
      <path className="ach-star" d="M16 14.2 L17.7 17.8 L21.6 18.2 L18.7 20.8 L19.5 24.7 L16 22.7 L12.5 24.7 L13.3 20.8 L10.4 18.2 L14.3 17.8 Z" />
    </svg>
  );
}

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
          <Medal on />
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
    <Dialog title={`Достижения: ${got} из ${ACHIEVEMENTS.length}`} onClose={onClose} wide white>
      <ul className="ach-list">
        {ACHIEVEMENTS.map((a) => {
          const when = unlocked[a.id];
          return (
            <li key={a.id} className={`ach-row${when ? ' on' : ''}`}>
              <Medal on={!!when} size={28} />
              <span className="ach-tt">
                <b>{a.title}</b>
                <span>{a.how}</span>
              </span>
              <span className="ach-when">{when ? dateText(when) : 'не получено'}</span>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
