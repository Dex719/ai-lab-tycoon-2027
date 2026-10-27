// Лаборатория на весь рабочий стол (вместо сцены из четырёх «станций»): 3D-помещение этапа, люди, стойки, доска, полка.
// Над местами в комнате висят подписи - что там происходит; щелчок открывает нужное окно. Слева сверху - этап лаборатории
// и что нужно до следующего; в первый год внизу - «Следующий шаг». Сцена перестраивается только при смене того,
// что на ней видно (spec), а не каждый игровой день.

import { useCallback, useMemo, useState } from 'react';
import { GPUS } from '../data/gpus';
import { LABS } from '../data/labs';
import { idleWarnings } from '../sim/idle';
import { LAB_STAGES, labStage, metricStage, yearCups } from '../sim/labStage';
import { rpPerDay, techCost, TECHS } from '../sim/research';
import { staffSeats } from '../sim/staff';
import { nextArrival, totalH100e } from '../sim/compute';
import { formatDateShort, yearOf } from '../sim/time';
import { personalityOf } from '../data/labPersonalities';
import type { GameState, LabId, PlayerModel, Tier } from '../sim/types';
import { distribute, ALLOC_ROWS } from './alloc';
import { fmtH100e, fmtMoney, fmtNum, fmtShare, ruPlural } from './format';
import { openDossier } from './dossier';
import { nextStep, type NextStep } from './nextStep';
import { raceMetricOf, raceRows } from './race';
import { store, useSpeed } from './store';
import { specKey, type LabSpec } from './three/specs';
import { View3D } from './three/View3D';
import type { WindowAlias, WindowId } from './windows';
import './labFloor.css';

type Open = (id: WindowId | WindowAlias) => void;
type At = Record<string, { x: number; y: number }>;

/** Карт на один светящийся сервер в стойке (24 карты - полная стойка из 8 серверов). */
const CARDS_PER_UNIT = 3;
const MODELS_ON_SHELF = 6;
const TIER_COLOR: Record<Tier, string> = { light: '#1fa8a0', mid: '#2f80e4', flagship: '#7b5cd6' };

function cardCount(s: GameState): number {
  let n = 0;
  for (const g of GPUS) n += s.compute.rented[g.id] ?? 0;
  for (const dc of s.datacenters?.list ?? []) for (const g of GPUS) n += dc.gpus[g.id] ?? 0;
  return n;
}

interface Facts {
  spec: LabSpec;
  cards: number;
  h100e: number;
  idle: boolean;
  research: { name: string; frac: number; busy: boolean } | null;
  training: { name: string; frac: number; stalled: boolean; more: number } | null;
  best: PlayerModel | null;
  place: number | null;
  released: number;
  freeSeats: number;
  /** Гонка, в которой считается место: «на «Арене»» или «по SQuAT». */
  raceLabel: string | null;
  /** Здания соперников перед лабораторией: лаборатория и её доля рынка. */
  rivals: { lab: LabId; name: string; share: number }[];
  /** Общая доля рынка игрока 0..1 и больше ли она, чем у любой лаборатории-соперника. */
  share: number;
  shareLeader: boolean;
}

/** Год основания лаборатории: с этого года её здание стоит в комнате, даже если доли на рынке ещё нет. */
const LAB_FOUNDED: Record<LabId, number> = {
  openbrain: 2015,
  gogle: 2010,
  alibabo: 2017,
  zhipo: 2019,
  antropik: 2021,
  charakter: 2021,
  infleksion: 2022,
  deepcent: 2023,
  moonshoot: 2023,
};

/**
 * Три лаборатории-соперника в комнате. Сначала с наибольшей долей рынка (хотя бы 1 %). Если таких меньше трёх,
 * добираем основанные к этому году по силе бренда (LabDef.brand): в первые годы здания стоят без доли рынка.
 * Возвращаются в порядке data/labs.ts: дома не переезжают.
 */
export function topRivals(s: GameState) {
  const shown = LABS.filter((l) => (s.market.labShares[l.id] ?? 0) >= 0.01)
    .sort((a, b) => (s.market.labShares[b.id] ?? 0) - (s.market.labShares[a.id] ?? 0))
    .slice(0, 3);
  if (shown.length < 3) {
    const year = yearOf(s.day);
    const extra = LABS.filter((l) => !shown.includes(l) && LAB_FOUNDED[l.id] <= year)
      .sort((a, b) => b.brand - a.brand)
      .slice(0, 3 - shown.length);
    shown.push(...extra);
  }
  return LABS.filter((l) => shown.includes(l));
}

