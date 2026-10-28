// Гонка в движении: место и ближайшие соперники на верхней панели, баннер, когда место меняется.
// До рынка API (середина 2020 года) гонка идёт по главному тесту времени, потом - по «Арене».

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LABS } from '../data/labs';
import { arenaStanding, type ArenaNeighbor, type ArenaStanding, type RaceMetric } from '../sim/leaderboard';
import { duelOf } from '../sim/duel';
import type { GameState, HypeOwner, LabId } from '../sim/types';
import { ARENA_PLACE_TITLE } from './arena';
import { LabEmblem } from './components/LabEmblem';
import { openDossier } from './dossier';
import { fmtInt, fmtPct } from './format';
import { FlashNum } from './FlashNum';
import { IconArrowDown, IconArrowUp, IconClose, IconTrophy } from './icons';
import { playSound } from './sound';
import { store } from './store';
import type { WindowAlias, WindowId } from './windows';
import './arena.css';

const BANNER_MS = 5000;

const LAB_COLOR = new Map<HypeOwner, string>(LABS.map((l) => [l.id, l.color]));
const LAB_NAME = new Map<HypeOwner, string>(LABS.map((l) => [l.id, l.name]));

export function standingOf(s: GameState): ArenaStanding | null {
  try {
    return arenaStanding(s);
  } catch {
    return null;
  }
}

/** Разрыв, при котором соседа подсвечиваем как «почти»: 15 Эло или 1,5 балла теста. */
function closeGap(m: RaceMetric): number {
  return m.kind === 'arena' ? 15 : 1.5;
}

/** «24» для Эло, «1,3» для баллов теста. */
export function fmtGap(m: RaceMetric, gap: number): string {
  return m.kind === 'arena' ? fmtInt(Math.max(1, gap)) : Math.max(0.1, gap).toFixed(1).replace('.', ',');
}

/** «1 234 Эло» или «88,4 %». */
export function fmtValue(m: RaceMetric, v: number): string {
  return m.kind === 'arena' ? `${fmtInt(v)} Эло` : fmtPct(v, 1);
}

/** Короткое имя гонки: «Арена» или имя теста. */
export function raceName(m: RaceMetric): string {
  return m.kind === 'arena' ? '«Арена»' : m.name;
}

function sameMetric(a: RaceMetric, b: RaceMetric): boolean {
  return a.kind === b.kind && (a.kind === 'arena' || (b.kind === 'bench' && a.bid === b.bid));
}

function raceTitle(m: RaceMetric): string {
  return m.kind === 'arena'
    ? ARENA_PLACE_TITLE
    : `Пока у соперников нет моделей в продаже, гонка идёт по тесту ${m.name} среди всех вышедших моделей. Когда модели появятся в продаже, гонка перейдёт на «Арену».`;
}

function Dot({ lab }: { lab: HypeOwner }) {
  return <i className="ar-dot" style={{ background: LAB_COLOR.get(lab) ?? '#888' }} />;
}

function NeighborLine({ n, dir, metric }: { n: ArenaNeighbor | null; dir: 'up' | 'down'; metric: RaceMetric }) {
  if (!n) {
    return <span className="ar-n ar-n-none">{dir === 'up' ? 'Выше никого' : 'Ниже никого'}</span>;
  }
  const close = n.gap <= closeGap(metric);
  return (
    <span className={`ar-n ar-n-${dir}${close ? ' close' : ''}`} title={`${n.name} (${LAB_NAME.get(n.lab) ?? n.lab}): ${fmtValue(metric, n.value)}`}>
      <b>{dir === 'up' ? <IconArrowUp size={11} strokeWidth={3} /> : <IconArrowDown size={11} strokeWidth={3} />}</b>
      <Dot lab={n.lab} />
      <span className="ar-name">{n.name}</span>
      <span className="ar-gap">
        {dir === 'up' ? '-' : '+'}
        {fmtGap(metric, n.gap)}
      </span>
      {close && <span className="ar-close">почти</span>}
    </span>
  );
}

