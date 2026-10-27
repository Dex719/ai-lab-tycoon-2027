// Всплывающие уведомления в правом нижнем углу: о каждом новом письме (обучение, контракты, исследования и т. д.).
// Письма с выбором не показываем: их и так открывает окно решения. Исчезают через 6 секунд, пауза при наведении.

import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import type { GameState, LabId, Mail } from '../sim/types';
import { LabEmblem } from './components/LabEmblem';
import { IconAlert, IconArrowUpDown, IconBank, IconCalendar, IconClose, IconFast, IconInfo, IconMail, IconTrophy, type LineIconProps } from './icons';
import { reducedMotion, useFlip } from './alive';
import { getSettings } from './settings';
import { playSound } from './sound';
import { store } from './store';
import type { WindowAlias, WindowId } from './windows';
import { lettersWord, ruPlural } from '../sim/text';

const SHOW_MS = 6000;
/** Награды и исход риска живут дольше: их не должны вытеснять новости. */
const REWARD_MS = 10000;
const OUTCOME_MS = 8000;
const MAX_VISIBLE = 4;
/** На экране ниже 1000 px (1366×768, 1440×900) больше двух уведомлений закрывают сводку справа: показываем два. */
const SHORT_SCREEN = 1000;
const maxVisible = (): number => (window.innerHeight < SHORT_SCREEN ? 2 : MAX_VISIBLE);
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
  /** Письмо, которое открывает «Открыть»; у уведомлений интерфейса (не писем) пусто. */
  mailId: string;
  /** Окно, которое открывает «Открыть» вместо «Почты». */
  win?: WindowId | WindowAlias;
  kind: Kind;
  title: string;
  important: boolean;
  group: boolean;
  /** reward - награда (золотая), good / bad - исход выбора со случайностью. */
  tone?: 'reward' | 'good' | 'bad';
  /** Подпись над заголовком вместо вида письма. */
  label?: string;
  /** Письмо лично от лаборатории-соперника: вместо значка - её эмблема. */
  from?: LabId;
  /** Подпись кнопки вместо «Открыть» (например, «Выпустить» у готовой проверки). */
  act?: string;
}

/** Уведомление интерфейса: ответ на действие игрока (обучение началось и т. п.), не письмо. */
export interface Notice {
  kind: Kind;
  label: string;
  title: string;
  win?: WindowId | WindowAlias;
  tone?: 'reward' | 'good' | 'bad';
  /** Эмблема лаборатории-соперника вместо значка (клиент ушёл к ней или от неё). */
  from?: LabId;
}

let noticeListener: ((n: Notice) => void) | null = null;

export function pushNotice(n: Notice): void {
  noticeListener?.(n);
}

function mailNum(m: Mail): number {
  return Number(m.id.slice(1));
}

function ToastItem({ t, onOpen, onClose }: { t: ToastData; onOpen: (t: ToastData) => void; onClose: (key: number) => void }) {
  const [hover, setHover] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Уходит за 120 мс (ease-in), затем настоящее удаление: оставшиеся карточки плавно съезжают на место.
  const dismiss = useCallback(() => {
    if (reducedMotion()) return onClose(t.key);
    setLeaving(true);
    window.setTimeout(() => onClose(t.key), 120);
  }, [onClose, t.key]);
  const left = useRef(t.tone === 'reward' ? REWARD_MS : t.tone ? OUTCOME_MS : SHOW_MS);
  useEffect(() => {
    if (hover || leaving) return;
    const started = Date.now();
    const id = window.setTimeout(dismiss, left.current);
    return () => {
      window.clearTimeout(id);
      left.current = Math.max(800, left.current - (Date.now() - started));
    };
  }, [hover, leaving, dismiss]);
  const { name, Icon } = KIND[t.kind];
  return (
    <div
      className={`toast k-${t.kind}${t.important ? ' important' : ''}${t.tone ? ` tone-${t.tone}` : ''}${leaving ? ' leaving' : ''}`}
      data-fk={t.key}
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={`ti${t.from ? ' from' : ''}`} aria-hidden="true">
        {t.from ? <LabEmblem lab={t.from} size={28} decorative /> : <Icon size={16} />}
      </span>
      <span className="tk">{t.label ?? (t.group ? 'Новые письма' : t.important ? `${name}, важное` : name)}</span>
      <span className="tt">{t.title}</span>
      <span className="ta">
        <button type="button" onClick={() => onOpen(t)} title={t.win ? 'Открыть окно' : 'Открыть письмо в «Почте»'}>
          {t.act ?? 'Открыть'}
        </button>
      </span>
      <button type="button" className="toast-x" onClick={dismiss} title="Скрыть уведомление" aria-label="Скрыть уведомление">
        <IconClose size={12} />
      </button>
    </div>
  );
}

