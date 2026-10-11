// Окно рабочего стола: перетаскивание за заголовок, изменение размера за угол, выход на передний план.

import { useRef, type ReactNode } from 'react';

export interface WinGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

interface Props {
  title: string;
  icon: string;
  geom: WinGeom;
  active: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMove: (g: Partial<WinGeom>) => void;
  children: ReactNode;
}

export function Window({ title, icon, geom, active, onFocus, onClose, onMove, children }: Props) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - geom.x, dy: e.clientY - geom.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: React.PointerEvent) {
    if (!drag.current) return;
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 70;
    onMove({
      x: Math.min(maxX, Math.max(-geom.w + 120, e.clientX - drag.current.dx)),
      y: Math.min(maxY, Math.max(0, e.clientY - drag.current.dy)),
    });
  }
  function endDrag() {
    drag.current = null;
  }

  const resize = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);
  function startResize(e: React.PointerEvent) {
    e.stopPropagation();
    resize.current = { sx: e.clientX, sy: e.clientY, w: geom.w, h: geom.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveResize(e: React.PointerEvent) {
    const r = resize.current;
    if (!r) return;
    onMove({ w: Math.max(280, r.w + e.clientX - r.sx), h: Math.max(160, r.h + e.clientY - r.sy) });
  }

  return (
    <div
      className={`window${active ? ' active' : ''}`}
      style={{ left: geom.x, top: geom.y, width: geom.w, height: geom.h, zIndex: geom.z }}
      onPointerDown={onFocus}
      data-window={title}
    >
      <div className="titlebar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}>
        <span>{icon}</span>
        <span className="t">{title}</span>
        <button className="x" onClick={onClose} title="Закрыть">
          ×
        </button>
      </div>
      <div className="window-body">{children}</div>
      <div
        className="resize"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={() => (resize.current = null)}
      />
    </div>
  );
}
