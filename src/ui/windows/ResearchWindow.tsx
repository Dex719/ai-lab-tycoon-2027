// Окно «Исследования» в духе дерева Processor Tycoon: строка текущего исследования (или самого быстрого следующего),
// слева неподвижная карта технологий со значками (изученные - тёмные плитки с полной зелёной полосой), справа
// «Можно начать» - что изучать дальше и что это даст. Любой узел и строка открывают диалог исследования.

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
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
  queueBlockReason,
  researchBlockReason,
  researchDaysLeft,
  rpPerDay,
  TECHS,
  techCost,
  techHistoryDay,
  techRequires,
} from '../../sim/research';
import { timesWord, tokensWord } from '../../sim/text';
import { formatDateShort } from '../../sim/time';
import type { GameState, TechId } from '../../sim/types';
import { TECH_IDS } from '../../sim/types';
import { checkAllocation, percentsOf, soldChannels, toAllocation, withPercent, ZERO_SHARE_WARNING } from '../alloc';
import { ConfirmDialog, DenyNote, Dialog, ErrorText, Range, useFlash } from '../components/common';
import { researchDaysAt } from '../forecast';
import { fmtMoney, fmtMult, fmtNum, fmtPct } from '../format';
import { IconCheck, IconClose, IconLock } from '../icons';
import { TechIcon } from '../icons/tech';
import { actions, store } from '../store';
import {
  CHAIN_TECHS,
  GRAPH_TECHS,
  graphEdges,
  MAP_CELL,
  MAP_COLS,
  MAP_LABEL,
  MAP_ROWS,
  TECHS_TO_LEARN,
  techGain,
  termText,
} from './researchMap';
import type { GraphTech } from './researchMap';
import './ResearchWindow.css';

type Status = 'done' | 'current' | 'available' | 'blocked';

// Размеры карты, px.
const NW = 192; // ширина узла
const NH = 62; // высота узла
const PAD_X = 12;
const PAD_Y = 12;
const COL_GAP = 40;
const ROW_GAP = 8;
const SPINE = 20; // вертикаль линий - за столько px до столбца цели
const CHAIN_GAP = 18; // от карты до полосы цепочек
const CHAIN_H = 58;

const MAP_W = PAD_X * 2 + MAP_COLS * NW + (MAP_COLS - 1) * COL_GAP;
const GRAPH_H = MAP_ROWS * NH + (MAP_ROWS - 1) * ROW_GAP;
const CHAIN_Y = PAD_Y + GRAPH_H + CHAIN_GAP;
const MAP_H = CHAIN_Y + CHAIN_H + PAD_Y;
const CHAIN_W = (MAP_W - PAD_X * 2 - 12) / 2;

/** Карта ужимается под окно, но не мельче этого масштаба: дальше текст на узлах не читается. */
const MIN_SCALE = 0.74;

function techInfo(id: TechId) {
  return TECHS.find((t) => t.id === id)!;
}

function techName(id: TechId): string {
  return TECHS.find((t) => t.id === id)?.name ?? id;
}

function statusOf(s: GameState, id: TechId): Status {
  if (id !== 'algo' && s.research.done.includes(id)) return 'done';
  if (s.research.current === id) return 'current';
  return researchBlockReason(s, id) ? 'blocked' : 'available';
}

/** Доля готовности текущего уровня технологии, 0..1. */
function progressOf(s: GameState, id: TechId): number {
  const cost = techCost(s, id);
  return cost > 0 ? Math.min(1, (s.research.points[id] ?? 0) / cost) : 0;
}

/** Дата выхода показывается только для прошедшего: будущие даты игрок знать не должен. */
function pastHistory(s: GameState, id: TechId): boolean {
  return techHistoryDay(s, id) <= s.day;
}

function posOf(t: GraphTech): { x: number; y: number } {
  const c = MAP_CELL[t];
  return { x: PAD_X + c.col * (NW + COL_GAP), y: PAD_Y + c.row * (NH + ROW_GAP) };
}

