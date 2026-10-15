// Окно «Мощности»: слева крупно машинный зал (стойки окрашены по задачам), справа мощность, аренда и карты;
// внизу одна полоса долей мощности: границы тянутся мышью, отпустили - доли применены; «Как нужно» - по потребностям.
// Аренда - одна кнопка «Арендовать»: диалог выбора карты с 3D-превью, количеством и итогом.
// Будущее не раскрывается: в выборе только вышедшие карты, мощность сравнивается с самой мощной из них.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { GPUS } from '../../data/gpus';
import {
  availableGpus,
  isGpuAvailable,
  ownedH100e,
  rentCapFor,
  rentCostPerDay,
  rentMaxFor,
  rentPerDay,
  rentPerGpuDay,
  totalH100e,
} from '../../sim/compute';
import { RENT_OVER_CAP_MULT } from '../../sim/constants';
import { ownedCards } from '../../sim/datacenters';
import { idleWarnings } from '../../sim/idle';
import { CHAT_MOMENT_DAY, inferenceNeed, marketSnapshot, subsOpen } from '../../sim/market';
import { TECHS } from '../../sim/research';
import { timesWord } from '../../sim/text';
import { formatDateShort } from '../../sim/time';
import type { GameState, GpuDef, GpuId } from '../../sim/types';
import {
  ALLOC_ROWS,
  distribute,
  checkAllocation,
  occupancy,
  percentsOf,
  samePercents,
  soldChannels,
  toAllocation,
  ZERO_SHARE_WARNING,
  type AllocKey,
  type Percents,
  type SoldChannels,
} from '../alloc';
import { Cards } from '../components/Cards';
import { contractsNeedWithApplications, researchDaysAt, trainingDaysAt } from '../forecast';
import { ConfirmDialog, Dialog, GuardButton, NewBadge, Range } from '../components/common';
import { fmtH100e as fmtH, fmtInt, fmtMoney, fmtNum, h100ePerCard, ruPlural } from '../format';
import { IconAlert } from '../icons';
import { playSound } from '../sound';
import { actions, store } from '../store';
import { farmLayout, rentedFarm } from '../three/specs';
import { GpuChooser, powerFact } from '../three/GpuChooser';
import { useGpuThumb, View3D } from '../three/View3D';
import './ComputeWindow.css';

/** Аренда списывается каждый день; в интерфейсе стоимость показана за 30 дней. */
const DAYS_IN_MONTH = 30;
/** «в 1,8 раза» - надбавка к цене за карты сверх лимита. */
const OVER_TIMES = timesWord(RENT_OVER_CAP_MULT);

function cardsWord(n: number): string {
  return ruPlural(n, 'карта', 'карты', 'карт');
}

/** «96 карт», «1 карта», «12,5 тыс. карт». */
function fmtCardsCount(n: number): string {
  return `${n >= 10_000 ? fmtNum(n) : fmtInt(n)} ${cardsWord(n)}`;
}

/** Аренда count карт за 30 дней с надбавкой за карты сверх лимита (rentCostPerDay). */
function monthlyCost(s: GameState, id: GpuId, count: number): number {
  return rentCostPerDay(s, id, count) * DAYS_IN_MONTH;
}

/** Цена аренды одной карты в месяц: «$1 368». */
function fmtCardMonth(perDay: number): string {
  return `$${fmtInt(perDay * DAYS_IN_MONTH)}`;
}

/** Самая дешёвая по цене за единицу мощности среди доступных; пока доступна одна карта, сравнивать не с чем. */
function cheapestGpuId(s: GameState): GpuId | null {
  const list = availableGpus(s);
  if (list.length < 2) return null;
  let best = list[0];
  for (const g of list) if (rentPerGpuDay(s, g.id) / g.h100e < rentPerGpuDay(s, best.id) / best.h100e) best = g;
  return best.id;
}

/** Сколько карт предложить в диалоге, если этих карт ещё нет: около 3/16 лимита, кратно 8 (целые серверы). */
function suggestedCount(s: GameState, id: GpuId): number {
  const cap = rentCapFor(s, id);
  return Math.max(8, Math.min(rentMaxFor(s, id), Math.round((cap * 3) / 16 / 8) * 8));
}