export function Toasts({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const [items, setItems] = useState<ToastData[]>([]);
  const seen = useRef<{ state: GameState; num: number }>({ state: s, num: s.nextMailNum });
  /** Письма, исход которых уже показан (или был до начала сессии). */
  const outcomes = useRef<{ state: GameState; ids: Set<string> }>({ state: s, ids: outcomeIds(s) });
  const keyRef = useRef(0);
  const flipRef = useFlip<HTMLDivElement>({ enter: false });

  // Ответы на действия игрока показываем всегда, даже при выключенных уведомлениях о письмах.
  useEffect(() => {
    noticeListener = (n) => {
      const t: ToastData = { key: ++keyRef.current, mailId: '', win: n.win, kind: n.kind, title: n.title, important: false, group: false, tone: n.tone, label: n.label, from: n.from };
      setItems((cur) => [...cur, t].slice(-maxVisible()));
    };
    return () => {
      noticeListener = null;
    };
  }, []);

  // Исход выбора со случайностью: письмо старое, новым становится только его поле outcome.
  useEffect(() => {
    const o = outcomes.current;
    if (o.state !== s) {
      outcomes.current = { state: s, ids: outcomeIds(s) };
      return;
    }
    const fresh = s.mail.filter((m) => m.outcome && !o.ids.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) o.ids.add(m.id);
    const next = fresh.map(
      (m): ToastData => ({
        key: ++keyRef.current,
        mailId: m.id,
        kind: m.kind,
        title: `${m.outcome!.lucky ? 'Повезло' : 'Не повезло'}: ${m.outcome!.text}`,
        important: false,
        group: false,
        tone: m.outcome!.lucky ? 'good' : 'bad',
        label: m.title,
      }),
    );
    playSound(fresh[fresh.length - 1].outcome!.lucky ? 'coin' : 'spend');
    setItems((cur) => [...cur, ...next].slice(-maxVisible()));
  });

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
      if (!m.choices && !m.read) fresh.unshift(m); // прочитанные сразу (выпуск модели) не всплывают
    }
    if (fresh.length === 0) return;
    const toToast = (m: Mail, group = false, title = m.title): ToastData => ({
      key: ++keyRef.current,
      mailId: m.id,
      kind: group ? 'news' : m.kind,
      title,
      important: !!m.important,
      group,
      tone: !group && m.reward ? 'reward' : undefined,
      label: !group && m.reward ? 'Награда' : undefined,
      from: group ? undefined : m.from,
      win: !group && m.tag === 'redteam-done' ? 'models' : undefined,
      act: !group && m.tag === 'redteam-done' ? 'Выпустить' : undefined,
    });
    // Награды - каждая отдельной карточкой, их не сворачиваем. Затем важные письма, затем новости.
    const rewards = fresh.filter((m) => m.reward);
    const important = fresh.filter((m) => !m.reward && m.important);
    // На ×4 новости не всплывают: копятся в «Почте», чтобы не вытеснять награды.
    const news = store.speed === 4 ? [] : fresh.filter((m) => !m.reward && !m.important);
    const others = [...important, ...news];
    const max = maxVisible();
    // Наград больше, чем помещается: последние - отдельными карточками, остальные одной строкой.
    const single = rewards.length > max ? rewards.slice(-(max - 1)) : rewards;
    const next: ToastData[] = single.map((m) => toToast(m));
    if (rewards.length > single.length) {
      const extra = rewards.length - single.length;
      next.unshift({
        ...toToast(rewards[0], true, `Ещё ${extra} ${ruPlural(extra, 'награда', 'награды', 'наград')} в «Почте»`),
        tone: 'reward',
        label: 'Награды',
      });
    }
    const room = Math.max(0, Math.min(SINGLE_LIMIT, max) - next.length);
    next.push(...others.slice(0, room).map((m) => toToast(m)));
    const rest = others.slice(room);
    if (rest.length > 0) next.push(toToast(rest[0], true, `Ещё ${rest.length} ${lettersWord(rest.length)}`));
    if (next.length === 0) return;
    // Вытесняем сначала обычные уведомления, награды держим.
    setItems((cur) => {
      const all = [...cur, ...next];
      while (all.length > max) {
        const i = all.findIndex((x) => x.tone !== 'reward');
        all.splice(i >= 0 ? i : 0, 1);
      }
      return all;
    });
  });

  const close = useCallback((key: number) => setItems((cur) => cur.filter((t) => t.key !== key)), []);
  const openMail = useCallback(
    (t: ToastData) => {
      if (t.win) open(t.win);
      else {
        store.focusMail(t.mailId);
        open('mail');
      }
      setItems((cur) => cur.filter((x) => x.key !== t.key));
    },
    [open],
  );

  if (items.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite" ref={flipRef}>
      {items.map((t) => (
        <ToastItem key={t.key} t={t} onOpen={openMail} onClose={close} />
      ))}
    </div>
  );
}

function outcomeIds(s: GameState): Set<string> {
  return new Set(s.mail.filter((m) => m.outcome).map((m) => m.id));
}
