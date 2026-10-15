// Общие части вкладок «Аналитики»: названия и цвета владельцев, светлый график с легендой-переключателем, тёмная полоса показателей.

import { memo, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LABS, PLAYER_COLOR } from '../../data/labs';
import { dayToDate, formatMonth } from '../../sim/time';
import type { GameState, HypeOwner, MonthLedger, MonthRecord } from '../../sim/types';

const LAB_BY_ID = new Map(LABS.map((l) => [l.id, l]));

/** Цвет игрока на светлом фоне: светло-серый цвет графиков там не виден. */
const PLAYER_ON_LIGHT = '#2f80e4';

export function ownerName(s: GameState, owner: HypeOwner): string {
  if (owner === 'player') return s.labName;
  return LAB_BY_ID.get(owner)?.name ?? owner;
}

/** Светлые цвета лабораторий (жёлтый Moonshoot) на белом почти не видны: такие затемняем на четверть. */
function readableOnWhite(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (0.299 * r + 0.587 * g + 0.114 * b < 170) return hex;
  const k = (x: number) => Math.round(x * 0.75).toString(16).padStart(2, '0');
  return `#${k(r)}${k(g)}${k(b)}`;
}

/** Цвет владельца: dark - на тёмном фоне, иначе на белом (таблицы и графики). */
export function ownerColor(owner: HypeOwner, dark = false): string {
  if (owner === 'player') return dark ? PLAYER_COLOR : PLAYER_ON_LIGHT;
  const c = LAB_BY_ID.get(owner)?.color ?? PLAYER_COLOR;
  return dark ? c : readableOnWhite(c);
}

/** Название владельца с цветной точкой. */
export function OwnerTag({ s, owner }: { s: GameState; owner: HypeOwner }) {
  return (
    <span className="own">
      <i className="own-dot" style={{ background: ownerColor(owner) }} />
      {ownerName(s, owner)}
    </span>
  );
}

/** Результат расчёта или null, если модуль симуляции не смог его выдать (битое сохранение). */
export function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export function finite(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

// ---------- Полоса показателей ----------

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  title?: string;
}

