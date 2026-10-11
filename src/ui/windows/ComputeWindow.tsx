// Окно «Мощности» (FR-2): аренда GPU и деление мощности на четыре доли.

import { useState } from 'react';
import type { WindowProps } from '.';
import { GPUS } from '../../data/gpus';
import { isGpuAvailable, pool, rentCapFor, rentPerDay, rentPerGpuDay, totalH100e } from '../../sim/compute';
import { inferenceNeed, marketSnapshot } from '../../sim/market';
import { dateToDay, formatDateShort } from '../../sim/time';
import type { Allocation, GameState, GpuDef, GpuId } from '../../sim/types';
import { ErrorText, Stat } from '../components/common';
import { fmtMoney, fmtNum, fmtPct } from '../format';
import { actions, store } from '../store';

/** H100e: у одной карты это доли (0,019), у всей аренды — десятки и тысячи. */
function fmtH(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e4) return fmtNum(n);
  const digits = n < 1 ? 3 : n < 10 ? 2 : n < 1000 ? 1 : 0;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// ---------- Доли мощности ----------

type AllocKey = keyof Allocation;

const ALLOC_ROWS: { key: AllocKey; label: string; hint: string }[] = [
  { key: 'training', label: 'Обучение', hint: 'Скорость проекта обучения: чем больше доля, тем быстрее готова модель.' },
  { key: 'contracts', label: 'Контракты', hint: 'Работа по выигранным тендерам на дообучение и RLHF.' },
  { key: 'experiments', label: 'Эксперименты', hint: 'Очки исследований: открывают технологии в окне «Исследования».' },
  { key: 'inference', label: 'Клиенты', hint: 'Обслуживание запросов к вашим моделям по API: от этого зависит выручка.' },
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

/** Нужная клиентам мощность; если модуль рынка недоступен или упал — null. */
function safeInferenceNeed(s: GameState): number | null {
  try {
    const need = inferenceNeed(s, marketSnapshot(s));
    return Number.isFinite(need) ? need : null;
  } catch {
    return null;
  }
}

function InferenceStatus({ s }: { s: GameState }) {
  const need = safeInferenceNeed(s);
  if (need === null) return null;
  const have = pool(s, 'inference');
  if (need <= 0) {
    return (
      <div className="muted small">
        Пока никто не пользуется вашими моделями по API. Выпустите модель в окне «Модели».
      </div>
    );
  }
  if (need > have * (1 + 1e-9) + 1e-9) {
    return (
      <div className="bad small">
        Не хватает мощности: клиенты уходят. Нужно ≈ {fmtH(need)} H100e, есть {fmtH(have)} H100e (не хватает ≈{' '}
        {fmtH(need - have)}). Лишний спрос теряется, а шумиха падает.
      </div>
    );
  }
  return (
    <div className="good small">
      Мощности хватает: клиентам нужно ≈ {fmtH(need)} H100e, выделено {fmtH(have)} H100e.
    </div>
  );
}

function AllocSection({ s }: { s: GameState }) {
  const [error, setError] = useState<string | null>(null);
  const percents = percentsOf(s.compute.alloc);
  const total = totalH100e(s);

  const change = (key: AllocKey, value: number) => {
    const r = store.dispatch(actions.setAllocation, withShare(s.compute.alloc, key, value));
    setError(r.ok ? null : r.error);
  };

  return (
    <>
      <div className="section-title">Куда направить мощность</div>
      <div className="muted small" style={{ marginBottom: 6 }}>
        Четыре доли всегда дают 100 %: когда вы двигаете одну, остальные подстраиваются пропорционально.
        {total <= 0 && ' Сначала арендуйте GPU в таблице выше: пока мощности нет, делить нечего.'}
      </div>
      <div className="col" style={{ gap: 6 }}>
        {ALLOC_ROWS.map((r) => (
          <div key={r.key}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div style={{ width: 96 }}>{r.label}</div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={percents[r.key]}
                onChange={(e) => change(r.key, Number(e.target.value))}
                style={{ flex: 1, minWidth: 100 }}
                aria-label={r.label}
              />
              <div className="num" style={{ width: 44 }}>{fmtPct(percents[r.key], 0)}</div>
              <div className="num" style={{ width: 96 }}>{fmtH(pool(s, r.key))} H100e</div>
            </div>
            <div className="muted small">{r.hint}</div>
            {r.key === 'inference' && <InferenceStatus s={s} />}
          </div>
        ))}
      </div>
      <ErrorText error={error} />
    </>
  );
}

// ---------- Таблица аренды ----------

function RentCell({ s, g, onError }: { s: GameState; g: GpuDef; onError: (id: GpuId, e: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const rented = s.compute.rented[g.id];
  const avail = isGpuAvailable(s, g.id);
  const cap = rentCapFor(s, g.id);
  const atCap = rented >= cap;
  const noGrowReason = !avail ? 'Этот GPU ещё не вышел' : atCap ? `Достигнут лимит аренды: ${cap} шт.` : undefined;

  const apply = (n: number) => {
    const r = store.dispatch(actions.setRent, g.id, n);
    onError(g.id, r.ok ? null : r.error);
  };
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === '') return;
    const n = Math.floor(Number(text));
    if (!Number.isFinite(n)) {
      onError(g.id, 'Введите число GPU');
      return;
    }
    if (n !== rented) apply(n);
  };

  return (
    <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
      <input
        type="number"
        min={0}
        step={1}
        style={{ width: 70 }}
        disabled={!avail && rented === 0}
        title={!avail ? 'Этот GPU ещё не вышел' : 'Сколько GPU арендовать (Enter или выход из поля — применить)'}
        value={draft ?? String(rented)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      <button className="btn small" disabled={rented <= 0} title={rented <= 0 ? 'Уже ноль' : undefined} onClick={() => apply(Math.max(0, rented - 10))}>
        −10
      </button>
      <button className="btn small" disabled={!avail || atCap} title={noGrowReason} onClick={() => apply(Math.min(cap, rented + 10))}>
        +10
      </button>
      <button className="btn small" disabled={!avail || atCap} title={noGrowReason} onClick={() => apply(cap)}>
        макс
      </button>
    </div>
  );
}

export default function ComputeWindow({ s }: WindowProps) {
  const [errors, setErrors] = useState<Partial<Record<GpuId, string>>>({});
  const setError = (id: GpuId, e: string | null) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (e) next[id] = e;
      else delete next[id];
      return next;
    });

  const perDay = rentPerDay(s);
  const errorLines = GPUS.filter((g) => errors[g.id]);

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="muted small">
        H100e — мощность в «эквивалентах H100»: так сравниваются карты разных лет. Аренда списывается каждый день по
        цене текущего года. Лимит на тип карты растёт с годами.
      </div>

      <table className="grid">
        <thead>
          <tr>
            <th>GPU</th>
            <th className="num" title="Мощность одной карты в эквивалентах H100">H100e / шт.</th>
            <th className="num" title="Аренда одной карты за сутки">$ / шт. в день</th>
            <th className="num" title="Цена одной единицы мощности H100e за сутки: чем ниже, тем выгоднее">$ / H100e в день</th>
            <th className="num">Арендовано</th>
            <th className="num" title="Больше арендовать в этом году нельзя">Лимит</th>
          </tr>
        </thead>
        <tbody>
          {GPUS.map((g) => {
            const avail = isGpuAvailable(s, g.id);
            const from = formatDateShort(dateToDay(g.availableFrom));
            const price = rentPerGpuDay(s, g.id);
            const cap = rentCapFor(s, g.id);
            return (
              <tr key={g.id} className={avail ? undefined : 'dim'}>
                <td>
                  <div>{g.name}</div>
                  <div className="muted small">{avail ? `вышел ${from}` : `с ${from}`}</div>
                </td>
                <td className="num">{fmtH(g.h100e)}</td>
                <td className="num">{fmtMoney(price)}</td>
                <td className="num">{fmtMoney(price / g.h100e)}</td>
                <td className="num">
                  <RentCell s={s} g={g} onError={setError} />
                </td>
                <td className={`num${avail && s.compute.rented[g.id] >= cap ? ' warn' : ''}`}>{fmtNum(cap)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {errorLines.map((g) => (
        <ErrorText key={g.id} error={`${g.name}: ${errors[g.id]}`} />
      ))}

      <div className="row" style={{ marginTop: 4 }}>
        <Stat label="Всего мощности" value={`${fmtH(totalH100e(s))} H100e`} />
        <Stat label="Аренда в день" value={fmtMoney(perDay)} />
        <Stat label="Аренда в месяц (×30)" value={fmtMoney(perDay * 30)} hint={`на счету ${fmtMoney(s.cash)}`} />
      </div>

      <AllocSection s={s} />
    </div>
  );
}
