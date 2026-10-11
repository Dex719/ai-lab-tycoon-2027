// Рабочий стол: иконки и открытые окна (FR-14.2, FR-14.3).

import { useCallback, useState } from 'react';
import { unreadCount } from '../sim/events';
import type { GameState } from '../sim/types';
import { Window, type WinGeom } from './Window';
import { WINDOWS, type WindowId } from './windows';

interface OpenWin extends WinGeom {
  id: WindowId;
}

export function Desktop({ s }: { s: GameState }) {
  const [wins, setWins] = useState<OpenWin[]>([]);

  const open = useCallback((id: WindowId) => {
    setWins((ws) => {
      const top = ws.reduce((m, w) => Math.max(m, w.z), 0) + 1;
      const existing = ws.find((w) => w.id === id);
      if (existing) return ws.map((w) => (w.id === id ? { ...w, z: top } : w));
      const def = WINDOWS.find((d) => d.id === id)!;
      const n = ws.length;
      const vw = window.innerWidth;
      const vh = window.innerHeight - 40;
      const w = Math.min(def.w, vw - 120);
      const h = Math.min(def.h, vh - 20);
      const x = Math.max(100, Math.min(vw - w - 10, 120 + n * 28));
      const y = Math.max(4, Math.min(vh - h - 4, 8 + n * 24));
      return [...ws, { id, x, y, w, h, z: top }];
    });
  }, []);

  const close = (id: WindowId) => setWins((ws) => ws.filter((w) => w.id !== id));
  const focus = (id: WindowId) =>
    setWins((ws) => {
      const top = ws.reduce((m, w) => Math.max(m, w.z), 0);
      const cur = ws.find((w) => w.id === id);
      if (!cur || cur.z === top) return ws;
      return ws.map((w) => (w.id === id ? { ...w, z: top + 1 } : w));
    });
  const move = (id: WindowId, g: Partial<WinGeom>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...g } : w)));

  const topZ = wins.reduce((m, w) => Math.max(m, w.z), 0);
  const unread = unreadCount(s);
  const pendingTenders = s.tenders.filter((t) => !t.application).length;

  return (
    <div className="desktop">
      <div className="icons">
        {WINDOWS.map((d) => (
          <button key={d.id} className="icon" onDoubleClick={() => open(d.id)} onClick={() => open(d.id)} data-icon={d.id}>
            <span className="glyph">
              {d.icon}
              {d.id === 'mail' && unread > 0 && <span className="badge">{unread}</span>}
              {d.id === 'contracts' && pendingTenders > 0 && <span className="badge" style={{ background: 'var(--accent-2)' }}>{pendingTenders}</span>}
            </span>
            <span className="label">{d.title}</span>
          </button>
        ))}
      </div>
      {wins.map((w) => {
        const def = WINDOWS.find((d) => d.id === w.id)!;
        const C = def.Component;
        return (
          <Window
            key={w.id}
            title={def.title}
            icon={def.icon}
            geom={w}
            active={w.z === topZ}
            onFocus={() => focus(w.id)}
            onClose={() => close(w.id)}
            onMove={(g) => move(w.id, g)}
          >
            <C s={s} open={open} />
          </Window>
        );
      })}
    </div>
  );
}