/** Порядок «что изучать»: сначала технологии карты, затем цепочки; внутри - по сроку. */
function availableList(s: GameState, rp: number): TechId[] {
  const ids = TECH_IDS.filter((t) => s.research.current !== t && researchBlockReason(s, t) === null);
  const chain = (t: TechId) => ((CHAIN_TECHS as TechId[]).includes(t) ? 1 : 0);
  return ids
    .map((t) => ({ t, d: researchDaysLeft(s, t, rp), c: chain(t) }))
    .sort((a, b) => a.c - b.c || a.d - b.d)
    .map((x) => x.t);
}

/** Технологии, которые откроются после идущего исследования или очереди: их можно ставить в очередь. */
function upcomingList(s: GameState): TechId[] {
  return TECH_IDS.filter((t) => {
    if (statusOf(s, t) !== 'blocked') return false;
    return s.research.queue.includes(t) || queueBlockReason(s, t) === null;
  });
}

// ---------- Узел карты ----------

function StatusLine({ s, id, status, rp }: { s: GameState; id: TechId; status: Status; rp: number }) {
  const q = s.research.queue.indexOf(id) + 1;
  if (status === 'done') {
    return (
      <span className="rs-st done">
        <IconCheck size={12} /> Изучено
      </span>
    );
  }
  if (status === 'current') return <span className="rs-st cur">Идёт: {fmtPct(progressOf(s, id) * 100, 0)}</span>;
  if (q > 0) return <span className="rs-st q">В очереди: {q}</span>;
  if (status === 'blocked') {
    return (
      <span className="rs-st lock">
        <IconLock size={12} /> Закрыто
      </span>
    );
  }
  return <span className="rs-st">{termText(researchDaysLeft(s, id, rp))}</span>;
}

function MapNode({ s, id, rp, onOpen }: { s: GameState; id: GraphTech; rp: number; onOpen: (id: TechId) => void }) {
  const status = statusOf(s, id);
  const queued = s.research.queue.includes(id);
  const p = posOf(id);
  const info = techInfo(id);
  return (
    <button
      type="button"
      className={`rs-node ${status}${queued ? ' queued' : ''}`}
      style={{ left: p.x, top: p.y, width: NW, height: NH }}
      data-tutorial={id === 'attention' ? 'tech-attention' : undefined}
      data-tech={id}
      title={`${info.name}. ${techGain(s, id)}`}
      onClick={() => onOpen(id)}
    >
      <span className="rs-ico">
        <TechIcon id={id} size={34} locked={status === 'blocked' && !queued} />
      </span>
      <span className="rs-txt">
        <span className="rs-name">{MAP_LABEL[id] ?? info.name}</span>
        <StatusLine s={s} id={id} status={status} rp={rp} />
      </span>
      {(status === 'current' || status === 'done') && (
        <span className="rs-bar" aria-hidden="true">
          <i style={{ width: `${(status === 'done' ? 1 : progressOf(s, id)) * 100}%` }} />
        </span>
      )}
    </button>
  );
}

