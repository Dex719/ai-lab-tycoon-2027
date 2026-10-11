// Окно «Исследования»: карта всех технологий на сером холсте (образец - «Исследования» в Processor Tycoon).
// Столбцы - годы появления в истории, линии - требования. Карту можно двигать мышью или пальцем и масштабировать.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { GPUS } from '../../data/gpus';
import { pool, rentPerDay, totalH100e } from '../../sim/compute';
import { ALGO_MULT, CONTEXT_LEVELS, RP_BASE, RP_K } from '../../sim/constants';
import {
  BRANCH_NAMES,
  CONTEXT_MAX_LEVEL,
  contextLabel,
  earlyPenalty,
  maxContext,
  missingRequirements,
  researchBlockReason,
  rpPerDay,
  TECHS,
  techCost,
  techHistoryDay,
  techRequires,
} from '../../sim/research';
import type { TechBranch } from '../../sim/research';
import { formatDateShort } from '../../sim/time';
import type { GameState, TechId } from '../../sim/types';
import { percentsOf, toAllocation, withPercent } from '../alloc';
import { Alert, Dialog, ErrorText, Range } from '../components/common';
import { fmtMoney, fmtMult, fmtNum, fmtPct } from '../format';
import { IconCheck, IconLock } from '../icons';
import { actions, store } from '../store';
import {
  BRANCH_COLOR,
  clampZoom,
  GRAPH_ROW,
  GRAPH_ROWS,
  GRAPH_TECHS,
  graphCol,
  graphEdges,
  graphYears,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from './researchMap';
import type { GraphTech } from './researchMap';
import './ResearchWindow.css';

type Status = 'done' | 'current' | 'available' | 'blocked';

// Размеры холста при масштабе 1, px.
const NW = 240; // ширина узла
const NH = 100; // высота узла
const PAD = 32; // поля
const YEAR_H = 30; // строка годов над картой
const COL_GAP = 64; // между столбцами
const ROW_GAP = 30; // между строками (в нём подпись «Раньше истории»)
const CHAIN_GAP = 56; // от карты до цепочек
const CHIP_W = 60;
const CHIP_H = 36;
const CHIP_GAP = 8;
const CHIP_LINK = 28; // от последнего значка до узла
const MAX_CHIPS = 8;

const COL_W = NW + COL_GAP;
const ROW_H = NH + ROW_GAP;

// Сохранённый вид карты: масштаб и прокрутка.
const VIEW_KEY = 'ai-lab-tycoon:research-view';
const DRAG_THRESHOLD = 4; // px: меньше - это щелчок, а не перетаскивание

interface SavedView {
  zoom: number;
  left: number;
  top: number;
}

function loadView(): SavedView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedView>;
    if (typeof v.zoom !== 'number' || typeof v.left !== 'number' || typeof v.top !== 'number') return null;
    return { zoom: clampZoom(v.zoom), left: Math.max(0, v.left), top: Math.max(0, v.top) };
  } catch {
    return null;
  }
}

function saveView(v: SavedView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // Хранилище недоступно: вид просто не запомнится.
  }
}

function techInfo(id: TechId) {
  return TECHS.find((t) => t.id === id)!;
}

function techName(id: TechId): string {
  return TECHS.find((t) => t.id === id)?.name ?? id;
}

function statusOf(s: GameState, id: TechId, reason: string | null): Status {
  if (id !== 'algo' && s.research.done.includes(id)) return 'done';
  if (s.research.current === id) return 'current';
  return reason ? 'blocked' : 'available';
}

/** Подсказка к закрытому узлу: «Нужно: «A», «B»» или причина из sim. */
function lockText(s: GameState, id: TechId, reason: string | null): string {
  const missing = missingRequirements(s, id);
  if (missing.length > 0) return `Нужно: ${missing.map((t) => `«${techName(t)}»`).join(', ')}`;
  return reason ?? 'Исследование недоступно';
}

/** Дней до конца технологии при текущей скорости очков; null, если очки не копятся. */
function daysLeft(s: GameState, id: TechId, rp: number): number | null {
  if (rp <= 0) return null;
  return Math.ceil(Math.max(0, techCost(s, id) - (s.research.points[id] ?? 0)) / rp);
}

interface Chip {
  label: string;
  title: string;
}

