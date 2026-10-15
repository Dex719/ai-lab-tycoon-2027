// Сцена в центре рабочего стола: лаборатория игрока в четырёх «станциях» - серверная (3D-зал арендованных стоек), исследования,
// обучение и витрина моделей. Сцена лежит под окнами (как обои) и показывает состояние лаборатории одним взглядом;
// каждая станция открывает своё окно. Анимаций нет: сцена меняется вместе с игрой.

import { memo } from 'react';
import { GPUS } from '../data/gpus';
import { idleWarnings } from '../sim/idle';
import { LAB_STAGES, labStage, yearCups, type YearCup } from './labStage';
import { rpPerDay, techCost, TECHS } from '../sim/research';
import type { GameState, PlayerModel } from '../sim/types';
import { ModelEmblem } from './components/ModelEmblem';
import { fmtNum, fmtShare, ruPlural } from './format';
import { IconLogo } from './icons';
import { nextStep, type NextStep } from './nextStep';
import { store, useSpeed } from './store';
import { raceMetricOf, raceRows } from './race';
import type { WindowAlias, WindowId } from './windows';
import { ALLOC_ROWS } from './alloc';
import { rentedFarm, specKey, type FarmSpec } from './three/specs';
import { View3D } from './three/View3D';
import './desk.css';

/** Карт в одной стойке на картинке; мест под стойки - по этапу лаборатории (labStage.ts), не больше шести. */
const CARDS_PER_RACK = 24;
const MAX_RACKS = 6;
/** Витрина: верхняя полка - лучшие по «Арене», нижняя - остальные выпущенные, новые первыми. */
const TOP_SHELF = 3;
const LOW_SHELF = 5;
/** Рабочих мест на сцене: по два за стол этапа и по два за звёздную команду; не больше шестнадцати. */
const MAX_SEATS = 16;

function cardCount(s: GameState): number {
  let n = 0;
  for (const g of GPUS) n += s.compute.rented[g.id] ?? 0;
  for (const dc of s.datacenters?.list ?? []) for (const g of GPUS) n += dc.gpus[g.id] ?? 0;
  return n;
}

interface SceneProps {
  labName: string;
  stage: number;
  seats: number;
  cups: YearCup[];
  cards: number;
  /** Машинный зал: арендованные стойки с планками цвета задачи (как в «Мощностях»). */
  farm: FarmSpec;
  idle: boolean;
  research: { name: string; frac: number; busy: boolean } | null;
  training: { name: string; frac: number; stalled: boolean } | null;
  trainingMore: number;
  shelf: PlayerModel[];
  lowShelf: PlayerModel[];
  onSale: number;
  place: number | null;
  /** «Следующий шаг» под станциями в первый год партии (nextStep.ts); null - не показывается. */
  next: NextStep | null;
  open: (id: WindowId | WindowAlias) => void;
}

const cupsKey = (cups: YearCup[]): string => cups.map((c) => c.year + c.kind).join();

/** Сцена перерисовывается, только когда меняется то, что на ней видно (а не каждый игровой день). */
function sameScene(a: SceneProps, b: SceneProps): boolean {
  return (
    a.labName === b.labName &&
    a.stage === b.stage &&
    a.seats === b.seats &&
    cupsKey(a.cups) === cupsKey(b.cups) &&
    a.cards === b.cards &&
    specKey(a.farm) === specKey(b.farm) &&
    a.idle === b.idle &&
    a.research?.name === b.research?.name &&
    a.research?.frac === b.research?.frac &&
    a.research?.busy === b.research?.busy &&
    a.training?.name === b.training?.name &&
    a.training?.frac === b.training?.frac &&
    a.training?.stalled === b.training?.stalled &&
    a.trainingMore === b.trainingMore &&
    a.shelf.map((m) => m.id).join() === b.shelf.map((m) => m.id).join() &&
    a.lowShelf.map((m) => m.id).join() === b.lowShelf.map((m) => m.id).join() &&
    a.onSale === b.onSale &&
    a.place === b.place &&
    a.next?.title === b.next?.title &&
    a.next?.detail === b.next?.detail &&
    a.next?.action === b.next?.action &&
    a.next?.open === b.next?.open &&
    a.open === b.open
  );
}