/** Строки долей, которые видит игрок: «Подписки» - только после открытия канала (или если доля уже не нулевая). */
function visibleRows(s: GameState) {
  return ALLOC_ROWS.filter((r) => r.key !== 'subs' || subsOpen(s.day) || s.compute.alloc.subs > 0);
}

function RowLabel({ s, r }: { s: GameState; r: (typeof ALLOC_ROWS)[number] }) {
  return (
    <>
      {r.label}
      {r.key === 'subs' && <NewBadge day={s.day} since={CHAT_MOMENT_DAY} />}
    </>
  );
}

// ---------- Полоса с фермой ----------

interface RentFlash {
  key: number;
  text: string;
}

/** Что такое H100e в картах игрока: «1 H100e ≈ 8 ваших карт» (без аренды - в лучших доступных картах). */
function unitLine(s: GameState, rented: boolean): string {
  const n = Math.max(1, Math.round(1 / h100ePerCard(s)));
  const word = rented ? ruPlural(n, 'ваша карта', 'ваши карты', 'ваших карт') : ruPlural(n, 'новая карта', 'новые карты', 'новых карт');
  return `1 H100e ≈ ${fmtInt(n)} ${word}`;
}

/** Доли мощности для окраски стоек: по порядку строк, принятые (не черновик). */
function farmTasks(p: Percents): { color: string; share: number }[] {
  return ALLOC_ROWS.map((r) => ({ color: r.color, share: p[r.key] / 100 }));
}

/** Машинный зал крупно: стойки окрашены планками по задачам, подписи поверх. */
function Hall({ s, shown, flash }: { s: GameState; shown: Percents; flash: RentFlash | null }) {
  const farm = { ...rentedFarm(s), tasks: farmTasks(shown) };
  const layout = farmLayout(farm.groups);
  const racks = `${fmtInt(layout.totalRacks)} ${ruPlural(layout.totalRacks, 'стойка', 'стойки', 'стоек')}`;
  return (
    <figure className="cw-hall">
      <View3D spec={farm} label={`Арендованные карты в облаке: ${fmtCardsCount(layout.cards)}, ${racks}`} className="cw-farm-view" />
      {layout.cards === 0 && <figcaption className="cw-farm-empty">Карт пока нет: нажмите «Арендовать»</figcaption>}
      {layout.scale > 1 && <figcaption className="cw-farm-scale">На схеме одна стойка за {fmtInt(layout.scale)}</figcaption>}
      {flash && (
        <div key={flash.key} className="cw-flash" role="status">
          {flash.text}
        </div>
      )}
    </figure>
  );
}

/** Правая колонка: мощность крупно, аренда, кнопка и арендованные карты. */
function Side({ s, onRent, onEdit, onGiveBack, open }: { s: GameState; onRent: () => void; onEdit: (id: GpuId) => void; onGiveBack: (id: GpuId) => void; open: WindowProps['open'] }) {
  const layout = farmLayout(rentedFarm(s).groups);
  const total = totalH100e(s);
  const own = ownedCards(s);
  const caps = availableGpus(s).map((g) => rentCapFor(s, g.id));
  const cap = caps.length ? Math.min(...caps) : 0;
  const racks = `${fmtInt(layout.totalRacks)} ${ruPlural(layout.totalRacks, 'стойка', 'стойки', 'стоек')}`;
  const rentedGpus = GPUS.filter((g) => s.compute.rented[g.id] > 0);
  return (
    <aside className="cw-side">
      <div className="cw-fig-label" title="Единица мощности: в ней считаются обучение, исследования и работа для клиентов">
        Мощность
      </div>
      <div className={`cw-fig-value${total > 0 ? '' : ' dim'}`}>
        {fmtH(total)}
        <span>H100e</span>
      </div>
      <div className="cw-fig-sub">{layout.cards > 0 ? `${fmtCardsCount(layout.cards)} в аренде, ${racks}` : 'Карт в аренде нет'}</div>
      <div className="cw-fig-unit" title="H100e - общая единица мощности для карт разных лет: обучение, исследования и контракты считаются в ней">
        {unitLine(s, layout.cards > 0)}
      </div>
      <dl className="cw-fig-kv">
        <dt>Аренда в месяц</dt>
        <dd className={rentPerDay(s) > 0 ? 'bad' : undefined}>{rentPerDay(s) > 0 ? fmtMoney(rentPerDay(s) * DAYS_IN_MONTH) : '-'}</dd>
        <dt title={`До лимита - обычная цена, сверх него карты дороже ${OVER_TIMES}. Лимит растёт каждый год`}>Лимит аренды</dt>
        <dd>{fmtInt(cap)} на тип</dd>
      </dl>
      <button className="btn primary big cw-rent-btn" onClick={onRent} data-tutorial="rent-button">
        Арендовать
      </button>
      {rentedGpus.length > 0 && (
        <div className="cw-rows">
          {rentedGpus.map((g) => (
            <RentedRow key={g.id} s={s} g={g} onEdit={() => onEdit(g.id)} onGiveBack={() => onGiveBack(g.id)} />
          ))}
        </div>
      )}
      {own > 0 && (
        <div className="cw-own">
          <span>
            Свои карты: <b>{fmtCardsCount(own)}</b>, {fmtH(ownedH100e(s))} H100e
          </span>
          <button type="button" className="btn small" onClick={() => open('datacenters')}>
            Дата-центры
          </button>
        </div>
      )}
    </aside>
  );
}