/** Цепочка с уровнями: значок, название, пройденные уровни делениями, срок следующего уровня. */
function ChainNode({ s, id, x, rp, onOpen }: { s: GameState; id: 'algo' | 'context'; x: number; rp: number; onOpen: (id: TechId) => void }) {
  const status = statusOf(s, id);
  const queued = s.research.queue.includes(id);
  const algo = id === 'algo';
  const level = algo ? s.research.algoLevel : s.research.contextLevel;
  const ctxNow = CONTEXT_LEVELS[s.research.contextLevel][0];
  const head = algo
    ? level > 0
      ? `Уровень ${level}: обучение ×${fmtMult(ALGO_MULT ** level)}`
      : 'Уровней пока нет'
    : `Контекст до ${contextLabel(ctxNow)} ${tokensWord(ctxNow)}`;
  const ticks = algo ? Math.min(level, 12) : CONTEXT_MAX_LEVEL;
  return (
    <button
      type="button"
      className={`rs-node chain ${status}${queued ? ' queued' : ''}`}
      style={{ left: x, top: CHAIN_Y, width: CHAIN_W, height: CHAIN_H }}
      data-tech={id}
      title={`${techName(id)}. ${techGain(s, id)}`}
      onClick={() => onOpen(id)}
    >
      <span className="rs-ico">
        <TechIcon id={id} size={38} locked={status === 'blocked' && !queued} />
      </span>
      <span className="rs-txt">
        <span className="rs-name">{techName(id)}</span>
        <span className="rs-sub">{head}</span>
        <span className="rs-chainrow">
          <span className="rs-ticks" aria-hidden="true">
            {Array.from({ length: ticks }, (_, i) => (
              <i key={i} className={i < level ? 'on' : undefined} />
            ))}
            {algo && level > 12 && <b>+{level - 12}</b>}
          </span>
          {status !== 'done' && <StatusLine s={s} id={id} status={status} rp={rp} />}
        </span>
      </span>
      {status === 'current' && (
        <span className="rs-bar" aria-hidden="true">
          <i style={{ width: `${progressOf(s, id) * 100}%` }} />
        </span>
      )}
    </button>
  );
}

/** Линия от требования к технологии: вправо, вертикаль перед столбцом цели, вправо к цели. */
function edgePath(from: GraphTech, to: GraphTech): string {
  const a = posOf(from);
  const b = posOf(to);
  const x1 = a.x + NW;
  const y1 = a.y + NH / 2;
  const y2 = b.y + NH / 2;
  const xs = b.x - SPINE;
  return y1 === y2 ? `M${x1} ${y1} H${b.x}` : `M${x1} ${y1} H${xs} V${y2} H${b.x}`;
}

