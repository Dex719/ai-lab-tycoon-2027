// Письмо с выбором поверх всего. Игра стоит, пока игрок не выберет вариант или не отложит решение.
// Отложенное письмо ждёт ответа в «Почте»; если срок истечёт, сработает вариант по умолчанию.

import { useEffect, useState } from 'react';
import { pendingChoice } from '../sim/events';
import { formatDate, formatDateShort } from '../sim/time';
import type { GameState, Mail } from '../sim/types';
import { useModalFocus } from './components/common';
import { IconClose } from './icons';
import { actions, store } from './store';
import './choice.css';

/** «Ответить до 12.07.2017. Без ответа: «Оставить в секрете».» */
export function replyLine(mail: Mail): string | null {
  if (mail.replyByDay === undefined || !mail.choices) return null;
  const fallback = mail.choices[mail.defaultChoice ?? mail.choices.length - 1];
  return `Ответить до ${formatDateShort(mail.replyByDay)}. Без ответа: «${fallback?.label ?? ''}».`;
}

type Tone = 'good' | 'bad' | 'flat';

/** Цвет части последствия: «+» зелёный, «-» красный, остальное нейтральное. */
export function hintTone(part: string): Tone {
  const c = part.trimStart().charAt(0);
  if (c === '+') return 'good';
  if (c === '-') return 'bad';
  return 'flat';
}

/** Минус перед числом или суммой внутри части: «репутация -3», «-$100 тыс.», «−1 п.п.». */
const LOSS_NUMBER = /(^|\s)[-−]\s?[\d$]/;

/** Вариант стоит денег, доли или репутации: одна из частей последствия - потеря. Такой выбор идёт через подтверждение. */
export function costlyChoice(hint: string): boolean {
  return hint.split(', ').some((p) => hintTone(p) === 'bad' || LOSS_NUMBER.test(p));
}

/** Выделяет числа жирным: «+15 репутации» -> «+», «15» жирным, « репутации». */
function boldNumbers(text: string) {
  return text.split(/(\d[\d\s.,]*\d|\d)/).map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : p));
}

/** Строка последствий: части через «, », каждая своего цвета. */
export function HintLine({ hint }: { hint: string }) {
  const parts = hint.split(', ');
  return (
    <span className="choice-h">
      {parts.map((p, i) => (
        <span key={i} className={`hp ${hintTone(p)}`}>
          {boldNumbers(p)}
          {i < parts.length - 1 && <span className="hp-sep">, </span>}
        </span>
      ))}
    </span>
  );
}

export function ChoiceList({ mail }: { mail: Mail }) {
  // Вариант с потерей ждёт подтверждения: первый щелчок «Выбрать» включает его, второй - «Подтвердить».
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => {
    setArmed(null);
  }, [mail.id]);
  if (!mail.choices) return null;
  return (
    <div className="choice-list">
      {mail.choices.map((c, i) => {
        const isArmed = armed === i;
        // Выбор - только кнопкой «Выбрать»: раньше кликалась вся карточка, и вариант выбирался случайным щелчком (плейтест 17.10).
        return (
          <div key={i} className={isArmed ? 'choice armed' : 'choice'}>
            <span className="choice-main">
              <span className="choice-l">{c.label}</span>
              {c.story && <span className="choice-s">{c.story}</span>}
              <HintLine hint={c.hint} />
            </span>
            {isArmed ? (
              <span className="choice-acts">
                <button
                  type="button"
                  className="choice-go confirm"
                  aria-label={`Подтвердить: ${c.label}`}
                  onClick={() => {
                    setArmed(null);
                    store.dispatch(actions.chooseOption, mail.id, i);
                  }}
                >
                  Подтвердить
                </button>
                <button type="button" className="choice-go" onClick={() => setArmed(null)}>
                  Отмена
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="choice-go"
                aria-label={`Выбрать: ${c.label}`}
                onClick={() => (costlyChoice(c.hint) ? setArmed(i) : store.dispatch(actions.chooseOption, mail.id, i))}
              >
                Выбрать
              </button>
            )}
          </div>
        );
      })}
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