const Scene = memo(function Scene(p: SceneProps) {
  const def = LAB_STAGES[p.stage] ?? LAB_STAGES[0];
  // Мест под стойки столько, сколько позволяет помещение этапа: в гараже две, в кампусе шесть.
  const slots = Math.min(MAX_RACKS, def.racks);
  const racks = Math.min(slots, Math.ceil(p.cards / CARDS_PER_RACK));
  const shownRacks = slots;
  // Сколько блоков в стойках светится: 8 блоков в стойке, последние стойки заполнены частично.
  const units = Math.min(racks * 8, Math.max(p.cards > 0 ? 1 : 0, Math.round((p.cards / (CARDS_PER_RACK * slots)) * slots * 8)));
  const ledTone = p.cards === 0 ? 'off' : p.idle ? 'idle' : 'on';
  const first = p.place === 1;
  return (
    <div className="lab-scene" aria-label="Лаборатория">
      <div className="ls-sign">
        <IconLogo size={26} />
        <b>{p.labName}</b>
        <span className="ls-stage">{def.name}</span>
      </div>
      <div className="ls-team">
        <Seats n={p.seats} />
        <Cups cups={p.cups} />
      </div>
      <div className="ls-room">
        <button type="button" className="ls-station ls-servers" onClick={() => p.open('compute')}>
          <span className="ls-art ls-hall">
            {p.cards > 0 ? (
              <View3D spec={p.farm} interactive={false} label="Машинный зал" className="ls-hall-view" />
            ) : (
              Array.from({ length: shownRacks }, (_, r) => (
                <span key={r} className={`ls-rack${r < racks ? '' : ' empty'}`}>
                  {Array.from({ length: 8 }, (_, u) => {
                    const lit = r * 8 + u < units;
                    return <i key={u} className={lit ? ledTone : 'off'} />;
                  })}
                </span>
              ))
            )}
          </span>
          <span className="ls-cap">
            <span>Серверная</span>
            <b className={p.idle ? 'warn' : undefined}>
              {p.cards > 0 ? `${fmtNum(p.cards)} ${p.cards >= 10_000 ? 'карт' : ruPlural(p.cards, 'карта', 'карты', 'карт')}` : 'Карт нет'}
            </b>
          </span>
        </button>

        <button type="button" className="ls-station ls-lab" onClick={() => p.open('research')}>
          <span className="ls-art">
            <span className={`ls-flask${p.research?.busy ? ' busy' : ''}`}>
              <span className="ls-liquid" style={{ height: `${Math.round(20 + (p.research?.frac ?? 0) * 60)}%` }} />
            </span>
          </span>
          <span className="ls-cap">
            <span>{p.research ? `Исследования, ${fmtShare(p.research.frac, 0)}` : 'Исследования'}</span>
            <b title={p.research?.name}>{p.research ? p.research.name : 'Не идут'}</b>
          </span>
        </button>

        <button type="button" className="ls-station ls-train" onClick={() => p.open(p.training ? 'models' : 'newModel')}>
          <span className="ls-art">
            <span className={`ls-monitor${p.training ? ' busy' : ''}${p.training?.stalled ? ' stalled' : ''}`}>
              {p.training ? (
                <>
                  <span className="ls-screen-k">Обучение{p.trainingMore > 0 ? ` +${p.trainingMore}` : ''}</span>
                  <span className="ls-screen-n">{p.training.name}</span>
                  <span className="ls-screen-bar">
                    <i style={{ width: `${Math.round(p.training.frac * 100)}%` }} />
                  </span>
                  <span className="ls-screen-p">{p.training.stalled ? 'ждёт решения' : fmtShare(p.training.frac, 0)}</span>
                </>
              ) : (
                <span className="ls-screen-idle">Новая модель</span>
              )}
            </span>
            <span className="ls-stand" />
          </span>
          <span className="ls-cap">
            <span>Обучение</span>
            <b>{p.training ? p.training.name : 'Свободно'}</b>
          </span>
        </button>

        <button type="button" className="ls-station ls-shelf" onClick={() => p.open('analytics')}>
          <span className="ls-art">
            <span className={`ls-cup${first ? ' gold' : ''}${p.place === null ? ' none' : ''}`}>{p.place !== null ? `${p.place}` : '-'}</span>
            <span className="ls-board">
              {p.shelf.map((m, i) => (
                <ModelEmblem key={m.id} m={m} size={36} gold={first && i === 0} />
              ))}
            </span>
            <span className="ls-plank" />
            <span className="ls-board low">
              {p.lowShelf.map((m) => (
                <ModelEmblem key={m.id} m={m} size={26} />
              ))}
            </span>
            <span className="ls-plank" />
          </span>
          <span className="ls-cap">
            <span>Витрина</span>
            <b>{p.onSale > 0 ? `В продаже: ${fmtNum(p.onSale)}` : 'Пусто'}</b>
          </span>
        </button>
      </div>
      {p.next && <NextPlate step={p.next} open={p.open} />}
    </div>
  );
}, sameScene);

