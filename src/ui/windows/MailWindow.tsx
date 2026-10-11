// Окно «Почта» (FR-11.3): список писем с фильтром по виду, текст выбранного письма, «Прочитать все».

import { useEffect, useState } from 'react';
import type { WindowProps } from '.';
import { unreadCount } from '../../sim/events';
import { formatDate, formatDateShort } from '../../sim/time';
import type { Mail, MailChoice } from '../../sim/types';
import { Empty } from '../components/common';
import { actions, store } from '../store';

const MAX_LIST = 200;

type Kind = Mail['kind'];

const KIND_ICON: Record<Kind, string> = {
  news: '📰',
  event: '❗',
  rival: '🏁',
  research: '🔬',
  training: '🧠',
  contract: '📝',
  finance: '💰',
  benchmark: '📊',
};

const KIND_NAME: Record<Kind, string> = {
  news: 'Новость',
  event: 'Событие',
  rival: 'Соперник',
  research: 'Исследование',
  training: 'Обучение',
  contract: 'Контракт',
  finance: 'Финансы',
  benchmark: 'Бенчмарк',
};

/** Фильтры списка. Новости входят в «События»: отдельной категории для них нет. */
const FILTERS: { id: string; label: string; kinds: Kind[] | null }[] = [
  { id: 'all', label: 'Все', kinds: null },
  { id: 'events', label: 'События', kinds: ['event', 'news'] },
  { id: 'rivals', label: 'Соперники', kinds: ['rival'] },
  { id: 'contracts', label: 'Контракты', kinds: ['contract'] },
  { id: 'research', label: 'Исследования и обучение', kinds: ['research', 'training'] },
  { id: 'finance', label: 'Финансы', kinds: ['finance'] },
  { id: 'benchmarks', label: 'Бенчмарки', kinds: ['benchmark'] },
];

const SELECTED_BG = 'rgba(78, 161, 255, 0.22)';

export default function MailWindow({ s }: WindowProps) {
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState<string | null>(null);

  // sim меняет s.mail на месте, поэтому список строим на каждом рендере, а не мемоизируем.
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const list = s.mail
    .slice()
    .reverse() // внутри одного дня новые письма идут позже в массиве
    .sort((a, b) => b.day - a.day) // сортировка стабильная: порядок внутри дня сохраняется
    .filter((m) => !kinds || kinds.includes(m.kind));
  // К концу игры писем сотни: показываем последние MAX_LIST, чтобы окно не тормозило на каждом тике.
  const hidden = Math.max(0, list.length - MAX_LIST);
  if (hidden > 0) list.length = MAX_LIST;
  // По умолчанию открыто самое новое письмо из текущего фильтра.
  const selected: Mail | undefined = list.find((m) => m.id === picked) ?? list[0];

  // Открытое письмо, в том числе выбранное по умолчанию, становится прочитанным.
  const selId = selected?.id;
  const selRead = selected?.read;
  useEffect(() => {
    if (selId !== undefined && selRead === false) store.dispatch(actions.markMailRead, selId);
  }, [selId, selRead]);

  const unread = unreadCount(s);
  // «Прочитать все» не трогает письма с выбором, которые ещё ждут решения (как в sim).
  const markable = s.mail.filter((m) => !m.read && (!m.choices || m.chosen !== undefined)).length;
  const markAllTitle =
    unread === 0
      ? 'Непрочитанных писем нет'
      : markable === 0
        ? 'Остались только письма, ждущие решения'
        : 'Отметить все письма прочитанными';

  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="row">
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPicked(null);
          }}
          aria-label="Категория писем"
        >
          {FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="grow" />
        <span className="muted small">Непрочитанных: {unread}</span>
        <button className="btn" disabled={markable === 0} title={markAllTitle} onClick={() => store.dispatch(actions.markAllRead)}>
          Прочитать все
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
        <div
          style={{ width: 250, flex: 'none', overflow: 'auto', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-input)' }}
        >
          {list.length === 0 ? (
            <Empty>{s.mail.length === 0 ? 'Писем пока нет.' : 'В этой категории писем нет.'}</Empty>
          ) : (
            <table className="grid">
              <tbody>
                {list.map((m) => {
                  const on = m.id === selected?.id;
                  const bg = on ? SELECTED_BG : undefined;
                  return (
                    <tr
                      key={m.id}
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setPicked(m.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setPicked(m.id)}
                    >
                      <td style={{ background: bg, width: 28 }} title={KIND_NAME[m.kind]}>
                        {KIND_ICON[m.kind]}
                      </td>
                      <td className="small" style={{ background: bg, fontWeight: m.read ? 400 : 700, color: m.read ? 'var(--text-dim)' : undefined }}>
                        {formatDateShort(m.day)}
                      </td>
                      <td style={{ background: bg, fontWeight: m.read ? 400 : 700, whiteSpace: 'normal' }}>{m.title}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {hidden > 0 && <div className="muted small" style={{ padding: 6 }}>Ещё {hidden} старых писем не показано.</div>}
        </div>

        <div className="card" style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {selected ? <MailView mail={selected} /> : <div className="muted">Выберите письмо слева.</div>}
        </div>
      </div>

      <div className="muted small">
        Непрочитанные письма выделены жирным. Письма с выбором открываются поверх окон: игра стоит, пока вы не выберете вариант.
      </div>
    </div>
  );
}

function MailView({ mail }: { mail: Mail }) {
  return (
    <div className="col">
      <div>
        <div className="section-title" style={{ marginBottom: 2 }}>
          {mail.title}
        </div>
        <div className="muted small">
          {formatDate(mail.day)} · {KIND_NAME[mail.kind]}
        </div>
      </div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{mail.body}</div>
      {mail.choices && <Decision mail={mail} choices={mail.choices} />}
    </div>
  );
}

function Decision({ mail, choices }: { mail: Mail; choices: MailChoice[] }) {
  if (mail.chosen !== undefined) {
    return <div className="good">Ваш выбор: {choices[mail.chosen]?.label ?? '—'}</div>;
  }
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="warn">Решение ждёт: окно с вариантами открыто поверх рабочего стола. Игра стоит, пока вы не выберете.</div>
      {choices.map((c, i) => (
        <div key={i} className="small">
          <b>{c.label}</b> <span className="muted">— {c.hint}</span>
        </div>
      ))}
    </div>
  );
}
