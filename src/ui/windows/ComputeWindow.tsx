// Окно «Мощности» (FR-2): сведения, арендованные карты, диалог аренды и распределение мощности.
// Раскладка по образцу «Производство» и «Управление линиями» в Processor Tycoon.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { GPUS } from '../../data/gpus';
import { availableGpus, isGpuAvailable, pool, rentCapFor, rentPerDay, rentPerGpuDay, totalH100e } from '../../sim/compute';
import { inferenceNeed, marketSnapshot } from '../../sim/market';
import { dateToDay, formatDateShort } from '../../sim/time';
import type { Allocation, GameState, GpuDef, GpuId } from '../../sim/types';
import { Dialog, ErrorText, ProgressBar } from '../components/common';
import { fmtMoney, fmtNum, fmtPct } from '../format';
import { actions, store } from '../store';
import './ComputeWindow.css';

/** Аренда списывается каждый день; в интерфейсе стоимость показана за 30 дней. */
const DAYS_IN_MONTH = 30;

// Мощность одной карты — доли H100e (0,021), у всей аренды — десятки и тысячи: знаков нужно по-разному.
const H_FORMATS = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d }));

/** H100e: «0,021», «2,03», «45,6», «1 234», «12 тыс.» */
function fmtH(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e4) return fmtNum(n);
  const digits = n < 1 ? 3 : n < 10 ? 2 : n < 1000 ? 1 : 0;
  return H_FORMATS[digits].format(n);
}

function monthlyCost(s: GameState, id: GpuId, count: number): number {
  return count * rentPerGpuDay(s, id) * DAYS_IN_MONTH;
}

/** Самая дешёвая по цене за H100e в день среди доступных; пока доступна одна карта, сравнивать не с чем. */
function cheapestGpuId(s: GameState): GpuId | null {
  const list = availableGpus(s);
  if (list.length < 2) return null;
  let best = list[0];
  for (const g of list) {
    if (rentPerGpuDay(s, g.id) / g.h100e < rentPerGpuDay(s, best.id) / best.h100e) best = g;
  }
  return best.id;
}

// ---------- Сведения ----------

function Summary({ s, onRent }: { s: GameState; onRent: () => void }) {
  const cards = GPUS.reduce((sum, g) => sum + s.compute.rented[g.id], 0);
  const caps = availableGpus(s).map((g) => rentCapFor(s, g.id));
  const capMin = caps.length ? Math.min(...caps) : 0;
  const capMax = caps.length ? Math.max(...caps) : 0;
  const capText = capMin === capMax ? fmtNum(capMin) : `${fmtNum(capMin)}–${fmtNum(capMax)}`;

  return (
    <header className="cw-info">
      <h2 className="cw-h">Сведения о мощностях</h2>
      <div className="cw-info-grid">
        <dl className="cw-kv">
          <dt title="H100e: мощность в эквивалентах одной карты H100">Всего мощности</dt>
          <dd>{fmtH(totalH100e(s))} H100e</dd>
          <dt>Арендовано карт</dt>
          <dd>{fmtNum(cards)}</dd>
          <dt title="Аренда за сутки × 30">Аренда в месяц</dt>
          <dd>{fmtMoney(rentPerDay(s) * DAYS_IN_MONTH)}</dd>
          <dt title="Больше карт одного типа в этом году арендовать нельзя">Лимит на тип в этом году</dt>
          <dd>{capText}</dd>
        </dl>
        <dl className="cw-kv">
          <dt>Обучение</dt>
          <dd>{fmtH(pool(s, 'training'))} H100e</dd>
          <dt>Контракты</dt>
          <dd>{fmtH(pool(s, 'contracts'))} H100e</dd>
          <dt>Эксперименты</dt>
          <dd>{fmtH(pool(s, 'experiments'))} H100e</dd>
          <dt>Клиенты</dt>
          <dd>{fmtH(pool(s, 'inference'))} H100e</dd>
        </dl>
        <div className="cw-info-act">
          <button className="btn primary" onClick={onRent} data-tutorial="rent-button">
            Арендовать
          </button>
        </div>
      </div>
    </header>
  );
}

// ---------- Карточки арендованных карт ----------

