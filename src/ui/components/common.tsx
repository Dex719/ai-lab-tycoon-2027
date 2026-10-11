// Общие мелкие компоненты для окон.

import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconAlert, IconInfo } from '../icons';

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

/** Полоса прогресса; value - 0..1. */
export function ProgressBar({ value, title }: { value: number; title?: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className="progress" title={title}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Ползунок в общем стиле игры: заполненная часть дорожки окрашена цветом color. */
export function Range(props: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  valueText?: string;
  color?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { value, min, max } = props;
  const p = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  const style = { '--p': `${p}%`, ...(props.color ? { '--c': props.color } : {}) } as CSSProperties;
  return (
    <input
      type="range"
      className={`range${props.className ? ` ${props.className}` : ''}`}
      style={style}
      min={min}
      max={max}
      step={props.step ?? 1}
      value={value}
      disabled={props.disabled}
      aria-label={props.label}
      aria-valuetext={props.valueText}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  );
}

/** Пара «подпись - значение» в карточке. */
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

export type AlertTone = 'warn' | 'bad' | 'info';

/**
 * Единое предупреждение в окнах: значок, текст и необязательная кнопка справа.
 * warn - «нет мощности», «ждёт решения»; bad - ошибка или минус на счёте; info - подсказка.
 * Стили - .alert в theme.css.
 */
export function Alert({
  tone,
  children,
  action,
}: {
  tone: AlertTone;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const Icon = tone === 'info' ? IconInfo : IconAlert;
  return (
    <div className={`alert ${tone}`} role={tone === 'info' ? 'status' : 'alert'}>
      <Icon size={18} />
      <div className="alert-text">{children}</div>
      {action && (
        <button type="button" className="btn small" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Фокус для модального окна. Фокус уходит на само окно (а не на кнопку: случайный Enter не должен
 * выбирать вариант), Tab и Shift+Tab ходят по кнопкам внутри окна по кругу. resetKey - когда он
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

/** Светлое диалоговое окно поверх всего (как «Настройка игры» в Processor Tycoon). */
export function Dialog(props: {
  title: string;
  onClose?: () => void;
  wide?: boolean;
  white?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(props.title);
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && props.onClose?.()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`dialog${props.wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onKeyDown={onKeyDown}
      >
        <div className="titlebar">
          <span className="t">{props.title}</span>
          {props.onClose && (
            <button className="wbtn close" onClick={props.onClose} aria-label="Закрыть">
              ×
            </button>
          )}
        </div>
        <div className={`body${props.white ? ' white' : ''}`}>{props.children}</div>
        {props.footer && <div className="foot">{props.footer}</div>}
      </div>
    </div>
  );
}

/**
 * Подтверждение необратимого действия: заголовок, сводка последствий, «Отмена» и кнопка-глагол.
 * Окно выводится в document.body, поэтому его можно открыть из любого окна игры.
 */
export function ConfirmDialog(props: {
  title: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return createPortal(
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button className={`btn ${props.danger ? 'danger' : 'primary'}`} onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">{props.children}</div>
    </Dialog>,
    document.body,
  );
}
