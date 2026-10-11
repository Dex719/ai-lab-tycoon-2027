// Общие мелкие компоненты для окон.

import type { ReactNode } from 'react';

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
