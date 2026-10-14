// Окно «Исследования»: тёмная полоса с текущим исследованием (или следующим, если ничего не идёт),
// слева неподвижная карта технологий со значками (изученные - золотые трофеи), справа «Можно начать» -
// что изучать дальше и что это даст. Любой узел и карточка открывают диалог исследования.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
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
import { fmtMoney, fmtMult, fmtNum, fmtPct } from '../format';
import { IconCheck, IconClose, IconLock } from '../icons';
import { TechIcon } from '../icons/tech';
import { actions, store } from '../store';
import {
  BRANCH_COLOR,
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
const NH = 52; // высота узла
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

/** Как долго подсвечивается только что изученная технология, мс. */
const FRESH_MS = 2600;
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

/** Новые изученные технологии и уровни цепочек (для золотой вспышки на карте). */
function useFresh(s: GameState): Set<TechId> {
  const key = `${s.research.done.join(',')}|${s.research.algoLevel}|${s.research.contextLevel}`;
  const prev = useRef<{ done: Set<TechId>; algo: number; ctx: number } | null>(null);
  const [fresh, setFresh] = useState<Set<TechId>>(() => new Set());
  useEffect(() => {
    const now = { done: new Set(s.research.done), algo: s.research.algoLevel, ctx: s.research.contextLevel };
    const p = prev.current;
    prev.current = now;
    if (!p) return;
    const added = new Set<TechId>([...now.done].filter((t) => !p.done.has(t)));
    if (now.algo > p.algo) added.add('algo');
    if (now.ctx > p.ctx) added.add('context');
    if (added.size === 0) return;
    setFresh(added);
    const timer = window.setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  return fresh;
}

// ---------- Узел карты ----------

function nodeStyle(id: TechId): CSSProperties {
  const c = BRANCH_COLOR[techInfo(id).branch];
  return { '--br': c.line, '--br-fill': c.fill } as CSSProperties;
}

function StatusLine({ s, id, status, rp }: { s: GameState; id: TechId; status: Status; rp: number }) {
  const q = s.research.queue.indexOf(id) + 1;
  if (status === 'done') {
    return (
      <span className="rs-st done">
        <Star /> Изучено
      </span>
    );
  }
  if (status === 'current') return <span className="rs-st cur">Идёт · {fmtPct(progressOf(s, id) * 100, 0)}</span>;
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

function Star({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="rs-star">
      <path d="M12 2.5 L14.9 8.6 L21.5 9.4 L16.6 13.9 L17.9 20.5 L12 17.2 L6.1 20.5 L7.4 13.9 L2.5 9.4 L9.1 8.6 Z" fill="currentColor" />
    </svg>
  );
}

function MapNode(props: {
  s: GameState;
  id: GraphTech;
  rp: number;
  fresh: boolean;
  onOpen: (id: TechId) => void;
}) {
  const { s, id, rp, fresh, onOpen } = props;
  const status = statusOf(s, id);
  const queued = s.research.queue.includes(id);
  const p = posOf(id);
  const info = techInfo(id);
  return (
    <button
      type="button"
      className={`rs-node ${status}${queued ? ' queued' : ''}${fresh ? ' fresh' : ''}`}
      style={{ left: p.x, top: p.y, width: NW, height: NH, ...nodeStyle(id) }}
      data-tutorial={id === 'attention' ? 'tech-attention' : undefined}
      data-tech={id}
      title={`${info.name}. ${techGain(s, id)}`}
      onClick={() => onOpen(id)}
    >
      <span className="rs-ico">
        <TechIcon id={id} size={36} locked={status === 'blocked' && !queued} />
      </span>
      <span className="rs-txt">
        <span className="rs-name">{MAP_LABEL[id] ?? info.name}</span>
        <StatusLine s={s} id={id} status={status} rp={rp} />
      </span>
      {status === 'current' && (
        <span className="rs-bar" aria-hidden="true">
          <i style={{ width: `${progressOf(s, id) * 100}%` }} />
        </span>
      )}
    </button>
  );
}

/** Цепочка с уровнями: значок, название, пройденные уровни точками, следующий уровень. */
function ChainNode(props: { s: GameState; id: 'algo' | 'context'; x: number; rp: number; fresh: boolean; onOpen: (id: TechId) => void }) {
  const { s, id, x, rp, fresh, onOpen } = props;
  const status = statusOf(s, id);
  const queued = s.research.queue.includes(id);
  const algo = id === 'algo';
  const level = algo ? s.research.algoLevel : s.research.contextLevel;
  const ctxNow = CONTEXT_LEVELS[s.research.contextLevel][0];
  const head = algo
    ? level > 0
      ? `Изучено уровней: ${level} · обучение ×${fmtMult(ALGO_MULT ** level)}`
      : 'Уровней пока нет'
    : `Контекст до ${contextLabel(ctxNow)} ${tokensWord(ctxNow)}`;
  const pips = algo ? Math.min(level, 12) : CONTEXT_MAX_LEVEL;
  return (
    <button
      type="button"
      className={`rs-node chain ${status}${queued ? ' queued' : ''}${fresh ? ' fresh' : ''}`}
      style={{ left: x, top: CHAIN_Y, width: CHAIN_W, height: CHAIN_H, ...nodeStyle(id) }}
      data-tech={id}
      title={`${techName(id)}. ${techGain(s, id)}`}
      onClick={() => onOpen(id)}
    >
      <span className="rs-ico">
        <TechIcon id={id} size={40} locked={status === 'blocked' && !queued} />
      </span>
      <span className="rs-txt">
        <span className="rs-name">{techName(id)}</span>
        <span className="rs-sub">{head}</span>
        <span className="rs-chainrow">
          <span className="rs-pips" aria-hidden="true">
            {Array.from({ length: pips }, (_, i) => (
              <i key={i} className={i < level ? 'on' : undefined} />
            ))}
            {algo && level > 12 && <b>+{level - 12}</b>}
          </span>
          {status !== 'done' && (
            <span className="rs-next">
              <StatusLine s={s} id={id} status={status} rp={rp} />
            </span>
          )}
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

function TechMap({ s, rp, fresh, onOpen }: { s: GameState; rp: number; fresh: Set<TechId>; onOpen: (id: TechId) => void }) {
  const edges = graphEdges();
  // Сначала серые, затем открытые, сверху - золотые: общие отрезки линий принимают самый «сильный» цвет.
  const kind = (from: TechId, to: TechId) =>
    !s.research.done.includes(from) ? 0 : s.research.done.includes(to) ? 2 : 1;
  const sorted = [...edges].sort((a, b) => kind(...a) - kind(...b));
  return (
    <div className="rs-map" style={{ width: MAP_W, height: MAP_H }}>
      <svg className="rs-lines" width={MAP_W} height={MAP_H} aria-hidden="true">
        {sorted.map(([from, to]) => (
          <path key={`${from}-${to}`} className={['off', 'on', 'gold'][kind(from, to)]} d={edgePath(from, to)} />
        ))}
      </svg>
      {GRAPH_TECHS.map((t) => (
        <MapNode key={t} s={s} id={t} rp={rp} fresh={fresh.has(t)} onOpen={onOpen} />
      ))}
      <span className="rs-chain-l" style={{ top: CHAIN_Y - 15, left: PAD_X }}>
        Уровни
      </span>
      <ChainNode s={s} id="algo" x={PAD_X} rp={rp} fresh={fresh.has('algo')} onOpen={onOpen} />
      <ChainNode s={s} id="context" x={PAD_X + CHAIN_W + 12} rp={rp} fresh={fresh.has('context')} onOpen={onOpen} />
    </div>
  );
}

// ---------- Полоса сверху ----------

/** Значок технологии в кольце готовности. */
function Ring({ id, share, dim }: { id: TechId; share: number; dim?: boolean }) {
  const r = 33;
  const c = 2 * Math.PI * r;
  const color = BRANCH_COLOR[techInfo(id).branch].line;
  return (
    <span className={`rs-ring${dim ? ' dim' : ''}`}>
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r={r} fill="none" stroke="#2c3650" strokeWidth="5" strokeDasharray={dim ? '4 5' : undefined} />
        {!dim && (
          <circle
            cx="38"
            cy="38"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${c * Math.max(0.001, share)} ${c}`}
            transform="rotate(-90 38 38)"
            className="rs-ring-arc"
          />
        )}
      </svg>
      <span className="rs-ring-ico">
        <TechIcon id={id} size={40} />
      </span>
    </span>
  );
}

function Hero(props: {
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
  const focus = current ?? pick;
  const cards = totalH100e(s) > 0;
  const days = focus ? researchDaysLeft(s, focus, rp) : Infinity;

  const stop = () => {
    const r = store.dispatch(actions.setResearch, null);
    if (!r.ok) flash(r.error);
  };

  let powerSub: ReactNode;
  if (!cards) powerSub = <span className="rs-kpi-s warn">Карты не арендованы</span>;
  else if (power <= 0) powerSub = <span className="rs-kpi-s warn">Работает только команда</span>;
  else if (!current) powerSub = <span className="rs-kpi-s warn">Простаивает</span>;
  else powerSub = <span className="rs-kpi-s">{fmtPct(s.compute.alloc.experiments * 100, 0)} всей мощности</span>;

  return (
    <div className={`rs-hero${current ? '' : ' idle'}`}>
      <div className="rs-kpi rs-kpi-main">
        {focus ? <Ring id={focus} share={current ? progressOf(s, current) : 0} dim={!current} /> : null}
        <div className="rs-kpi-body">
          <div className={`rs-kpi-l${current ? '' : ' warn'}`}>{current ? 'Текущее исследование' : 'Исследование не выбрано'}</div>
          {focus ? (
            <>
              <div className="rs-hero-name">{techName(focus)}</div>
              <div className="rs-kpi-s gain">{techGain(s, focus)}</div>
            </>
          ) : (
            <div className="rs-hero-name">Все технологии изучены</div>
          )}
        </div>
        {!current && focus && (
          <button
            type="button"
            className="btn rs-go"
            data-tutorial={focus === 'attention' ? 'tech-attention' : undefined}
            onClick={() => onOpen(focus)}
          >
            Изучать
          </button>
        )}
      </div>
      <div className="rs-kpi">
        <div className="rs-kpi-l">{current ? 'До готовности' : 'Срок'}</div>
        <div className="rs-kpi-v">{focus ? termText(days) : '-'}</div>
        <div className="rs-kpi-s">{focus && Number.isFinite(days) ? `к ${formatDateShort(s.day + Math.max(1, days))}` : ' '}</div>
      </div>
      <div className="rs-kpi rs-kpi-power">
        <div className="rs-kpi-l">Мощность на исследования</div>
        <div className="rs-kpi-v">{fmtNum(power)} H100e</div>
        {powerSub}
        <div className="rs-hero-btns">
          {current && cards && (
            <button type="button" className="rs-hbtn" onClick={() => onOpen(current)}>
              Изменить
            </button>
          )}
          {!cards && (
            <button type="button" className="rs-hbtn" onClick={onCompute}>
              Открыть «Мощности»
            </button>
          )}
          {current && (
            <button type="button" className="rs-hbtn" onClick={stop}>
              Остановить
            </button>
          )}
          <DenyNote text={note} />
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
      <span className="rs-queue-l">Дальше по очереди</span>
      {s.research.queue.map((id, i) => (
        <span className="rs-qchip" key={id}>
          <b className="num">{i + 1}</b>
          <button type="button" className="rs-qname" onClick={() => onOpen(id)}>
            <TechIcon id={id} size={20} />
            {techName(id)}
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
            <IconClose size={12} />
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
  const busy = s.research.current !== null;
  return (
    <aside className="rs-side">
      <div className="rs-side-h">
        Можно начать <span className="rs-count num">{list.length}</span>
      </div>
      <div className="rs-side-list">
        {list.map((id) => {
          const q = s.research.queue.indexOf(id) + 1;
          return (
            <button key={id} type="button" className="rs-card" style={nodeStyle(id)} onClick={() => onOpen(id)}>
              <TechIcon id={id} size={38} />
              <span className="rs-card-t">
                <span className="rs-card-name">{techName(id)}</span>
                <span className="rs-card-gain">{techGain(s, id)}</span>
                <span className="rs-card-foot">
                  <span className="rs-card-term">{termText(researchDaysLeft(s, id, rp))}</span>
                  {q > 0 ? <span className="rs-card-q">В очереди: {q}</span> : <span className="rs-card-go">{busy ? 'Выбрать' : 'Изучать'}</span>}
                </span>
              </span>
            </button>
          );
        })}
        {later.length > 0 && (
          <>
            <div className="rs-side-sub">Откроются потом</div>
            {later.map((id) => {
              const need = missingRequirements(s, id);
              const q = s.research.queue.indexOf(id) + 1;
              return (
                <button key={id} type="button" className="rs-later" onClick={() => onOpen(id)}>
                  <TechIcon id={id} size={26} locked={q === 0} />
                  <span className="rs-later-t">
                    <span className="rs-later-name">{techName(id)}</span>
                    <span className="rs-later-why">
                      {q > 0 ? `В очереди: ${q}` : `После «${need.map(techName).join('», «')}»`}
                    </span>
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

// ---------- Окно ----------

export default function ResearchWindow({ s, open }: WindowProps) {
  const [dialog, setDialog] = useState<TechId | null>(null);
  const rp = rpPerDay(s);
  const power = pool(s, 'experiments');
  const fresh = useFresh(s);
  const doneCount = s.research.done.length;
  const pick = availableList(s, rp)[0] ?? null;
  const mapRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(mapRef);

  return (
    <div className="rs">
      <Hero s={s} rp={rp} power={power} pick={pick} onOpen={setDialog} onCompute={() => open('compute')} />
      <QueueStrip s={s} onOpen={setDialog} />
      <div className="rs-body">
        <section className="rs-mapwrap" aria-label="Карта технологий">
          <div className="rs-map-h">
            <span className="rs-map-t">Карта технологий</span>
            <span className="rs-legend" aria-hidden="true">
              <span className="lg done">Изучено</span>
              <span className="lg avail">Можно начать</span>
              <span className="lg lock">Закрыто</span>
            </span>
            <span className={`rs-trophies${fresh.size > 0 ? ' pop' : ''}`} title="Изучено технологий">
              <Star size={14} />
              <b className="num">
                {doneCount} из {TECHS_TO_LEARN}
              </b>
            </span>
          </div>
          <div className="rs-mapscroll" ref={mapRef}>
            <div className="rs-mapfit" style={{ width: MAP_W * scale, height: MAP_H * scale }}>
              <div style={{ transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: '0 0' }}>
                <TechMap s={s} rp={rp} fresh={fresh} onOpen={setDialog} />
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
  const penalty = earlyPenalty(s, id);
  const rentMonth = rentPerDay(s) * (pct / 100) * DAYS_IN_MONTH;
  const changed = pct !== current.experiments;
  const noCards = total <= 0;
  const past = pastHistory(s, id);
  const color = BRANCH_COLOR[info.branch];
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
      <div className="rs-d" style={{ '--br': color.line, '--br-fill': color.fill } as CSSProperties}>
        <div className={`rs-d-head${status === 'done' ? ' done' : ''}`}>
          <span className="rs-d-ico">
            <TechIcon id={id} size={56} locked={status === 'blocked' && !queued} />
          </span>
          <div className="rs-d-ht">
            <div className="rs-d-branch">{BRANCH_NAMES[info.branch]}</div>
            <h2 className="rs-d-title">{info.name}</h2>
          </div>
          {status === 'done' && (
            <span className="rs-d-medal">
              <Star size={16} /> Изучено
            </span>
          )}
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
                {contextLabel(maxContext(s))} → {contextLabel(ctxNext)} {tokensWord(ctxNext)}
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
              <dt>Раньше своего времени</dt>
              <dd className="warn" title="Технология опережает историю. Чем ближе её время, тем она дешевле.">
                дороже {timesWord(penalty)}
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
                  <Range value={pct} min={0} max={100} color={color.line} label="Мощность на исследование" valueText={fmtPct(pct, 0)} onChange={setPct} />
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