/** Масштаб карты, при котором она целиком помещается в место el (не крупнее 1 и не мельче MIN_SCALE). */
function useFitScale(ref: RefObject<HTMLDivElement | null>): number {
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      setK(Math.max(MIN_SCALE, Math.min(1, w / MAP_W, h / MAP_H)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return k;
}

function TechMap({ s, rp, onOpen }: { s: GameState; rp: number; onOpen: (id: TechId) => void }) {
  // Сначала закрытые линии, сверху - открытые: общие отрезки принимают цвет открытой линии.
  const on = (from: TechId) => s.research.done.includes(from);
  const edges = [...graphEdges()].sort((a, b) => Number(on(a[0])) - Number(on(b[0])));
  return (
    <div className="rs-map" style={{ width: MAP_W, height: MAP_H }}>
      <svg className="rs-lines" width={MAP_W} height={MAP_H} aria-hidden="true">
        {edges.map(([from, to]) => (
          <path key={`${from}-${to}`} className={on(from) ? 'on' : 'off'} d={edgePath(from, to)} />
        ))}
        <path className="rs-rule" d={`M${PAD_X} ${CHAIN_Y - 10} H${MAP_W - PAD_X}`} />
      </svg>
      {GRAPH_TECHS.map((t) => (
        <MapNode key={t} s={s} id={t} rp={rp} onOpen={onOpen} />
      ))}
      <ChainNode s={s} id="algo" x={PAD_X} rp={rp} onOpen={onOpen} />
      <ChainNode s={s} id="context" x={PAD_X + CHAIN_W + 12} rp={rp} onOpen={onOpen} />
    </div>
  );
}

// ---------- Строка текущего исследования ----------

function NowStrip(props: {
  s: GameState;
  rp: number;
  power: number;
  pick: TechId | null;
  onOpen: (id: TechId) => void;
  onCompute: () => void;
}) {
  const { s, rp, power, pick, onOpen, onCompute } = props;
  const [note, flash] = useFlash();
  const current = s.research.current;
  const cards = totalH100e(s) > 0;

  const stop = () => {
    const r = store.dispatch(actions.setResearch, null);
    if (!r.ok) flash(r.error);
  };

  let powerText: ReactNode;
  if (!cards) powerText = <span className="warn">Карты не арендованы: работает только команда</span>;
  else if (power <= 0) powerText = <span className="warn">Мощность не выделена: работает только команда</span>;
  else if (!current) powerText = <span className="warn">Простаивает {fmtNum(power)} H100e</span>;
  else
    powerText = (
      <>
        Мощность: <b>{fmtNum(power)} H100e</b>, {fmtPct(s.compute.alloc.experiments * 100, 0)} всей
      </>
    );

  if (current) {
    const days = researchDaysLeft(s, current, rp);
    const share = progressOf(s, current);
    return (
      <div className="rs-now">
        <span className="rs-now-ico">
          <TechIcon id={current} size={40} />
        </span>
        <div className="rs-now-main">
          <div className="rs-now-t">
            Изучается: <b>{techName(current)}</b>
          </div>
          <div className="rs-now-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
            <i className="pb" style={{ ['--p' as string]: Math.min(1, Math.max(0, share)) }} />
          </div>
          <div className="rs-now-m">
            <b>{fmtPct(share * 100, 0)}</b> · готово через {termText(days)}
            {Number.isFinite(days) && `, ${formatDateShort(s.day + Math.max(1, days))}`} · {techGain(s, current)}
          </div>
        </div>
        <div className="rs-now-side">
          <div className="rs-now-power">{powerText}</div>
          <div className="rs-now-btns">
            {cards ? (
              <button type="button" className="btn small" onClick={() => onOpen(current)}>
                Изменить мощность
              </button>
            ) : (
              <button type="button" className="btn small" onClick={onCompute}>
                Открыть «Мощности»
              </button>
            )}
            <button type="button" className="btn small" onClick={stop}>
              Остановить
            </button>
            <DenyNote text={note} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rs-now idle">
      <span className="rs-now-ico">{pick ? <TechIcon id={pick} size={40} /> : null}</span>
      <div className="rs-now-main">
        <div className="rs-now-t warn">Исследование не выбрано</div>
        {pick ? (
          <div className="rs-now-m">
            Быстрее всего: <b>{techName(pick)}</b>, {termText(researchDaysLeft(s, pick, rp))} · {techGain(s, pick)}
          </div>
        ) : (
          <div className="rs-now-m">Все технологии изучены.</div>
        )}
      </div>
      <div className="rs-now-side">
        <div className="rs-now-power">{powerText}</div>
        <div className="rs-now-btns">
          {!cards && (
            <button type="button" className="btn small" onClick={onCompute}>
              Открыть «Мощности»
            </button>
          )}
          {pick && (
            <button type="button" className="btn primary" data-tutorial={pick === 'attention' ? 'tech-attention' : undefined} onClick={() => onOpen(pick)}>
              Изучать «{techName(pick)}»
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueStrip({ s, onOpen }: { s: GameState; onOpen: (id: TechId) => void }) {
  const [note, flash] = useFlash();
  if (s.research.queue.length === 0) return null;
  return (
    <div className="rs-queue">
      <span className="rs-queue-l">Дальше по очереди:</span>
      {s.research.queue.map((id, i) => (
        <span className="rs-qitem" key={id}>
          <button type="button" className="rs-qname" onClick={() => onOpen(id)}>
            {i + 1}. {techName(id)}
          </button>
          <button
            type="button"
            className="rs-qx"
            aria-label={`Убрать «${techName(id)}» из очереди`}
            title="Убрать из очереди"
            onClick={() => {
              const r = store.dispatch(actions.unqueueResearch, id);
              if (!r.ok) flash(r.error);
            }}
          >
            <IconClose size={11} />
          </button>
        </span>
      ))}
      <DenyNote text={note} />
    </div>
  );
}

// ---------- «Можно начать» ----------

function NextList({ s, rp, onOpen }: { s: GameState; rp: number; onOpen: (id: TechId) => void }) {
  const list = availableList(s, rp);
  const later = upcomingList(s);
  return (
    <aside className="rs-side">
      <div className="rs-side-h">Можно начать: {list.length}</div>
      <div className="rs-side-list">
        {list.map((id) => {
          const q = s.research.queue.indexOf(id) + 1;
          return (
            <button key={id} type="button" className="rs-row" onClick={() => onOpen(id)}>
              <span className="rs-row-ico">
                <TechIcon id={id} size={30} />
              </span>
              <span className="rs-row-t">
                <span className="rs-row-top">
                  <span className="rs-row-name">{techName(id)}</span>
                  <span className={`rs-row-term${q > 0 ? ' q' : ''}`}>{q > 0 ? `В очереди: ${q}` : termText(researchDaysLeft(s, id, rp))}</span>
                </span>
                <span className="rs-row-gain">{techGain(s, id)}</span>
              </span>
            </button>
          );
        })}
        {later.length > 0 && <div className="rs-side-sub">Откроются потом</div>}
        {later.map((id) => {
          const need = missingRequirements(s, id);
          const q = s.research.queue.indexOf(id) + 1;
          return (
            <button key={id} type="button" className="rs-row later" onClick={() => onOpen(id)}>
              <span className="rs-row-ico">
                <TechIcon id={id} size={26} locked={q === 0} />
              </span>
              <span className="rs-row-t">
                <span className="rs-row-top">
                  <span className="rs-row-name">{techName(id)}</span>
                  {q > 0 && <span className="rs-row-term q">В очереди: {q}</span>}
                </span>
                <span className="rs-row-gain">После «{need.map(techName).join('», «')}»</span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ---------- Окно ----------

export default function ResearchWindow({ s, open }: WindowProps) {
  const [dialog, setDialog] = useState<TechId | null>(null);
  const rp = rpPerDay(s);
  const power = pool(s, 'experiments');
  const pick = availableList(s, rp)[0] ?? null;
  const mapRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(mapRef);

  return (
    <div className="rs">
      <NowStrip s={s} rp={rp} power={power} pick={pick} onOpen={setDialog} onCompute={() => open('compute')} />
      <QueueStrip s={s} onOpen={setDialog} />
      <div className="rs-body">
        <section className="rs-mapwrap" aria-label="Карта технологий">
          <div className="rs-map-h">
            <span className="rs-map-t">Технологии</span>
            <span className="rs-map-n">
              Изучено: {s.research.done.length} из {TECHS_TO_LEARN}
            </span>
          </div>
          <div className="rs-mapscroll" ref={mapRef}>
            <div className="rs-mapfit" style={{ width: MAP_W * scale, height: MAP_H * scale }}>
              <div style={{ transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: '0 0' }}>
                <TechMap s={s} rp={rp} onOpen={setDialog} />
              </div>
            </div>
          </div>
        </section>
        <NextList s={s} rp={rp} onOpen={setDialog} />
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
  const info = techInfo(id);
  const current = percentsOf(s.compute.alloc);
  const status = statusOf(s, id);
  const isCurrent = s.research.current === id;
  const queued = s.research.queue.includes(id);
  const startable = researchBlockReason(s, id) === null;
  const other = s.research.current && !isCurrent ? techName(s.research.current) : null;
  // «В очередь» имеет смысл, когда что-то уже идёт или стоит в очереди.
  const canQueue = !isCurrent && !queued && (s.research.current !== null || s.research.queue.length > 0) && queueBlockReason(s, id) === null;
  // Пока на исследования ничего не выделено, предлагаем половину мощности.
  const [pct, setPct] = useState(() => (current.experiments > 0 || isCurrent ? current.experiments : 50));
  const [error, setError] = useState<string | null>(null);
  // Каналы, которые останутся без мощности, если принять выбранную долю: игрок подтверждает это отдельно.
  const [zero, setZero] = useState<{ keys: ('api' | 'subs')[]; then: 'start' | 'save' } | null>(null);

  const total = totalH100e(s);
  const cards = GPUS.reduce((sum, g) => sum + s.compute.rented[g.id], 0);
  const power = (total * pct) / 100;
  const rp = RP_BASE + RP_K * Math.sqrt(power);
  const share = progressOf(s, id);
  const left = researchDaysLeft(s, id, rp);
  const days = Number.isFinite(left) ? Math.max(1, left) : left;
  // Края ползунка - срок без карт (работает команда) и со всей мощностью: честно видно, сколько даёт ползунок.
  const endDate = (share: number): string => {
    const d = researchDaysAt(s, id, share);
    return Number.isFinite(d) ? formatDateShort(s.day + Math.max(1, d)) : '-';
  };
  const penalty = earlyPenalty(s, id);
  const rentMonth = rentPerDay(s) * (pct / 100) * DAYS_IN_MONTH;
  const changed = pct !== current.experiments;
  const noCards = total <= 0;
  const past = pastHistory(s, id);
  const missing = missingRequirements(s, id);

  /** Подтверждение нужно, если канал, где идут продажи, теряет всю мощность из-за новой доли. */
  function zeroed(): ('api' | 'subs')[] {
    if (!changed || noCards) return [];
    const next = withPercent(current, 'experiments', pct);
    return checkAllocation(next, soldChannels(s.models)).zero.filter((k) => current[k] > 0);
  }

  function applyShare(): boolean {
    if (!changed || noCards) return true;
    const r = store.dispatch(actions.setAllocation, toAllocation(withPercent(current, 'experiments', pct)));
    if (!r.ok) setError(r.error);
    return r.ok;
  }

  function run(kind: 'start' | 'save') {
    if (!applyShare()) return;
    if (kind === 'save') {
      onClose();
      return;
    }
    const r = store.dispatch(actions.setResearch, id);
    if (r.ok) onClose();
    else setError(r.error);
  }

  function ask(kind: 'start' | 'save') {
    const keys = zeroed();
    if (keys.length > 0) setZero({ keys, then: kind });
    else run(kind);
  }

  function stop() {
    const r = store.dispatch(actions.setResearch, null);
    if (r.ok) onClose();
    else setError(r.error);
  }

  function enqueue() {
    const r = store.dispatch(actions.queueResearch, id);
    if (r.ok) onClose();
    else setError(r.error);
  }

  function unqueue() {
    const r = store.dispatch(actions.unqueueResearch, id);
    if (r.ok) onClose();
    else setError(r.error);
  }

  const footer =
    status === 'done' ? (
      <button className="btn" onClick={onClose}>
        Закрыть
      </button>
    ) : isCurrent ? (
      <>
        <button className="btn danger rs-d-left" onClick={stop}>
          Остановить
        </button>
        <button className="btn" onClick={onClose}>
          Закрыть
        </button>
        <button className="btn primary" disabled={!changed || noCards} onClick={() => ask('save')}>
          Применить
        </button>
      </>
    ) : (
      <>
        {queued && (
          <button className="btn danger rs-d-left" onClick={unqueue}>
            Убрать из очереди
          </button>
        )}
        <button className="btn" onClick={onClose}>
          {queued && !startable ? 'Закрыть' : 'Отмена'}
        </button>
        {canQueue && (
          <button className="btn" data-tutorial="research-queue" onClick={enqueue}>
            В очередь
          </button>
        )}
        {startable && (
          <button className="btn primary" data-tutorial="research-start" onClick={() => ask('start')}>
            Начать исследование
          </button>
        )}
      </>
    );

  // Место под подписи постоянное (две строки): ползунок меняет текст, но не размер диалога.
  const lines: ReactNode[] = [];
  if (startable || isCurrent) {
    if (!noCards && changed) lines.push(<div key="rest" className="rs-d-note">Остальным задачам останется {fmtPct(100 - pct, 0)} мощности.</div>);
    if (other) lines.push(<div key="other" className="rs-d-note">Сейчас изучается «{other}». Сделанное по нему сохранится.</div>);
  }

  const ctxNext = id === 'context' && s.research.contextLevel < CONTEXT_MAX_LEVEL ? CONTEXT_LEVELS[s.research.contextLevel + 1][0] : null;

  return (
    <Dialog title="Исследование" onClose={onClose} footer={footer}>
      <div className="rs-d">
        <div className="rs-d-head">
          <span className="rs-d-ico">
            <TechIcon id={id} size={52} locked={status === 'blocked' && !queued} />
          </span>
          <div className="rs-d-ht">
            <h2 className="rs-d-title">{info.name}</h2>
            <div className="rs-d-sub">
              {BRANCH_NAMES[info.branch]}
              {status === 'done' && (
                <span className="rs-d-done">
                  <IconCheck size={13} /> Изучено
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="rs-d-desc">{info.description}</p>

        <dl className="rs-d-kv">
          {past && (
            <>
              <dt>Появилась в истории</dt>
              <dd>{formatDateShort(techHistoryDay(s, id))}</dd>
            </>
          )}
          {status !== 'done' && techRequires(id).length > 0 && (
            <>
              <dt>Нужно изучить</dt>
              <dd className="rs-d-req">
                {techRequires(id).map((t) => (
                  <span key={t} className={s.research.done.includes(t) ? 'ok' : 'miss'}>
                    {s.research.done.includes(t) ? <IconCheck size={13} /> : <IconLock size={12} />}
                    {techName(t)}
                  </span>
                ))}
              </dd>
            </>
          )}
          {ctxNext !== null && (
            <>
              <dt>Контекст</dt>
              <dd>
                до {contextLabel(ctxNext)} {tokensWord(ctxNext)}, сейчас {contextLabel(maxContext(s))}
              </dd>
            </>
          )}
          {status !== 'done' && share > 0 && (
            <>
              <dt>Сделано</dt>
              <dd>{fmtPct(share * 100, 0)}</dd>
            </>
          )}
          {status !== 'done' && penalty > 1.05 && (
            <>
              <dt>Наценка за спешку</dt>
              <dd className="warn" title="Технология опережает историю: в реальности она появилась позже. С каждым месяцем наценка падает.">
                очков нужно {timesWord(penalty)} больше, с каждым месяцем меньше
              </dd>
            </>
          )}
        </dl>

        {status === 'done' ? null : startable || isCurrent ? (
          <>
            <section className="rs-d-power">
              <div className="rs-d-h">
                <span>Мощность на исследование</span>
                <b className="num">{fmtPct(pct, 0)}</b>
              </div>
              {noCards ? (
                <div className="rs-d-empty">
                  <span>Карты не арендованы: работает только команда.</span>
                  <button className="btn small" onClick={onRent}>
                    Открыть «Мощности»
                  </button>
                </div>
              ) : (
                <>
                  <Range value={pct} min={0} max={100} label="Мощность на исследование" valueText={fmtPct(pct, 0)} onChange={setPct} />
                  <div className="rs-d-ends">
                    <span>при 0 %: {endDate(0)}</span>
                    <span>при 100 %: {endDate(1)}</span>
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
                <b className="num">{termText(days)}</b>
              </div>
              <div>
                <span className="l">Готово</span>
                <b className="num">{Number.isFinite(days) ? formatDateShort(s.day + days) : '-'}</b>
              </div>
            </div>
          </>
        ) : (
          <div className="rs-d-note">
            {queued
              ? 'Стоит в очереди: начнётся сама, когда откроется.'
              : canQueue
                ? `Откроется после «${missing.map(techName).join('», «')}»: её можно поставить в очередь.`
                : missing.length > 0
                  ? `Сначала нужно изучить: ${missing.map((t) => `«${techName(t)}»`).join(', ')}.`
                  : null}
          </div>
        )}
        {status !== 'done' && <div className="rs-d-slot">{error ? <ErrorText error={error} /> : lines}</div>}
      </div>
      {zero && (
        <ConfirmDialog
          title="Продажи остановятся"
          confirmLabel="Продолжить"
          onConfirm={() => {
            const then = zero.then;
            setZero(null);
            run(then);
          }}
          onClose={() => setZero(null)}
        >
          {zero.keys.map((k) => (
            <p key={k} className="cw-confirm-line">
              {ZERO_SHARE_WARNING[k]}
            </p>
          ))}
        </ConfirmDialog>
      )}
    </Dialog>
  );
}
