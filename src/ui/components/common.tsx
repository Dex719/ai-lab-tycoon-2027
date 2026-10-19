// Общие мелкие компоненты для окон.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { reducedMotion } from '../alive';
import { IconAlert, IconClose, IconInfo } from '../icons';

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
      <div className="pb" style={{ ['--p' as string]: pct / 100 }} />
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
      <div style={{ fontSize: 16, fontWeight: 'var(--fw-title)' }} className="num">
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
  // Закрытие крестиком, Esc или тенью: 100 мс выхода, затем настоящий onClose. Кнопки подвала закрывают сразу.
  const [leaving, setLeaving] = useState(false);
  const downOnShade = useRef(false);
  const close = props.onClose
    ? () => {
        if (leaving) return;
        if (reducedMotion()) return props.onClose?.();
        setLeaving(true);
        window.setTimeout(() => props.onClose?.(), 100);
      }
    : undefined;
  return (
    <div
      className={`modal-backdrop${leaving ? ' leaving' : ''}`}
      onKeyDown={(e) => e.key === 'Escape' && close?.()}
      // Щелчок по тени вокруг окна закрывает его; нажатие должно начаться на тени, чтобы выделение текста не закрывало окно
      onPointerDown={(e) => {
        downOnShade.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnShade.current && e.target === e.currentTarget) close?.();
        downOnShade.current = false;
      }}
    >
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
          {close && (
            <button className="wbtn close" onClick={close} aria-label="Закрыть" title="Закрыть">
              <IconClose size={14} />
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
  /** data-tutorial кнопки подтверждения: обучение игре подсвечивает её. */
  tutorial?: string;
  /** Может вернуть результат действия: при ошибке диалог остаётся открытым и показывает её. */
  onConfirm: () => void | { ok: true } | { ok: false; error: string };
  onClose: () => void;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  // Повторное нажатие до того, как диалог закрылся, действие не повторяет: три щелчка подряд в одной задаче браузера
  // запускали два обучения (QA 19.10). Замок снимается в следующей задаче - если диалог остался открытым (ошибка).
  const busy = useRef(false);
  const confirm = () => {
    if (busy.current) return;
    busy.current = true;
    window.setTimeout(() => (busy.current = false), 0);
    const r = props.onConfirm();
    setError(r && !r.ok ? r.error : null);
  };
  return createPortal(
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button className={`btn ${props.danger ? 'danger' : 'primary'}`} data-tutorial={props.tutorial} onClick={confirm}>
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        {props.children}
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
    </Dialog>,
    document.body,
  );
}

// ---------- «Новое» и отклик недоступных кнопок ----------

/** Сколько игровых дней новинка помечена значком «Новое». */
export const NEW_BADGE_DAYS = 7;

/** Новинка, появившаяся в день since, ещё свежая: прошло меньше NEW_BADGE_DAYS дней. */
export function isFresh(day: number, since: number): boolean {
  return day >= since && day - since < NEW_BADGE_DAYS;
}

/** Значок «Новое» рядом с подписью: виден NEW_BADGE_DAYS игровых дней с дня since. */
export function NewBadge({ day, since }: { day: number; since: number }) {
  if (!isFresh(day, since)) return null;
  return (
    <span className="new-badge" title="Появилось недавно">
      Новое
    </span>
  );
}

/** Короткое сообщение на 3,5 секунды: почему нажатый элемент сейчас недоступен. */
export function useFlash(ms = 3500): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback(
    (next: string) => {
      setText(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setText(null), ms);
    },
    [ms],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [text, show];
}

/** Красная строка под элементом: причина недоступности. Не сдвигает раскладку (выводится поверх). */
export function DenyNote({ text }: { text: string | null }) {
  return text ? (
    <span className="deny-note" role="alert">
      {text}
    </span>
  ) : null;
}

/**
 * Кнопка, которая выглядит недоступной, пока есть причина (reason), но отвечает на нажатие:
 * под ней на 3,5 секунды появляется красная строка с причиной. Без причины - обычная кнопка.
 */
export function GuardButton(props: {
  reason: string | null | undefined;
  onClick: () => void;
  className?: string;
  title?: string;
  children: ReactNode;
  [data: `data-${string}`]: string | undefined;
}) {
  const { reason, onClick, className, title, children, ...rest } = props;
  const [note, flash] = useFlash();
  const blocked = !!reason;
  return (
    <span className="guard">
      <button
        type="button"
        {...rest}
        className={className}
        title={title ?? reason ?? undefined}
        aria-disabled={blocked || undefined}
        onClick={() => (blocked ? flash(reason!) : onClick())}
      >
        {children}
      </button>
      <DenyNote text={note} />
    </span>
  );
}
