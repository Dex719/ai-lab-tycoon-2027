// Окно «Мощности» (FR-2): сведения, арендованные карты, диалог аренды и распределение мощности.
// Раскладка по образцу «Производство» и «Управление линиями» в Processor Tycoon.

import { Fragment, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { GPUS } from '../../data/gpus';
import {
  availableGpus,
  isGpuAvailable,
  ownedH100e,
  pool,
  rentCapFor,
  rentCostPerDay,
  rentMaxFor,
  rentPerDay,
  rentPerGpuDay,
  totalH100e,
} from '../../sim/compute';
import { RENT_HARD_CAP_MULT, RENT_OVER_CAP_MULT } from '../../sim/constants';
import { ownedCards } from '../../sim/datacenters';
import { CHAT_MOMENT_DAY, inferenceNeed, marketSnapshot, subsOpen } from '../../sim/market';
import { dateToDay } from '../../sim/time';
import type { GameState, GpuDef, GpuId } from '../../sim/types';
import {
  ALLOC_ROWS,
  checkAllocation,
  maxPercent,
  occupancy,
  percentsOf,
  samePercents,
  setPercent,
  soldChannels,
  toAllocation,
  ZERO_SHARE_WARNING,
  type AllocKey,
  type Percents,
  type SoldChannels,
} from '../alloc';
import { Cards } from '../components/Cards';
import { Alert, ConfirmDialog, Dialog, ErrorText, NewBadge, Range } from '../components/common';
import { fmtH100e as fmtH, fmtInt, fmtMoney, fmtMult, fmtNum, fmtPct } from '../format';
import { idleCompute } from '../../sim/idle';
import { IconAlert } from '../icons';
import { timesWord } from '../../sim/text';
import { actions, store } from '../store';
import './ComputeWindow.css';

/** Аренда списывается каждый день; в интерфейсе стоимость показана за 30 дней. */
const DAYS_IN_MONTH = 30;

/** «×1,8» - надбавка к цене за карты сверх лимита. */
const OVER_MULT_TEXT = `×${fmtMult(RENT_OVER_CAP_MULT)}`;
/** Подсказка к лимиту: что будет сверх него и где жёсткий потолок. */
const CAP_HINT = `Карты сверх лимита стоят дороже: ${OVER_MULT_TEXT}. Больше ×${fmtMult(RENT_HARD_CAP_MULT)} от лимита арендовать нельзя`;

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

/**
 * Строки долей, которые видит игрок: «Подписки» - только после открытия канала подписок
 * (или если доля почему-то уже не нулевая, чтобы её можно было убрать).
 */
function visibleRows(s: GameState) {
  return ALLOC_ROWS.filter((r) => r.key !== 'subs' || subsOpen(s.day) || s.compute.alloc.subs > 0);
}

/** Подпись доли со значком «Новое» у «Подписок» в первые дни после открытия канала. */
function RowLabel({ s, r }: { s: GameState; r: (typeof ALLOC_ROWS)[number] }) {
  return (
    <>
      {r.label}
      {r.key === 'subs' && <NewBadge day={s.day} since={CHAT_MOMENT_DAY} />}
    </>
  );
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
      <div className="cw-info-head">
        <h2 className="cw-h">Сведения о мощностях</h2>
        <button className="btn primary" onClick={onRent} data-tutorial="rent-button">
          Арендовать
        </button>
      </div>
      <div className="cw-info-grid">
        <dl className="cw-kv">
          <dt title="H100e: мощность в эквивалентах одной карты H100">Всего мощности</dt>
          <dd>
            {fmtH(totalH100e(s))} H100e
            <Cards s={s} h100e={totalH100e(s)} />
          </dd>
          <dt>Арендовано карт</dt>
          <dd>{fmtNum(cards)}</dd>
          {s.datacenters.unlockedDay !== null && (
            <>
              <dt title="Карты в своих дата-центрах: входят во «Всего мощности», лимит аренды на них не действует">Свои карты</dt>
              <dd className="cw-own">
                {fmtNum(ownedCards(s))} шт., {fmtH(ownedH100e(s))} H100e
              </dd>
            </>
          )}
          <dt title="Аренда за сутки × 30, с надбавкой за карты сверх лимита">Аренда в месяц</dt>
          <dd className="cw-cost">{fmtMoney(rentPerDay(s) * DAYS_IN_MONTH)}</dd>
          <dt title={CAP_HINT}>Лимит по обычной цене</dt>
          <dd className={over > 0 ? 'warn' : undefined}>{capText}</dd>
        </dl>
        <dl className="cw-kv">
          {visibleRows(s).map((r) => (
            <Fragment key={r.key}>
              <dt title={r.hint}>
                <span className="cw-dot" style={{ background: r.color }} />
                <RowLabel s={s} r={r} />
              </dt>
              <dd>
                {fmtH(pool(s, r.key))} H100e
                <Cards s={s} h100e={pool(s, r.key)} />
              </dd>
            </Fragment>
          ))}
        </dl>
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
        <dd className="cw-cost">{fmtMoney(monthlyCost(s, g.id, count))}</dd>
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
  const atMax = count === max;
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
          {/* Карты, которые ещё не вышли, не показываются вовсе: игрок не должен знать будущее. */}
          {GPUS.filter((x) => isGpuAvailable(s, x.id)).map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={x.id === id}
              className={`cw-gpu${x.id === id ? ' is-selected' : ''}`}
              onClick={() => pick(x)}
            >
              <span className="cw-gpu-name">
                <span>
                  {x.name}
                  <NewBadge day={s.day} since={dateToDay(x.availableFrom)} />
                </span>
                {x.id === cheapest && <span className="cw-gpu-tag">Выгоднее всего</span>}
              </span>
              <span className="n">{fmtH(x.h100e)}</span>
              <span className="n">{fmtMoney(rentPerGpuDay(s, x.id) / x.h100e)}</span>
            </button>
          ))}
        </div>

        <div className="cw-qty">
          <label htmlFor="cw-qty-num">Количество</label>
          <div
            className={`cw-qty-range${capFrac === null ? '' : ' has-cap'}`}
            style={{ '--cap': capFrac ?? 1 } as CSSProperties}
          >
            <Range value={count ?? 0} min={0} max={max} label="Количество карт" onChange={(v) => setCount(String(v))} />
            {capFrac !== null && (
              <span className="cw-cap-label" aria-hidden="true">
                {fmtNum(cap)} шт.: дальше {OVER_MULT_TEXT}
              </span>
            )}
          </div>
          <input
            id="cw-qty-num"
            type="number"
            inputMode="decimal"
            min={0}
            max={max}
            step={1}
            value={text}
            onChange={(e) => setCount(e.target.value)}
            onBlur={normalize}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {/* Строка зарезервирована всегда: «Максимум» появляется у правого края ползунка, размер диалога не меняется. */}
          <div className="cw-qty-legend">
            <span className={capFrac === null ? 'cw-hide' : undefined}>
              <span className="cw-sw over" />
              Сверх лимита - {timesWord(RENT_OVER_CAP_MULT)} дороже.
            </span>
            <span className={`cw-qty-max${atMax ? '' : ' cw-hide'}`} aria-hidden={!atMax}>
              Максимум {fmtInt(max)} шт.
            </span>
          </div>
          <div className={`cw-qty-note${count === null ? ' bad' : ''}`}>
            {count === null ? (
              `Введите целое число от 0 до ${fmtInt(max)}`
            ) : (
              over > 0 && (
                <span className="warn">
                  Сверх лимита: {fmtNum(over)} шт. по цене {OVER_MULT_TEXT}
                </span>
              )
            )}
          </div>
        </div>

        <div className="card cw-sum">
          <dl className="cw-kv">
            <dt>Мощность</dt>
            <dd>{count === null ? '-' : `${fmtH(count * g.h100e)} H100e`}</dd>
            <dt title="Аренда за сутки × 30, с надбавкой за карты сверх лимита">Стоимость</dt>
            <dd className="cw-cost">{count === null ? '-' : `${fmtMoney(monthlyCost(s, g.id, count))} в месяц`}</dd>
            {/* Строки есть всегда (с прочерком), чтобы диалог не менял высоту при движении ползунка. */}
            <dt title={`Надбавка за карты сверх лимита: цена ${OVER_MULT_TEXT}`}>Из них надбавка</dt>
            <dd className={over > 0 ? 'warn' : undefined}>{over > 0 ? `${fmtMoney(overCost)} в месяц` : '-'}</dd>
            <dt>Сейчас в аренде</dt>
            <dd>{fmtNum(rented)} шт.</dd>
            <dt title="Разница с текущей арендой этого типа карт">Изменение</dt>
            {count !== null && count !== rented ? (
              <dd className={lowering ? 'good' : 'bad'}>
                {fmtChange(monthlyCost(s, g.id, count) - monthlyCost(s, g.id, rented), (count - rented) * g.h100e)}
              </dd>
            ) : (
              <dd>-</dd>
            )}
          </dl>
        </div>
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}