function RentedCard({ s, g, onEdit }: { s: GameState; g: GpuDef; onEdit: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const count = s.compute.rented[g.id];
  const cap = rentCapFor(s, g.id);
  const perDay = rentPerGpuDay(s, g.id);

  const giveBack = () => {
    const r = store.dispatch(actions.setRent, g.id, 0);
    setError(r.ok ? null : r.error);
  };

  return (
    <div className="cw-card">
      <div>
        <div className="cw-card-name">{g.name}</div>
        <div className="muted small">{fmtMoney(perDay / g.h100e)} за H100e в день</div>
      </div>
      <dl className="cw-kv">
        <dt>Карт</dt>
        <dd>{fmtNum(count)}</dd>
        <dt>Мощность</dt>
        <dd>{fmtH(count * g.h100e)} H100e</dd>
        <dt>В месяц</dt>
        <dd>{fmtMoney(monthlyCost(s, g.id, count))}</dd>
        <dt>Лимит</dt>
        <dd className={count >= cap ? 'warn' : undefined}>{fmtNum(cap)}</dd>
      </dl>
      <ProgressBar value={cap > 0 ? count / cap : 0} title={`${fmtNum(count)} из ${fmtNum(cap)}`} />
      <div className="cw-card-actions">
        <button className="btn small" onClick={onEdit}>
          Изменить
        </button>
        <button className="btn small" onClick={giveBack} title={`Вернуть все карты ${g.name}`}>
          Вернуть
        </button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

// ---------- Диалог «Аренда мощностей» ----------

function RentDialog({ s, initialId, onClose }: { s: GameState; initialId: GpuId; onClose: () => void }) {
  const [id, setId] = useState<GpuId>(initialId);
  const [text, setText] = useState(String(s.compute.rented[initialId]));
  const [error, setError] = useState<string | null>(null);

  const g = GPUS.find((x) => x.id === id) ?? GPUS[0];
  const rented = s.compute.rented[g.id];
  const cap = rentCapFor(s, g.id);
  // Если лимит упал ниже уже арендованного, текущее число остаётся допустимым.
  const max = Math.max(cap, rented);
  const parsed = text.trim() === '' ? NaN : Number(text);
  const count = Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
  const cheapest = cheapestGpuId(s);

  const pick = (next: GpuDef) => {
    setId(next.id);
    setText(String(s.compute.rented[next.id]));
    setError(null);
  };
  const setCount = (raw: string) => {
    setText(raw);
    setError(null);
  };
  const normalize = () => {
    const n = Math.floor(Number(text));
    setText(String(Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : rented));
  };
  const submit = () => {
    if (count === null || count === rented) return;
    const r = store.dispatch(actions.setRent, g.id, count);
    if (r.ok) onClose();
    else setError(r.error);
  };

  const lowering = count !== null && count < rented;
  const submitLabel = lowering ? 'Вернуть' : 'Арендовать';

  return (
    <Dialog
      title="Аренда мощностей"
      onClose={onClose}
      footer={
        <>
          {count !== null && count === rented && (
            <span className="cw-foot-note">{rented === 0 ? 'Укажите количество' : 'Количество не изменено'}</span>
          )}
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={submit} disabled={count === null || count === rented}>
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div className="cw-gpus" role="radiogroup" aria-label="Тип карты">
          <div className="cw-gpu-head">
            <span>Карта</span>
            <span>H100e на карту</span>
            <span>$ за H100e в день</span>
          </div>
          {GPUS.map((x) => {
            const avail = isGpuAvailable(s, x.id);
            const from = formatDateShort(dateToDay(x.availableFrom));
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={x.id === id}
                className="cw-gpu"
                disabled={!avail}
                onClick={() => pick(x)}
                title={avail ? undefined : `Доступна с ${from}`}
              >
                <span className="cw-gpu-name">
                  <span>{x.name}</span>
                  {!avail && <span className="cw-gpu-from">Доступна с {from}</span>}
                  {avail && x.id === cheapest && <span className="cw-gpu-tag">Выгоднее всего</span>}
                </span>
                <span className="n">{fmtH(x.h100e)}</span>
                <span className="n">{avail ? fmtMoney(rentPerGpuDay(s, x.id) / x.h100e) : '—'}</span>
              </button>
            );
          })}
        </div>

        <div className="cw-qty">
          <label htmlFor="cw-qty-num">Количество</label>
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={count ?? 0}
            onChange={(e) => setCount(e.target.value)}
            aria-label="Количество карт"
          />
          <input
            id="cw-qty-num"
            type="number"
            min={0}
            max={max}
            step={1}
            value={text}
            onChange={(e) => setCount(e.target.value)}
            onBlur={normalize}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <div className={`cw-qty-note${count === null ? ' bad' : ''}`}>
            {count === null ? `Введите целое число от 0 до ${fmtNum(max)}` : `Лимит в этом году: ${fmtNum(cap)} шт.`}
          </div>
        </div>

        <div className="card cw-sum">
          <dl className="cw-kv">
            <dt>Мощность</dt>
            <dd>{count === null ? '—' : `${fmtH(count * g.h100e)} H100e`}</dd>
            <dt>Стоимость</dt>
            <dd>{count === null ? '—' : `${fmtMoney(monthlyCost(s, g.id, count))} в месяц`}</dd>
            <dt>Сейчас в аренде</dt>
            <dd>{fmtNum(rented)} шт.</dd>
          </dl>
        </div>
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}

// ---------- Распределение мощности ----------

type AllocKey = keyof Allocation;

const ALLOC_ROWS: { key: AllocKey; label: string; hint: string }[] = [
  { key: 'training', label: 'Обучение', hint: 'Скорость обучения модели.' },
  { key: 'contracts', label: 'Контракты', hint: 'Работа по выигранным контрактам.' },
  { key: 'experiments', label: 'Эксперименты', hint: 'Очки исследований.' },
  { key: 'inference', label: 'Клиенты', hint: 'Обслуживание запросов к моделям на API. При нехватке мощности часть спроса теряется.' },
];

/** Разложить total на целые части пропорционально весам (метод наибольших остатков); все веса нулевые — поровну. */
function distribute(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? weights : weights.map(() => 1);
  const wsum = sum > 0 ? sum : weights.length;
  const exact = w.map((x) => (x / wsum) * total);
  const out = exact.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i]++;
  return out;
}

/** Текущие доли в целых процентах, сумма ровно 100. */
function percentsOf(alloc: Allocation): Record<AllocKey, number> {
  const p = distribute(ALLOC_ROWS.map((r) => alloc[r.key]), 100);
  const out = {} as Record<AllocKey, number>;
  ALLOC_ROWS.forEach((r, i) => (out[r.key] = p[i]));
  return out;
}

/** Поставить долю key в value % и пропорционально пересчитать остальные три. */
function withShare(alloc: Allocation, key: AllocKey, value: number): Allocation {
  const cur = percentsOf(alloc);
  const others = ALLOC_ROWS.map((r) => r.key).filter((k) => k !== key);
  const next = distribute(others.map((k) => cur[k]), 100 - value);
  const out = { ...cur, [key]: value } as Record<AllocKey, number>;
  others.forEach((k, i) => (out[k] = next[i]));
  return {
    training: out.training / 100,
    contracts: out.contracts / 100,
    experiments: out.experiments / 100,
    inference: out.inference / 100,
  };
}

/** Мощность, которая нужна клиентам; если расчёт рынка недоступен, null. */
function safeInferenceNeed(s: GameState): number | null {
  try {
    const need = inferenceNeed(s, marketSnapshot(s));
    return Number.isFinite(need) ? need : null;
  } catch {
    return null;
  }
}

function ClientNeed({ s }: { s: GameState }) {
  const need = safeInferenceNeed(s);
  if (need === null) return null;
  const have = pool(s, 'inference');
  const short = need > 0 && need > have * (1 + 1e-9) + 1e-9;
  return (
    <div className="cw-need">
      <span className={short ? 'bad' : 'muted'}>Нужно клиентам: {fmtH(need)} H100e</span>
      {need > 0 && (short ? <span className="bad">Не хватает {fmtH(need - have)} H100e</span> : <span className="good">Хватает</span>)}
    </div>
  );
}

function AllocPanel({ s }: { s: GameState }) {
  const [error, setError] = useState<string | null>(null);
  const percents = percentsOf(s.compute.alloc);

  const change = (key: AllocKey, value: number) => {
    const r = store.dispatch(actions.setAllocation, withShare(s.compute.alloc, key, value));
    setError(r.ok ? null : r.error);
  };

  return (
    <section className="cw-panel" data-tutorial="alloc">
      <h2 className="cw-h">Распределение мощности</h2>
      {totalH100e(s) <= 0 && <p className="cw-panel-note">Мощность появится после аренды карт.</p>}
      {ALLOC_ROWS.map((r) => (
        <div key={r.key} className="cw-alloc-row" title={r.hint}>
          <div className="cw-alloc-top">
            <span className="cw-alloc-name">{r.label}</span>
            <span className="cw-alloc-pct">{fmtPct(percents[r.key], 0)}</span>
            <span className="cw-alloc-val">{fmtH(pool(s, r.key))} H100e</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={percents[r.key]}
            onChange={(e) => change(r.key, Number(e.target.value))}
            aria-label={r.label}
            aria-valuetext={fmtPct(percents[r.key], 0)}
          />
          {r.key === 'inference' && <ClientNeed s={s} />}
        </div>
      ))}
      <ErrorText error={error} />
    </section>
  );
}

// ---------- Окно ----------

/** Тип карты, выбранный в диалоге по умолчанию: самый выгодный из доступных. */
function defaultRentId(s: GameState): GpuId {
  return cheapestGpuId(s) ?? availableGpus(s)[0]?.id ?? GPUS[0].id;
}

export default function ComputeWindow({ s }: WindowProps) {
  const [dialogId, setDialogId] = useState<GpuId | null>(null);
  const rentedGpus = GPUS.filter((g) => s.compute.rented[g.id] > 0);

  return (
    <div className="cw">
      <Summary s={s} onRent={() => setDialogId(defaultRentId(s))} />
      <div className="cw-scroll">
        <div className="cw-main">
          <section className="cw-rented">
            <h2 className="cw-h">Арендованные карты</h2>
            {rentedGpus.length === 0 ? (
              <div className="cw-empty">Карты не арендованы.</div>
            ) : (
              <div className="cw-cards">
                {rentedGpus.map((g) => (
                  <RentedCard key={g.id} s={s} g={g} onEdit={() => setDialogId(g.id)} />
                ))}
              </div>
            )}
          </section>
          <AllocPanel s={s} />
        </div>
      </div>
      {dialogId && createPortal(<RentDialog s={s} initialId={dialogId} onClose={() => setDialogId(null)} />, document.body)}
    </div>
  );
}