/** Этажей у здания соперника по доле: до 5 % - один, до 15 % - два, до 30 % - три, больше - четыре. */
function rivalBuildings(s: GameState): NonNullable<LabSpec['rivals']> {
  return topRivals(s).map((l) => {
    const sh = s.market.labShares[l.id] ?? 0;
    return { lab: l.id, color: l.color, floors: sh < 0.05 ? 1 : sh < 0.15 ? 2 : sh < 0.3 ? 3 : 4 };
  });
}

function factsOf(s: GameState): Facts {
  const stage = labStage(s);
  const def = LAB_STAGES[stage];
  const cur = s.research.current;
  let research: Facts['research'] = null;
  if (cur) {
    const cost = techCost(s, cur);
    const frac = cost > 0 ? Math.min(1, (s.research.points[cur] ?? 0) / cost) : 0;
    research = { name: TECHS.find((t) => t.id === cur)?.name ?? cur, frac, busy: rpPerDay(s) > 0 };
  }
  const t = s.trainings[0];
  const training = t
    ? { name: t.plan.name, frac: t.flopTotal > 0 ? t.flopDone / t.flopTotal : 0, stalled: t.failed, more: Math.max(0, s.trainings.length - 1) }
    : null;
  let place: number | null = null;
  let best: PlayerModel | null = null;
  const metric = raceMetricOf(s);
  if (metric) {
    const rows = raceRows(s, metric);
    const mine = rows.some((x) => x.owner !== 'player') ? rows.find((x) => x.owner === 'player' && x.rank !== null) : undefined;
    if (mine) {
      place = mine.rank;
      best = s.models.find((m) => m.id === mine.row.ref.id) ?? null;
    }
  }
  const released = s.models.filter((m) => m.releasedDay !== null);
  const share = s.market.labShares.player ?? 0;
  const rivalTop = Math.max(0, ...LABS.map((l) => s.market.labShares[l.id] ?? 0));
  const shelf = [...(best ? [best] : []), ...released.filter((m) => m !== best).sort((a, b) => b.arenaElo - a.arenaElo)].slice(0, MODELS_ON_SHELF);
  const cards = cardCount(s);
  const racks = def.racks;
  const shares = ALLOC_ROWS.map((r) => s.compute.alloc[r.key]);
  const perRack = distribute(shares, racks);
  const rackColors: string[] = [];
  ALLOC_ROWS.forEach((r, i) => {
    for (let k = 0; k < perRack[i]; k++) rackColors.push(r.color);
  });
  const staff = s.staff?.people ?? [];
  const working = staff.filter((e) => e.startDay <= s.day).length;
  const teams = s.late?.teams.length ?? 0;
  const freeSeats = Math.max(0, staffSeats(s) - staff.length);
  const spec: LabSpec = {
    kind: 'lab',
    stage,
    people: 2 + working + teams * 2,
    freeSeats,
    racks,
    racksLit: Math.min(racks * 8, Math.ceil(cards / CARDS_PER_UNIT)),
    rackColors,
    research: !!research?.busy,
    training: !!training && !training.stalled,
    models: shelf.map((m, i) => (i === 0 && place === 1 ? '#e8c34a' : TIER_COLOR[m.plan.tier])),
    cups: yearCups(s).slice(-6).map((c) => c.kind),
    base: '#5f8f45',
    flag: s.country,
    visitors: true,
    rivals: rivalBuildings(s),
  };
  return {
    spec,
    cards,
    h100e: totalH100e(s),
    idle: idleWarnings(s).length > 0,
    research,
    training,
    best,
    place,
    released: released.length,
    freeSeats,
    raceLabel: metric ? (metric.kind === 'arena' ? 'на «Арене»' : `по ${metric.name}`) : null,
    share,
    shareLeader: share > 0.005 && share > rivalTop,
    rivals: topRivals(s).map((l) => ({ lab: l.id, name: l.name, share: s.market.labShares[l.id] ?? 0 })),
  };
}

