// Окно «Модели» (FR-4.4, FR-8.1, FR-7.3): список моделей игрока, баллы, выпуск, цена и продажа.

import { useState } from 'react';
import type { WindowProps } from '.';
import { benchDef, introducedBenchmarks } from '../../sim/benchmarks';
import { pool } from '../../sim/compute';
import { refPrice } from '../../sim/market';
import { modelScore } from '../../sim/training';
import type { BenchmarkId, GameState, PlayerModel } from '../../sim/types';
import { Empty, ErrorText } from '../components/common';
import { fmtElo, fmtNum, fmtParams, fmtPct, fmtPrice, fmtShare } from '../format';
import { actions, store } from '../store';

const MAX_PRICE = 10_000;
const BASE_COLS = 7; // название, статус, параметры, Эло, цена, доля, токены в день

/** Опорная цена рынка; null, если сим-модуль не смог её посчитать. */
function safeRefPrice(day: number): number | null {
  try {
    const p = refPrice(day);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Цена по умолчанию при выпуске: 80 % от опорной цены рынка, запасной вариант — $20. */
function defaultPrice(day: number): number {
  try {
    const p = Math.round(refPrice(day) * 0.8 * 100) / 100;
    return Number.isFinite(p) && p > 0 ? p : 20;
  } catch {
    return 20;
  }
}

function parsePrice(text: string): number | null {
  const v = Number(text.replace(',', '.').trim());
  return Number.isFinite(v) && v > 0 && v <= MAX_PRICE ? v : null;
}

function relativeToRef(price: number, ref: number): string {
  const rel = (price / ref - 1) * 100;
  const sign = Math.round(rel) > 0 ? '+' : Math.round(rel) < 0 ? '−' : '';
  return `${sign}${fmtPct(Math.abs(rel), 0)}`;
}

// ---------- Ячейки ----------

function StatusCell({ m }: { m: PlayerModel }) {
  let text = 'Обучена — не выпущена';
  let cls = 'muted';
  if (m.releasedDay !== null) {
    if (m.onApi) {
      text = 'В продаже';
      cls = 'good';
    } else {
      text = 'Снята с продажи';
      cls = 'warn';
    }
  }
  return (
    <td>
      <span className={cls}>{text}</span>
      {m.exposed && <div className="bad small">⚠ подгонка раскрыта</div>}
    </td>
  );
}

function ScoreCell({ m, bid, saturated }: { m: PlayerModel; bid: BenchmarkId; saturated: boolean }) {
  const cls = `num${saturated ? ' dim' : ''}`;
  const shown = modelScore(m, bid, false);
  if (!((m.overfit[bid] ?? 0) > 0)) return <td className={cls}>{fmtPct(shown)}</td>;
  const honest = modelScore(m, bid, true);
  return (
    <td className={cls} title={`честный балл: ${fmtPct(honest)}`}>
      {fmtPct(shown)}
      {m.exposed ? <span className="bad"> ⚠</span> : <span className="muted">*</span>}
    </td>
  );
}

// ---------- Действия над моделью ----------

function ModelActions({ s, m }: { s: GameState; m: PlayerModel }) {
  const released = m.releasedDay !== null;
  const [text, setText] = useState<string | null>(null); // null — показываем цену по умолчанию или текущую
  const [err, setErr] = useState<string | null>(null);

  const shown = text ?? String(released ? m.price : defaultPrice(s.day));
  const price = parsePrice(shown);
  const ref = safeRefPrice(s.day);
  const priceHint =
    price === null
      ? shown.trim() === ''
        ? 'Введите цену за 1 млн токенов.'
        : `Цена должна быть больше нуля и не выше ${fmtPrice(MAX_PRICE)} за 1 млн токенов.`
      : null;

  function done(r: { ok: true } | { ok: false; error: string }) {
    if (r.ok) {
      setErr(null);
      setText(null);
    } else {
      setErr(r.error);
    }
  }

  function release() {
    if (price === null) return;
    done(store.dispatch(actions.releaseModel, m.id, price));
  }

  function changePrice() {
    if (price === null) return;
    done(store.dispatch(actions.setModelPrice, m.id, price));
  }

  function toggleSale() {
    done(store.dispatch(actions.setOnApi, m.id, !m.onApi));
  }

  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row">
        <span className="muted">{released ? 'Цена:' : 'Цена выпуска:'}</span>
        <span className="muted">$</span>
        <input
          type="number"
          min={0}
          step="any"
          value={shown}
          onChange={(e) => setText(e.target.value)}
          title="Цена за 1 млн токенов, в долларах"
          aria-invalid={price === null}
          style={price === null ? { borderColor: 'var(--bad)' } : undefined}
        />
        <span className="muted small">за 1 млн токенов</span>
        {price !== null && ref !== null && (
          <span className="muted small">({relativeToRef(price, ref)} к опорной цене {fmtPrice(ref)})</span>
        )}
        {!released ? (
          <button className="btn primary small" disabled={price === null} title={priceHint ?? undefined} onClick={release}>
            Выпустить
          </button>
        ) : (
          <>
            <button
              className="btn small"
              disabled={price === null || price === m.price}
              title={priceHint ?? (price === m.price ? 'Цена не изменилась' : undefined)}
              onClick={changePrice}
            >
              Изменить цену
            </button>
            <button className={`btn small${m.onApi ? ' danger' : ''}`} onClick={toggleSale}>
              {m.onApi ? 'Снять с продажи' : 'Вернуть в продажу'}
            </button>
          </>
        )}
      </div>
      {!released && (
        <div className="muted small">
          Выпуск открывает продажу по API и даёт шумиху. Цена по умолчанию — 80 % от опорной цены рынка.
        </div>
      )}
      {priceHint && <div className="error">{priceHint}</div>}
      <ErrorText error={err} />
    </div>
  );
}

// ---------- Строки таблицы ----------

function ModelRows({ s, m, benches }: { s: GameState; m: PlayerModel; benches: BenchmarkId[] }) {
  const released = m.releasedDay !== null;
  const onSale = released && m.onApi;
  const share: number | undefined = onSale ? s.market.shares[`player:${m.id}`] : undefined;
  const tokens = share !== undefined ? share * s.market.totalTokens * (1 - s.market.lostFraction) : undefined;

  return (
    <>
      <tr>
        <td>
          <b>{m.name}</b>
          <div className="muted small">
            {m.arch === 'transformer' ? 'Трансформер' : 'LSTM'}
            {m.rlhf && ' · RLHF'}
          </div>
        </td>
        <StatusCell m={m} />
        <td className="num">{fmtParams(m.plan.paramsB)}</td>
        <td className="num" title="Рейтинг на «Арене»: подгонкой под тесты его не накрутить">{fmtElo(m.arenaElo)}</td>
        {benches.map((b) => (
          <ScoreCell key={b} m={m} bid={b} saturated={s.benchmarks[b].saturated} />
        ))}
        <td className={`num${onSale ? '' : ' muted'}`}>{released ? fmtPrice(m.price) : '—'}</td>
        <td className="num">{share !== undefined ? fmtShare(share) : '—'}</td>
        <td className="num">{tokens !== undefined ? fmtNum(tokens) : '—'}</td>
      </tr>
      <tr>
        <td colSpan={BASE_COLS + benches.length} style={{ paddingTop: 2, paddingBottom: 10 }}>
          <ModelActions s={s} m={m} />
        </td>
      </tr>
    </>
  );
}

// ---------- Окно ----------

export default function ModelsWindow({ s, open }: WindowProps) {
  if (s.models.length === 0) {
    return (
      <div className="col">
        <Empty>У вас пока нет моделей. Обучите первую в окне «Обучение»: после завершения она появится здесь.</Empty>
        <div>
          <button className="btn primary" onClick={() => open('training')}>Открыть «Обучение»</button>
        </div>
      </div>
    );
  }

  const models = [...s.models].reverse(); // новые сверху
  const benches = introducedBenchmarks(s);
  const ref = safeRefPrice(s.day);
  const anyOnSale = s.models.some((m) => m.releasedDay !== null && m.onApi);
  const anyOverfit = s.models.some((m) => Object.values(m.overfit).some((v) => (v ?? 0) > 0));
  const noInference = pool(s, 'inference') <= 0;
  const lost = s.market.lostFraction;

  return (
    <div className="col">
      <div className="muted small">
        Цена — в долларах за 1 млн токенов{ref !== null && <>; опорная цена рынка сейчас {fmtPrice(ref)}</>}. Дешевле — больше доли рынка,
        но каждый токен клиента тратит вычисления из доли «Клиенты»; если их не хватает, часть спроса теряется, а шумиха падает.
      </div>

      {anyOnSale && noInference && (
        <div className="row">
          <span className="warn small">Доля «Клиенты» равна нулю: модели в продаже никого не обслуживают.</span>
          <button className="btn small" onClick={() => open('compute')}>Открыть «Мощности»</button>
        </div>
      )}
      {anyOnSale && !noInference && lost > 0.01 && (
        <div className="warn small">Мощности «Клиенты» не хватает: теряется {fmtShare(lost, 0)} спроса, шумиха падает.</div>
      )}

      <table className="grid">
        <thead>
          <tr>
            <th>Модель</th>
            <th>Статус</th>
            <th className="num">Параметры</th>
            <th className="num" title="Рейтинг на «Арене»">Эло</th>
            {benches.map((b) => {
              const def = benchDef(b);
              const saturated = s.benchmarks[b].saturated;
              return (
                <th key={b} className={`num${saturated ? ' dim' : ''}`} title={saturated ? `${def.description} Тест насыщен: больше не влияет на шумиху.` : def.description}>
                  {def.name}
                </th>
              );
            })}
            <th className="num">Цена за 1М</th>
            <th className="num">Доля рынка</th>
            <th className="num" title="Сколько токенов в день обслуживает модель">Токенов в день</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <ModelRows key={m.id} s={s} m={m} benches={benches} />
          ))}
        </tbody>
      </table>

      {anyOverfit && (
        <div className="muted small">
          * — балл завышен подгонкой под тест: наведите курсор на число, чтобы увидеть честный балл. ⚠ — подгонка раскрыта, показаны честные баллы.
        </div>
      )}
    </div>
  );
}
