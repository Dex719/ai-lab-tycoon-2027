// Люди лаборатории: фигурки с суставами (плечи, локти, бёдра, колени) и простое поведение. Сидят и печатают,
// иногда встают и идут по проходам к кофемашине, принтеру, доске, окну или к коллеге; на события партии реагируют:
// к серверам подходит человек и что-то настраивает, на выпуск модели все встают и радуются, новый сотрудник входит
// в дверь и идёт к своему столу. Тени - мягкие пятна под ногами (карта теней на движущихся людей не пересчитывается).

import * as THREE from 'three';
import { blobTex } from './kit';

export type Act = 'tap' | 'drink' | 'chat' | 'look' | 'write' | 'print' | 'cheer';

/** Точка в комнате, куда можно прийти: где стоять, куда смотреть (рад, 0 - на -z), что делать. */
export interface Spot {
  x: number;
  z: number;
  face: number;
  act: Act;
  /** Горизонтальный проход, к которому точка примыкает (z). */
  lane: number;
  /** Особые точки по пути от прохода (например, проём в стекле серверной). */
  via?: { x: number; z: number }[];
}

export interface Look {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  style: 'short' | 'bun' | 'long' | 'bald' | 'curly';
  coat?: boolean;
  glasses?: boolean;
}

interface Rig {
  root: THREE.Group;
  pelvis: THREE.Group;
  head: THREE.Group;
  sh: [THREE.Group, THREE.Group];
  el: [THREE.Group, THREE.Group];
  hip: [THREE.Group, THREE.Group];
  kn: [THREE.Group, THREE.Group];
}

type Mk = (geo: THREE.BufferGeometry, color: string) => THREE.Mesh;

const geoCache = new Map<string, THREE.BufferGeometry>();