/** Люди за столами: столы по два рабочих места, у каждого монитор. Плоские фигуры, без анимации. */
const SEAT_W = 30;
const SHIRTS = ['#4f7cc0', '#3f9a8a', '#c07a3f', '#8a8f98', '#5d8f4e'];
const HEADS = ['#d9b48f', '#a87a55', '#e3c4a1', '#8c5f3f'];
function Seats({ n }: { n: number }) {
  const desks = Math.ceil(n / 2);
  const w = desks * SEAT_W * 2 + (desks - 1) * 8;
  return (
    <svg className="ls-seats" width={w} height={44} viewBox={`0 0 ${w} 44`} role="img" aria-label={`Рабочих мест: ${n}`}>
      {Array.from({ length: desks }, (_, d) => {
        const x = d * (SEAT_W * 2 + 8);
        return (
          <g key={d}>
            {[0, 1].map((k) => {
              const i = d * 2 + k;
              if (i >= n) return null;
              const px = x + k * SEAT_W;
              return (
                <g key={k}>
                  <rect x={px + 5} y={17} width={14} height={15} rx={4} fill={SHIRTS[i % SHIRTS.length]} />
                  <circle cx={px + 12} cy={11} r={5.5} fill={HEADS[(i * 3) % HEADS.length]} />
                  <rect x={px + 17} y={14} width={11} height={10} rx={1} fill="#15181d" stroke="#5b6676" strokeWidth={1.5} />
                </g>
              );
            })}
            <rect x={x} y={30} width={SEAT_W * 2} height={4} fill="#7a5a38" />
            <rect x={x + 3} y={34} width={3} height={10} fill="#5b4430" />
            <rect x={x + SEAT_W * 2 - 6} y={34} width={3} height={10} fill="#5b4430" />
          </g>
        );
      })}
    </svg>
  );
}

/** Кубки по годам: золото - 1-е место на конец года, серебро - все цели года. */
function Cups({ cups }: { cups: YearCup[] }) {
  if (cups.length === 0) return null;
  return (
    <span className="ls-cups">
      {cups.slice(-8).map((c) => (
        <span key={c.year} className="ls-ycup" title={c.kind === 'first' ? `1-е место на конец ${c.year} года` : `Все цели ${c.year} года`}>
          <svg width={22} height={24} viewBox="0 0 22 24" aria-hidden="true">
            <path
              className={c.kind}
              d="M4 2 H18 V8 C18 13 15 15.5 11 15.5 C7 15.5 4 13 4 8 Z M9 15 H13 V19 H16 V22 H6 V19 H9 Z M1 3 H4 V5 H3 V7 C3 8.5 3.6 9.4 4.4 10 L3.6 11.4 C2.2 10.6 1 9 1 7 Z M21 3 H18 V5 H19 V7 C19 8.5 18.4 9.4 17.6 10 L18.4 11.4 C19.8 10.6 21 9 21 7 Z"
            />
          </svg>
          <small>{c.year}</small>
        </span>
      ))}
    </span>
  );
}