/** Примерный размер подписи: соседние подписи не должны налезать друг на друга. */
const TAG_W = 190;
const TAG_H = 64;
/** Подпись стоит над точкой: от низа подписи до точки - хвостик (см. .lf-tag в labFloor.css). */
const TAG_GAP = 10;
/** Интерфейс поверх сцены: подписи под ним не видно (колонка разделов, лента, сводка, деньги, «Следующий шаг»). */
const HUD_SELECTORS = '.dock, .dock-tip, .topbar-left, .pause-note, .side, .hud-stats, .hud-br, .lf-next, .month-strip';

type Rect = { l: number; t: number; r: number; b: number };

/** Прямоугольники интерфейса и края экрана: подпись не должна под них уходить. */
function hudRects(): Rect[] {
  const out: Rect[] = [];
  for (const e of document.querySelectorAll(HUD_SELECTORS)) {
    const b = e.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) out.push({ l: b.left, t: b.top, r: b.right, b: b.bottom });
  }
  const far = 1e5;
  const w = window.innerWidth;
  const h = window.innerHeight;
  out.push({ l: -far, t: -far, r: far, b: 0 }, { l: -far, t: -far, r: 0, b: far }, { l: w, t: -far, r: far, b: far }, { l: -far, t: h, r: far, b: far });
  return out;
}

/** Точки сцены, у которых есть подпись или кнопка. */
const SHOWN = new Set(['servers', 'research', 'training', 'showcase', 'seats', 'sign', 'queue']);

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

function tagRect(p: { x: number; y: number }): Rect {
  return { l: p.x - TAG_W / 2, r: p.x + TAG_W / 2, t: p.y - TAG_H - TAG_GAP, b: p.y - TAG_GAP };
}

/**
 * Развести подписи. Каждая выбирает из места у своего предмета и сдвигов (вверх, вниз, вбок) вариант с наименьшим штрафом:
 * подпись под интерфейсом или за краем экрана - хуже всего, наезд на соседнюю подпись - меньше, отход от предмета - меньше
 * всего. Раньше подпись при наезде сразу уезжала вверх и повисала в небе (плейтест 17.10), а на 1024 × 768 уходила под
 * колонку разделов и ленту (QA 19.10). Нижние по экрану ставятся первыми.
 */
export function spread(at: At, hud: readonly Rect[] = []): At {
  const order = Object.entries(at).sort((a, b) => b[1].y - a[1].y);
  const placed: Rect[] = [];
  const out: At = {};
  const cost = (p: { x: number; y: number }, p0: { x: number; y: number }) => {
    const r = tagRect(p);
    const underHud = hud.reduce((a, h) => a + overlap(r, h), 0);
    const onTags = placed.reduce((a, q) => a + overlap(r, q), 0);
    return underHud * 10 + onTags * 3 + Math.hypot(p.x - p0.x, p.y - p0.y) * 30;
  };
  for (const [k, p0] of order) {
    const dx = TAG_W + 6;
    const tries: { x: number; y: number }[] = [p0];
    for (let i = 1; i <= 3; i++) tries.push({ x: p0.x, y: p0.y - i * TAG_H }, { x: p0.x, y: p0.y + i * TAG_H });
    for (const sx of [-1, 1]) for (const sy of [-1, 0, 1]) tries.push({ x: p0.x + sx * dx, y: p0.y + sy * TAG_H });
    // Сдвиг ровно до края интерфейса слева: подпись остаётся почти у предмета.
    for (const h of hud) if (h.r > 0 && h.r < p0.x + TAG_W / 2 && h.l <= 0) tries.push({ x: h.r + TAG_W / 2 + 6, y: p0.y });
    let best = p0;
    let bestCost = cost(p0, p0);
    for (const t of tries) {
      const c = cost(t, p0);
      if (c < bestCost) [best, bestCost] = [t, c];
    }
    placed.push(tagRect(best));
    out[k] = best;
  }
  return out;
}

/** Кнопка «+» над пустым местом в комнате (свободный стол, место под стойку, пустая доска): что можно сделать. */
function Plus(props: { at?: { x: number; y: number }; label: string; onClick: () => void; tutorial?: string }) {
  if (!props.at) return null;
  return (
    <button type="button" className="lf-plus" style={{ left: props.at.x, top: props.at.y }} onClick={props.onClick} data-tutorial={props.tutorial}>
      <i aria-hidden="true">+</i>
      <span>{props.label}</span>
    </button>
  );
}