function rig(look: Look, mk: Mk, reg: (g: THREE.BufferGeometry) => void): Rig {
  const g = (key: string, make: () => THREE.BufferGeometry) => {
    let x = geoCache.get(key);
    if (!x) {
      x = make();
      geoCache.set(key, x);
      reg(x);
    }
    return x;
  };
  const cap = (r: number, len: number) => g(`c${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 14));
  const sph = (r: number) => g(`s${r}`, () => new THREE.SphereGeometry(r, 20, 14));
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => {
    const m = mk(geo, color);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  const root = new THREE.Group();
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.8;
  root.add(pelvis);
  // Туловище: чуть шире к плечам, у исследователя - белый халат до колен.
  const torso = add(pelvis, cap(0.2, 0.26), look.coat ? '#f4f5f6' : look.shirt, 0, 0.3, 0);
  torso.scale.set(1.05, 1, 0.78);
  add(pelvis, cap(0.19, 0.04), look.pants, 0, 0.04, 0).scale.set(1.05, 1, 0.8);
  if (look.coat) {
    add(pelvis, cap(0.21, 0.18), '#f4f5f6', 0, -0.12, 0).scale.set(1.05, 1, 0.82);
    add(pelvis, sph(0.07), look.shirt, 0, 0.5, -0.12).scale.set(1.2, 0.6, 0.4);
  }
  const head = new THREE.Group();
  head.position.y = 0.78;
  pelvis.add(head);
  add(head, sph(0.23), look.skin, 0, 0, 0);
  add(head, sph(0.05), look.skin, -0.23, -0.01, 0).scale.set(0.6, 1, 1);
  add(head, sph(0.05), look.skin, 0.23, -0.01, 0).scale.set(0.6, 1, 1);
  for (const sx of [-1, 1]) add(head, sph(0.032), '#22252b', sx * 0.085, 0.02, -0.205);
  if (look.glasses) for (const sx of [-1, 1]) add(head, sph(0.06), '#2b2f35', sx * 0.085, 0.02, -0.2).scale.set(1, 1, 0.25);
  if (look.style !== 'bald') {
    const top = add(head, sph(0.24), look.hair, 0, 0.07, 0.03);
    top.scale.set(1, 0.72, 1);
  }
  if (look.style === 'bun') add(head, sph(0.1), look.hair, 0, 0.2, 0.17);
  if (look.style === 'long') add(head, cap(0.17, 0.22), look.hair, 0, -0.14, 0.12).scale.set(1.25, 1, 0.6);
  if (look.style === 'curly') for (let k = 0; k < 5; k++) add(head, sph(0.09), look.hair, Math.cos(k * 1.26) * 0.17, 0.12, Math.sin(k * 1.26) * 0.15 + 0.03);
  if (look.style === 'bald') add(head, sph(0.1), look.hair, 0, -0.12, 0.17).scale.set(1.6, 0.5, 0.6);

  const limb = (side: number, y: number, x: number, upper: number, lower: number, r: number, color: string, endColor: string, end: 'hand' | 'shoe') => {
    const a = new THREE.Group();
    a.position.set(x * side, y, 0);
    pelvis.add(a);
    add(a, cap(r, upper), color, 0, -(upper / 2 + r * 0.5), 0);
    const b = new THREE.Group();
    b.position.y = -(upper + r);
    a.add(b);
    add(b, cap(r * 0.92, lower), color, 0, -(lower / 2 + r * 0.5), 0);
    if (end === 'hand') add(b, sph(0.065), endColor, 0, -(lower + r * 1.4), 0);
    else add(b, g('shoe', () => new THREE.CapsuleGeometry(0.075, 0.12, 4, 10).rotateX(Math.PI / 2)), endColor, 0, -(lower + r * 1.1), -0.05);
    return [a, b] as const;
  };
  const sleeve = look.coat ? '#f4f5f6' : look.shirt;
  const [shL, elL] = limb(-1, 0.48, 0.25, 0.18, 0.16, 0.065, sleeve, look.skin, 'hand');
  const [shR, elR] = limb(1, 0.48, 0.25, 0.18, 0.16, 0.065, sleeve, look.skin, 'hand');
  const [hipL, knL] = limb(-1, -0.02, 0.1, 0.2, 0.2, 0.085, look.pants, '#2b2f35', 'shoe');
  const [hipR, knR] = limb(1, -0.02, 0.1, 0.2, 0.2, 0.085, look.pants, '#2b2f35', 'shoe');
  return { root, pelvis, head, sh: [shL, shR], el: [elL, elR], hip: [hipL, hipR], kn: [knL, knR] };
}

// ---------- Позы ----------

function reset(r: Rig): void {
  for (const j of [...r.sh, ...r.el, ...r.hip, ...r.kn]) j.rotation.set(0, 0, 0);
  r.pelvis.position.y = 0.8;
  r.pelvis.rotation.set(0, 0, 0);
  r.head.rotation.set(0, 0, 0);
}

function sit(r: Rig, t: number, typing: boolean): void {
  reset(r);
  r.pelvis.position.y = 0.6;
  for (let k = 0; k < 2; k++) {
    r.hip[k].rotation.x = Math.PI / 2;
    r.kn[k].rotation.x = -Math.PI / 2;
    r.sh[k].rotation.x = 1.0;
    r.el[k].rotation.x = 0.9;
  }
  if (typing) {
    r.el[0].rotation.x = 0.9 + Math.sin(t * 14) * 0.08;
    r.el[1].rotation.x = 0.9 + Math.sin(t * 14 + 2) * 0.08;
    r.head.rotation.x = Math.sin(t * 0.7) * 0.05;
  }
}

function walk(r: Rig, phase: number): void {
  reset(r);
  const s = Math.sin(phase);
  r.hip[0].rotation.x = s * 0.55;
  r.hip[1].rotation.x = -s * 0.55;
  r.kn[0].rotation.x = Math.max(0, -s) * -0.7;
  r.kn[1].rotation.x = Math.max(0, s) * -0.7;
  r.sh[0].rotation.x = -s * 0.45;
  r.sh[1].rotation.x = s * 0.45;
  r.el[0].rotation.x = 0.25;
  r.el[1].rotation.x = 0.25;
  r.pelvis.position.y = 0.8 + Math.abs(Math.cos(phase)) * 0.03;
}

function act(r: Rig, a: Act, t: number): void {
  reset(r);
  switch (a) {
    case 'tap':
    case 'print':
      r.sh[1].rotation.x = 1.25 + Math.sin(t * 9) * 0.12;
      r.el[1].rotation.x = 0.35;
      r.sh[0].rotation.x = 0.4;
      r.el[0].rotation.x = 0.9;
      r.head.rotation.x = 0.15;
      break;
    case 'write':
      r.sh[1].rotation.x = 1.9 + Math.sin(t * 2.3) * 0.15;
      r.sh[1].rotation.z = Math.sin(t * 1.7) * 0.25;
      r.el[1].rotation.x = 0.3;
      r.head.rotation.y = Math.sin(t * 1.7) * 0.15;
      break;
    case 'drink': {
      const up = Math.max(0, Math.sin(t * 1.4));
      r.sh[1].rotation.x = 0.6 + up * 0.8;
      r.el[1].rotation.x = 1.6 + up * 0.6;
      r.head.rotation.x = -up * 0.25;
      break;
    }
    case 'chat':
      r.sh[0].rotation.x = 0.5 + Math.sin(t * 3) * 0.3;
      r.el[0].rotation.x = 1.2;
      r.sh[0].rotation.z = -0.2;
      r.head.rotation.y = Math.sin(t * 1.3) * 0.2;
      break;
    case 'look':
      r.head.rotation.y = Math.sin(t * 0.6) * 0.4;
      r.sh[0].rotation.z = 0.15;
      r.sh[1].rotation.z = -0.15;
      break;
    case 'cheer': {
      const j = Math.abs(Math.sin(t * 6));
      r.sh[0].rotation.z = 2.6;
      r.sh[1].rotation.z = -2.6;
      r.pelvis.position.y = 0.8 + j * 0.12;
      r.hip[0].rotation.x = -j * 0.3;
      r.hip[1].rotation.x = -j * 0.3;
      r.kn[0].rotation.x = j * 0.6;
      r.kn[1].rotation.x = j * 0.6;
      break;
    }
  }
}

// ---------- Поведение ----------

interface Agent {
  rig: Rig;
  /** Своё место: стул (сидит лицом к -z) или точка, где стоит по умолчанию (исследователь у доски). */
  home: Spot;
  seated: boolean;
  mode: 'home' | 'walk' | 'act';
  path: { x: number; z: number }[];
  target: Spot | null;
  actUntil: number;
  nextErrand: number;
  x: number;
  z: number;
  heading: number;
  phase: number;
  t0: number;
}

const SPEED = 1.25;
let handledSeq = 0;

export class Crowd {
  readonly root = new THREE.Group();
  private agents: Agent[] = [];
  private blobMat: THREE.MeshBasicMaterial;
  private blobGeo: THREE.PlaneGeometry;
  private last = 0;

  constructor(
    private mk: Mk,
    private reg: (g: THREE.BufferGeometry) => void,
    /** Вертикальный проход (x), соединяющий горизонтальные. */
    private laneX: number,
    private spots: Spot[],
    private serverSpots: Spot[],
    private door: { x: number; z: number },
    private rand: () => number,
  ) {
    this.blobMat = new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.55 });
    this.blobGeo = new THREE.PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2);
    reg(this.blobGeo);
  }

  /** Сотрудник за столом: стул в точке seat, смотрит на стол (-z); проход ряда - lane. */
  addSeated(look: Look, seat: { x: number; z: number }, lane: number): void {
    this.add(look, { x: seat.x, z: seat.z, face: 0, act: 'look', lane }, true);
  }

  addStanding(look: Look, spot: Spot): void {
    this.add(look, spot, false);
  }

  private add(look: Look, home: Spot, seated: boolean): void {
    const r = rig(look, this.mk, this.reg);
    const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
    blob.position.y = 0.012;
    r.root.add(blob);
    this.root.add(r.root);
    const a: Agent = {
      rig: r,
      home,
      seated,
      mode: 'home',
      path: [],
      target: null,
      actUntil: 0,
      nextErrand: 6 + this.rand() * 30,
      x: home.x,
      z: home.z,
      heading: home.face,
      phase: this.rand() * 6,
      t0: this.rand() * 10,
    };
    this.agents.push(a);
    this.place(a, 0);
  }

  /** Новый сотрудник: последний сидящий входит в дверь и идёт к своему столу. */
  arriveLast(): void {
    const a = [...this.agents].reverse().find((x) => x.seated);
    if (!a) return;
    a.x = this.door.x;
    a.z = this.door.z;
    a.mode = 'walk';
    a.target = null;
    a.path = [
      { x: this.laneX, z: this.door.z },
      { x: this.laneX, z: a.home.lane },
      { x: a.home.x, z: a.home.lane },
      { x: a.home.x, z: a.home.z },
    ];
  }

  private route(from: { x: number; z: number; lane: number }, to: Spot): { x: number; z: number }[] {
    const tail = to.via ? [...to.via] : [{ x: to.x, z: to.lane }];
    return [{ x: from.x, z: from.lane }, { x: this.laneX, z: from.lane }, { x: this.laneX, z: to.lane }, ...tail, { x: to.x, z: to.z }];
  }

  private send(a: Agent, to: Spot, now: number): void {
    a.path = this.route({ x: a.x, z: a.z, lane: a.home.lane }, to);
    a.target = to;
    a.mode = 'walk';
    a.t0 = now;
  }

  private goHome(a: Agent, now: number): void {
    const from = a.target ?? a.home;
    // Обратный путь: сначала назад через особые точки цели (проём серверной), потом по проходам к своему месту.
    if (from.via) {
      const pre = [...from.via].reverse();
      const end = pre[pre.length - 1];
      a.path = [...pre, ...this.route({ x: end.x, z: end.z, lane: from.lane }, a.home)];
    } else a.path = this.route({ x: a.x, z: a.z, lane: from.lane }, a.home);
    a.target = null;
    a.mode = 'walk';
    a.t0 = now;
  }

  private place(a: Agent, t: number): void {
    const r = a.rig;
    r.root.position.set(a.x, 0, a.z);
    r.root.rotation.y = a.heading;
    if (a.mode === 'walk') walk(r, a.phase);
    else if (a.mode === 'act' && a.target) act(r, a.target.act, t - a.t0);
    else if (a.seated) sit(r, t + a.t0, true);
    else act(r, a.home.act, t + a.t0);
  }

  /** Шаг жизни; true - что-то сдвинулось и нужен кадр. */
  update(nowMs: number, running: boolean, event: { kind: string; seq: number; age: number } | null): { dirty: boolean; moving: boolean } {
    const now = nowMs / 1000;
    const dt = this.last ? Math.min(0.1, now - this.last) : 0;
    this.last = now;
    if (!running) return { dirty: false, moving: false };

    if (event && event.seq !== handledSeq && event.age < 1500) {
      handledSeq = event.seq;
      this.react(event.kind, now);
    }

    let moving = false;
    const walkers = this.agents.filter((a) => a.mode !== 'home').length;
    for (const a of this.agents) {
      if (a.mode === 'home') {
        a.nextErrand -= dt;
        if (a.nextErrand <= 0 && walkers < Math.max(1, Math.ceil(this.agents.length / 4)) && this.spots.length) {
          a.nextErrand = 15 + this.rand() * 45;
          this.send(a, this.spots[Math.floor(this.rand() * this.spots.length)], now);
        }
      }
      if (a.mode === 'walk') {
        moving = true;
        let step = SPEED * dt;
        while (step > 0 && a.path.length) {
          const p = a.path[0];
          const dx = p.x - a.x;
          const dz = p.z - a.z;
          const d = Math.hypot(dx, dz);
          if (d < 1e-3) {
            a.path.shift();
            continue;
          }
          a.heading = Math.atan2(-dx, -dz);
          const m = Math.min(step, d);
          a.x += (dx / d) * m;
          a.z += (dz / d) * m;
          step -= m;
          if (m >= d) a.path.shift();
        }
        a.phase += dt * 9;
        if (!a.path.length) {
          if (a.target) {
            a.mode = 'act';
            a.heading = a.target.face;
            a.actUntil = now + (a.target.act === 'cheer' ? 2.5 : 3 + this.rand() * 4);
            a.t0 = now;
          } else {
            a.mode = 'home';
            a.heading = a.home.face;
          }
        }
      } else if (a.mode === 'act') {
        moving = true;
        if (now >= a.actUntil) {
          if (a.target?.act === 'cheer' && Math.hypot(a.x - a.home.x, a.z - a.home.z) < 0.05) {
            a.mode = 'home';
            a.target = null;
          } else this.goHome(a, now);
        }
      }
      this.place(a, now);
    }
    return { dirty: true, moving };
  }

  private react(kind: string, now: number): void {
    if (kind === 'hire') {
      this.arriveLast();
      return;
    }
    if (kind === 'release') {
      for (const a of this.agents)
        if (a.mode === 'home') {
          a.mode = 'act';
          a.target = { ...a.home, act: 'cheer' };
          a.actUntil = now + 2.5;
          a.t0 = now;
        }
      return;
    }
    if ((kind === 'trainStart' || kind === 'hardware') && this.serverSpots.length) {
      const free = this.agents.filter((a) => a.mode === 'home' && a.seated);
      const a = free[Math.floor(this.rand() * free.length)];
      if (a) this.send(a, this.serverSpots[Math.floor(this.rand() * this.serverSpots.length)], now);
    }
  }
}
