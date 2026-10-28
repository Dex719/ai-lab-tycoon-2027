// Окно «Продукты» (идея «Продукты», 18.10): свои сервисы лаборатории. Переводчик 2017-2020 (sim/translator.ts) и
// ИИ-программист с июля 2021 года (sim/products.ts). У программиста запуск - выбор из трёх способов, после запуска -
// места, выручка в день, сколько заработал и качество против лучшего соперника по коду.

import { useState } from 'react';
import type { WindowProps } from '.';
import {
  CODER_LAUNCH,
  CODER_LAUNCH_IDS,
  CODER_PRICE,
  coderBlock,
  coderPerDay,
  coderQuality,
  coderTarget,
  coderVisible,
  showCost,
} from '../../sim/products';
import { dateToDay, formatDateShort } from '../../sim/time';
import { TRANSLATOR_LAST_LAUNCH, translatorBlock, translatorPerDay } from '../../sim/translator';
import type { CoderLaunch, GameState } from '../../sim/types';
import { ErrorText, GuardButton } from '../components/common';
import { fmtInt, fmtMoney } from '../format';
import { actions, store } from '../store';
import './ProductsWindow.css';

function Fig({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="pw-fig">
      <span className="pw-fig-l">{label}</span>
      <span className="pw-fig-v">{value}</span>
      {note && <span className="pw-fig-s">{note}</span>}
    </div>
  );
}

function translatorShown(s: GameState): boolean {
  return s.translator !== undefined || s.day < dateToDay(TRANSLATOR_LAST_LAUNCH);
}

function Translator({ s }: { s: GameState }) {
  const [err, setErr] = useState<string | null>(null);
  const block = translatorBlock(s);
  return (
    <section className="pw-card">
      <div className="pw-head">
        <h3 className="pw-h">Переводчик</h3>
        <span className={`pw-state${s.translator ? ' on' : ''}`}>{s.translator ? 'Работает' : 'Не запущен'}</span>
      </div>
      <p
        className="pw-note"
        title="Выручка растёт с Эло модели. После 2020 года переводы уходят в API: новый сервис открыть нельзя, старый зарабатывает всё меньше."
      >
        Сервис перевода на лучшей модели лаборатории.
      </p>
      {s.translator ? (
        <div className="pw-figs">
          <Fig label="В день" value={fmtMoney(translatorPerDay(s))} />
          <Fig label="Заработал" value={fmtMoney(s.translator.earned)} />
          <Fig label="Работает с" value={formatDateShort(s.translator.launchedDay)} />
        </div>
      ) : (
        <div className="pw-act">
          <span className="pw-act-s">Сейчас было бы около {fmtMoney(translatorPerDay(s))} в день</span>
          <GuardButton
            className="btn primary"
            reason={block}
            onClick={() => {
              const r = store.dispatch(actions.launchTranslator);
              setErr(r.ok ? null : r.error);
            }}
          >
            Запустить переводчик
          </GuardButton>
          <ErrorText error={err} />
        </div>
      )}
    </section>
  );
}

function qualityNote(q: number): string {
  if (q >= 1.15) return 'лучше соперников';
  if (q >= 0.9) return 'как у соперников';
  return 'слабее соперников';
}

function Coder({ s }: { s: GameState }) {
  const [mode, setMode] = useState<CoderLaunch>('beta');
  const [err, setErr] = useState<string | null>(null);
  const c = s.coder;
  const q = coderQuality(s);
  return (
    <section className="pw-card">
      <div className="pw-head">
        <h3 className="pw-h">ИИ-программист</h3>
        <span className={`pw-state${c ? ' on' : ''}`}>
          {!c ? 'Не запущен' : s.day < c.openDay ? `Лист ожидания до ${formatDateShort(c.openDay)}` : c.mode === 'beta' && s.day < c.openDay + 60 ? 'Тихая бета' : 'Работает'}
        </span>
      </div>
      <p
        className="pw-note"
        title="Мест тем больше, чем сильнее лучшая модель по коду против лучшего соперника. Мощности сервис не берёт."
      >
        Помощник в редакторе кода: подписка для разработчиков, ${CODER_PRICE} за место в месяц.
      </p>
      {c ? (
        <div className="pw-figs">
          <Fig label="Мест" value={fmtInt(c.seats)} note={`цель сейчас ${fmtInt(coderTarget(s))}`} />
          <Fig label="В день" value={fmtMoney(coderPerDay(s))} />
          <Fig label="Заработал" value={fmtMoney(c.earned)} />
          <Fig label="Качество" value={`×${String(Math.round(q * 100) / 100).replace('.', ',')}`} note={qualityNote(q)} />
        </div>
      ) : (
        <div className="pw-launch">
          <div className="pw-lbl">Как запустить</div>
          <div className="pw-opts" role="radiogroup" aria-label="Способ запуска">
            {CODER_LAUNCH_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                className={`pw-opt${mode === id ? ' on' : ''}`}
                onClick={() => setMode(id)}
              >
                <span className="pw-opt-t">
                  {CODER_LAUNCH[id].name}
                  {id === 'show' && <span className="pw-opt-c">, {fmtMoney(showCost(s))}</span>}
                </span>
                <span className="pw-opt-s">{CODER_LAUNCH[id].text}</span>
              </button>
            ))}
          </div>
          <div className="pw-act">
            <span className="pw-act-s">
              Качество сейчас ×{String(Math.round(q * 100) / 100).replace('.', ',')}, {qualityNote(q)}
            </span>
            <GuardButton
              className="btn primary"
              reason={coderBlock(s, mode)}
              onClick={() => {
                const r = store.dispatch(actions.launchCoder, mode);
                setErr(r.ok ? null : r.error);
              }}
            >
              Запустить
            </GuardButton>
            <ErrorText error={err} />
          </div>
        </div>
      )}
    </section>
  );
}

export default function ProductsWindow({ s }: WindowProps) {
  const tr = translatorShown(s);
  const coder = coderVisible(s);
  return (
    <div className="pw">
      {coder && <Coder s={s} />}
      {tr && <Translator s={s} />}
      {!tr && !coder && <p className="pw-empty">Новых продуктов пока нет: рынок помощников для кода ещё не сложился.</p>}
    </div>
  );
}
