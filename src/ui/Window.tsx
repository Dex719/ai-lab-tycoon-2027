// Окно рабочего стола: перетаскивание за заголовок, изменение размера за угол, выход на передний план.

import { useRef, type ComponentType, type ReactNode } from 'react';

export interface WinGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/** Размер рабочего стола, внутри которого живут окна. */
export interface DeskArea {
  w: number;
  h: number;
}

/** Высота заголовка окна (.titlebar в theme.css). */
export const TITLEBAR_H = 32;
/** Верхняя панель и панель задач вместе: столько места занимает не стол (запасной расчёт без элемента стола). */
const BARS_H = 80;

/** Размер рабочего стола (.desk), которому принадлежит элемент; запасной вариант - окно браузера без панелей. */
export function deskAreaOf(el: Element | null): DeskArea {
  const d = el?.closest('.desk');
  return d ? { w: d.clientWidth, h: d.clientHeight } : { w: window.innerWidth, h: Math.max(0, window.innerHeight - BARS_H) };
}

/**
 * Положение окна, при котором заголовок целиком остаётся на столе и за него можно взяться:
 * сверху не выше нуля, снизу - не ниже высоты стола минус заголовок, по бокам - не меньше 120 px окна на столе.
 */
export function clampPos(g: Pick<WinGeom, 'x' | 'y' | 'w'>, area: DeskArea): Pick<WinGeom, 'x' | 'y'> {
  const maxY = Math.max(0, area.h - TITLEBAR_H);
  return {
    x: Math.min(Math.max(0, area.w - 80), Math.max(-g.w + 120, g.x)),
    y: Math.min(maxY, Math.max(0, g.y)),
  };
}

interface Props {
  title: string;
  geom: WinGeom;
  active: boolean;
  accent?: string; // цвет верхней полосы заголовка
  icon?: ComponentType<{ size?: number }>; // значок раздела в круге слева от названия
  flush?: boolean; // тело без отступов (окно само раскладывает панели)
  fullscreen?: boolean; // телефон: окно на весь стол, без перетаскивания и изменения размера
  hidden?: boolean; // телефон: окно открыто, но показано другое
  leaving?: 'close' | 'min'; // окно уходит: 110 мс выхода перед тем, как его уберут
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMove: (g: Partial<WinGeom>) => void;
  children: ReactNode;
}

export function Window({ title, geom, active, accent, icon: Icon, flush, fullscreen, hidden, leaving, onFocus, onClose, onMinimize, onMove, children }: Props) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  function startDrag(e: React.PointerEvent) {
    if (fullscreen || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    drag.current = { dx: e.clientX - geom.x, dy: e.clientY - geom.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: React.PointerEvent) {
    if (!drag.current) return;
    onMove(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy, w: geom.w }, deskAreaOf(e.currentTarget as HTMLElement)));
  }
  function endDrag() {
    drag.current = null;
  }

  const resize = useRef<{ sx: number; sy: number; w: number; h: number } | null>(null);
  function startResize(e: React.PointerEvent) {
    // Без stopPropagation: нажатие доходит до окна и выводит его на передний план.
    if (fullscreen || e.button !== 0) return;
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
      className={`window${active ? ' active' : ''}${fullscreen ? ' fs' : ''}${hidden ? ' fs-off' : ''}${leaving ? ` leaving ${leaving}` : ''}`}
      style={{
        ...(fullscreen ? {} : { left: geom.x, top: geom.y, width: geom.w, height: geom.h }),
        zIndex: geom.z,
        ...(accent ? { ['--wa' as string]: accent } : {}),
      }}
      onPointerDown={onFocus}
      data-window={title}
    >
      <div className="titlebar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}>
        {fullscreen && (
          <button className="wbtn back" onClick={onMinimize} title="Назад на стол" aria-label="Назад на стол">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M9 2L4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        )}
        {Icon && (
          <span className="wicon" aria-hidden="true">
            <Icon size={22} />
          </span>
        )}
        <span className="t">{title}</span>
        <button className="wbtn min" onClick={onMinimize} title="Свернуть" aria-label="Свернуть">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 9h8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        <button className="wbtn close" onClick={onClose} title="Закрыть" aria-label="Закрыть">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>
      <div className={`window-body${flush ? ' flush' : ''}`}>{children}</div>
      {!fullscreen && (
        <div
          className="resize"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={() => (resize.current = null)}
        />
      )}
    </div>
  );
}
