// Окно «Почта»: слева список писем с фильтром, справа текст выбранного письма.
// Письмо становится прочитанным, только когда игрок нажал на него в списке.

import { useState } from 'react';
import type { WindowProps } from '.';
import { unreadCount } from '../../sim/events';
import { ChoiceList, replyLine } from '../ChoiceModal';
import { formatDate, formatDateShort } from '../../sim/time';
import type { Mail } from '../../sim/types';
import { fmtNum } from '../format';
import { actions, store } from '../store';
import './MailWindow.css';

/** Сколько последних писем показывает список. */
const MAX_LIST = 200;

type Kind = Mail['kind'];

const KIND_NAME: Record<Kind, string> = {
  news: 'Новости',
  event: 'События',
  rival: 'Соперники',
  research: 'Исследования',
  training: 'Обучение',
  contract: 'Контракты',
  finance: 'Финансы',
  benchmark: 'Бенчмарки',
};

const FILTERS: { id: string; label: string; kinds: Kind[] | null }[] = [
  { id: 'all', label: 'Все', kinds: null },
  { id: 'event', label: 'События', kinds: ['event'] },
  { id: 'rival', label: 'Соперники', kinds: ['rival'] },
  { id: 'contract', label: 'Контракты', kinds: ['contract'] },
  { id: 'research', label: 'Исследования и обучение', kinds: ['research', 'training'] },
  { id: 'finance', label: 'Финансы', kinds: ['finance'] },
  { id: 'benchmark', label: 'Бенчмарки', kinds: ['benchmark'] },
  { id: 'news', label: 'Новости', kinds: ['news'] },
];

/** Письмо с вариантами, на которые игрок ещё не ответил. */
function awaitsDecision(m: Mail): boolean {
  return !!m.choices && m.chosen === undefined;
}

export default function MailWindow({ s }: WindowProps) {
  const [filter, setFilter] = useState('all');
  const [picked, setPicked] = useState<string | null>(null);

  // sim меняет s.mail на месте, поэтому список строится на каждом рендере, без мемоизации.
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const filtered = s.mail
    .slice()
    .reverse() // внутри одного дня новые письма стоят позже в массиве
    .sort((a, b) => b.day - a.day) // сортировка стабильная: порядок внутри дня сохраняется
    .filter((m) => !kinds || kinds.includes(m.kind));
  const list = filtered.slice(0, MAX_LIST);
  const hidden = filtered.length - list.length;

  // Без выбора открыто самое новое письмо из фильтра. Оно остаётся непрочитанным, пока игрок не нажмёт на него:
  // иначе забытое окно гасило бы счётчик новых писем на рабочем столе.
  const selected = list.find((m) => m.id === picked) ?? list[0];

  function pick(m: Mail) {
    setPicked(m.id);
    if (!m.read) store.dispatch(actions.markMailRead, m.id);
  }

  const unread = unreadCount(s);
  // «Отметить все прочитанными» не трогает письма, которые ждут решения (так же работает sim).
  const markable = s.mail.filter((m) => !m.read && !awaitsDecision(m)).length;
  const markAllTitle =
    markable > 0 ? undefined : unread === 0 ? 'Непрочитанных писем нет' : 'Остались только письма, которые ждут решения';

  return (
    <div className="mail">
      <aside className="mail-side">
        <div className="mail-head">
          <div className="mail-count">
            <span>Писем: {fmtNum(s.mail.length)}</span>
            {unread > 0 && <span className="mail-unread">Непрочитанных: {fmtNum(unread)}</span>}
          </div>
          <div className="mail-filter">
            <label htmlFor="mail-filter">Фильтр</label>
            <select id="mail-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
              {FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mail-list">
          {list.length === 0 && <div className="mail-empty">{s.mail.length === 0 ? 'Писем нет' : 'В этой категории писем нет'}</div>}
          {list.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`mail-row${m.id === selected?.id ? ' is-selected' : ''}${m.read ? '' : ' unread'}`}
              aria-current={m.id === selected?.id ? 'true' : undefined}
              onClick={() => pick(m)}
            >
              <span className="mail-row-title" title={m.title}>
                {m.title}
              </span>
              <span className="mail-row-date">{formatDateShort(m.day)}</span>
              {awaitsDecision(m) && <span className="mail-row-note">Нужно решение до {formatDateShort(m.replyByDay ?? m.day)}</span>}
            </button>
          ))}
          {hidden > 0 && (
            <div className="mail-more">
              Показаны последние {fmtNum(MAX_LIST)}. Старых писем скрыто: {fmtNum(hidden)}.
            </div>
          )}
        </div>

        <div className="mail-foot" title={markAllTitle}>
          <button type="button" className="btn wide" disabled={markable === 0} onClick={() => store.dispatch(actions.markAllRead)}>
            Отметить все прочитанными
          </button>
        </div>
      </aside>

      {selected ? <MailView key={selected.id} mail={selected} /> : <div className="mail-view-empty">Письмо не выбрано</div>}
    </div>
  );
}

function MailView({ mail }: { mail: Mail }) {
  const decided = mail.chosen !== undefined;
  const choice = decided ? mail.choices?.[mail.chosen as number] : undefined;
  const reply = replyLine(mail);
  return (
    <article className="mail-view">
      <h2 className="mail-title">{mail.title}</h2>
      <div className="mail-meta">
        <span>{KIND_NAME[mail.kind]}</span>
        <span>{formatDate(mail.day)}</span>
      </div>
      <div className="mail-body">{mail.body}</div>
      {mail.choices && (
        <div className="mail-decision">
          {decided ? (
            <>
              <div>
                Решение: <b>{choice?.label ?? '-'}</b>
              </div>
              {choice && <div className="mail-decision-hint">{choice.hint}</div>}
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
    </article>
  );
}