/** Тёмная полоса главных чисел вкладки (как полоса прогноза в «Новой модели»). */
export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div className="stat-strip">
      {items.map((it, i) => (
        <div key={i} className="stat" title={it.title}>
          <div className="stat-v">{it.value}</div>
          <div className="stat-l">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- График ----------

export interface SeriesDef {
  id: string;
  label: string;
  color: string;
  title?: string;
  pick: (r: MonthRecord) => number;
}

export interface ChartData {
  labels: string[]; // «03.21»
  fullLabels: string[]; // «Март 2021»
  series: { id: string; label: string; color: string; title?: string; values: number[] }[];
}

/** Ряды по закрытым месяцам. Вызывать из useMemo по истории и её длине. */
export function buildChartData(history: MonthRecord[], defs: SeriesDef[]): ChartData {
  return {
    labels: history.map((r) => `${String(r.month).padStart(2, '0')}.${String(r.year % 100).padStart(2, '0')}`),
    fullLabels: history.map((r) => formatMonth(r.year, r.month)),
    series: defs.map((d) => ({
      id: d.id,
      label: d.label,
      color: d.color,
      title: d.title,
      values: history.map((r) => finite(d.pick(r))),
    })),
  };
}

/** Деления оси: от нуля до круглого числа не меньше max. */
function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const count = Math.ceil(max / step - 1e-9);
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Number((i * step).toPrecision(12)));
  return ticks;
}

const PAD = { top: 10, bottom: 28, left: 80 } as const;
const INSET = 20; // отступ первой и последней точки от краёв области (по ним центрируются подписи месяцев)
const X_LABEL_GAP = 54; // минимальное расстояние между подписями месяцев, px

interface PlotProps {
  width: number;
  height: number;
  labels: string[];
  series: ChartData['series'];
  yFormat: (v: number) => string;
  hover: number | null;
  onHover: (i: number | null) => void;
  /** Логарифмическая шкала (цены падают в сотни раз); значения 0 и меньше - пропуск, линия рвётся. */
  log?: boolean;
}

// Перерисовывается, только когда меняются данные (раз в месяц), размер или точка под курсором.
const PlotSvg = memo(function PlotSvg({ width, height, labels, series, yFormat, hover, onHover, log = false }: PlotProps) {
  const n = labels.length;
  const plotW = Math.max(40, width - PAD.left);
  const plotH = height - PAD.top - PAD.bottom;

  let max = 0;
  let min = Infinity;
  for (const sr of series)
    for (const v of sr.values) {
      if (v > max) max = v;
      if (v > 0 && v < min) min = v;
    }
  let ticks: number[];
  let y: (v: number) => number;
  if (log) {
    // Чуть ниже минимума: ряд, равный круглому числу ($100), не ложится на нижнюю ось.
    const lo = Number.isFinite(min) ? Math.floor(Math.log10(min * 0.95)) : 0;
    const hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(max, 1e-9))));
    ticks = n === 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, i) => Number((10 ** (lo + i)).toPrecision(12)));
    y = (v: number) => PAD.top + plotH - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo)) * plotH;
  } else {
    ticks = n === 0 ? [] : niceTicks(max);
    const top = ticks.length > 0 ? ticks[ticks.length - 1] : 1;
    y = (v: number) => PAD.top + plotH - (Math.max(0, v) / top) * plotH;
  }
  const missing = (v: number) => log && !(v > 0);
  /** Куски линии без пропусков. */
  const segments = (values: number[]): string[] => {
    const out: string[] = [];
    let cur: string[] = [];
    values.forEach((v, i) => {
      if (missing(v)) {
        if (cur.length > 1) out.push(cur.join(' '));
        cur = [];
        return;
      }
      cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (cur.length > 1) out.push(cur.join(' '));
    return out;
  };

  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : INSET + (i * (plotW - 2 * INSET)) / (n - 1));

  const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((plotW - 2 * INSET) / X_LABEL_GAP))));

  function indexAt(e: React.MouseEvent<SVGRectElement>): number {
    if (n <= 1) return 0;
    const box = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - box.left - INSET) / Math.max(1, box.width - 2 * INSET);
    return Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))));
  }

  return (
    <svg width={width} height={height} role="img" aria-label="График по месяцам">
      <rect className="pl-bg" x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
      {ticks.map((t) => (
        <g key={t}>
          <line className={`pl-grid${t === 0 ? ' base' : ''}`} x1={PAD.left} x2={width} y1={y(t)} y2={y(t)} />
          <text className="pl-tick" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
            {yFormat(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        (n - 1 - i) % step === 0 ? (
          <text key={i} className="pl-tick" x={x(i)} y={height - 8} textAnchor="middle">
            {l}
          </text>
        ) : null,
      )}
      {n >= 2 &&
        series.length === 1 &&
        segments(series[0].values).map((pts, k) => {
          const xs = pts.split(' ');
          const first = xs[0].split(',')[0];
          const last = xs[xs.length - 1].split(',')[0];
          const base = (PAD.top + plotH).toFixed(1);
          return <polygon key={`area-${k}`} points={`${first},${base} ${pts} ${last},${base}`} fill={series[0].color} className="pl-area" />;
        })}
      {n >= 2 &&
        series.map((sr) =>
          segments(sr.values).map((pts, k) => (
            <polyline
              key={`${sr.id}-${k}`}
              fill="none"
              stroke={sr.color}
              strokeWidth={2.4}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={pts}
            />
          )),
        )}
      {n === 1 && series.map((sr) => <circle key={sr.id} cx={x(0)} cy={y(sr.values[0])} r={3.5} fill={sr.color} />)}
      {hover !== null && hover < n && (
        <g pointerEvents="none">
          <line className="pl-cursor" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
          {series.map((sr) =>
            missing(sr.values[hover]) ? null : (
              <circle key={sr.id} cx={x(hover)} cy={y(sr.values[hover])} r={4} fill={sr.color} className="pl-point" />
            ),
          )}
        </g>
      )}
      {n > 0 && (
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={(e) => onHover(indexAt(e))}
          onMouseLeave={() => onHover(null)}
        />
      )}
    </svg>
  );
});

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * График по месяцам на белом поле, справа легенда. В легенде - значения за идущий месяц (live) или за месяц
 * под курсором; нажатие на строку легенды прячет ряд (шкала пересчитывается по видимым рядам).
 */
export function ChartPanel(props: {
  data: ChartData;
  yFormat: (v: number) => string;
  live: Record<string, number>;
  liveLabel: string;
  height?: number;
  legendWidth?: number;
  log?: boolean;
}) {
  const { data, yFormat, live, liveLabel, height = 260, legendWidth = 220, log = false } = props;
  const fmtLegend = (v: number) => (log && !(v > 0) ? '-' : yFormat(v));
  const mainRef = useRef<HTMLDivElement>(null);
  const width = useWidth(mainRef);
  const [hover, setHover] = useState<number | null>(null);
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const hov = hover !== null && hover < data.labels.length ? hover : null;
  const plotH = height - PAD.top - PAD.bottom;
  const shown = data.series.filter((sr) => !off.has(sr.id));
  const toggle = (id: string) =>
    setOff((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (data.series.length - next.size > 1) next.add(id); // хотя бы один ряд остаётся
      return next;
    });

  return (
    <div className="pl">
      <div className="pl-main" ref={mainRef} style={{ height }}>
        {width > 0 && (
          <PlotSvg
            width={width}
            height={height}
            labels={data.labels}
            series={shown}
            yFormat={yFormat}
            hover={hov}
            onHover={setHover}
            log={log}
          />
        )}
        {data.labels.length === 0 && (
          <div className="pl-empty" style={{ left: PAD.left, top: PAD.top, height: plotH }}>
            Данных пока нет. Точка появляется в конце каждого месяца.
          </div>
        )}
      </div>
      <div className="pl-legend legend" style={{ width: legendWidth, height: plotH, marginTop: PAD.top }}>
        <div className="pl-head">{hov !== null ? data.fullLabels[hov] : liveLabel}</div>
        {data.series.map((sr) => {
          const hidden = off.has(sr.id);
          return (
            <button
              type="button"
              className={`r pl-row${hidden ? ' off' : ''}`}
              key={sr.id}
              title={sr.title ?? (data.series.length > 1 ? (hidden ? 'Показать на графике' : 'Скрыть с графика') : undefined)}
              aria-pressed={!hidden}
              onClick={() => data.series.length > 1 && toggle(sr.id)}
            >
              <span className="pl-name">
                <i className="dot" style={{ background: sr.color }} />
                {sr.label}
              </span>
              <span className="num">{fmtLegend(hov !== null ? sr.values[hov] : finite(live[sr.id]))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Что показывать как «текущий месяц»: после финала декабрь уже закрыт и идущий месяц пуст, поэтому берём закрытый.
 * closed - показан закрытый месяц (без пометки «идёт»).
 */
export function currentMonthView(s: GameState): { ledger: MonthLedger; label: string; closed: boolean } {
  const cur = dayToDate(s.day);
  const last = s.finance.history.at(-1);
  if (s.outcome && last && last.year === cur.year && last.month === cur.month) {
    return { ledger: last, label: formatMonth(cur.year, cur.month), closed: true };
  }
  return { ledger: s.finance.month, label: liveMonthLabel(cur.year, cur.month), closed: false };
}

/** Подпись идущего месяца для легенды: «Июнь 2021 (идёт)». */
export function liveMonthLabel(year: number, month: number): string {
  return `${formatMonth(year, month)} (идёт)`;
}
