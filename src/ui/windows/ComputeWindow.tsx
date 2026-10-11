// Окно «Мощности» (FR-2): сведения, арендованные карты, диалог аренды и распределение мощности.
// Раскладка по образцу «Производство» и «Управление линиями» в Processor Tycoon.

import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { GPUS } from '../../data/gpus';
import {
  availableGpus,
  isGpuAvailable,
  pool,
  rentCapFor,
  rentCostPerDay,
  rentMaxFor,
  rentPerDay,
  rentPerGpuDay,
  totalH100e,
} from '../../sim/compute';
import { RENT_HARD_CAP_MULT, RENT_OVER_CAP_MULT } from '../../sim/constants';
import { inferenceNeed, marketSnapshot } from '../../sim/market';
import { dateToDay, formatDateShort } from '../../sim/time';
import type { GameState, GpuDef, GpuId } from '../../sim/types';
import { ALLOC_ROWS, percentsOf, samePercents, toAllocation, withPercent, type Percents } from '../alloc';
import { Alert, Dialog, ErrorText, Range } from '../components/common';
import { fmtMoney, fmtMult, fmtNum, fmtPct } from '../format';
import { actions, store } from '../store';
import './ComputeWindow.css';

/** Аренда списывается каждый день; в интерфейсе стоимость показана за 30 дней. */
const DAYS_IN_MONTH = 30;

/** «×1,8» - надбавка к цене за карты сверх лимита. */
const OVER_MULT_TEXT = `×${fmtMult(RENT_OVER_CAP_MULT)}`;
/** Подсказка к лимиту: что будет сверх него и где жёсткий потолок. */
const CAP_HINT = `Карты сверх лимита стоят дороже: ${OVER_MULT_TEXT}. Больше ×${fmtMult(RENT_HARD_CAP_MULT)} от лимита арендовать нельзя`;

// Мощность одной карты - доли H100e (0,021), у всей аренды - десятки и тысячи: знаков нужно по-разному.
const H_FORMATS = [0, 1, 2, 3].map((d) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: d }));

/** H100e: «0,021», «2,03», «45,6», «1 234», «12 тыс.» */
function fmtH(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e4) return fmtNum(n);
  const digits = n < 1 ? 3 : n < 10 ? 2 : n < 1000 ? 1 : 0;
  return H_FORMATS[digits].format(n);
}

/** Аренда count карт за 30 дней с надбавкой за карты сверх лимита (rentCostPerDay). */
function monthlyCost(s: GameState, id: GpuId, count: number): number {
  return rentCostPerDay(s, id, count) * DAYS_IN_MONTH;
}

/** Сколько из count карт - сверх лимита по обычной цене. */
function overCap(count: number, cap: number): number {
  return Math.max(0, count - cap);
}