/** Значки изученных уровней. Если их больше MAX_CHIPS, первые сворачиваются в один значок «Ур. 1-N». */
function algoChips(level: number): Chip[] {
  const one = (k: number): Chip => ({ label: `Ур. ${k}`, title: `Уровень ${k}: эффективность обучения ×${fmtMult(ALGO_MULT ** k)}` });
  const all = Array.from({ length: level }, (_, i) => one(i + 1));
  if (level <= MAX_CHIPS) return all;
  const folded = level - (MAX_CHIPS - 1);
  return [{ label: `Ур. 1-${folded}`, title: `Уровни 1-${folded} изучены` }, ...all.slice(folded)];
}

/** Значки изученных уровней контекста: «1 тыс.», «2 тыс.»… */
function contextChips(level: number): Chip[] {
  return Array.from({ length: level }, (_, i) => {
    const label = contextLabel(CONTEXT_LEVELS[i + 1][0]);
    return { label, title: `Уровень ${i + 1}: контекст до ${label} токенов` };
  });
}

function chipsWidth(n: number): number {
  return n > 0 ? n * CHIP_W + (n - 1) * CHIP_GAP : 0;
}

interface NodeProps {
  s: GameState;
  id: TechId;
  label?: string;
  code?: string;
  rp: number;
  x: number;
  y: number;
  onPick: (id: TechId, status: Status, reason: string | null) => void;
}

function TechNode({ s, id, label, code, rp, x, y, onPick }: NodeProps) {
  const info = techInfo(id);
  const reason = researchBlockReason(s, id);
  const status = statusOf(s, id, reason);
  const points = s.research.points[id] ?? 0;
  const cost = techCost(s, id);
  const days = daysLeft(s, id, rp);
  const penalty = earlyPenalty(s, id);
  const share = status === 'done' ? 1 : cost > 0 ? Math.min(1, points / cost) : 0;
  const color = BRANCH_COLOR[info.branch];
  const branch = BRANCH_NAMES[info.branch];

  const title =
    status === 'blocked'
      ? `${info.name}. ${lockText(s, id, reason)}`
      : `${info.name}. ${info.description} Направление: ${branch}.`;

  return (
    <div className="rs-slot" style={{ left: x, top: y, width: NW, height: NH }}>
      <button
        type="button"
        className={`rs-node ${status}`}
        style={{ '--br': color.line, '--br-fill': color.fill } as CSSProperties}
        data-tutorial={id === 'attention' ? 'tech-attention' : undefined}
        data-tech={id}
        title={title}
        aria-disabled={status === 'blocked' || status === 'done'}
        onClick={() => onPick(id, status, reason)}
      >
        <span className="rs-name">{label ?? info.name}</span>
        <span className="rs-main">
          <span className="rs-thumb">
            {status === 'blocked' && <IconLock size={16} />}
            <span>{code ?? info.code}</span>
          </span>
          <span className="rs-kv">
            <span>Дата</span>
            <span>{formatDateShort(techHistoryDay(s, id))}</span>
            {status === 'done' ? (
              <span className="rs-done">
                <IconCheck size={14} />
                Изучено
              </span>
            ) : (
              <>
                <span>Цена</span>
                <span>{fmtNum(cost)} очков</span>
                <span>Срок</span>
                <span>{days === null ? '-' : `${fmtNum(days)} дн.`}</span>
              </>
            )}
          </span>
        </span>
        {status !== 'done' && points > 0 && (
          <span className="rs-prog" title={`${fmtNum(points)} из ${fmtNum(cost)} очков`}>
            <span style={{ width: `${share * 100}%` }} />
          </span>
        )}
      </button>
      {status !== 'done' && penalty > 1 && (
        <span className="rs-caption" title="Цена снижается по мере приближения к дате появления в истории">
          Раньше истории: цена ×{fmtMult(penalty)}
        </span>
      )}
    </div>
  );
}

