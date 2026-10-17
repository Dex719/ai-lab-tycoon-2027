// Лаборатория на весь рабочий стол: помещение этапа (гараж → офис → этаж → кампус) в изометрии.
// Люди за столами - основатели и вышедшие на работу сотрудники; свободный стол - место под следующего нанятого.
// Стойки в серверной - арендованные карты, огоньки цвета задачи; доска - исследования; полка - выпущенные модели и кубки.
// Пока идёт время, огоньки мигают, люди работают, экраны светятся; на паузе всё замирает. Подписи над местами
// рисует React (LabFloor) по точкам anchors.

import * as THREE from 'three';
import type { Content } from './engine';
import { EVENT_MS, live } from './live';
import { rng } from './kit';
import type { LabSpec } from './specs';

interface RoomDef {
  w: number;
  d: number;
  floor: string;
  back: string;
  side: string;
  trim: string;
  /** Окна на задней стене. */
  windows: number;
}

const ROOMS: RoomDef[] = [
  { w: 12, d: 9, floor: '#bdb6aa', back: '#e9e3d7', side: '#ddd5c6', trim: '#c9c1b2', windows: 1 },
  { w: 14, d: 9.5, floor: '#c4a17b', back: '#e3e7ea', side: '#d5dbe0', trim: '#b9c0c7', windows: 2 },
  { w: 17, d: 11, floor: '#9aa0a8', back: '#eceff2', side: '#dfe3e7', trim: '#c4c9cf', windows: 3 },
  { w: 20, d: 12.5, floor: '#d3d0c8', back: '#f2f2f0', side: '#e5e4e0', trim: '#cfcdc7', windows: 4 },
];

const WALL_H = 3.2;
const SHIRTS = ['#d9822b', '#2f80e4', '#2e9b4f', '#c0504d', '#5d6b7a', '#1fa8a0', '#8a6bbf', '#c9a227'];
const HAIR = ['#3b2a1e', '#1f1f22', '#8a5a2b', '#6b4a2e', '#b58b55', '#2d2620'];
const SKIN = ['#e7bf9b', '#c99a74', '#f0d0b0', '#a87a55'];
const PERSON_CAP = 40;

