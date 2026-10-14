// Окно «Почта»: слева папки (решения, награды, лаборатория, контракты, события, соперники, новости),
// посередине список писем, справа письмо на бланке. Итог контрактов за месяц показан таблицей строк.
// Письмо становится прочитанным, только когда игрок нажал на него в списке.

import { useEffect, useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { unreadCount } from '../../sim/events';
import { ChoiceList, replyLine } from '../ChoiceModal';
import { formatDate, formatDateShort } from '../../sim/time';
import type { Mail } from '../../sim/types';
import { fmtMoney, fmtNum } from '../format';
import { IconChevronLeft } from '../icons';
import { Line, type LineIconProps } from '../icons/base';
import { actions, store } from '../store';
import './MailWindow.css';

/** Сколько последних писем показывает список. */
const MAX_LIST = 200;

type Kind = Mail['kind'];

export const KIND_NAME: Record<Kind, string> = {
  news: 'Новости',
  event: 'События',
  rival: 'Соперники',
  research: 'Исследования',
  training: 'Обучение',
  contract: 'Контракты',
  finance: 'Финансы',
  benchmark: 'Бенчмарки',
};

/** Письмо с вариантами, на которые игрок ещё не ответил. */
function awaitsDecision(m: Mail): boolean {
  return !!m.choices && m.chosen === undefined;
}

type FolderId = 'all' | 'decide' | 'reward' | 'lab' | 'contract' | 'event' | 'rival' | 'news';

interface Folder {
  id: FolderId;
  label: string;
  match: (m: Mail) => boolean;
}

/** Папки: письмо может лежать в двух сразу (награда за контракт - и в «Наградах», и в «Контрактах»). */
export const FOLDERS: Folder[] = [
  { id: 'all', label: 'Все письма', match: () => true },
  { id: 'decide', label: 'Нужно решение', match: awaitsDecision },
  { id: 'reward', label: 'Награды', match: (m) => !!m.reward },
  { id: 'lab', label: 'Лаборатория', match: (m) => m.kind === 'training' || m.kind === 'research' || m.kind === 'finance' },
  { id: 'contract', label: 'Контракты', match: (m) => m.kind === 'contract' },
  { id: 'event', label: 'События', match: (m) => m.kind === 'event' },
  { id: 'rival', label: 'Соперники', match: (m) => m.kind === 'rival' },
  { id: 'news', label: 'Новости', match: (m) => m.kind === 'news' || m.kind === 'benchmark' },
];

// ---------- Значки ----------

function Glyph({ kind, ...p }: LineIconProps & { kind: Kind | FolderId }) {
  switch (kind) {
    case 'all':
      return (
        <Line {...p}>
          <path d="M3 13 L5.5 5 H18.5 L21 13 V19 H3 Z" />
          <path d="M3 13 H8 L9.5 15.5 H14.5 L16 13 H21" />
        </Line>
      );
    case 'decide':
      return (
        <Line {...p}>
          <path d="M12 3 L22 20 H2 Z" />
          <path d="M12 9.5 V13.5 M12 16.6 V16.8" />
        </Line>
      );
    case 'reward':
      return (
        <Line {...p}>
          <path d="M7 4 H17 V9 A5 5 0 0 1 7 9 Z" />
          <path d="M7 6 H4 A3 3 0 0 0 7 10.5 M17 6 H20 A3 3 0 0 1 17 10.5 M12 14 V17 M8.5 20.5 H15.5 L14.5 17 H9.5 Z" />
        </Line>
      );
    case 'lab':
    case 'research':
      return (
        <Line {...p}>
          <path d="M9.5 3 V9 L4.5 18.5 A1.6 1.6 0 0 0 6 21 H18 A1.6 1.6 0 0 0 19.5 18.5 L14.5 9 V3" />
          <path d="M8 3 H16 M7 15 H17" />
        </Line>
      );
    case 'training':
      return (
        <Line {...p}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M9 2.5 V6 M15 2.5 V6 M9 18 V21.5 M15 18 V21.5 M2.5 9 H6 M2.5 15 H6 M18 9 H21.5 M18 15 H21.5" />
          <circle cx="12" cy="12" r="2" />
        </Line>
      );
    case 'finance':
      return (
        <Line {...p}>
          <path d="M3 19 H21 M5 16 V11 M10 16 V7 M15 16 V9.5 M20 16 V4.5" />
        </Line>
      );
    case 'contract':
      return (
        <Line {...p}>
          <path d="M6 2.5 H14.5 L19 7 V21.5 H6 Z" />
          <path d="M14.5 2.5 V7 H19 M9 11.5 H16 M9 15 H16 M9 18.5 H13" />
        </Line>
      );
    case 'event':
      return (
        <Line {...p}>
          <path d="M13 2.5 L5 13.5 H11.5 L10.5 21.5 L19 10 H12.5 Z" />
        </Line>
      );
    case 'rival':
      return (
        <Line {...p}>
          <path d="M5 21 V4 M5 4.5 H17 L14.5 8.5 L17 12.5 H5" />
        </Line>
      );
    case 'news':
    case 'benchmark':
      return (
        <Line {...p}>
          <path d="M4 5 H17 V19 A2 2 0 0 1 15 21 H6 A2 2 0 0 1 4 19 Z" />
          <path d="M17 9 H20 V19 A2 2 0 0 1 18 21 M7.5 9 H13.5 M7.5 12.5 H13.5 M7.5 16 H11" />
        </Line>
      );
  }
}

// ---------- Итог контрактов за месяц ----------

const DONE_MARK = 'Выполнен: ';
const WON_MARK = 'Выигран: ';

export interface DigestRow {
  status: 'done' | 'won';
  client: string;
  detail: string;
  /** Сумма из строки: оплата или будущая оплата. */
  money: string | null;
}

/** Строки итога контрактов (sim/contracts.contractDigest): «Выполнен: Клиент. ...» и «Выигран: Клиент. ...». */
export function parseDigest(body: string): DigestRow[] | null {
  const lines = body.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0 || !lines.every((l) => l.startsWith(DONE_MARK) || l.startsWith(WON_MARK))) return null;
  return lines.map((line) => {
    const status = line.startsWith(DONE_MARK) ? 'done' : 'won';
    const rest = line.slice(status === 'done' ? DONE_MARK.length : WON_MARK.length);
    const dot = rest.indexOf('. ');
    const client = dot >= 0 ? rest.slice(0, dot) : rest;
    const detail = dot >= 0 ? rest.slice(dot + 2) : '';
    const money = detail.match(/(?:оплата|Оплата)[^$]*(\$\d+(?:,\d+)?(?: (?:тыс\.|млн|млрд))?)/)?.[1] ?? null;
    return { status, client, detail, money };
  });
}