/** Место и ближайшие соперники для верхней панели. */
export function ArenaStrip({ s }: { s: GameState }) {
  const st = standingOf(s);
  if (!st) {
    return (
      <span className="ar-strip ar-empty" title={ARENA_PLACE_TITLE}>
        Гонка: {s.models.some((m) => m.releasedDay !== null) ? 'соперников пока нет' : 'выпустите первую модель'}
      </span>
    );
  }
  return (
    <div className="ar-strip" title={raceTitle(st.metric)}>
      <div className="ar-place">
        <span className="ar-k">{raceName(st.metric)}</span>
        <span className={`ar-r${st.rank === 1 ? ' first' : ''}`}>
          <FlashNum value={st.rank} frac={0} invert>
            {st.rank}-е
          </FlashNum>
        </span>
      </div>
      <div className="ar-ns">
        <NeighborLine n={st.above} dir="up" metric={st.metric} />
        <NeighborLine n={st.below} dir="down" metric={st.metric} />
      </div>
    </div>
  );
}

/** Строка выдержки из таблицы гонки в баннере. */
interface Row {
  key: string;
  name: string;
  lab: HypeOwner | null; // null - модель игрока
  value: number;
  me: boolean;
  note: 'passed' | 'lost' | null; // обогнали её / она обогнала вас
}

interface Banner {
  key: number;
  metric: RaceMetric;
  from: number | null;
  to: number;
  model: string;
  passed: ArenaNeighbor[]; // кого обогнали
  lost: ArenaNeighbor[]; // кто обогнал
  ahead: ArenaNeighbor[];
  behind: ArenaNeighbor[];
  switched: boolean; // гонка перешла на другой тест или на «Арену»
  rows: Row[];
  /** Главный соперник участвовал в смене места: его счёт обгонов с вами после неё. */
  rival: { lab: LabId; youPassed: number; passedYou: number } | null;
}