export function buildLab(spec: LabSpec): Content {
  const room = ROOMS[spec.stage] ?? ROOMS[0];
  const { w: W, d: D } = room;
  const root = new THREE.Group();
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const extraMats: THREE.Material[] = [];
  const rand = rng(97 + spec.stage * 13);

  const mat = (color: string, glow = 0): THREE.MeshStandardMaterial => {
    const key = `${color}|${glow}`;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, flatShading: true, emissive: glow ? color : '#000000', emissiveIntensity: glow });
      mats.set(key, m);
    }
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.add(g);
    return g;
  };
  const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = root, glow = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), mat(color, glow));
    m.position.set(x, y, z);
    m.castShadow = glow === 0;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const cyl = (r: number, h: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r, h, 10)), mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const ball = (r: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = root, glow = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(r, 1)), mat(color, glow));
    m.position.set(x, y, z);
    m.castShadow = glow === 0;
    parent.add(m);
    return m;
  };

  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D / 2;
  const z1 = D / 2;

  // ---------- Пол и стены ----------
  box(W + 1.2, 0.5, D + 1.2, '#2b2f35', 0, -0.35, 0);
  box(W, 0.2, D, room.floor, 0, -0.1, 0);
  for (let x = x0 + 2.5; x < x1; x += 2.5) box(0.02, 0.01, D, shade(room.floor, -0.06), x, 0.005, 0).castShadow = false;
  box(W + 0.2, WALL_H, 0.2, room.back, -0.1, WALL_H / 2, z0 - 0.1);
  box(0.2, WALL_H, D, room.side, x0 - 0.1, WALL_H / 2, 0);
  box(W + 0.2, 0.22, 0.04, room.trim, -0.1, 0.11, z0 + 0.02).castShadow = false;
  box(0.04, 0.22, D, room.trim, x0 + 0.02, 0.11, 0).castShadow = false;

  // Окна на задней стене (в средней части, между доской и серверной).
  const sky = new THREE.MeshBasicMaterial({ color: '#bcd9ef' });
  extraMats.push(sky);
  const winSpan = W - 9;
  for (let i = 0; i < room.windows; i++) {
    const wx = x0 + 5 + (winSpan * (i + 0.5)) / room.windows;
    box(1.9, 1.3, 0.06, '#8f8a80', wx, 1.95, z0 + 0.02);
    const pane = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.75, 1.15)), sky);
    pane.position.set(wx, 1.95, z0 + 0.06);
    root.add(pane);
    box(0.05, 1.15, 0.05, '#8f8a80', wx, 1.95, z0 + 0.08);
  }

  if (spec.stage === 0) {
    // Подъёмные ворота гаража на левой стене.
    box(0.08, 2.7, 3.8, '#9aa4ae', x0 + 0.04, 1.35, z1 - 2.6);
    for (let i = 0; i < 7; i++) box(0.1, 0.04, 3.8, '#848e98', x0 + 0.08, 0.25 + i * 0.38, z1 - 2.6).castShadow = false;
  }

  // ---------- Серверная: стойки у задней стены справа ----------
  const RACK_W = 0.8;
  const RACK_STEP = 0.95;
  const rackZ = z0 + 0.75;
  const rackX = (i: number) => x1 - 0.7 - i * RACK_STEP;
  const leds: { mesh: THREE.Mesh; rack: number; seed: number }[] = [];
  const ledOn = new Map<string, THREE.MeshStandardMaterial>();
  const ledMat = (c: string) => {
    let m = ledOn.get(c);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.5 });
      ledOn.set(c, m);
    }
    return m;
  };
  const ledOff = new THREE.MeshStandardMaterial({ color: '#3c4148', roughness: 0.7 });
  extraMats.push(ledOff);
  const ledGeo = geo(new THREE.BoxGeometry(0.09, 0.06, 0.02));
  let litLeft = spec.racksLit;
  for (let i = 0; i < spec.racks; i++) {
    const x = rackX(i);
    box(RACK_W, 2.1, 0.95, '#2a2d33', x, 1.05, rackZ);
    box(RACK_W + 0.02, 0.06, 0.97, '#3a3e45', x, 2.12, rackZ);
    // Планка цвета задачи над дверцей (как в «Мощностях»).
    if (spec.racksLit > i * 8) box(RACK_W - 0.06, 0.07, 0.02, spec.rackColors[i] ?? '#7dd87f', x, 2.03, rackZ + 0.49, root, 0.8);
    for (let sv = 0; sv < 8; sv++) {
      const y = 0.3 + sv * 0.23;
      const on = litLeft > 0;
      if (on) litLeft--;
      box(0.7, 0.17, 0.02, on ? '#3a3f47' : '#30343a', x, y, rackZ + 0.48).castShadow = false;
      if (!on) continue;
      for (let l = 0; l < 5; l++) {
        const led = new THREE.Mesh(ledGeo, ledOff);
        led.position.set(x - 0.26 + l * 0.11, y, rackZ + 0.5);
        root.add(led);
        leds.push({ mesh: led, rack: i, seed: rand() });
      }
    }
  }
  if (spec.racks > 0) box(spec.racks * RACK_STEP, 0.08, 0.2, '#4a4f57', (rackX(0) + rackX(spec.racks - 1)) / 2, 2.32, z0 + 0.3);
  if (spec.stage >= 1 && spec.racks > 0) {
    // Стеклянная перегородка серверной.
    const glass = new THREE.MeshStandardMaterial({ color: '#cfe3f2', transparent: true, opacity: 0.18, roughness: 0.1, depthWrite: false });
    extraMats.push(glass);
    const gx = rackX(spec.racks - 1) - 0.75;
    const pane = new THREE.Mesh(geo(new THREE.BoxGeometry(0.04, 2.6, 1.9)), glass);
    pane.position.set(gx, 1.3, z0 + 0.95);
    root.add(pane);
    const front = new THREE.Mesh(geo(new THREE.BoxGeometry(x1 - gx, 2.6, 0.04)), glass);
    front.position.set((gx + x1) / 2, 1.3, z0 + 1.9);
    root.add(front);
    box(0.06, 2.6, 0.06, '#9aa1a9', gx, 1.3, z0 + 1.9);
  }

  // ---------- Исследования: доска с формулами на задней стене слева ----------
  const wbX = x0 + 2.6;
  box(2.4, 1.3, 0.05, '#f7f7f5', wbX, 1.75, z0 + 0.03);
  if (spec.research) {
    const ink = ['#2f80e4', '#d64545', '#2e9b4f', '#1f2023', '#7b5cd6'];
    for (let i = 0; i < 9; i++) box(0.3 + ((i * 37) % 7) / 10, 0.035, 0.01, ink[i % ink.length], wbX - 0.8 + ((i * 53) % 13) / 10, 2.25 - i * 0.12, z0 + 0.07).castShadow = false;
    box(0.55, 0.45, 0.01, '#fff5b8', wbX + 0.85, 1.45, z0 + 0.07).castShadow = false;
  }

  // ---------- Витрина: полка на левой стене ----------
  const shelfZ = z0 + 2.2;
  const shelfLen = Math.max(1.6, Math.min(3.2, 0.42 * Math.max(4, spec.models.length + spec.cups.length)));
  box(0.35, 0.05, shelfLen, '#8a6a4f', x0 + 0.18, 1.9, shelfZ);
  let sz = shelfZ - shelfLen / 2 + 0.25;
  spec.models.forEach((m, i) => {
    const big = i === 0;
    box(0.26, big ? 0.32 : 0.22, 0.26, m, x0 + 0.18, 1.925 + (big ? 0.16 : 0.11), sz);
    sz += 0.38;
  });
  for (const c of spec.cups) {
    const col = c === 'first' ? '#e8c34a' : '#c3c6cb';
    cyl(0.08, 0.06, col, x0 + 0.18, 1.955, sz);
    cyl(0.03, 0.12, col, x0 + 0.18, 2.04, sz);
    cyl(0.11, 0.14, col, x0 + 0.18, 2.17, sz);
    sz += 0.3;
  }

  // ---------- Столы и люди ----------
  const deskArea = { xa: x0 + 4.2, xb: x1 - 1.4, za: z0 + (spec.stage >= 1 ? 2.9 : 2.4), zb: z1 - 1.3 };
  const COL = 2.15;
  const ROW = 2.05;
  const cols = Math.max(1, Math.floor((deskArea.xb - deskArea.xa) / COL));
  const rows = Math.max(1, Math.floor((deskArea.zb - deskArea.za) / ROW) + 1);
  const capacity = Math.min(PERSON_CAP, cols * rows);
  const shown = Math.min(spec.people, capacity);
  const ghosts = spec.freeSeats > 0 && shown < capacity ? 1 : 0;
  const deskPos = (i: number) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return { x: deskArea.xa + COL / 2 + c * COL, z: deskArea.za + r * ROW };
  };
  const screens: THREE.Mesh[] = [];
  const heads: { m: THREE.Object3D; base: number; phase: number }[] = [];
  const screenColor = spec.training ? '#3a7bd5' : '#4a5563';
  for (let i = 0; i < shown; i++) {
    const { x, z } = deskPos(i);
    desk(x, z, i);
    person(x - 0.15, z + 0.85, i);
  }
  let ghostAt: THREE.Vector3 | null = null;
  if (ghosts) {
    const { x, z } = deskPos(shown);
    const ghost = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false });
    const line = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 });
    extraMats.push(ghost, line);
    const top = new THREE.Mesh(geo(new THREE.BoxGeometry(1.7, 0.07, 0.85)), ghost);
    top.position.set(x, 0.76, z);
    root.add(top);
    const edges = new THREE.LineSegments(geo(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.7, 0.76, 0.85))), line);
    edges.position.set(x, 0.38, z);
    root.add(edges);
    ghostAt = new THREE.Vector3(x, 1.0, z);
  }

  function desk(x: number, z: number, i: number) {
    box(1.7, 0.07, 0.85, '#b88a5e', x, 0.76, z);
    for (const [dx, dz] of [
      [-0.78, -0.36],
      [0.78, -0.36],
      [-0.78, 0.36],
      [0.78, 0.36],
    ])
      box(0.06, 0.74, 0.06, '#5d4836', x + dx, 0.37, z + dz);
    box(0.78, 0.48, 0.05, '#25282d', x - 0.15, 1.16, z - 0.28);
    screens.push(box(0.7, 0.4, 0.01, i % 3 === 1 && spec.training ? '#2e9b4f' : screenColor, x - 0.15, 1.16, z - 0.25, root, spec.training ? 0.9 : 0.4));
    box(0.08, 0.2, 0.08, '#25282d', x - 0.15, 0.88, z - 0.3);
    box(0.5, 0.03, 0.18, '#d9dbdf', x - 0.15, 0.81, z + 0.05);
    if (i % 2 === 0) cyl(0.06, 0.12, SHIRTS[(i + 3) % SHIRTS.length], x + 0.6, 0.86, z + 0.1);
    else box(0.3, 0.04, 0.22, '#f2f2ee', x + 0.5, 0.81, z + 0.05).rotation.y = 0.3;
  }

  function person(x: number, z: number, i: number) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI;
    box(0.55, 0.07, 0.55, '#3b3f46', 0, 0.48, 0, g);
    box(0.55, 0.55, 0.07, '#3b3f46', 0, 0.8, 0.26, g);
    cyl(0.04, 0.45, '#555a62', 0, 0.24, 0, g);
    box(0.36, 0.14, 0.42, '#3d4a5e', 0, 0.58, -0.12, g);
    const torso = cyl(0.21, 0.6, SHIRTS[i % SHIRTS.length], 0, 0.92, 0, g);
    torso.scale.z = 0.75;
    const head = new THREE.Group();
    head.position.set(0, 1.4, 0);
    ball(0.17, SKIN[(i * 3) % SKIN.length], 0, 0, 0, head);
    const cap = ball(0.18, HAIR[(i * 5) % HAIR.length], 0, 0.05, 0.03, head);
    cap.scale.set(1, 0.75, 1);
    g.add(head);
    heads.push({ m: head, base: head.position.y, phase: rand() * 6 });
    root.add(g);
  }

  // Исследователь у доски - когда исследование идёт.
  if (spec.research) {
    const g = new THREE.Group();
    g.position.set(wbX, 0, z0 + 0.95);
    box(0.13, 0.75, 0.15, '#3d4a5e', -0.1, 0.38, 0, g);
    box(0.13, 0.75, 0.15, '#3d4a5e', 0.1, 0.38, 0, g);
    const t = cyl(0.21, 0.6, '#7b5cd6', 0, 1.05, 0, g);
    t.scale.z = 0.75;
    const head = new THREE.Group();
    head.position.set(0, 1.53, 0);
    ball(0.17, SKIN[1], 0, 0, 0, head);
    const cap = ball(0.18, HAIR[2], 0, 0.05, -0.03, head);
    cap.scale.set(1, 0.75, 1);
    g.add(head);
    heads.push({ m: head, base: head.position.y, phase: 1.3 });
    root.add(g);
  }

  // Переговорный стол спереди справа - если передний ряд столов свободен.
  const rowsUsed = Math.ceil((shown + ghosts) / cols);
  if (spec.stage >= 1 && rowsUsed < rows) {
    const mx = x1 - 3.2;
    const mz = z1 - 1.6;
    box(2.6, 0.07, 1.2, '#e6e2da', mx, 0.74, mz);
    cyl(0.06, 0.72, '#6b6f76', mx - 0.9, 0.36, mz);
    cyl(0.06, 0.72, '#6b6f76', mx + 0.9, 0.36, mz);
    for (const dx of [-0.8, 0, 0.8])
      for (const dz of [-0.85, 0.85]) {
        box(0.45, 0.06, 0.45, '#3b3f46', mx + dx, 0.46, mz + dz);
        box(0.45, 0.45, 0.06, '#3b3f46', mx + dx, 0.72, mz + dz + (dz > 0 ? 0.2 : -0.2));
      }
    box(0.5, 0.03, 0.35, '#f2f2ee', mx - 0.4, 0.79, mz).rotation.y = 0.2;
  }
  // Книжный шкаф и кулер на левой стене (офис и дальше).
  if (spec.stage >= 1) {
    const bz = z0 + 5.6;
    box(0.4, 2.0, 1.4, '#8a6a4f', x0 + 0.22, 1.0, bz);
    const books = ['#c0504d', '#2f80e4', '#2e9b4f', '#c9a227', '#5d6b7a', '#8a6bbf'];
    for (let r = 0; r < 4; r++)
      for (let b = 0; b < 6; b++) box(0.26, 0.32, 0.13, books[(r * 2 + b) % books.length], x0 + 0.3, 0.35 + r * 0.46, bz - 0.5 + b * 0.2).castShadow = false;
    cyl(0.18, 1.0, '#e9ecef', x0 + 0.35, 0.5, bz + 1.2);
    cyl(0.15, 0.4, '#9fc6e8', x0 + 0.35, 1.2, bz + 1.2);
  }

  // ---------- Уголок отдыха и мелочи ----------
  const lx = x0 + 1.9;
  const lz = z1 - 1.6;
  box(2.2, 0.42, 0.95, '#6f5646', lx, 0.21, lz);
  box(2.2, 0.6, 0.25, '#654e40', lx, 0.62, lz + 0.4);
  box(0.25, 0.55, 0.95, '#654e40', lx - 1.05, 0.42, lz);
  box(0.25, 0.55, 0.95, '#654e40', lx + 1.05, 0.42, lz);
  box(1.1, 0.4, 0.6, '#8a6a4f', lx + 0.1, 0.2, lz - 1.2);
  box(3.0, 0.02, 2.2, spec.stage === 0 ? '#6b7f99' : '#7d8f84', lx, 0.01, lz - 0.6).castShadow = false;
  box(0.6, 0.9, 0.5, '#c3c6cb', x0 + 0.45, 0.45, z0 + 4.2);
  box(0.3, 0.35, 0.3, '#25282d', x0 + 0.45, 1.08, z0 + 4.2);
  for (const [px, pz] of spec.stage === 0
    ? [[x1 - 0.6, z1 - 0.6]]
    : [
        [x1 - 0.6, z1 - 0.6],
        [x0 + 4.2, z0 + 0.6],
      ]) {
    cyl(0.22, 0.4, '#b5654a', px, 0.2, pz);
    ball(0.42, '#4f8a4a', px, 0.75, pz).scale.y = 1.3;
    ball(0.3, '#5d9a55', px - 0.15, 1.15, pz + 0.1);
  }
  if (spec.stage === 0) {
    box(0.6, 0.45, 0.5, '#c79f6b', x1 - 1.6, 0.22, z1 - 0.6);
    box(0.5, 0.35, 0.45, '#b8905e', x1 - 1.5, 0.62, z1 - 0.6).rotation.y = 0.2;
  }
  for (let x = x0 + 3; x < x1 - 1; x += 3.2) {
    box(0.02, 0.8, 0.02, '#25282d', x, WALL_H - 0.4, 0);
    ball(0.12, '#ffe6a8', x, WALL_H - 0.85, 0, root, 0.8);
  }

  // ---------- Свет ----------
  root.add(new THREE.HemisphereLight('#fdfaf3', '#8a7f70', 1.5));
  const sun = new THREE.DirectionalLight('#fff4e2', 2.4);
  sun.position.set(W * 0.5, 14, D * 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const ext = Math.max(W, D) * 0.75;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 50 });
  sun.shadow.bias = -0.0006;
  root.add(sun, sun.target);

  // ---------- Точки подписей ----------
  const anchors: Record<string, THREE.Vector3> = {};
  if (spec.racks > 0) anchors.servers = new THREE.Vector3((rackX(0) + rackX(spec.racks - 1)) / 2, 2.6, rackZ);
  anchors.research = new THREE.Vector3(wbX, 2.75, z0 + 0.1);
  if (shown > 0) {
    const last = deskPos(Math.min(shown, cols) - 1);
    anchors.training = new THREE.Vector3((deskPos(0).x + last.x) / 2, 1.75, deskPos(0).z - 0.3);
  }
  anchors.showcase = new THREE.Vector3(x0 + 0.18, 2.55, shelfZ);
  if (ghostAt) anchors.seats = ghostAt;

  // ---------- Жизнь: огоньки, головы, экраны ----------
  let lastLit = -1;
  const paint = (now: number, animated: boolean, eventOn: boolean): boolean => {
    const trouble = live.trouble;
    const busy = Math.max(0.15, live.load);
    for (const l of leds) {
      const color = trouble ? '#e8c34a' : spec.rackColors[l.rack % Math.max(1, spec.rackColors.length)] ?? '#7dd87f';
      let on: boolean;
      if (eventOn) on = true;
      else if (!animated) on = l.seed < busy;
      else on = Math.sin(now / (trouble ? 420 : 160) + l.seed * 40) > 1 - 2 * busy * (0.6 + 0.4 * l.seed);
      l.mesh.material = on ? ledMat(color) : ledOff;
    }
    for (const h of heads) h.m.position.y = h.base + (animated ? Math.sin(now / 380 + h.phase) * 0.018 : 0);
    const k = eventOn ? 1.6 : animated && spec.training ? 0.8 + Math.sin(now / 700) * 0.12 : spec.training ? 0.8 : 0.4;
    if (k !== lastLit) {
      for (const s of screens) (s.material as THREE.MeshStandardMaterial).emissiveIntensity = k;
      lastLit = k;
    }
    return true;
  };
  paint(0, false, false);

  const ambient: NonNullable<Content['ambient']> = (ctx) => {
    const ev = live.event;
    const age = ev ? ctx.now - ev.at : Infinity;
    const eventOn = !ctx.reduced && !!ev && age >= 0 && age < EVENT_MS;
    const animated = !ctx.reduced && live.running;
    const dirty = paint(ctx.now, animated, eventOn);
    return { dirty, next: eventOn ? 60 : animated ? (ctx.slow ? 260 : 150) : Infinity };
  };

  const box3 = new THREE.Box3(new THREE.Vector3(x0 - 0.6, -0.6, z0 - 0.3), new THREE.Vector3(x1 + 0.6, WALL_H, z1 + 0.6));
  return {
    root,
    framing: {
      target: box3.getCenter(new THREE.Vector3()),
      fit: { box: box3 },
      yaw: Math.PI / 4,
      pitch: 0.6,
      minPitch: 0.6,
      maxPitch: 0.6,
      fov: 20,
      fill: 0.97,
    },
    background: null,
    envIntensity: 0.3,
    shadows: true,
    ambient,
    anchors,
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats.values()) m.dispose();
      for (const m of ledOn.values()) m.dispose();
      for (const m of extraMats) m.dispose();
      sun.shadow.map?.dispose();
    },
  };
}

/** Цвет темнее (k < 0) или светлее (k > 0). */
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
}