// ---------- Арендованные карты ----------

function GpuThumb({ id, w, h }: { id: GpuId; w: number; h: number }) {
  const url = useGpuThumb(id, w, h);
  return (
    <span className="cw-thumb" style={{ width: w, height: h }}>
      {url && <img src={url} alt="" width={w} height={h} draggable={false} />}
    </span>
  );
}

function RentedRow({ s, g, onEdit, onGiveBack }: { s: GameState; g: GpuDef; onEdit: () => void; onGiveBack: () => void }) {
  const count = s.compute.rented[g.id];
  const cap = rentCapFor(s, g.id);
  const over = Math.max(0, count - cap);
  return (
    <div className="cw-row">
      <GpuThumb id={g.id} w={88} h={50} />
      <div className="cw-row-main">
        <div className="cw-row-name">{g.name}</div>
        <div className="cw-row-meta">
          <b>{fmtInt(count)} шт.</b>, {fmtH(count * g.h100e)} H100e, {fmtCardMonth(rentPerGpuDay(s, g.id))} за карту в месяц
        </div>
        <div className={`cw-row-over${over > 0 ? '' : ' cw-hide'}`}>
          Сверх лимита {fmtInt(over)} шт.: цена {OVER_TIMES} выше
        </div>
      </div>
      <div className="cw-row-cost">
        {fmtMoney(monthlyCost(s, g.id, count))}
        <small>в месяц</small>
      </div>
      <div className="cw-row-actions">
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

// ---------- Диалог аренды ----------

interface RentTarget {
  id: GpuId;
  /** Число в поле; по умолчанию - сколько уже арендовано или предложенное количество для новых карт. */
  count?: number;
}

function RentDialog({ s, target, onClose, onDone }: { s: GameState; target: RentTarget; onClose: () => void; onDone: (text: string) => void }) {
  const initial = (id: GpuId, count?: number) => String(count ?? (s.compute.rented[id] > 0 ? s.compute.rented[id] : suggestedCount(s, id)));
  const [id, setId] = useState<GpuId>(target.id);
  const [text, setText] = useState(initial(target.id, target.count));
  const [error, setError] = useState<string | null>(null);

  const list = GPUS.filter((x) => isGpuAvailable(s, x.id));
  const g = GPUS.find((x) => x.id === id) ?? GPUS[0];
  const rented = s.compute.rented[g.id];
  const cap = rentCapFor(s, g.id);
  const max = Math.max(rentMaxFor(s, g.id), rented);
  const parsed = text.trim() === '' ? NaN : Number(text);
  const count = Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
  const over = count === null ? 0 : Math.max(0, count - cap);
  const cheapest = cheapestGpuId(s);
  const capFrac = cap < max ? cap / max : null;

  const pick = (next: GpuDef) => {
    setId(next.id);
    setText(initial(next.id));
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

  const lowering = count !== null && count < rented;
  const label = count === 0 && rented > 0 ? 'Вернуть все' : lowering ? 'Вернуть' : 'Арендовать';
  const reason = count === null ? `Введите целое число от 0 до ${fmtInt(max)}` : count === rented ? (rented === 0 ? 'Укажите количество' : 'Количество не изменилось') : null;
  const submit = () => {
    if (reason || count === null) return;
    const r = store.dispatch(actions.setRent, g.id, count);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const diff = count - rented;
    onDone(diff > 0 ? `+${fmtCardsCount(diff)} ${g.name}` : `Возвращено ${fmtCardsCount(-diff)} ${g.name}`);
  };

  const cost = count === null ? null : monthlyCost(s, g.id, count);
  const delta = count === null ? null : { money: monthlyCost(s, g.id, count) - monthlyCost(s, g.id, rented), power: (count - rented) * g.h100e };
  const overCost = count === null || over === 0 ? 0 : monthlyCost(s, g.id, count) - monthlyCost(s, g.id, cap);

  return (
    <Dialog
      title="Аренда видеокарт"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <GuardButton className="btn primary cw-rd-submit" data-tutorial="rent-confirm" reason={reason} onClick={submit}>
            {label}
          </GuardButton>
        </>
      }
    >
      <div className="cw-rd">
        <GpuChooser
          day={s.day}
          items={list.map((x) => ({
            gpu: x,
            price: `${fmtCardMonth(rentPerGpuDay(s, x.id))} в месяц`,
            tag: x.id === cheapest ? 'Выгоднее всего' : null,
            note: s.compute.rented[x.id] > 0 ? `в аренде ${fmtInt(s.compute.rented[x.id])}` : null,
          }))}
          value={g.id}
          onPick={(next) => pick(GPUS.find((x) => x.id === next) ?? g)}
          facts={[
            { label: 'Мощность', value: powerFact(g, list) },
            { label: 'Цена', value: `${fmtCardMonth(rentPerGpuDay(s, g.id))} за карту в месяц` },
            { label: 'На рынке', value: `с ${g.availableFrom.slice(0, 4)} года` },
          ]}
        />

        <div className="cw-qty">
          <label htmlFor="cw-qty-num">Количество</label>
          <div className={`cw-qty-range${capFrac === null ? '' : ' has-cap'}`} style={{ '--cap': capFrac ?? 1 } as CSSProperties}>
            <Range value={count ?? 0} min={0} max={max} label="Количество карт" onChange={(v) => setCount(String(v))} />
          </div>
          <input
            id="cw-qty-num"
            type="number"
            inputMode="numeric"
            min={0}
            max={max}
            step={1}
            value={text}
            onChange={(e) => setCount(e.target.value)}
            onBlur={normalize}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {/* Строка зарезервирована всегда: подсказка меняется, высота диалога - нет. */}
          <div className={`cw-qty-note${count === null || error ? ' bad' : over > 0 ? ' warn' : ''}`} role="status">
            {error ??
              (count === null
                ? `Введите целое число от 0 до ${fmtInt(max)}`
                : over > 0
                  ? `Сверх лимита ${fmtInt(over)} шт.: цена ${OVER_TIMES} выше, надбавка ${fmtMoney(overCost)} в месяц`
                  : `По обычной цене - до ${fmtCardsCount(cap)}, всего можно ${fmtInt(max)}`)}
          </div>
        </div>

        <div className="cw-sum">
          <div className="cw-sum-i">
            <span>Мощность {g.name}</span>
            <b>{count === null ? '-' : `${fmtH(count * g.h100e)} H100e`}</b>
            <Delta value={delta && count !== rented ? delta.power : null} good={(v) => v > 0} fmt={(v) => `${fmtH(v)} H100e`} />
          </div>
          <div className="cw-sum-i">
            <span>Аренда этих карт в месяц</span>
            <b className={cost ? 'bad' : undefined}>{cost === null ? '-' : fmtMoney(cost)}</b>
            <Delta value={delta && count !== rented ? delta.money : null} good={(v) => v < 0} fmt={fmtMoney} />
          </div>
          <div className="cw-sum-i">
            <span>Карт</span>
            <b>{count === null ? '-' : `${fmtInt(count)} шт.`}</b>
            <small>сейчас {fmtInt(rented)} шт.</small>
          </div>
          <div className="cw-sum-i">
            <span>На счёте</span>
            <b className={s.cash < 0 ? 'bad' : undefined}>{fmtMoney(s.cash)}</b>
            <small title="Аренда всех карт после изменения">вся аренда {count === null ? '-' : fmtMoney(rentPerDay(s) * DAYS_IN_MONTH + (delta?.money ?? 0))} в месяц</small>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Строка изменения под числом: «+2,05 H100e» зелёным или красным; без изменения - прочерк. */
function Delta({ value, good, fmt }: { value: number | null; good: (v: number) => boolean; fmt: (v: number) => string }) {
  if (value === null || value === 0) return <small>без изменений</small>;
  return (
    <small className={good(value) ? 'good' : 'bad'}>
      {value > 0 ? '+' : '−'}
      {fmt(Math.abs(value))}
    </small>
  );
}

// ---------- Распределение мощности ----------

type NeedChannel = 'api' | 'subs';

function safeInferenceNeed(s: GameState): Record<NeedChannel, number> | null {
  try {
    const need = inferenceNeed(s, marketSnapshot(s));
    return Number.isFinite(need.api) && Number.isFinite(need.subs) ? need : null;
  } catch {
    return null;
  }
}

/** «Нужно клиентам» под строкой API или «Подписки»: одна строка постоянной высоты, нехватка - оранжевым справа. */
function ClientNeed({ s, need, have, label = 'Нужно клиентам' }: { s: GameState; need: number | undefined; have: number; label?: string }) {
  if (need === undefined || !(need > 0)) return null;
  const short = need > have * (1 + 1e-9) + 1e-9;
  return (
    <div className={`cw-need${short ? ' short' : ''}`}>
      <span className="cw-need-t">
        {label}: <b>{fmtH(need)} H100e</b>
        <Cards s={s} h100e={need} />
      </span>
      {short && <span className="cw-need-short">не хватает {fmtH(need - have)}</span>}
    </div>
  );
}

/**
 * Что даёт доля «Обучение» или «Исследования»: срок текущего проекта при принятой доле и, пока ползунок двигают, при новой
 * («готово 02.05.2017 → 13.04.2017»). Строка есть всегда, поэтому окно не меняет высоту.
 */
function RowEffect({ s, k, share }: { s: GameState; k: 'training' | 'experiments'; share: number }) {
  let name: string | null = null;
  let now: number | null = null;
  let next: number | null = null;
  if (k === 'training') {
    const run = s.trainings.find((x) => !x.failed);
    if (run) {
      name = run.plan.name;
      now = trainingDaysAt(s, run, s.compute.alloc.training);
      next = trainingDaysAt(s, run, share);
    }
  } else if (s.research.current) {
    const cur = s.research.current;
    name = TECHS.find((x) => x.id === cur)?.name ?? cur;
    const a = researchDaysAt(s, cur, s.compute.alloc.experiments);
    const b = researchDaysAt(s, cur, share);
    now = Number.isFinite(a) ? a : null;
    next = Number.isFinite(b) ? b : null;
  }
  if (name === null) {
    return (
      <div className="cw-need">
        <span className="cw-need-t">{k === 'training' ? 'Обучение не идёт' : 'Исследование не выбрано'}</span>
      </div>
    );
  }
  const date = (d: number | null) => (d === null ? 'не скоро' : formatDateShort(s.day + d));
  const moved = now !== next;
  const tone = !moved ? '' : next === null || (now !== null && next > now) ? ' later' : ' sooner';
  return (
    <div className="cw-need">
      <span className="cw-need-t">
        «{name}»: готово <b>{date(now)}</b>
        {moved && <span className={`cw-eff${tone}`}> → {date(next)}</span>}
      </span>
    </div>
  );
}

/**
 * Доли «как нужно»: контрактам и клиентам - сколько им нужно сейчас (+5 %), остальное - обучению и исследованиям
 * в прежнем соотношении (если идёт только что-то одно - ему всё).
 */
function autoPercents(s: GameState, cur: Percents): Percents {
  const total = totalH100e(s);
  if (!(total > 0)) return cur;
  const need = safeInferenceNeed(s);
  const pct = (h: number) => (h > 0 ? Math.min(100, Math.ceil((h / total) * 105)) : 0);
  let contracts = pct(contractsNeedWithApplications(s) ?? 0);
  let api = need ? pct(need.api) : cur.api;
  let subs = need ? pct(need.subs) : cur.subs;
  const used = contracts + api + subs;
  if (used > 100) {
    [contracts, api, subs] = distribute([contracts, api, subs], 100);
  }
  const rest = 100 - contracts - api - subs;
  const training = s.trainings.length > 0;
  const research = s.research.current !== null;
  const wT = training ? Math.max(1, cur.training) : 0;
  const wE = research ? Math.max(1, cur.experiments) : 0;
  const [t, e] = wT + wE > 0 ? distribute([wT, wE], rest) : [rest, 0];
  return { training: t, contracts, experiments: e, api, subs };
}

/** Одна полоса долей: границы между соседними долями тянутся мышью или стрелками, отпустили - доли применены. */
function SplitBar({ rows, shown, onDrag, onDone }: { rows: typeof ALLOC_ROWS; shown: Percents; onDrag: (p: Percents) => void; onDone: (p: Percents) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ a: AllocKey; b: AllocKey; x0: number; a0: number; b0: number; last: Percents } | null>(null);
  const moveTo = (clientX: number) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    const delta = Math.round(((clientX - d.x0) / el.clientWidth) * 100);
    const a = Math.max(0, Math.min(d.a0 + d.b0, d.a0 + delta));
    const next = { ...shown, [d.a]: a, [d.b]: d.a0 + d.b0 - a };
    d.last = next;
    onDrag(next);
  };
  const nudge = (a: AllocKey, b: AllocKey, step: number) => {
    if (shown[a] + step < 0 || shown[b] - step < 0) return;
    const next = { ...shown, [a]: shown[a] + step, [b]: shown[b] - step };
    onDrag(next);
    onDone(next);
  };
  let left = 0;
  return (
    <div className="cw-split" ref={ref}>
      {rows.map((r) => {
        const w = shown[r.key];
        const seg = (
          <div key={r.key} className="cw-seg" style={{ left: `${left}%`, width: `${w}%`, background: r.color }}>
            {w >= 9 && (
              <span>
                {r.label} {w} %
              </span>
            )}
          </div>
        );
        left += w;
        return seg;
      })}
      {rows.slice(0, -1).map((r, i) => {
        const b = rows[i + 1];
        const at = rows.slice(0, i + 1).reduce((a, x) => a + shown[x.key], 0);
        return (
          <div
            key={`h-${r.key}`}
            className="cw-handle"
            style={{ left: `${at}%` }}
            role="slider"
            tabIndex={0}
            aria-label={`Граница «${r.label}» и «${b.label}»`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={shown[r.key]}
            aria-valuetext={`${r.label} ${shown[r.key]} %, ${b.label} ${shown[b.key]} %`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { a: r.key, b: b.key, x0: e.clientX, a0: shown[r.key], b0: shown[b.key], last: shown };
            }}
            onPointerMove={(e) => drag.current && moveTo(e.clientX)}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d) onDone(d.last);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') nudge(r.key, b.key, -1);
              else if (e.key === 'ArrowRight') nudge(r.key, b.key, 1);
              else return;
              e.preventDefault();
            }}
          />
        );
      })}
    </div>
  );
}