/** Ломаная от требования к технологии: вправо от источника, вертикаль в промежутке перед столбцом цели, вправо к цели. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = x2 - COL_GAP / 2;
  return y1 === y2 ? `M${x1} ${y1} H${x2}` : `M${x1} ${y1} H${mid} V${y2} H${x2}`;
}

const BRANCH_ORDER: TechBranch[] = ['architecture', 'scale', 'alignment', 'data', 'efficiency', 'product'];

export default function ResearchWindow({ s, open }: WindowProps) {
  // Сообщение об отказе висит до следующего действия (выбор узла или остановка).
  const [note, setNote] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TechId | null>(null);
  const rp = rpPerDay(s);
  const power = pool(s, 'experiments');
  const current = s.research.current;
  const level = s.research.algoLevel;

  const pick = (id: TechId, status: Status, reason: string | null) => {
    if (status === 'done') return;
    if (status === 'blocked') {
      setNote(lockText(s, id, reason));
      return;
    }
    setNote(null);
    setDialog(id);
  };

  const stop = () => {
    const r = store.dispatch(actions.setResearch, null);
    setNote(r.ok ? null : r.error);
  };

  // ---------- Раскладка ----------
  const years = graphYears();
  const graphTop = PAD + YEAR_H;
  const posOf = (t: GraphTech) => ({ x: PAD + graphCol(t, years) * COL_W, y: graphTop + GRAPH_ROW[t] * ROW_H });
  const graphW = years.length * COL_W - COL_GAP;
  const graphBottom = graphTop + GRAPH_ROWS * ROW_H - ROW_GAP;

  const chips = algoChips(level);
  const algoY = graphBottom + CHAIN_GAP;
  const algoX = PAD + (chips.length > 0 ? chipsWidth(chips.length) + CHIP_LINK : 0);
  const algoCy = algoY + NH / 2;

  const ctxLevel = s.research.contextLevel;
  const ctxChips = contextChips(ctxLevel);
  const ctxY = algoY + NH + CHAIN_GAP;
  const ctxX = PAD + (ctxChips.length > 0 ? chipsWidth(ctxChips.length) + CHIP_LINK : 0);
  const ctxCy = ctxY + NH / 2;
  const ctxDone = ctxLevel >= CONTEXT_MAX_LEVEL;
  const ctxNext = CONTEXT_LEVELS[Math.min(ctxLevel + 1, CONTEXT_MAX_LEVEL)][0];

  const width = Math.max(PAD + graphW + PAD, algoX + NW + PAD, ctxX + NW + PAD);
  const height = ctxY + NH + ROW_GAP + PAD / 2;

  const currentDays = current ? daysLeft(s, current, rp) : null;

  // ---------- Масштаб и перемещение ----------
  const viewRef = useRef<HTMLDivElement>(null);
  const [saved] = useState(loadView);
  const [zoom, setZoom] = useState<number>(saved?.zoom ?? 1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Точка, которая должна остаться на месте после смены масштаба (координаты в окне карты).
  const anchor = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const restored = useRef(false);
  const fitOnFirst = useRef(saved === null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const saveTimer = useRef<number | null>(null);

  const offX = Math.max(0, (size.w - width * zoom) / 2);
  const offY = Math.max(0, (size.h - height * zoom) / 2);

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitZoom = useCallback(
    () => (size.w > 0 && size.h > 0 ? clampZoom(Math.min(size.w / width, size.h / height)) : 1),
    [size.w, size.h, width, height],
  );

  // Первое открытие без сохранённого вида - вся карта по размеру окна; иначе - сохранённая прокрутка.
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el || restored.current || size.w === 0) return;
    restored.current = true;
    if (fitOnFirst.current) {
      setZoom(fitZoom());
      return;
    }
    if (saved) {
      el.scrollLeft = saved.left;
      el.scrollTop = saved.top;
    }
  }, [size.w, fitZoom, saved]);

  // После смены масштаба точка под курсором (или центр окна) остаётся на месте.
  useLayoutEffect(() => {
    const el = viewRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.x * zoom + offX - a.cx;
    el.scrollTop = a.y * zoom + offY - a.cy;
  }, [zoom, offX, offY]);

  const remember = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const el = viewRef.current;
      if (el) saveView({ zoom, left: el.scrollLeft, top: el.scrollTop });
    }, 150);
  }, [zoom]);

  useEffect(() => {
    remember();
  }, [zoom, remember]);

  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const zoomTo = useCallback(
    (next: number, cx?: number, cy?: number) => {
      const el = viewRef.current;
      const z = clampZoom(next);
      if (!el || z === zoom) return;
      const px = cx ?? el.clientWidth / 2;
      const py = cy ?? el.clientHeight / 2;
      anchor.current = {
        x: (el.scrollLeft + px - offX) / zoom,
        y: (el.scrollTop + py - offY) / zoom,
        cx: px,
        cy: py,
      };
      setZoom(z);
    },
    [zoom, offX, offY],
  );

  const fit = () => {
    anchor.current = null;
    setZoom(fitZoom());
    const el = viewRef.current;
    if (el) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    }
  };

  // Ctrl + колесо - масштаб вокруг курсора. Слушатель не пассивный: иначе браузер масштабирует всю страницу.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zoom * (e.deltaY < 0 ? 1 + ZOOM_STEP : 1 / (1 + ZOOM_STEP)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, zoomTo]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = viewRef.current;
    if (!el) return;
    // Два пальца: масштаб щипком. Одиночное перетаскивание при этом отменяется.
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom };
      drag.current = null;
      setDragging(false);
      suppressClick.current = true;
      return;
    }
    if (touches.current.size > 2) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = viewRef.current;
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && el && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      const r = el.getBoundingClientRect();
      zoomTo((pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (!d || !el || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragging(true);
      // Захват - только когда началось перетаскивание: иначе щелчок по узлу ушёл бы холсту.
      el.setPointerCapture(e.pointerId);
    }
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (pinch.current) {
      if (touches.current.size < 2) {
        pinch.current = null;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }
      drag.current = null;
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      suppressClick.current = true;
      setDragging(false);
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
  };

  const pct = Math.round(zoom * 100);
  const edges = graphEdges();

  return (
    <div className="rs">
      <div className="rs-head">
        <h2 className="rs-title">Технологии</h2>
        <div className="rs-zoom" role="group" aria-label="Масштаб карты">
          <button type="button" className="btn small" title="Уменьшить" aria-label="Уменьшить" disabled={zoom <= ZOOM_MIN} onClick={() => zoomTo(zoom - ZOOM_STEP)}>
            −
          </button>
          <span className="rs-zoom-val num" title="Масштаб. Ctrl + колесо мыши - изменить">
            {pct} %
          </span>
          <button type="button" className="btn small" title="Увеличить" aria-label="Увеличить" disabled={zoom >= ZOOM_MAX} onClick={() => zoomTo(zoom + ZOOM_STEP)}>
            +
          </button>
          <button type="button" className="btn small" title="Показать всю карту" onClick={fit}>
            По размеру
          </button>
        </div>
        <div className="rs-state">
          {current ? (
            <>
              <span>
                Изучается: <b>{techName(current)}</b>
                {currentDays !== null && <span className="num"> · {fmtNum(currentDays)} дн.</span>}
              </span>
              <button type="button" className="btn small" onClick={stop}>
                Остановить
              </button>
            </>
          ) : (
            <span>Исследование не выбрано</span>
          )}
        </div>
      </div>

      <div className="rs-legend">
        {BRANCH_ORDER.map((b) => (
          <span key={b} className="rs-legend-item">
            <i style={{ background: BRANCH_COLOR[b].line }} />
            {BRANCH_NAMES[b]}
          </span>
        ))}
        <span className="rs-legend-hint">Перетащите карту мышью, Ctrl + колесо - масштаб</span>
      </div>

      <div
        ref={viewRef}
        className={`rs-canvas${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onScroll={remember}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <div className="rs-space" style={{ width: width * zoom + 2 * offX, height: height * zoom + 2 * offY }}>
          <div className="rs-stage" style={{ width, height, left: offX, top: offY, transform: `scale(${zoom})` }}>
            {years.map((y, i) => (
              <div
                key={y}
                className={`rs-col${i % 2 === 1 ? ' alt' : ''}`}
                style={{ left: PAD + i * COL_W - COL_GAP / 2, top: PAD, width: COL_W, height: graphBottom - PAD + ROW_GAP / 2 }}
              >
                <span className="rs-year">{y}</span>
              </div>
            ))}

            <svg className="rs-lines" width={width} height={height} aria-hidden="true">
              {edges.map(([from, to]) => {
                const a = posOf(from);
                const b = posOf(to);
                const on = s.research.done.includes(from);
                return (
                  <path
                    key={`${from}-${to}`}
                    className={on ? 'on' : undefined}
                    d={edgePath(a.x + NW, a.y + NH / 2, b.x, b.y + NH / 2)}
                  />
                );
              })}
              {chips.length > 0 && <path className="on" d={`M${PAD + CHIP_W / 2} ${algoCy} H${algoX}`} />}
              {ctxChips.length > 0 && <path className="on" d={`M${PAD + CHIP_W / 2} ${ctxCy} H${ctxX}`} />}
            </svg>

            {GRAPH_TECHS.map((t) => {
              const p = posOf(t);
              return <TechNode key={t} s={s} id={t} rp={rp} x={p.x} y={p.y} onPick={pick} />;
            })}

            <span className="rs-caption free" style={{ left: PAD, top: algoCy - CHIP_H / 2 - 22 }}>
              {chips.length > 0 ? `Эффективность обучения ×${fmtMult(ALGO_MULT ** level)}` : 'Цепочка: алгоритмические улучшения'}
            </span>
            {chips.map((c, i) => (
              <span
                key={c.label}
                className="rs-chip"
                title={c.title}
                style={{ left: PAD + i * (CHIP_W + CHIP_GAP), top: algoCy - CHIP_H / 2, width: CHIP_W, height: CHIP_H }}
              >
                {c.label}
              </span>
            ))}
            <TechNode s={s} id="algo" code={`ALG ${level + 1}`} rp={rp} x={algoX} y={algoY} onPick={pick} />

            <span className="rs-caption free" style={{ left: PAD, top: ctxCy - CHIP_H / 2 - 22 }}>
              {`Наибольший контекст: ${contextLabel(CONTEXT_LEVELS[ctxLevel][0])} токенов`}
            </span>
            {ctxChips.map((c, i) => (
              <span
                key={c.label}
                className="rs-chip"
                title={c.title}
                style={{ left: PAD + i * (CHIP_W + CHIP_GAP), top: ctxCy - CHIP_H / 2, width: CHIP_W, height: CHIP_H }}
              >
                {c.label}
              </span>
            ))}
            <TechNode
              s={s}
              id="context"
              label={ctxDone ? 'Длинный контекст' : `Длинный контекст: ${contextLabel(ctxNext)}`}
              rp={rp}
              x={ctxX}
              y={ctxY}
              onPick={pick}
            />
          </div>
        </div>
      </div>

      {(power <= 0 || note) && (
        <div className="rs-alerts">
          {power <= 0 && (
            <Alert tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
              Мощность на исследования не выделена.
            </Alert>
          )}
          {note && <Alert tone="bad">{note}</Alert>}
        </div>
      )}
      <div className="rs-bar">
        <span className="rs-stat" title={`${fmtNum(RP_BASE)} + ${fmtNum(RP_K)} × √(H100e на исследования)`}>
          <span className="l">Очки в день</span>
          <b className="num">{fmtNum(rp)}</b>
        </span>
        <span className="rs-stat" title={`Доля мощности на исследования: ${fmtPct(s.compute.alloc.experiments * 100, 0)}`}>
          <span className="l">Мощность</span>
          <b className="num">{fmtNum(power)} H100e</b>
        </span>
        <button type="button" className="btn small" onClick={() => open('compute')}>
          Открыть «Мощности»
        </button>
      </div>
      {dialog &&
        createPortal(
          <ResearchDialog
            s={s}
            id={dialog}
            onClose={() => setDialog(null)}
            onRent={() => {
              setDialog(null);
              open('compute');
            }}
          />,
          document.body,
        )}
    </div>
  );
}

// ---------- Диалог исследования ----------

const DAYS_IN_MONTH = 30;

function ResearchDialog({ s, id, onClose, onRent }: { s: GameState; id: TechId; onClose: () => void; onRent: () => void }) {
  const info = TECHS.find((t) => t.id === id)!;
  const current = percentsOf(s.compute.alloc);
  const isCurrent = s.research.current === id;
  const other = s.research.current && !isCurrent ? techName(s.research.current) : null;
  // Пока на исследования ничего не выделено, предлагаем половину мощности.
  const [pct, setPct] = useState(() => (current.experiments > 0 || isCurrent ? current.experiments : 50));
  const [error, setError] = useState<string | null>(null);

  const total = totalH100e(s);
  const cards = GPUS.reduce((sum, g) => sum + s.compute.rented[g.id], 0);
  const power = (total * pct) / 100;
  const rp = RP_BASE + RP_K * Math.sqrt(power);
  const cost = techCost(s, id);
  const points = s.research.points[id] ?? 0;
  const days = Math.max(1, Math.ceil(Math.max(0, cost - points) / rp));
  const penalty = earlyPenalty(s, id);
  const rentMonth = rentPerDay(s) * (pct / 100) * DAYS_IN_MONTH;
  const changed = pct !== current.experiments;
  const noCards = total <= 0;

  function applyShare(): boolean {
    if (!changed || noCards) return true;
    const r = store.dispatch(actions.setAllocation, toAllocation(withPercent(current, 'experiments', pct)));
    if (!r.ok) setError(r.error);
    return r.ok;
  }

  function start() {
    if (!applyShare()) return;
    const r = store.dispatch(actions.setResearch, id);
    if (r.ok) onClose();
    else setError(r.error);
  }

  function save() {
    if (applyShare()) onClose();
  }

  function stop() {
    const r = store.dispatch(actions.setResearch, null);
    if (r.ok) onClose();
    else setError(r.error);
  }

  const footer = isCurrent ? (
    <>
      <button className="btn danger rs-d-left" onClick={stop}>
        Остановить
      </button>
      <button className="btn" onClick={onClose}>
        Закрыть
      </button>
      <button className="btn primary" disabled={!changed || noCards} onClick={save}>
        Применить
      </button>
    </>
  ) : (
    <>
      <button className="btn" onClick={onClose}>
        Отмена
      </button>
      <button className="btn primary" data-tutorial="research-start" onClick={start}>
        Начать исследование
      </button>
    </>
  );

  return (
    <Dialog title="Исследование" onClose={onClose} footer={footer}>
      <div className="rs-d">
        <div>
          <h2 className="rs-d-title">{info.name}</h2>
          <p className="rs-d-desc">{info.description}</p>
        </div>

        <dl className="rs-d-kv">
          <dt>Направление</dt>
          <dd>{BRANCH_NAMES[info.branch]}</dd>
          <dt>Дата в истории</dt>
          <dd>{formatDateShort(techHistoryDay(s, id))}</dd>
          {techRequires(id).length > 0 && (
            <>
              <dt>Требуется</dt>
              <dd>{techRequires(id).map((t) => `«${techName(t)}»`).join(', ')}</dd>
            </>
          )}
          <dt>Стоимость</dt>
          <dd>
            {fmtNum(cost)} очков
            {penalty > 1 && (
              <small title="Исследование раньше исторической даты стоит дороже. Цена снижается по мере приближения к этой дате.">
                раньше истории, цена ×{fmtMult(penalty)}
              </small>
            )}
          </dd>
          {id === 'context' && s.research.contextLevel < CONTEXT_MAX_LEVEL && (
            <>
              <dt>Контекст</dt>
              <dd>
                {contextLabel(maxContext(s))} → {contextLabel(CONTEXT_LEVELS[s.research.contextLevel + 1][0])} токенов
              </dd>
            </>
          )}
          {points > 0 && (
            <>
              <dt>Накоплено</dt>
              <dd>
                {fmtNum(points)} очков ({fmtPct((points / cost) * 100, 0)})
              </dd>
            </>
          )}
        </dl>

        <section className="rs-d-power">
          <div className="rs-d-h">
            <span>Мощность на исследование</span>
            <b className="num">{fmtPct(pct, 0)}</b>
          </div>
          {noCards ? (
            <div className="rs-d-empty">
              <span>Карты не арендованы. Исследование идёт медленно.</span>
              <button className="btn small" onClick={onRent}>
                Открыть «Мощности»
              </button>
            </div>
          ) : (
            <>
              <Range value={pct} min={0} max={100} color="#7b5cd6" label="Мощность на исследование" valueText={fmtPct(pct, 0)} onChange={setPct} />
              <div className="rs-d-ends">
                <span>Медленнее</span>
                <span>Быстрее</span>
              </div>
              <dl className="rs-d-kv">
                <dt>Карт</dt>
                <dd>
                  {fmtNum(Math.round((cards * pct) / 100))} из {fmtNum(cards)}
                </dd>
                <dt>Мощность</dt>
                <dd>{fmtNum(power)} H100e</dd>
                <dt>Аренда этих карт</dt>
                <dd>{fmtMoney(rentMonth)} в месяц</dd>
              </dl>
            </>
          )}
        </section>

        <div className="rs-d-result">
          <div>
            <span className="l">Срок</span>
            <b className="num">{fmtNum(days)} дн.</b>
          </div>
          <div>
            <span className="l">Готово</span>
            <b className="num">{formatDateShort(s.day + days)}</b>
          </div>
        </div>

        {!noCards && changed && <div className="rs-d-note">Остальным задачам останется {fmtPct(100 - pct, 0)} мощности.</div>}
        {other && <div className="rs-d-note">Сейчас изучается «{other}». Его очки сохранятся.</div>}
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}


