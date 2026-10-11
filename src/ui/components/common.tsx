// Общие мелкие компоненты для окон.

import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

export function Tabs<T extends string>(props: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs">
      {props.tabs.map((t) => (
        <button key={t.id} className={`tab${t.id === props.value ? ' on' : ''}`} onClick={() => props.onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Полоса прогресса; value — 0..1. */
export function ProgressBar({ value, title }: { value: number; title?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className="progress" title={title}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Пара «подпись — значение» в карточке. */
export function Stat({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card" style={{ minWidth: 120 }}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }} className="num">
        {value}
      </div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

/** Текст ошибки действия (или ничего). */
export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <div className="error">{error}</div> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted" style={{ padding: '12px 0' }}>{children}</div>;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Фокус для модального окна. Фокус уходит на само окно (а не на кнопку: случайный Enter не должен
 * выбирать вариант), Tab и Shift+Tab ходят по кнопкам внутри окна по кругу. resetKey — когда он
 * меняется (пришло другое письмо), фокус возвращается на окно.
 */
export function useModalFocus<T extends HTMLElement>(resetKey?: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [resetKey]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || cur === root)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return { ref, onKeyDown };
}
