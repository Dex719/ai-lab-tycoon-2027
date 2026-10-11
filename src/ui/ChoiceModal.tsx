// Письмо с выбором поверх всего: игра стоит, пока игрок не выберет (FR-1.3, FR-11.3).

import { pendingChoice } from '../sim/events';
import { formatDate } from '../sim/time';
import type { GameState } from '../sim/types';
import { useModalFocus } from './components/common';
import { actions, store } from './store';

export function ChoiceModal({ s }: { s: GameState }) {
  const mail = pendingChoice(s);
  // Остальной интерфейс закрыт (inert в App), фокус внутри окна; на само окно, а не на первый вариант:
  // случайный Enter не должен молча выбирать необратимое решение.
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(mail?.id);
  if (!mail || !mail.choices) return null;
  return (
    <div className="modal-backdrop" key={mail.id}>
      <div className="modal" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={mail.title} onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span>📨</span>
          <span className="t">{mail.title}</span>
          <span className="muted small" style={{ color: '#c9d3de' }}>{formatDate(mail.day)}</span>
        </div>
        <div className="body">{mail.body}</div>
        <div className="choices">
          {mail.choices.map((c, i) => (
            <button key={i} className={`btn choice${i === 0 ? ' primary' : ''}`} onClick={() => store.dispatch(actions.chooseOption, mail.id, i)}>
              {c.label}
              <span className="hint">{c.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
