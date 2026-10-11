// Рабочий стол: иконки и открытые окна (FR-14.2, FR-14.3).

import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { unreadCount } from '../sim/events';
import type { GameState } from '../sim/types';
import { store } from './store';
import { clampPos, deskAreaOf, Window, type WinGeom } from './Window';
import { WINDOWS, type WindowId, type WindowProps } from './windows';

interface OpenWin extends WinGeom {
  id: WindowId;
}

/** Запас справа от иконок, если измерить их не удалось: две колонки по 84 px и отступы. */
const ICONS_RIGHT_FALLBACK = 190;

interface BodyProps extends WindowProps {
  C: ComponentType<WindowProps>;
  /** Версия состояния. Состояние меняется на месте, поэтому только версия говорит memo, что данные новые. */
  version: number;
}

/**
 * Содержимое окна. Перерисовывается на каждый ход игры и действие игрока (меняется version),
 * но не когда соседнее окно перетаскивают, растягивают или поднимают.
 */
const WindowBody = memo(function WindowBody({ C, s, open }: BodyProps) {
  return <C s={s} open={open} />;
});

export function Desktop({ s }: { s: GameState }) {
  const [wins, setWins] = useState<OpenWin[]>([]);
  const deskRef = useRef<HTMLDivElement>(null);
  const iconsRef = useRef<HTMLDivElement>(null);

  const open = useCallback((id: WindowId) => {
    setWins((ws) => {
      const top = ws.reduce((m, w) => Math.max(m, w.z), 0) + 1;
      const area = deskAreaOf(deskRef.current);
      const existing = ws.find((w) => w.id === id);
      if (existing) {
        // Заодно возвращаем на стол окно, которое осталось за краем после уменьшения браузера.
        return ws.map((w) => (w.id === id ? { ...w, ...clampPos(w, area), z: top } : w));
      }
      const def = WINDOWS.find((d) => d.id === id)!;
      const n = ws.length;
      // Новые окна открываются справа от иконок, чтобы не закрывать их (в том числе «Игра», «Рынок», «Финансы»).
      const icons = iconsRef.current;
      const left = icons ? icons.offsetLeft + icons.offsetWidth + 8 : ICONS_RIGHT_FALLBACK;
      const w = Math.max(280, Math.min(def.w, area.w - left - 10));
      const h = Math.max(160, Math.min(def.h, area.h - 20));
      const x = Math.max(left, Math.min(area.w - w - 10, left + n * 28));
      const y = Math.max(4, Math.min(area.h - h - 4, 8 + n * 24));
      return [...ws, { id, x, y, w, h, z: top }];
    });
  }, []);

  // Браузер стал меньше (выход из полноэкранного режима, панель разработчика): окна не должны уйти за край.
  useEffect(() => {
    function onResize() {
      const area = deskAreaOf(deskRef.current);
      setWins((ws) => {
        let changed = false;
        const next = ws.map((w) => {
          const p = clampPos(w, area);
          if (p.x === w.x && p.y === w.y) return w;
          changed = true;
          return { ...w, ...p };
        });
        return changed ? next : ws;
      });
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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
    <div className="desktop" ref={deskRef}>
      <div className="icons" ref={iconsRef}>
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
            <WindowBody C={def.Component} s={s} open={open} version={store.version} />
          </Window>
        );
      })}
    </div>
  );
}
