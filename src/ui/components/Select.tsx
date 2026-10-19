// Выпадающий список в стиле игры. Обычный <select> показывает список средствами системы (белый, синяя строка, мелкий
// шрифт) и выглядит чужим в окнах игры (QA 19.10, «Частота кадров» в «Настройках»). Список выводится в document.body:
// окно с прокруткой его не обрезает. Клавиши: стрелки, Enter, Esc, Tab.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './Select.css';

export interface SelectOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

/** Место списка: под кнопкой, а если внизу тесно - над ней. */
interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

const GAP = 4;
const MAX_LIST = 320;

export function Select<T extends string | number>(props: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  'aria-label'?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = props.options.findIndex((o) => o.value === props.value);

  const measure = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const down = below >= Math.min(MAX_LIST, 160) || below >= above;
    setPlace({
      left: r.left,
      width: r.width,
      ...(down ? { top: r.bottom + GAP } : { bottom: window.innerHeight - r.top + GAP }),
      maxHeight: Math.max(120, Math.min(MAX_LIST, down ? below : above)),
    });
  }, []);

  const show = () => {
    if (props.disabled) return;
    setActive(Math.max(0, current));
    measure();
    setOpen(true);
  };
  const hide = (focusBack = true) => {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  };
  const pick = (i: number) => {
    const o = props.options[i];
    if (o && o.value !== props.value) props.onChange(o.value);
    hide();
  };

  useLayoutEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) hide(false);
    };
    // Окно под списком прокрутили или изменили размер: список закрывается, а не висит отдельно от кнопки.
    const away = (e: Event) => {
      if (list.current && e.target instanceof Node && list.current.contains(e.target)) return;
      hide(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function onButtonKey(e: KeyboardEvent) {
    if (open) return onListKey(e);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      show();
    }
  }

  function onListKey(e: KeyboardEvent) {
    const n = props.options.length;
    if (e.key === 'ArrowDown') setActive((a) => Math.min(n - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape') hide();
    else if (e.key === 'Tab') return hide(false);
    else return;
    // Esc и стрелки не доходят до окна и игры: Esc закрыл бы диалог «Настройки», пробел - поставил бы паузу.
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`sel${open ? ' open' : ''}${props.className ? ` ${props.className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={props['aria-label']}
        disabled={props.disabled}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onButtonKey}
      >
        <span className="sel-v">{props.options[current]?.label ?? ''}</span>
        <svg className="sel-arrow" width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">
          <path d="M1.5 1.5 6 6l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={list}
            id={id}
            className="sel-list"
            role="listbox"
            aria-label={props['aria-label']}
            tabIndex={-1}
            style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
            onKeyDown={onListKey}
          >
            {props.options.map((o, i) => (
              <div
                key={String(o.value)}
                data-i={i}
                role="option"
                aria-selected={i === current}
                className={`sel-opt${i === current ? ' on' : ''}${i === active ? ' active' : ''}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