function SplitPanel({ s, open }: { s: GameState; open: WindowProps['open'] }) {
  const [draft, setDraft] = useState<Percents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zero, setZero] = useState<{ p: Percents; keys: (keyof SoldChannels)[] } | null>(null);
  const current = percentsOf(s.compute.alloc);
  const shown = draft ?? current;
  const total = totalH100e(s);
  const occ = occupancy(shown);
  const need = safeInferenceNeed(s);
  const rows = visibleRows(s);
  const auto = autoPercents(s, current);
  const autoSame = samePercents(auto, current);

  const commit = (p: Percents) => {
    const r = store.dispatch(actions.setAllocation, toAllocation(p));
    setError(r.ok ? null : r.error);
    setDraft(null);
  };
  const apply = (p: Percents) => {
    if (samePercents(p, current)) {
      setDraft(null);
      return;
    }
    const check = checkAllocation(p, soldChannels(s.models));
    if (check.error) {
      setError(check.error);
      setDraft(null);
      return;
    }
    // Спрашиваем, только если продаваемый канал обнуляется сейчас: уже нулевая доля не мешает двигать другие.
    const newlyZero = check.zero.filter((k) => current[k] > 0);
    if (newlyZero.length > 0) {
      setZero({ p, keys: newlyZero });
      return;
    }
    commit(p);
  };

  return (
    <section className="cw-panel" data-tutorial="alloc">
      <div className="cw-panel-head">
        <h2 className="cw-h">Чем заняты карты</h2>
        <div className={`cw-occ ${total > 0 ? occ.tone : 'none'}`} role="status">
          {error ?? (total > 0 ? occ.text : 'Мощности пока нет: доли заработают после аренды.')}
        </div>
        <GuardButton className="btn small" reason={total > 0 ? (autoSame ? 'Доли уже такие, как нужно сейчас' : null) : 'Сначала арендуйте карты'} onClick={() => apply(auto)}>
          Как нужно
        </GuardButton>
      </div>
      <SplitBar rows={rows} shown={shown} onDrag={setDraft} onDone={apply} />
      <div className="cw-cols" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((r) => {
          const h = (total * shown[r.key]) / 100;
          return (
            <div key={r.key} className="cw-col" title={r.hint}>
              <div className="cw-col-top">
                <span className="cw-dot" style={{ background: r.color }} />
                <span className="cw-alloc-name">
                  <RowLabel s={s} r={r} />
                </span>
                <b className="cw-col-pct">{shown[r.key]} %</b>
              </div>
              <div className="cw-col-val">
                {fmtH(h)} H100e <Cards s={s} h100e={h} />
              </div>
              {(r.key === 'api' || r.key === 'subs') && <ClientNeed s={s} need={need?.[r.key]} have={h} />}
              {(r.key === 'training' || r.key === 'experiments') && total > 0 && <RowEffect s={s} k={r.key} share={shown[r.key] / 100} />}
              {r.key === 'contracts' && (
                <ClientNeed s={s} need={contractsNeedWithApplications(s) ?? undefined} have={h} label={s.contracts.length > 0 ? 'Нужно контрактам' : 'Нужно по заявке'} />
              )}
            </div>
          );
        })}
      </div>
      <IdleStrip s={s} open={open} />
      {zero && (
        <ConfirmDialog
          title="Нулевая доля мощности"
          confirmLabel="Распределить"
          onConfirm={() => {
            const p = zero.p;
            setZero(null);
            commit(p);
          }}
          onClose={() => {
            setZero(null);
            setDraft(null);
          }}
        >
          {zero.keys.map((k) => (
            <p key={k} className="cw-confirm-line">
              {ZERO_SHARE_WARNING[k]}
            </p>
          ))}
        </ConfirmDialog>
      )}
    </section>
  );
}