// ---------- Распределение мощности ----------

type NeedChannel = 'api' | 'subs';

/** Мощность, которая нужна клиентам по каналам; если расчёт рынка недоступен, null. */
function safeInferenceNeed(s: GameState): Record<NeedChannel, number> | null {
  try {
    const need = inferenceNeed(s, marketSnapshot(s));
    return Number.isFinite(need.api) && Number.isFinite(need.subs) ? need : null;
  } catch {
    return null;
  }
}

/**
 * Подсказка «Нужно клиентам» под строкой API или «Подписки». Одна строка постоянной высоты: нехватка при перетаскивании
 * ползунка только меняет цвет и добавляет слово справа, ошибкой не считается и размер окна не меняет.
 */
function ClientNeed({ s, need, have }: { s: GameState; need: number | undefined; have: number }) {
  if (need === undefined || !(need > 0)) return null;
  const short = need > have * (1 + 1e-9) + 1e-9;
  return (
    <div className={`cw-need${short ? ' short' : ''}`}>
      <span className="cw-need-t">
        Нужно клиентам: <b>{fmtH(need)} H100e</b>
        <Cards s={s} h100e={need} />
      </span>
      {short && <span className="cw-need-short">не хватает {fmtH(need - have)}</span>}
    </div>
  );
}