function names(list: ArenaNeighbor[]): string {
  const shown = list.slice(0, 2).map((n) => n.name);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(', ')} и ещё ${more}` : shown.join(' и ');
}

function rivalRow(n: ArenaNeighbor, note: Row['note']): Row {
  return { key: n.id, name: n.name, lab: n.lab, value: n.value, me: false, note };
}

/** Выдержка из таблицы: до двух моделей выше, лучшая модель игрока, до двух ниже. Кто сменил место - отмечен. */
function excerpt(st: ArenaStanding, passed: ArenaNeighbor[], lost: ArenaNeighbor[]): Row[] {
  const lostIds = new Set(lost.map((n) => n.id));
  const passedIds = new Set(passed.map((n) => n.id));
  // ahead идут по убыванию, ближние к игроку в конце; behind - ближние первыми.
  const above = (lost.length > 0 ? st.ahead.filter((n) => lostIds.has(n.id)) : st.ahead).slice(-2);
  const below = (passed.length > 0 ? st.behind.filter((n) => passedIds.has(n.id)) : st.behind).slice(0, passed.length > 0 ? 2 : 1);
  return [
    ...above.map((n) => rivalRow(n, lostIds.has(n.id) ? 'lost' : null)),
    { key: 'me', name: st.modelName, lab: null, value: st.value, me: true, note: null },
    ...below.map((n) => rivalRow(n, passedIds.has(n.id) ? 'passed' : null)),
  ];
}

/** Баннер под верхней панелью, когда лучшая модель игрока меняет место в гонке: выдержка из таблицы вокруг модели. */
export function ArenaBanner({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const prev = useRef<{ state: GameState; day: number; st: ArenaStanding | null } | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [hover, setHover] = useState(false);
  const version = useSyncExternalStore(store.subscribe, store.getVersion);

  useEffect(() => {
    const st = standingOf(s);
    const p = prev.current;
    prev.current = { state: s, day: s.day, st };
    // Новая партия, загрузка или откат дня: сравнивать не с чем.
    if (!p || p.state !== s || s.day < p.day || !st) return;
    const before = p.st && sameMetric(p.st.metric, st.metric) ? p.st : null;
    const switched = !!p.st && !before;
    if (before && before.rank === st.rank) return;
    const wasAhead = new Set((before?.ahead ?? []).map((n) => n.id));
    const nowAhead = new Set(st.ahead.map((n) => n.id));
    const passed = (before?.ahead ?? []).filter((n) => !nowAhead.has(n.id));
    const lost = st.ahead.filter((n) => !wasAhead.has(n.id));
    const b: Banner = {
      key: version,
      metric: st.metric,
      from: before?.rank ?? null,
      to: st.rank,
      model: st.modelName,
      passed,
      lost,
      ahead: st.ahead,
      behind: st.behind,
      switched,
      rows: excerpt(st, switched ? [] : passed, switched ? [] : lost),
      rival: null,
    };
    // Главный соперник в смене места: строка со счётом обгонов (sim/duel.ts уже засчитал этот день).
    const main = s.duel?.main ?? null;
    if (main && !switched && [...passed, ...lost].some((n) => n.lab === main)) {
      const d = duelOf(s, main);
      b.rival = { lab: main, youPassed: d.youPassed, passedYou: d.passedYou };
    }
    setBanner(b);
    const up = b.from === null || b.to < b.from;
    playSound(switched ? 'research' : b.to === 1 && up ? 'first' : up ? 'rankUp' : 'rankDown');
  }, [s, version]);

  useEffect(() => {
    if (!banner || hover) return;
    const id = window.setTimeout(() => setBanner(null), BANNER_MS);
    return () => window.clearTimeout(id);
  }, [banner, hover]);

  if (!banner) return null;
  const up = banner.from === null || banner.to < banner.from;
  const first = banner.to === 1 && up && !banner.switched;
  const race = raceName(banner.metric);
  let sub: string;
  if (banner.switched) {
    sub =
      banner.metric.kind === 'arena'
        ? 'У соперников появились модели в продаже: теперь гонка идёт на «Арене»'
        : `Новый бенчмарк ${banner.metric.name}: теперь гонка идёт по нему`;
  } else if (banner.from === null) {
    sub = banner.to === 1 ? `Гонка началась: впереди вы, за вами ${names(banner.behind)}` : `Гонка началась: впереди ${names(banner.ahead)}`;
  }
  else if (up) sub = banner.passed.length > 0 ? `${banner.model} обогнала ${names(banner.passed)}` : `${banner.model} поднялась выше`;
  else sub = banner.lost.length > 0 ? `Вас ${banner.lost.length > 1 ? 'обогнали' : 'обогнала'} ${names(banner.lost)}` : `${banner.model} опустилась ниже`;
  const tone = banner.switched ? 'switch' : first ? 'first' : up ? 'up' : 'down';
  return (
    <div
      key={banner.key}
      className={`ar-banner ${tone}`}
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="arb-head">
        {first && <IconTrophy size={18} className="arb-cup" />}
        <span className="arb-race">{banner.switched ? `Гонка: ${race}` : race}</span>
        <b className="arb-place">{banner.to}-е место</b>
        {banner.from !== null && !banner.switched && <span className="arb-was">было {banner.from}-е</span>}
      </div>
      <div className="arb-sub">{sub}</div>
      {banner.rival && (
        <button
          type="button"
          className="arb-rival"
          onClick={() => {
            if (banner.rival) openDossier(banner.rival.lab, open);
            setBanner(null);
          }}
          title="Открыть досье лаборатории"
        >
          <LabEmblem lab={banner.rival.lab} size={16} decorative />
          <span>
            Главный соперник: <b>{LAB_NAME.get(banner.rival.lab)}</b>. Счёт обгонов {banner.rival.youPassed}:{banner.rival.passedYou}
          </span>
        </button>
      )}
      <table className="arb-rows">
        <tbody>
          {banner.rows.map((r) => (
            <tr key={r.key} className={r.me ? 'me' : r.note ?? undefined}>
              <td>
                <span className="arb-n">
                  <i className="ar-dot" style={{ background: r.lab ? (LAB_COLOR.get(r.lab) ?? '#888') : 'var(--accent)' }} />
                  <span className="ar-name">{r.name}</span>
                  {r.me && <span className="arb-you">вы</span>}
                </span>
              </td>
              <td className="arb-v">{fmtValue(banner.metric, r.value)}</td>
              <td className="arb-note">{r.note === 'passed' ? 'обогнали' : r.note === 'lost' ? 'обогнала вас' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="arb-x" onClick={() => setBanner(null)} aria-label="Скрыть">
        <IconClose size={12} />
      </button>
    </div>
  );
}