/** Подпись над местом в комнате: что там происходит и полоса готовности; щелчок открывает окно. */
function Tag(props: { at?: { x: number; y: number }; k: string; v: string; frac?: number; color?: string; warn?: boolean; onClick: () => void; tutorial?: string }) {
  if (!props.at) return null;
  return (
    <button
      type="button"
      className={`lf-tag${props.warn ? ' warn' : ''}`}
      style={{ left: props.at.x, top: props.at.y }}
      onClick={props.onClick}
      data-tutorial={props.tutorial}
    >
      <b>{props.k}</b>
      <span>{props.v}</span>
      {props.frac !== undefined && (
        <i className="lf-bar">
          <i style={{ width: `${Math.round(Math.min(1, props.frac) * 100)}%`, background: props.color }} />
        </i>
      )}
    </button>
  );
}

/** Этап лаборатории на верхней панели: название и полоска до следующего этапа (подробности - в подсказке). */
export function StageMark({ s }: { s: GameState }) {
  const stage = labStage(s);
  const def = LAB_STAGES[stage];
  const next = LAB_STAGES[stage + 1];
  const m = metricStage(s);
  const frac = next ? Math.max(Math.min(1, m.month / next.month), Math.min(1, m.value / next.value)) : 1;
  const title = next
    ? `До этапа «${next.name}»: лучший месяц выручки ${fmtMoney(m.month)} из ${fmtMoney(next.month)} или оценка компании ${fmtMoney(m.value)} из ${fmtMoney(next.value)}`
    : 'Последний этап';
  return (
    <span className="tb-stage" title={title}>
      {def.name}
      {next && (
        <i className="tb-stage-bar">
          <i style={{ width: `${Math.round(frac * 100)}%` }} />
        </i>
      )}
    </span>
  );
}

/**
 * Табло над лабораторией: место в гонке (золотое на 1-м месте) и сколько клиентов выбирают модели лаборатории.
 * Видно, только когда есть модель в продаже. Щелчок открывает «Аналитику» с таблицей мест.
 */
function LabSign(props: { at?: { x: number; y: number }; f: Facts; labName: string; onClick: () => void }) {
  const { at, f } = props;
  if (!at || f.released === 0) return null;
  const first = f.place === 1;
  const title = f.place !== null && f.raceLabel ? `${f.place}-е место ${f.raceLabel}` : 'Соперников в гонке пока нет';
  const pct = Math.round(f.share * 100);
  const sub =
    pct >= 1
      ? `Выбирают ${pct} % клиентов${f.shareLeader ? ' - больше всех' : ''}`
      : f.share > 0
        ? 'Выбирают меньше 1 % клиентов'
        : 'Клиентов пока нет';
  return (
    <button type="button" className={`lf-sign${first ? ' first' : ''}`} style={{ left: at.x, top: at.y }} onClick={props.onClick}>
      <small>{props.labName}</small>
      <b>{title}</b>
      <span className={f.shareLeader ? 'lead' : undefined}>{sub}</span>
    </button>
  );
}

function NextPlate({ step, open }: { step: NextStep; open: Open }) {
  return (
    <div className="lf-next" role="note" aria-label="Следующий шаг">
      <div className="lf-next-t">
        <span>Следующий шаг</span>
        <b>{step.title}</b>
        <small>{step.detail}</small>
      </div>
      {step.action && (
        <button type="button" className="btn primary" onClick={() => (step.open === 'play' ? store.setSpeed(1) : open(step.open))}>
          {step.action}
        </button>
      )}
    </div>
  );
}

