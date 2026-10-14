// Живая сцена в центре рабочего стола: лаборатория игрока в четырёх «станциях» - серверная, исследования,
// обучение и витрина моделей. Сцена лежит под окнами (как обои) и показывает состояние лаборатории одним взглядом;
// каждая станция открывает своё окно. Огоньки и пузырьки двигаются только пока идёт время, без постоянного цикла.

import { memo } from 'react';
import { GPUS } from '../data/gpus';
import { idleWarnings } from '../sim/idle';
import { rpPerDay, techCost, TECHS } from '../sim/research';
import type { GameState, PlayerModel } from '../sim/types';
import { ModelEmblem } from './components/ModelEmblem';
import { fmtNum, fmtShare, ruPlural } from './format';
import { IconLogo } from './icons';
import { raceMetricOf, raceRows } from './race';
import type { WindowAlias, WindowId } from './windows';
import './desk.css';

/** Карт в одной стойке на картинке; стоек не больше шести. */
const CARDS_PER_RACK = 24;
const MAX_RACKS = 6;
const SHELF_MAX = 4;

function cardCount(s: GameState): number {
  let n = 0;
  for (const g of GPUS) n += s.compute.rented[g.id] ?? 0;
  for (const dc of s.datacenters?.list ?? []) for (const g of GPUS) n += dc.gpus[g.id] ?? 0;
  return n;
}

interface SceneProps {
  labName: string;
  running: boolean;
  cards: number;
  idle: boolean;
  research: { name: string; frac: number; busy: boolean } | null;
  training: { name: string; frac: number; stalled: boolean } | null;
  trainingMore: number;
  shelf: PlayerModel[];
  onSale: number;
  place: number | null;
  open: (id: WindowId | WindowAlias) => void;
}

/** Сцена перерисовывается, только когда меняется то, что на ней видно (а не каждый игровой день). */
function sameScene(a: SceneProps, b: SceneProps): boolean {
  return (
    a.labName === b.labName &&
    a.running === b.running &&
    a.cards === b.cards &&
    a.idle === b.idle &&
    a.research?.name === b.research?.name &&
    a.research?.frac === b.research?.frac &&
    a.research?.busy === b.research?.busy &&
    a.training?.name === b.training?.name &&
    a.training?.frac === b.training?.frac &&
    a.training?.stalled === b.training?.stalled &&
    a.trainingMore === b.trainingMore &&
    a.shelf.map((m) => m.id).join() === b.shelf.map((m) => m.id).join() &&
    a.onSale === b.onSale &&
    a.place === b.place &&
    a.open === b.open
  );
}

const Scene = memo(function Scene(p: SceneProps) {
  const racks = Math.min(MAX_RACKS, Math.ceil(p.cards / CARDS_PER_RACK));
  const shownRacks = Math.max(3, racks);
  // Сколько блоков в стойках светится: 8 блоков в стойке, последние стойки заполнены частично.
  const units = Math.min(racks * 8, Math.max(p.cards > 0 ? 1 : 0, Math.round((p.cards / (CARDS_PER_RACK * MAX_RACKS)) * MAX_RACKS * 8)));
  const ledTone = p.cards === 0 ? 'off' : p.idle ? 'idle' : 'on';
  const first = p.place === 1;
  return (
    <div className={`lab-scene${p.running ? ' running' : ''}`} aria-label="Лаборатория">
      <div className="ls-sign">
        <IconLogo size={26} />
        <b>{p.labName}</b>
      </div>
      <div className="ls-room">
        <button type="button" className="ls-station ls-servers" onClick={() => p.open('compute')}>
          <span className="ls-art">
            {Array.from({ length: shownRacks }, (_, r) => (
              <span key={r} className={`ls-rack${r < racks ? '' : ' empty'}`} style={{ ['--d' as string]: `${-r * 0.37}s` }}>
                {Array.from({ length: 8 }, (_, u) => {
                  const lit = r * 8 + u < units;
                  return <i key={u} className={lit ? ledTone : 'off'} />;
                })}
              </span>
            ))}
          </span>
          <span className="ls-cap">
            <span>Серверная</span>
            <b className={p.idle ? 'warn' : undefined}>
              {p.cards > 0 ? `${fmtNum(p.cards)} ${ruPlural(p.cards, 'карта', 'карты', 'карт')}` : 'Карт нет'}
            </b>
          </span>
        </button>

        <button type="button" className="ls-station ls-lab" onClick={() => p.open('research')}>
          <span className="ls-art">
            <span className={`ls-flask${p.research?.busy ? ' busy' : ''}`}>
              <span className="ls-liquid" style={{ height: `${Math.round(20 + (p.research?.frac ?? 0) * 60)}%` }}>
                <i />
                <i />
                <i />
              </span>
            </span>
          </span>
          <span className="ls-cap">
            <span>Исследования</span>
            <b title={p.research?.name}>{p.research ? `${p.research.name}, ${fmtShare(p.research.frac, 0)}` : 'Не идут'}</b>
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
              {p.shelf.map((m) => (
                <ModelEmblem key={m.id} m={m} size={44} gold={first && m === p.shelf[0]} />
              ))}
              {p.shelf.length === 0 && <span className="ls-board-empty" />}
            </span>
          </span>
          <span className="ls-cap">
            <span>Витрина</span>
            <b>{p.onSale > 0 ? `В продаже: ${fmtNum(p.onSale)}` : 'Пусто'}</b>
          </span>
        </button>
      </div>
    </div>
  );
}, sameScene);

/** Сцена лаборатории по состоянию партии: сюда приходят только простые числа, чтобы не перерисовывать её каждый день. */
export function DeskScene({ s, running, open }: { s: GameState; running: boolean; open: (id: WindowId | WindowAlias) => void }) {
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
    const mine = raceRows(s, metric).find((x) => x.owner === 'player' && x.rank !== null);
    if (mine) {
      place = mine.rank;
      best = s.models.find((m) => m.id === mine.row.ref.id);
    }
  }
  const onSaleList = s.models.filter((m) => m.releasedDay !== null && (m.onApi || m.onSubs));
  // На полке: лучшая модель в гонке первой, дальше новые.
  const shelf = [...(best ? [best] : []), ...onSaleList.filter((m) => m !== best).reverse()].slice(0, SHELF_MAX);
  return (
    <Scene
      labName={s.labName}
      running={running}
      cards={cardCount(s)}
      idle={idleWarnings(s).length > 0}
      research={research}
      training={training}
      trainingMore={Math.max(0, s.trainings.length - 1)}
      shelf={shelf}
      onSale={onSaleList.length}
      place={place}
      open={open}
    />
  );
}
