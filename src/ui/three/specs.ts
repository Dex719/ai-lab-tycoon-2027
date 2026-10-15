// Что показывают 3D-виды: описание сцены из состояния игры. Без three.js - считается в окнах и в тестах.
// Ферма: карты по 8 в сервере, по 4 сервера в стойке (32 карты на стойку, как в типичном зале с ускорителями).
// Кампус: площадка, этап стройки с прогрессом, заполнение залов картами, грузовики с заказами в пути.

import { DC_STAGES, type DcSiteId } from '../../data/datacenters';
import { GPUS } from '../../data/gpus';
import { dcReady, findDc, stageProgress, usedKw } from '../../sim/datacenters';
import type { Datacenter, GameState, GpuId } from '../../sim/types';

export const CARDS_PER_SERVER = 8;
export const SERVERS_PER_RACK = 4;
export const CARDS_PER_RACK = CARDS_PER_SERVER * SERVERS_PER_RACK;
/** Больше стоек на схеме не рисуется: дальше одна нарисованная стойка изображает несколько. */
export const FARM_MAX_RACKS = 400;

export interface FarmGroup {
  gpu: GpuId;
  cards: number;
}

export interface GpuSpec {
  kind: 'gpu';
  gpu: GpuId;
}

export interface FarmSpec {
  kind: 'farm';
  /** Карты по типам, новые поколения первыми (стоят ближе к зрителю). */
  groups: FarmGroup[];
  /** Широкий кадр (полоса в окне): ряды длиннее, их меньше. */
  wide?: boolean;
}

export interface CampusSpec {
  kind: 'campus';
  site: DcSiteId;
  /** Мощность дата-центра, МВт; null - площадка свободна. */
  mw: number | null;
  /** Номер текущего этапа; DC_STAGES - дата-центр готов. */
  stage: number;
  /** Доля пройденного этапа, шагами по 0,1 (чтобы сцена не перестраивалась каждый день). */
  progress: number;
  /** Доля мощности зала, занятая стоящими картами, шагами по 1/40. */
  fill: number;
  /** Карты по типам: цвет стоек в зале. */
  mix: FarmGroup[];
  /** Заказы в пути: грузовики у ворот (не больше трёх). */
  trucks: number;
}

export type ViewSpec = GpuSpec | FarmSpec | CampusSpec;

/** Ключ сцены: вид перестраивается, только когда ключ изменился. */
export function specKey(spec: ViewSpec): string {
  return JSON.stringify(spec);
}

// ---------- Ферма ----------

export interface FarmRack {
  gpu: GpuId;
  /** Серверов в стойке: 1..SERVERS_PER_RACK (неполная стойка - последняя в группе). */
  servers: number;
}

export interface FarmLayout {
  racks: FarmRack[];
  /** Сколько настоящих стоек изображает одна нарисованная (1 - каждая стойка как есть). */
  scale: number;
  /** Настоящих стоек всего. */
  totalRacks: number;
  /** Карт всего. */
  cards: number;
}

function racksFor(cards: number): number {
  return Math.ceil(Math.max(0, cards) / CARDS_PER_RACK);
}

/** Стойки фермы по группам карт: сначала новые поколения. */
export function farmLayout(groups: readonly FarmGroup[], maxRacks = FARM_MAX_RACKS): FarmLayout {
  const live = groups.filter((g) => g.cards > 0);
  const totalRacks = live.reduce((n, g) => n + racksFor(g.cards), 0);
  const cards = live.reduce((n, g) => n + g.cards, 0);
  const scale = Math.max(1, Math.ceil(totalRacks / maxRacks));
  const racks: FarmRack[] = [];
  for (const g of live) {
    if (scale === 1) {
      const servers = Math.ceil(g.cards / CARDS_PER_SERVER);
      const full = Math.floor(servers / SERVERS_PER_RACK);
      for (let i = 0; i < full; i++) racks.push({ gpu: g.gpu, servers: SERVERS_PER_RACK });
      const rest = servers - full * SERVERS_PER_RACK;
      if (rest > 0) racks.push({ gpu: g.gpu, servers: rest });
    } else {
      const n = Math.max(1, Math.round(racksFor(g.cards) / scale));
      for (let i = 0; i < n; i++) racks.push({ gpu: g.gpu, servers: SERVERS_PER_RACK });
    }
  }
  return { racks, scale, totalRacks, cards };
}

/** Порядок поколений: новые первыми. */
function newestFirst(groups: FarmGroup[]): FarmGroup[] {
  const order = GPUS.map((g) => g.id);
  return [...groups].sort((a, b) => order.indexOf(b.gpu) - order.indexOf(a.gpu));
}

/** Ферма арендованных карт. */
export function rentedFarm(s: GameState): FarmSpec {
  return { kind: 'farm', groups: newestFirst(GPUS.map((g) => ({ gpu: g.id, cards: s.compute.rented[g.id] })).filter((g) => g.cards > 0)) };
}

/** Зал своего дата-центра: стоящие карты. */
export function dcFarm(dc: Datacenter): FarmSpec {
  return { kind: 'farm', groups: newestFirst(GPUS.map((g) => ({ gpu: g.id, cards: dc.gpus[g.id] ?? 0 })).filter((g) => g.cards > 0)) };
}

// ---------- Кампус ----------

/** Сцена площадки: свободная земля, стройка по этапам или готовый дата-центр с картами. */
export function campusSpec(s: GameState, site: DcSiteId): CampusSpec {
  const dc = findDc(s, site);
  if (!dc) return { kind: 'campus', site, mw: null, stage: 0, progress: 0, fill: 0, mix: [], trucks: 0 };
  const ready = dcReady(dc);
  const kwStanding = GPUS.reduce((kw, g) => kw + (dc.gpus[g.id] ?? 0), 0) > 0 ? usedKwStanding(dc) : 0;
  return {
    kind: 'campus',
    site,
    mw: dc.mw,
    stage: ready ? DC_STAGES : dc.stage,
    progress: ready ? 1 : Math.floor(stageProgress(s, dc) * 10) / 10,
    fill: ready ? Math.min(1, Math.ceil((kwStanding / (dc.mw * 1000)) * 40) / 40) : 0,
    mix: dcFarm(dc).groups,
    trucks: Math.min(3, dc.orders.length),
  };
}

/** Занято кВт только стоящими картами (без заказов в пути). */
function usedKwStanding(dc: Datacenter): number {
  return usedKw({ ...dc, orders: [] });
}
