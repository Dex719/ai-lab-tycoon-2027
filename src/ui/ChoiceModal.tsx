// Письмо с выбором поверх всего. Игра стоит, пока игрок не выберет вариант или не отложит решение.
// Отложенное письмо ждёт ответа в «Почте»; если срок истечёт, сработает вариант по умолчанию.

import { pendingChoice } from '../sim/events';
import { formatDate, formatDateShort } from '../sim/time';
import type { GameState, Mail } from '../sim/types';
import { useModalFocus } from './components/common';
import { IconClose } from './icons';
import { actions, store } from './store';

/** «Ответить до 12.07.2017. Без ответа: «Оставить в секрете».» */
export function replyLine(mail: Mail): string | null {
  if (mail.replyByDay === undefined || !mail.choices) return null;
  const fallback = mail.choices[mail.defaultChoice ?? mail.choices.length - 1];
  return `Ответить до ${formatDateShort(mail.replyByDay)}. Без ответа: «${fallback?.label ?? ''}».`;
}

export function ChoiceList({ mail }: { mail: Mail }) {
  if (!mail.choices) return null;
  return (
    <div className="choice-list">
      {mail.choices.map((c, i) => (
        <button key={i} className="choice" onClick={() => store.dispatch(actions.chooseOption, mail.id, i)}>
          <span className="choice-l">{c.label}</span>
          <span className="choice-h">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function ChoiceModal({ s }: { s: GameState }) {
  const mail = pendingChoice(s);
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(mail?.id);
  if (!mail || !mail.choices) return null;
  const later = () => store.dispatch(actions.deferChoice, mail.id);
  const reply = replyLine(mail);
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && later()}>
      <div
        ref={ref}
        tabIndex={-1}
        className="dialog choice-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={mail.title}
        onKeyDown={onKeyDown}
      >
        <div className="titlebar">
          <span className="t">Письмо</span>
          <button className="wbtn close" onClick={later} aria-label="Решить позже" title="Решить позже">
            <IconClose size={14} />
          </button>
        </div>
        <div className="body white">
          <div className="choice-date">{formatDate(mail.day)}</div>
          <h2 className="choice-title">{mail.title}</h2>
          <p className="choice-text">{mail.body}</p>
        </div>
        <div className="body">
          <ChoiceList mail={mail} />
        </div>
        <div className="foot">
          {reply && <span className="choice-reply">{reply}</span>}
          <button className="btn" onClick={later}>
            Решить позже
          </button>
        </div>
      </div>
    </div>
  );
}
