// Всплывающие уведомления в правом нижнем углу: о каждом новом письме (обучение, контракты, исследования и т. д.).
// Письма с выбором не показываем: их и так открывает окно решения. Исчезают через 6 секунд, пауза при наведении.

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import type { GameState, Mail } from '../sim/types';
import { IconAlert, IconArrowUpDown, IconBank, IconCalendar, IconClose, IconFast, IconInfo, IconMail, IconTrophy, type LineIconProps } from './icons';
import { getSettings } from './settings';
import { store } from './store';
import type { WindowAlias, WindowId } from './windows';

const SHOW_MS = 6000;
const MAX_VISIBLE = 4;
/** Если за один шаг пришло больше писем, первые показываем по отдельности, остальные одной строкой. */
const SINGLE_LIMIT = 3;

type Kind = Mail['kind'];

const KIND: Record<Kind, { name: string; Icon: ComponentType<LineIconProps> }> = {
  training: { name: 'Обучение', Icon: IconFast },
  contract: { name: 'Контракты', Icon: IconTrophy },
  finance: { name: 'Финансы', Icon: IconBank },
  rival: { name: 'Соперники', Icon: IconAlert },
  research: { name: 'Исследования', Icon: IconInfo },
  news: { name: 'Новости', Icon: IconMail },
  event: { name: 'События', Icon: IconCalendar },
  benchmark: { name: 'Бенчмарки', Icon: IconArrowUpDown },
};

interface ToastData {
  key: number;
  mailId: string;
  kind: Kind;
  title: string;
  important: boolean;
  group: boolean;
}

function mailNum(m: Mail): number {
  return Number(m.id.slice(1));
}

function lettersWord(n: number): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return 'письмо';
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'письма';
  return 'писем';
}

function ToastItem({ t, onOpen, onClose }: { t: ToastData; onOpen: (t: ToastData) => void; onClose: (key: number) => void }) {
  const [hover, setHover] = useState(false);
  const left = useRef(SHOW_MS);
  useEffect(() => {
    if (hover) return;
    const started = Date.now();
    const id = window.setTimeout(() => onClose(t.key), left.current);
    return () => {
      window.clearTimeout(id);
      left.current = Math.max(800, left.current - (Date.now() - started));
    };
  }, [hover, onClose, t.key]);
  const { name, Icon } = KIND[t.kind];
  return (
    <div
      className={`toast k-${t.kind}${t.important ? ' important' : ''}`}
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="ti" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="tk">{t.group ? 'Новые письма' : t.important ? `${name}, важное` : name}</span>
      <span className="tt">{t.title}</span>
      <span className="ta">
        <button type="button" onClick={() => onOpen(t)} title="Открыть письмо в «Почте»">
          Открыть
        </button>
        <button type="button" className="quiet" onClick={() => onClose(t.key)} title="Скрыть уведомление" aria-label="Скрыть уведомление">
          <IconClose size={12} />
        </button>
      </span>
    </div>
  );
}

export function Toasts({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const [items, setItems] = useState<ToastData[]>([]);
  const seen = useRef<{ state: GameState; num: number }>({ state: s, num: s.nextMailNum });
  const keyRef = useRef(0);

  // Состояние меняется на месте: сравниваем номер следующего письма с тем, что видели в прошлый раз.
  useEffect(() => {
    const prev = seen.current;
    if (prev.state !== s || s.nextMailNum < prev.num) {
      seen.current = { state: s, num: s.nextMailNum };
      setItems([]);
      return;
    }
    if (s.nextMailNum === prev.num) return;
    const from = prev.num;
    seen.current = { state: s, num: s.nextMailNum };
    if (!getSettings().toasts) return;
    const fresh: Mail[] = [];
    for (let i = s.mail.length - 1; i >= 0; i--) {
      const m = s.mail[i];
      if (mailNum(m) < from) break;
      if (!m.choices) fresh.unshift(m);
    }
    if (fresh.length === 0) return;
    // Важные письма показываем первыми.
    const ordered = [...fresh.filter((m) => m.important), ...fresh.filter((m) => !m.important)];
    const toToast = (m: Mail, group = false, title = m.title): ToastData => ({
      key: ++keyRef.current,
      mailId: m.id,
      kind: group ? 'news' : m.kind,
      title,
      important: !!m.important,
      group,
    });
    const next: ToastData[] = ordered.slice(0, SINGLE_LIMIT).map((m) => toToast(m));
    const rest = ordered.slice(SINGLE_LIMIT);
    if (rest.length > 0) next.push(toToast(rest[0], true, `Ещё ${rest.length} ${lettersWord(rest.length)}`));
    setItems((cur) => [...cur, ...next].slice(-MAX_VISIBLE));
  });

  const close = useCallback((key: number) => setItems((cur) => cur.filter((t) => t.key !== key)), []);
  const openMail = useCallback(
    (t: ToastData) => {
      store.focusMail(t.mailId);
      open('mail');
      setItems((cur) => cur.filter((x) => x.key !== t.key));
    },
    [open],
  );

  if (items.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <ToastItem key={t.key} t={t} onOpen={openMail} onClose={close} />
      ))}
    </div>
  );
}
