// Письмо с выбором поверх всего: игра стоит, пока игрок не выберет (FR-1.3, FR-11.3).

import { pendingChoice } from '../sim/events';
import { formatDate } from '../sim/time';
import type { GameState } from '../sim/types';
import { useModalFocus } from './components/common';
import { actions, store } from './store';

export function ChoiceModal({ s }: { s: GameState }) {
  const mail = pendingChoice(s);
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(mail?.id);
  if (!mail || !mail.choices) return null;
  return (
    <div className="modal-backdrop">
      <div ref={ref} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-label={mail.title} onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">{mail.title}</span>
          <span className="small" style={{ fontWeight: 400, color: 'var(--text-dim)' }}>
            {formatDate(mail.day)}
          </span>
        </div>
        <div className="body white" style={{ whiteSpace: 'pre-wrap' }}>
          {mail.body}
        </div>
        <div className="body">
          <div className="choice-list">
            {mail.choices.map((c, i) => (
              <button key={i} className={`btn${i === 0 ? ' primary' : ''}`} onClick={() => store.dispatch(actions.chooseOption, mail.id, i)}>
                <span>{c.label}</span>
                <span className="hint">{c.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