/** Поле процента рядом с ползунком: пока в нём печатают, показывается набранный текст, после ухода из поля - долю. */
function PercentInput(props: {
  value: number;
  /** Наибольшее значение: 100 минус сумма остальных долей. Больше набрать нельзя, число зажимается. */
  max: number;
  label: string;
  changed: boolean;
  onChange: (v: number) => void;
  onEnter: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className={`cw-pct${props.changed ? ' changed' : ''}`}>
      <input
        type="number"
        min={0}
        max={props.max}
        step={1}
        inputMode="decimal"
        value={text ?? String(props.value)}
        aria-label={`${props.label}, процент`}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === '') return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          props.onChange(n);
          if (n < 0 || n > props.max) setText(String(Math.max(0, Math.min(props.max, Math.round(n)))));
        }}
        onBlur={() => setText(null)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          setText(null);
          props.onEnter();
        }}
      />
      <span>%</span>
    </label>
  );
}

function AllocPanel({ s }: { s: GameState }) {
  const [draft, setDraft] = useState<Percents | null>(null);
  // Ошибка показывается только после «Распределить»; любое изменение долей её убирает.
  const [error, setError] = useState<string | null>(null);
  const [zero, setZero] = useState<(keyof SoldChannels)[] | null>(null);
  // Доля упёрлась в остаток: вместо молчаливого обнуления говорим, сколько можно.
  const [limit, setLimit] = useState<number | null>(null);
  const current = percentsOf(s.compute.alloc);
  const shown = draft ?? current;
  const changed = draft !== null && !samePercents(draft, current);
  const total = totalH100e(s);
  const occ = occupancy(shown);
  const need = safeInferenceNeed(s);
  const rows = visibleRows(s);

  const edit = (key: AllocKey, value: number) => {
    setError(null);
    const cap = maxPercent(shown, key);
    setLimit(Math.round(value) > cap ? cap : null);
    setDraft(setPercent(shown, key, value));
  };

  const commit = () => {
    if (!draft) return;
    const r = store.dispatch(actions.setAllocation, toAllocation(draft));
    setError(r.ok ? null : r.error);
    if (r.ok) {
      setDraft(null);
      setLimit(null);
    }
  };

  // «Распределить»: сумма не больше 100 % (остаток простаивает); нулевую долю API или подписок при продажах в канале игрок подтверждает.
  const apply = () => {
    if (!draft || !changed) return;
    const check = checkAllocation(draft, soldChannels(s.models));
    if (check.error) {
      setError(check.error);
      return;
    }
    if (check.zero.length > 0) {
      setZero(check.zero);
      return;
    }
    commit();
  };

  return (
    <section className="cw-panel" data-tutorial="alloc">
      <div className="cw-panel-head">
        <h2 className="cw-h">Распределение мощности</h2>
        <div className="cw-allocbar" aria-hidden="true">
          {ALLOC_ROWS.map((r) => (
            <div key={r.key} style={{ width: `${shown[r.key]}%`, background: r.color }} />
          ))}
        </div>
        <div
          className={`cw-occ ${occ.tone}`}
          role="status"
          title={occ.tone === 'idle' ? 'Свободная мощность простаивает, а аренда за неё всё равно списывается.' : undefined}
        >
          {occ.text}
        </div>
      </div>
      {total <= 0 && <p className="cw-panel-note">Мощность появится после аренды карт.</p>}
      {rows.map((r) => {
        const h = (total * shown[r.key]) / 100;
        const cap = maxPercent(shown, r.key);
        return (
          <div key={r.key} className="cw-alloc-row" title={r.hint}>
            <div className="cw-alloc-top">
              <span className="cw-dot" style={{ background: r.color }} />
              <span className="cw-alloc-name">
                <RowLabel s={s} r={r} />
              </span>
              <span className="cw-alloc-val">
                {fmtH(h)} H100e
                <Cards s={s} h100e={h} />
              </span>
            </div>
            <div className="cw-alloc-ctl">
              <Range
                value={shown[r.key]}
                min={0}
                max={100}
                color={r.color}
                label={r.label}
                valueText={fmtPct(shown[r.key], 0)}
                onChange={(v) => edit(r.key, v)}
              />
              <PercentInput
                value={shown[r.key]}
                max={cap}
                label={r.label}
                changed={draft !== null && shown[r.key] !== current[r.key]}
                onChange={(v) => edit(r.key, v)}
                onEnter={apply}
              />
            </div>
            {(r.key === 'api' || r.key === 'subs') && <ClientNeed s={s} need={need?.[r.key]} have={h} />}
          </div>
        );
      })}
      <div className="cw-panel-foot">
        <div className="cw-alloc-msg" title={error ?? undefined}>
            {error ? (
              <Alert tone="bad">{error}</Alert>
            ) : (
              limit !== null && <Alert tone="warn">Максимум {limit} %: сначала уменьшите другую долю.</Alert>
            )}
          </div>
        <div className="cw-alloc-foot">
          {changed ? (
            <button
              className="btn"
              onClick={() => {
                setDraft(null);
                setError(null);
                setLimit(null);
              }}
            >
              Сбросить
            </button>
          ) : (
            <span className="cw-alloc-hint">Двигайте ползунки</span>
          )}
          <button className="btn primary" disabled={!changed} onClick={apply}>
            Распределить
          </button>
        </div>
      </div>
      {zero && (
        <ConfirmDialog
          title="Нулевая доля мощности"
          confirmLabel="Распределить"
          onConfirm={() => {
            setZero(null);
            commit();
          }}
          onClose={() => setZero(null)}
        >
          {zero.map((k) => (
            <p key={k} className="cw-confirm-line">
              {ZERO_SHARE_WARNING[k]}
            </p>
          ))}
        </ConfirmDialog>
      )}
    </section>
  );
}