/** Табличка «Следующий шаг» под станциями: что сделать сейчас и кнопка к окну. Лежит под сценой и не сдвигает её. */
function NextPlate({ step, open }: { step: NextStep; open: (id: WindowId | WindowAlias) => void }) {
  return (
    <div className="ls-next" role="note" aria-label="Следующий шаг">
      <div className="ls-next-t">
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

/** Сцена лаборатории по состоянию партии: сюда приходят только простые числа, чтобы не перерисовывать её каждый день. */
export function DeskScene({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const speed = useSpeed();
  const cur = s.research.current;
  let research: SceneProps['research'] = null;
  if (cur) {
    const cost = techCost(s, cur);
    const frac = cost > 0 ? Math.min(1, (s.research.points[cur] ?? 0) / cost) : 0;
    // Доля округляется до процента, чтобы сцена не обновлялась от каждой сотой.
    research = { name: TECHS.find((t) => t.id === cur)?.name ?? cur, frac: Math.floor(frac * 100) / 100, busy: rpPerDay(s) > 0 };
  }
  const t = s.trainings[0];
  const training = t
    ? { name: t.plan.name, frac: Math.floor((t.flopTotal > 0 ? t.flopDone / t.flopTotal : 0) * 100) / 100, stalled: t.failed }
    : null;
  const metric = raceMetricOf(s);
  let place: number | null = null;
  let best: PlayerModel | undefined;
  if (metric) {
    const rows = raceRows(s, metric);
    // Без соперников в таблице места нет (как на верхней панели: «Соперников пока нет»).
    const mine = rows.some((x) => x.owner !== 'player') ? rows.find((x) => x.owner === 'player' && x.rank !== null) : undefined;
    if (mine) {
      place = mine.rank;
      best = s.models.find((m) => m.id === mine.row.ref.id);
    }
  }
  const onSaleList = s.models.filter((m) => m.releasedDay !== null && (m.onApi || m.onSubs));
  // Витрина - все выпущенные модели. Верхняя полка: лучшая в гонке первой, дальше сильнейшие по «Арене»;
  // нижняя - остальные, новые первыми.
  const releasedList = s.models.filter((m) => m.releasedDay !== null);
  const byElo = releasedList.filter((m) => m !== best).sort((a, b) => b.arenaElo - a.arenaElo);
  const shelf = [...(best ? [best] : []), ...byElo].slice(0, TOP_SHELF);
  const lowShelf = releasedList.filter((m) => !shelf.includes(m)).reverse().slice(0, LOW_SHELF);
  const stage = labStage(s);
  const teams = s.late?.teams.length ?? 0;
  return (
    <Scene
      labName={s.labName}
      stage={stage}
      seats={Math.min(MAX_SEATS, (LAB_STAGES[stage]?.desks ?? 1) * 2 + teams * 2)}
      cups={yearCups(s)}
      cards={cardCount(s)}
      farm={{
        ...rentedFarm(s),
        // Доли округлены до 5 %: зал не перестраивается от каждого процента.
        tasks: ALLOC_ROWS.map((r) => ({ color: r.color, share: Math.round(s.compute.alloc[r.key] * 20) / 20 })),
        backdrop: '#3a3d42',
      }}
      idle={idleWarnings(s).length > 0}
      research={research}
      training={training}
      trainingMore={Math.max(0, s.trainings.length - 1)}
      shelf={shelf}
      lowShelf={lowShelf}
      onSale={onSaleList.length}
      place={place}
      next={nextStep(s, speed)}
      open={open}
    />
  );
}