export function LabFloor({ s, open }: { s: GameState; open: Open }) {
  const speed = useSpeed();
  const f = factsOf(s);
  const key = specKey(f.spec);
  // Тот же объект описания, пока не изменилось то, что видно: View3D сравнивает по ключу.
  const spec = useMemo(() => f.spec, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [at, setAt] = useState<At>({});
  // В раскладке участвуют только точки, у которых на экране есть подпись или кнопка: пустые точки-заготовки
  // (места под стойку и т. п.) иначе расталкивали настоящие подписи.
  // Маленькие подписи зданий соперников не раздвигаются: они висят прямо над крышей.
  const onAnchors = useCallback(
    (a: At) => {
      setAt({ ...spread(Object.fromEntries(Object.entries(a).filter(([k]) => SHOWN.has(k))), hudRects()), ...Object.fromEntries(Object.entries(a).filter(([k]) => k.startsWith('rival'))) });
    },
    [],
  );
  const next = nextStep(s, speed);
  const arrival = nextArrival(s);
  return (
    <div className="lab-floor">
      <View3D spec={spec} interactive={false} panZoom label="Лаборатория" className="lf-view" onAnchors={onAnchors} />
      <div className="lf-tags">
        <Tag
          at={at.servers}
          k={f.cards > 0 ? `Серверная · ${fmtH100e(f.h100e)} H100e` : 'Серверная'}
          v={
            f.cards > 0
              ? `${fmtNum(f.cards)} ${ruPlural(f.cards, 'карта', 'карты', 'карт')}${f.idle ? ', есть простой' : ''}`
              : arrival
                ? `Карты в пути: придут ${formatDateShort(arrival.day)}`
                : 'Карт нет: арендовать'
          }
          warn={f.idle || f.cards === 0}
          onClick={() => open('compute')}
          tutorial="scene-compute"
        />
        <Tag
          at={at.research}
          k={f.research ? `Исследование · ${fmtShare(f.research.frac, 0)}` : 'Исследования'}
          v={f.research ? f.research.name : 'Не идут: выбрать'}
          frac={f.research ? f.research.frac : undefined}
          color="var(--dir-research)"
          warn={!f.research || !f.research.busy}
          onClick={() => open('research')}
        />
        <Tag
          at={at.training}
          k={f.training ? `Обучение · ${fmtShare(f.training.frac, 0)}${f.training.more ? ` (+${f.training.more})` : ''}` : 'Обучение'}
          v={f.training ? (f.training.stalled ? `${f.training.name}: ждёт решения` : f.training.name) : 'Свободно: новая модель'}
          frac={f.training ? f.training.frac : undefined}
          color="var(--dir-train)"
          warn={!!f.training?.stalled}
          onClick={() => open(f.training ? 'models' : 'newModel')}
        />
        <Tag
          at={at.showcase}
          k={f.place !== null ? `Витрина · ${f.place}-е место` : 'Витрина'}
          v={f.best ? f.best.name : f.released > 0 ? `Выпущено: ${fmtNum(f.released)}` : 'Пусто'}
          onClick={() => open(f.released > 0 ? 'models' : 'newModel')}
        />
        <LabSign at={at.sign} f={f} labName={s.labName} onClick={() => open('ratings')} />
        {/* Люди на дорожке - клиенты: очередь растёт с долей рынка (без подписи было непонятно, кто это, отзыв 18.10). */}
        <Tag at={f.share > 0.005 ? at.queue : undefined} k="Клиенты в очереди" v={`Доля рынка ${fmtShare(f.share, 0)}`} onClick={() => open('market')} />
        {/* Здания соперников: кто ещё забирает клиентов и сколько. */}
        {f.rivals.map((r, i) => {
          const p = personalityOf(r.lab);
          return (
            <button
              key={r.lab}
              type="button"
              className="lf-mini"
              title={`${p.archetype}: ${p.description}`}
              style={at[`rival${i}`] ? { left: at[`rival${i}`].x, top: at[`rival${i}`].y } : { display: 'none' }}
              onClick={() => openDossier(r.lab, open)}
            >
              {r.share < 0.005 ? r.name : `${r.name} · ${fmtShare(r.share, 0)}`}
            </button>
          );
        })}
        <Plus at={at.seats} label={`Нанять (${fmtNum(f.freeSeats)} ${ruPlural(f.freeSeats, 'место', 'места', 'мест')})`} onClick={() => open('team')} />
        {/* Кнопка «+» - только если подпись рядом не предлагает то же самое: иначе пузыри дублировали друг друга и
            налезали («Свободно: новая модель» и «+ Новая модель», плейтест 17.10). */}
        {f.research && <Plus at={at.researchSlot} label="Исследование в очередь" onClick={() => open('research')} />}
        {f.training && <Plus at={at.trainSlot} label="Ещё модель" onClick={() => open('newModel')} />}
      </div>
      {next && <NextPlate step={next} open={open} />}
    </div>
  );
}