// ---------- Окно ----------

/** Тип карты, выбранный в диалоге по умолчанию: самый выгодный из доступных. */
function defaultRentId(s: GameState): GpuId {
  return cheapestGpuId(s) ?? availableGpus(s)[0]?.id ?? GPUS[0].id;
}

/** Простой мощности: доля выделена, а работы для неё нет. Одна рамка, в ней строки с кнопкой, которая ведёт к исправлению. */
function IdleStrip({ s, open }: { s: GameState; open: WindowProps['open'] }) {
  const items = idleCompute(s);
  if (items.length === 0) return null;
  const shown = items.slice(0, 2);
  const rest = items.length - shown.length;
  return (
    <div className="cw-idle" role="alert">
      <IconAlert size={18} />
      <div className="cw-idle-rows">
        {shown.map((i) => (
          <div className="cw-idle-row" key={i.kind}>
            <span>
              Простаивает <b>{fmtH(i.h100e)} H100e</b>: {i.reason}
            </span>
            {i.fix !== 'compute' && (
              <button type="button" className="btn small" onClick={() => open(i.fix)}>
                {i.fixLabel}
              </button>
            )}
          </div>
        ))}
        {rest > 0 && <div className="cw-idle-more">Ещё {rest}: {items.slice(2).map((i) => i.reason).join(', ')}</div>}
      </div>
    </div>
  );
}

export default function ComputeWindow({ s, open }: WindowProps) {
  const [dialog, setDialog] = useState<RentTarget | null>(null);
  const rentedGpus = GPUS.filter((g) => s.compute.rented[g.id] > 0);

  return (
    <div className="cw">
      <Summary s={s} onRent={() => setDialog({ id: defaultRentId(s) })} />
      <IdleStrip s={s} open={open} />
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