/** Разница со знаком: «+$1,2 тыс. в месяц, +4,5 H100e» или «−$1,2 тыс. в месяц, −4,5 H100e». */
function fmtChange(costDelta: number, hDelta: number): string {
  const money = costDelta > 0 ? `+${fmtMoney(costDelta)}` : fmtMoney(costDelta);
  const h = hDelta > 0 ? `+${fmtH(hDelta)}` : hDelta < 0 ? `−${fmtH(-hDelta)}` : fmtH(0);
  return `${money} в месяц, ${h} H100e`;
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
  const capText = capMin === capMax ? fmtNum(capMin) : `${fmtNum(capMin)}-${fmtNum(capMax)}`;
  const over = GPUS.reduce((sum, g) => sum + overCap(s.compute.rented[g.id], rentCapFor(s, g.id)), 0);

  return (
    <header className="cw-info">
      <h2 className="cw-h">Сведения о мощностях</h2>
      <div className="cw-info-grid">
        <dl className="cw-kv">
          <dt title="H100e: мощность в эквивалентах одной карты H100">Всего мощности</dt>
          <dd>{fmtH(totalH100e(s))} H100e</dd>
          <dt>Арендовано карт</dt>
          <dd>{fmtNum(cards)}</dd>
          <dt title="Аренда за сутки × 30, с надбавкой за карты сверх лимита">Аренда в месяц</dt>
          <dd>{fmtMoney(rentPerDay(s) * DAYS_IN_MONTH)}</dd>
          <dt title={CAP_HINT}>Лимит по обычной цене</dt>
          <dd className={over > 0 ? 'warn' : undefined}>{capText}</dd>
        </dl>
        <dl className="cw-kv">
          <dt>Обучение</dt>
          <dd>{fmtH(pool(s, 'training'))} H100e</dd>
          <dt>Контракты</dt>
          <dd>{fmtH(pool(s, 'contracts'))} H100e</dd>
          <dt>Исследования</dt>
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

/** Карточка арендованного типа карт. «Изменить» и «Вернуть» открывают диалог аренды: возврат всех карт - с нулём в поле. */
function RentedCard({ s, g, onEdit, onGiveBack }: { s: GameState; g: GpuDef; onEdit: () => void; onGiveBack: () => void }) {
  const count = s.compute.rented[g.id];
  const cap = rentCapFor(s, g.id);
  const over = overCap(count, cap);
  const perDay = rentPerGpuDay(s, g.id);

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
        <dt title="Аренда за сутки × 30, с надбавкой за карты сверх лимита">В месяц</dt>
        <dd>{fmtMoney(monthlyCost(s, g.id, count))}</dd>
        <dt title={CAP_HINT}>Лимит по обычной цене</dt>
        <dd className={over > 0 ? 'warn' : undefined}>{fmtNum(cap)}</dd>
        {over > 0 && (
          <>
            <dt title={`Эти карты стоят ${OVER_MULT_TEXT} от обычной цены`}>Сверх лимита</dt>
            <dd className="warn">
              {fmtNum(over)} шт. по цене {OVER_MULT_TEXT}
            </dd>
          </>
        )}
      </dl>
      <div className="cw-card-actions">
        <button className="btn small" onClick={onEdit}>
          Изменить
        </button>
        <button className="btn small" onClick={onGiveBack} title={`Вернуть все карты ${g.name}`}>
          Вернуть
        </button>
      </div>
    </div>
  );
}

// ---------- Диалог «Аренда мощностей» ----------

/** Что открыть в диалоге аренды: тип карты и число в поле (по умолчанию - сколько уже арендовано). */
interface RentTarget {
  id: GpuId;
  count?: number;
}

function RentDialog({ s, target, onClose }: { s: GameState; target: RentTarget; onClose: () => void }) {
  const [id, setId] = useState<GpuId>(target.id);
  const [text, setText] = useState(String(target.count ?? s.compute.rented[target.id]));
  const [error, setError] = useState<string | null>(null);

  const g = GPUS.find((x) => x.id === id) ?? GPUS[0];
  const rented = s.compute.rented[g.id];
  const cap = rentCapFor(s, g.id);
  // Если потолок упал ниже уже арендованного, текущее число остаётся допустимым.
  const max = Math.max(rentMaxFor(s, g.id), rented);
  const parsed = text.trim() === '' ? NaN : Number(text);
  const count = Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
  const over = count === null ? 0 : overCap(count, cap);
  const cheapest = cheapestGpuId(s);
  // Где на ползунке кончается обычная цена (доля длины дорожки); при лимите не ниже потолка отметки нет.
  const capFrac = cap < max ? cap / max : null;

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
  // Надбавка за карты сверх лимита в месяц: вся аренда минус аренда карт по обычной цене.
  const overCost = count === null || over === 0 ? 0 : monthlyCost(s, g.id, count) - monthlyCost(s, g.id, cap);

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
                className={`cw-gpu${x.id === id ? ' is-selected' : ''}`}
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
                <span className="n">{avail ? fmtMoney(rentPerGpuDay(s, x.id) / x.h100e) : '-'}</span>
              </button>
            );
          })}
        </div>

        <div className="cw-qty">
          <label htmlFor="cw-qty-num">Количество</label>
          <div
            className={`cw-qty-range${capFrac === null ? '' : ' has-cap'}`}
            style={{ '--cap': capFrac ?? 1 } as CSSProperties}
            title={capFrac === null ? undefined : `Лимит по обычной цене: ${fmtNum(cap)} шт.`}
          >
            <Range value={count ?? 0} min={0} max={max} label="Количество карт" onChange={(v) => setCount(String(v))} />
          </div>
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
            {count === null ? (
              `Введите целое число от 0 до ${fmtNum(max)}`
            ) : (
              <>
                <span title={CAP_HINT}>Лимит по обычной цене: {fmtNum(cap)} шт.</span>
                {over > 0 && (
                  <span className="warn">
                    Сверх лимита: {fmtNum(over)} шт. по цене {OVER_MULT_TEXT}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="card cw-sum">
          <dl className="cw-kv">
            <dt>Мощность</dt>
            <dd>{count === null ? '-' : `${fmtH(count * g.h100e)} H100e`}</dd>
            <dt title="Аренда за сутки × 30, с надбавкой за карты сверх лимита">Стоимость</dt>
            <dd>{count === null ? '-' : `${fmtMoney(monthlyCost(s, g.id, count))} в месяц`}</dd>
            {over > 0 && (
              <>
                <dt title={`Надбавка за ${fmtNum(over)} шт. сверх лимита: цена ${OVER_MULT_TEXT}`}>Из них надбавка</dt>
                <dd className="warn">{fmtMoney(overCost)} в месяц</dd>
              </>
            )}
            <dt>Сейчас в аренде</dt>
            <dd>{fmtNum(rented)} шт.</dd>
            {count !== null && count !== rented && (
              <>
                <dt title="Разница с текущей арендой этого типа карт">Изменение</dt>
                <dd className={lowering ? 'good' : undefined}>
                  {fmtChange(monthlyCost(s, g.id, count) - monthlyCost(s, g.id, rented), (count - rented) * g.h100e)}
                </dd>
              </>
            )}
          </dl>
        </div>
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}

// ---------- Распределение мощности ----------

/** Мощность, которая нужна клиентам; если расчёт рынка недоступен, null. */
function safeInferenceNeed(s: GameState): number | null {
  try {
    const need = inferenceNeed(s, marketSnapshot(s));
    return Number.isFinite(need) ? need : null;
  } catch {
    return null;
  }
}

function ClientNeed({ s, have }: { s: GameState; have: number }) {
  const need = safeInferenceNeed(s);
  if (need === null || need <= 0) return null;
  const short = need > have * (1 + 1e-9) + 1e-9;
  if (short) {
    return (
      <Alert tone="warn">
        Нужно клиентам: {fmtH(need)} H100e, не хватает {fmtH(need - have)}
      </Alert>
    );
  }
  return <div className="cw-need">Нужно клиентам: {fmtH(need)} H100e</div>;
}

function AllocPanel({ s }: { s: GameState }) {
  const [draft, setDraft] = useState<Percents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = percentsOf(s.compute.alloc);
  const shown = draft ?? current;
  const changed = draft !== null && !samePercents(draft, current);
  const total = totalH100e(s);

  const apply = () => {
    if (!draft) return;
    const r = store.dispatch(actions.setAllocation, toAllocation(draft));
    setError(r.ok ? null : r.error);
    if (r.ok) setDraft(null);
  };

  return (
    <section className="cw-panel" data-tutorial="alloc">
      <h2 className="cw-h">Распределение мощности</h2>
      <div className="cw-allocbar" aria-hidden="true">
        {ALLOC_ROWS.map((r) => (
          <div key={r.key} style={{ width: `${shown[r.key]}%`, background: r.color }} />
        ))}
      </div>
      {total <= 0 && <p className="cw-panel-note">Мощность появится после аренды карт.</p>}
      {ALLOC_ROWS.map((r) => (
        <div key={r.key} className="cw-alloc-row" title={r.hint}>
          <div className="cw-alloc-top">
            <span className="cw-dot" style={{ background: r.color }} />
            <span className="cw-alloc-name">{r.label}</span>
            <span className="cw-alloc-val">{fmtH((total * shown[r.key]) / 100)} H100e</span>
            <span className={`cw-alloc-pct${draft && shown[r.key] !== current[r.key] ? ' changed' : ''}`}>{fmtPct(shown[r.key], 0)}</span>
          </div>
          <Range
            value={shown[r.key]}
            min={0}
            max={100}
            color={r.color}
            label={r.label}
            valueText={fmtPct(shown[r.key], 0)}
            onChange={(v) => {
              setError(null);
              setDraft(withPercent(shown, r.key, v));
            }}
          />
          {r.key === 'inference' && <ClientNeed s={s} have={(total * shown.inference) / 100} />}
        </div>
      ))}
      <ErrorText error={error} />
      <div className="cw-alloc-foot">
        {changed ? (
          <button className="btn" onClick={() => setDraft(null)}>
            Сбросить
          </button>
        ) : (
          <span className="cw-alloc-hint">Двигайте ползунки</span>
        )}
        <button className="btn primary" disabled={!changed} onClick={apply}>
          Распределить
        </button>
      </div>
    </section>
  );
}

// ---------- Окно ----------

/** Тип карты, выбранный в диалоге по умолчанию: самый выгодный из доступных. */
function defaultRentId(s: GameState): GpuId {
  return cheapestGpuId(s) ?? availableGpus(s)[0]?.id ?? GPUS[0].id;
}

export default function ComputeWindow({ s }: WindowProps) {
  const [dialog, setDialog] = useState<RentTarget | null>(null);
  const rentedGpus = GPUS.filter((g) => s.compute.rented[g.id] > 0);

  return (
    <div className="cw">
      <Summary s={s} onRent={() => setDialog({ id: defaultRentId(s) })} />
      <div className="cw-scroll">
        <div className="cw-main">
          <section className="cw-rented">
            <h2 className="cw-h">Арендованные карты</h2>
            {rentedGpus.length === 0 ? (
              <div className="cw-empty">Карты не арендованы.</div>
            ) : (
              <div className="cw-cards">
                {rentedGpus.map((g) => (
                  <RentedCard
                    key={g.id}
                    s={s}
                    g={g}
                    onEdit={() => setDialog({ id: g.id })}
                    onGiveBack={() => setDialog({ id: g.id, count: 0 })}
                  />
                ))}
              </div>
            )}
          </section>
          <AllocPanel s={s} />
        </div>
      </div>
      {dialog && createPortal(<RentDialog s={s} target={dialog} onClose={() => setDialog(null)} />, document.body)}
    </div>
  );
}