/** «$1,2 млн» → 1 200 000; null - не сумма. */
export function parseMoney(text: string): number | null {
  const m = text.match(/^\$(\d+(?:,\d+)?)(?: (тыс\.|млн|млрд))?$/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  const k = m[2] === 'тыс.' ? 1e3 : m[2] === 'млн' ? 1e6 : m[2] === 'млрд' ? 1e9 : 1;
  return v * k;
}

function Digest({ rows }: { rows: DigestRow[] }) {
  const done = rows.filter((r) => r.status === 'done');
  const won = rows.filter((r) => r.status === 'won');
  const paid = done.reduce((sum, r) => sum + (r.money ? (parseMoney(r.money) ?? 0) : 0), 0);
  return (
    <div className="mail-digest">
      <div className="mail-digest-sum">
        <div>
          <span>Выполнено</span>
          <b>{fmtNum(done.length)}</b>
        </div>
        <div>
          <span>Выиграно тендеров</span>
          <b>{fmtNum(won.length)}</b>
        </div>
        <div className="paid">
          <span>Получено</span>
          <b>{paid > 0 ? fmtMoney(paid) : '-'}</b>
        </div>
      </div>
      <div className="mail-digest-rows">
        {rows.map((r, i) => (
          <div key={i} className={`mail-digest-row ${r.status}`}>
            <span className="st">{r.status === 'done' ? 'Выполнен' : 'Выигран'}</span>
            <span className="who">
              <b>{r.client}</b>
              <small>{r.detail}</small>
            </span>
            <span className="money">
              {r.money ? (
                <>
                  {r.status === 'done' ? '+' : ''}
                  {r.money}
                  <small>{r.status === 'done' ? 'получено' : 'после сдачи'}</small>
                </>
              ) : (
                '-'
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Окно ----------

export default function MailWindow({ s }: WindowProps) {
  const [folder, setFolder] = useState<FolderId>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [detail, setDetail] = useState(false); // телефон: письмо открыто на весь экран

  // «Открыть» в уведомлении просит показать конкретное письмо: сбрасываем папку и выбираем его.
  const focusId = store.mailFocus;
  useEffect(() => {
    if (!focusId) return;
    const m = s.mail.find((x) => x.id === focusId);
    store.mailFocus = null;
    if (!m) return;
    setFolder('all');
    setPicked(m.id);
    setDetail(true);
    if (!m.read && !awaitsDecision(m)) store.dispatch(actions.markMailRead, m.id);
  }, [focusId, s]);

  // sim меняет s.mail на месте, поэтому список строится на каждом рендере, без мемоизации.
  const sorted = s.mail
    .slice()
    .reverse() // внутри одного дня новые письма стоят позже в массиве
    .sort((a, b) => b.day - a.day); // сортировка стабильная: порядок внутри дня сохраняется
  const current = FOLDERS.find((f) => f.id === folder) ?? FOLDERS[0];
  const filtered = sorted.filter(current.match);
  const list = filtered.slice(0, MAX_LIST);
  const hidden = filtered.length - list.length;

  // Без выбора открыто самое новое письмо папки. Оно остаётся непрочитанным, пока игрок не нажмёт на него:
  // иначе забытое окно гасило бы счётчик новых писем на рабочем столе.
  const selected = list.find((m) => m.id === picked) ?? list[0];

  function pick(m: Mail) {
    setPicked(m.id);
    setDetail(true);
    if (!m.read) store.dispatch(actions.markMailRead, m.id);
  }

  const unread = unreadCount(s);
  // «Отметить все прочитанными» не трогает письма, которые ждут решения (так же работает sim).
  const markable = s.mail.filter((m) => !m.read && !awaitsDecision(m)).length;
  const markAllTitle = markable > 0 ? undefined : unread === 0 ? 'Непрочитанных писем нет' : 'Остались только письма, которые ждут решения';

  return (
    <div className={`mail${detail ? ' show-detail' : ''}`}>
      <nav className="mail-rail" aria-label="Папки">
        {FOLDERS.map((f) => {
          const inFolder = sorted.filter(f.match);
          // У «Нужно решение» счётчик - все письма без ответа, у остальных - непрочитанные.
          const n = f.id === 'decide' ? inFolder.length : inFolder.filter((m) => !m.read).length;
          if (f.id === 'decide' && n === 0 && folder !== 'decide') return null;
          return (
            <button
              key={f.id}
              type="button"
              className={`mail-folder f-${f.id}${f.id === folder ? ' on' : ''}`}
              aria-current={f.id === folder ? 'true' : undefined}
              title={f.label}
              onClick={() => {
                setFolder(f.id);
                setPicked(null);
              }}
            >
              <Glyph kind={f.id} size={18} />
              <span className="mail-folder-l">{f.label}</span>
              {n > 0 && <span className="mail-folder-n">{fmtNum(n)}</span>}
            </button>
          );
        })}
        <span className="grow" />
        <button
          type="button"
          className="mail-markall"
          title={markAllTitle}
          disabled={markable === 0}
          onClick={() => store.dispatch(actions.markAllRead)}
        >
          Отметить все прочитанными
        </button>
      </nav>

      <aside className="mail-side">
        <div className="mail-head">
          <span className="mail-head-t">{current.label}</span>
          <span className="mail-head-n">
            {fmtNum(filtered.length)}
            {unread > 0 && folder === 'all' && <span className="mail-unread"> · новых {fmtNum(unread)}</span>}
          </span>
        </div>
        <div className="mail-list">
          {list.length === 0 && <div className="mail-empty">{s.mail.length === 0 ? 'Писем нет' : 'В этой папке писем нет'}</div>}
          {list.map((m) => {
            const decide = awaitsDecision(m);
            return (
              <button
                key={m.id}
                type="button"
                className={`mail-row k-${m.kind}${m.reward ? ' reward' : ''}${decide ? ' decide' : ''}${m.id === selected?.id ? ' is-selected' : ''}${m.read ? '' : ' unread'}`}
                aria-current={m.id === selected?.id ? 'true' : undefined}
                onClick={() => pick(m)}
              >
                <span className="mail-row-ic">
                  <Glyph kind={decide ? 'decide' : m.reward ? 'reward' : m.kind} size={16} />
                </span>
                <span className="mail-row-main">
                  <span className="mail-row-title" title={m.title}>
                    {m.title}
                  </span>
                  <span className="mail-row-meta">
                    {decide ? (
                      <span className="mail-row-note">Ответить до {formatDateShort(m.replyByDay ?? m.day)}</span>
                    ) : (
                      <span>{KIND_NAME[m.kind]}</span>
                    )}
                    <span className="mail-row-date">{formatDateShort(m.day)}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {hidden > 0 && (
            <div className="mail-more">
              Показаны последние {fmtNum(MAX_LIST)}. Старых писем скрыто: {fmtNum(hidden)}.
            </div>
          )}
        </div>
      </aside>

      <button type="button" className="btn m-back" onClick={() => setDetail(false)}>
        <IconChevronLeft size={14} />
        К списку
      </button>
      {selected ? <MailView key={selected.id} mail={selected} /> : <div className="mail-view-empty">Письмо не выбрано</div>}
    </div>
  );
}

function Body({ text }: { text: string }): ReactNode {
  const digest = parseDigest(text);
  if (digest) return <Digest rows={digest} />;
  return (
    <div className="mail-body">
      {text
        .split('\n')
        .filter((p) => p.trim() !== '')
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
    </div>
  );
}

function MailView({ mail }: { mail: Mail }) {
  const decided = mail.chosen !== undefined;
  const choice = decided ? mail.choices?.[mail.chosen as number] : undefined;
  const reply = replyLine(mail);
  const decide = awaitsDecision(mail);
  return (
    <article className={`mail-view k-${mail.kind}${mail.reward ? ' reward' : ''}${decide ? ' decide' : ''}`}>
      <div className="mail-sheet">
        <header className="mail-letterhead">
          <span className="mail-kicker">
            <span className="mail-kicker-ic">
              <Glyph kind={mail.kind} size={15} />
            </span>
            {KIND_NAME[mail.kind]}
          </span>
          {mail.reward && <span className="mail-ribbon">Награда</span>}
          <span className="mail-date">{formatDate(mail.day)}</span>
        </header>
        <h2 className="mail-title">{mail.title}</h2>
        <Body text={mail.body} />
        {mail.choices && (
          <div className="mail-decision">
            {decided ? (
              <>
                <div className="mail-decided">
                  Решение: <b>{choice?.label ?? '-'}</b>
                </div>
                {choice && <div className="mail-decision-hint">{choice.hint}</div>}
                {mail.outcome && (
                  <div className={`mail-outcome ${mail.outcome.lucky ? 'good' : 'bad'}`}>
                    {mail.outcome.lucky ? 'Повезло' : 'Не повезло'}: {mail.outcome.text}
                  </div>
                )}
                {mail.autoChosen && <div className="mail-decision-hint">Срок ответа истёк, вариант выбран по умолчанию.</div>}
              </>
            ) : (
              <>
                <h3 className="mail-decision-h">Нужно решение</h3>
                <ChoiceList mail={mail} />
                {reply && <div className="mail-decision-hint">{reply}</div>}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