// ---------- Простой мощности ----------

function IdleStrip({ s, open }: { s: GameState; open: WindowProps['open'] }) {
  const items = idleWarnings(s);
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
        {rest > 0 && (
          <div className="cw-idle-more">
            Ещё {rest}: {items.slice(2).map((i) => i.reason).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Окно ----------

/** Карта, выбранная в диалоге по умолчанию: самая выгодная из вышедших. */
function defaultRentId(s: GameState): GpuId {
  return cheapestGpuId(s) ?? availableGpus(s)[0]?.id ?? GPUS[0].id;
}

/** Плашка после аренды видна 2,6 с. */
const FLASH_MS = 2600;

export default function ComputeWindow({ s, open }: WindowProps) {
  const [dialog, setDialog] = useState<RentTarget | null>(null);
  const [flash, setFlash] = useState<RentFlash | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const done = (text: string) => {
    setDialog(null);
    playSound('rack');
    setFlash({ key: Date.now(), text });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };

  return (
    <div className="cw">
      <div className="cw-top">
        <Hall s={s} shown={percentsOf(s.compute.alloc)} flash={flash} />
        <Side
          s={s}
          open={open}
          onRent={() => setDialog({ id: defaultRentId(s) })}
          onEdit={(id) => setDialog({ id })}
          onGiveBack={(id) => setDialog({ id, count: 0 })}
        />
      </div>
      <SplitPanel s={s} open={open} />
      {dialog && createPortal(<RentDialog s={s} target={dialog} onClose={() => setDialog(null)} onDone={done} />, document.body)}
    </div>
  );
}
