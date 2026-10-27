// Лаборатория на весь рабочий стол: помещение этапа (гараж → офис → этаж → кампус) в изометрии.
// Люди за столами - основатели и вышедшие на работу сотрудники; свободный стол - место под следующего нанятого.
// Стойки в серверной - арендованные карты, огоньки цвета задачи; доска - исследования; полка - выпущенные модели и кубки.
// Пока идёт время, огоньки мигают, люди работают, экраны светятся; на паузе всё замирает. Подписи над местами
// рисует React (LabFloor) по точкам anchors.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Content } from './engine';
import { EVENT_MS, live } from './live';
import { rng } from './kit';
import { flagTexture } from './flag';
import { Crowd, type Look, type Spot } from './people';
import { onlyRackColorsDiffer, type LabSpec } from './specs';

interface RoomDef {
  w: number;
  d: number;
  /** Пол плиткой в шахматку: два тона. */
  floor: string;
  floorAlt: string;
  back: string;
  side: string;
  trim: string;
  /** Нижняя цветная полоса стен и крышка по верху среза стены (мягкий «кукольный» разрез, как в тайкунах). */
  band: string;
  cap: string;
  /** Окна на задней стене. */
  windows: number;
}

const ROOMS: RoomDef[] = [
  { w: 12, d: 9, floor: '#c4bcae', floorAlt: '#b8b0a1', back: '#f3e8d2', side: '#eadcc2', trim: '#c9b79c', band: '#e0954f', cap: '#9c6a3c', windows: 1 },
  { w: 14, d: 9.5, floor: '#ecd6aa', floorAlt: '#e2c996', back: '#e3f3f1', side: '#d6ece9', trim: '#b9d8d6', band: '#35aebb', cap: '#1d8592', windows: 2 },
  { w: 17, d: 11, floor: '#a9d0de', floorAlt: '#9cc5d4', back: '#f6f1e6', side: '#ede6d8', trim: '#d8cfbf', band: '#f2922c', cap: '#2f3d44', windows: 3 },
  { w: 20, d: 12.5, floor: '#dcebd2', floorAlt: '#cfe2c3', back: '#ffffff', side: '#f2f2f2', trim: '#dcdcdc', band: '#7b5cd6', cap: '#4b3a8c', windows: 4 },
];

/** Стены ниже прежнего: срез как в кукольном домике, внутрь видно сверху. */
const WALL_H = 2.7;
const SHIRTS = ['#d9822b', '#2f80e4', '#2e9b4f', '#c0504d', '#5d6b7a', '#1fa8a0', '#8a6bbf', '#c9a227'];
const HAIR = ['#3b2a1e', '#1f1f22', '#8a5a2b', '#6b4a2e', '#b58b55', '#2d2620'];
const SKIN = ['#e7bf9b', '#c99a74', '#f0d0b0', '#a87a55'];
const PERSON_CAP = 40;
const CHAIRS = ['#35aebb', '#f2922c', '#5d6b7a', '#e0574f'];

export function buildLab(spec: LabSpec): Content {
  let cur = spec; // текущее описание: patch меняет только цвета стоек
  const room = ROOMS[spec.stage] ?? ROOMS[0];
  const { w: W, d: D } = room;
  const root = new THREE.Group();
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const strips: { mesh: THREE.Mesh; rack: number }[] = [];
  const extraMats: THREE.Material[] = [];
  const extraTex: THREE.Texture[] = [];
  const rivalDoors: { x: number; z: number }[] = [];
  const rivalTops: THREE.Vector3[] = [];
  const rand = rng(97 + spec.stage * 13);

  const mat = (color: string, glow = 0): THREE.MeshStandardMaterial => {
    const key = `${color}|${glow}`;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, emissive: glow ? color : '#000000', emissiveIntensity: glow });
      mats.set(key, m);
    }
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.add(g);
    return g;
  };
  // Мягкий стиль: у всего, что толще 4 см, скруглённые рёбра; тонкие накладки, пол и стены - прямые.
  const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = root, glow = 0): THREE.Mesh => {
    const min = Math.min(w, h, d);
    const g = min >= 0.04 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.07, min * 0.35)) : new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo(g), mat(color, glow));
    m.position.set(x, y, z);
    m.castShadow = glow === 0;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const cyl = (r: number, h: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r, h, 20)), mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const sharp = (w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const ball = (r: number, color: string, x: number, y: number, z: number, parent: THREE.Object3D = root, glow = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo(new THREE.SphereGeometry(r, 20, 14)), mat(color, glow));
    m.position.set(x, y, z);
    m.castShadow = glow === 0;
    parent.add(m);
    return m;
  };

  const ghostMat = new THREE.MeshStandardMaterial({ color: '#7fd6e0', transparent: true, opacity: 0.6, roughness: 0.6, depthWrite: false });
  const padMat = new THREE.MeshBasicMaterial({ color: '#35aebb', transparent: true, opacity: 0.28, depthWrite: false });
  const dashMat = new THREE.MeshBasicMaterial({ color: '#1d8592' });
  extraMats.push(ghostMat, padMat, dashMat);
  /** Полупрозрачная деталь «скелета» (место, где может появиться предмет). */
  const ghostBox = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
    const min = Math.min(w, h, d);
    const m = new THREE.Mesh(geo(min >= 0.04 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(0.06, min * 0.35)) : new THREE.BoxGeometry(w, h, d)), ghostMat);
    m.position.set(x, y, z);
    m.renderOrder = 2;
    root.add(m);
    return m;
  };
  /** Мятная площадка с белой пунктирной рамкой на полу: здесь можно что-то поставить. */
  const slotPad = (cx: number, cz: number, w: number, d: number): void => {
    const pad = new THREE.Mesh(geo(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), padMat);
    pad.position.set(cx, 0.02, cz);
    root.add(pad);
    const dash = geo(new THREE.BoxGeometry(0.22, 0.012, 0.07));
    const dashZ = geo(new THREE.BoxGeometry(0.07, 0.012, 0.22));
    for (let t = -w / 2 + 0.15; t < w / 2 - 0.05; t += 0.36)
      for (const zz of [cz - d / 2, cz + d / 2]) {
        const m = new THREE.Mesh(dash, dashMat);
        m.position.set(cx + t, 0.025, zz);
        root.add(m);
      }
    for (let t = -d / 2 + 0.15; t < d / 2 - 0.05; t += 0.36)
      for (const xx of [cx - w / 2, cx + w / 2]) {
        const m = new THREE.Mesh(dashZ, dashMat);
        m.position.set(xx, 0.025, cz + t);
        root.add(m);
      }
  };

  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D / 2;
  const z1 = D / 2;

  // ---------- Пол и стены ----------
  const M = spec.base ? 2.4 : 0.6;
  box(W + M * 2, 0.5, D + M * 2, spec.base ?? '#2b2f35', 0, -0.35, 0);
  sharp(W, 0.2, D, room.floor, 0, -0.1, 0);
  // Плитка в шахматку: второй тон - квадратами поверх пола (одна сетка на все плитки).
  {
    const tile = geo(new THREE.PlaneGeometry(0.98, 0.98));
    tile.rotateX(-Math.PI / 2);
    const cells: [number, number][] = [];
    for (let ix = 0; ix < Math.floor(W); ix++) for (let iz = 0; iz < Math.floor(D); iz++) if ((ix + iz) % 2 === 0) cells.push([x0 + ix + 0.5, z0 + iz + 0.5]);
    const tiles = new THREE.InstancedMesh(tile, mat(room.floorAlt), cells.length);
    cells.forEach(([tx, tz], k) => tiles.setMatrixAt(k, new THREE.Matrix4().makeTranslation(tx, 0.002, tz)));
    tiles.receiveShadow = true;
    root.add(tiles);
  }
  // Стены: светлая краска, цветная полоса снизу, толстая цветная крышка по срезу.
  const WT = 0.3;
  sharp(W + WT, WALL_H, WT, room.back, -WT / 2, WALL_H / 2, z0 - WT / 2);
  sharp(WT, WALL_H, D, room.side, x0 - WT / 2, WALL_H / 2, 0);
  sharp(W + WT + 0.02, 0.9, 0.02, room.band, -WT / 2, 0.45, z0 + 0.01);
  sharp(0.02, 0.9, D, room.band, x0 + 0.01, 0.45, 0);
  sharp(W + WT + 0.02, 0.05, 0.03, shade(room.band, -0.12), -WT / 2, 0.92, z0 + 0.015);
  sharp(0.03, 0.05, D, shade(room.band, -0.12), x0 + 0.015, 0.92, 0);
  box(W + WT + 0.04, 0.12, WT + 0.06, room.cap, -WT / 2, WALL_H + 0.05, z0 - WT / 2);
  box(WT + 0.06, 0.12, D + 0.04, room.cap, x0 - WT / 2, WALL_H + 0.05, 0);

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
  let rackSlot: THREE.Vector3 | null = null;
  for (let i = 0; i < spec.racks; i++) {
    const x = rackX(i);
    if (litLeft <= 0) {
      // Место под стойку: карт на неё нет - полупрозрачный скелет на площадке.
      slotPad(x, rackZ + 0.1, 0.9, 1.15);
      ghostBox(RACK_W, 2.1, 0.95, x, 1.05, rackZ);
      rackSlot ??= new THREE.Vector3(x, 2.55, rackZ + 0.2);
      continue;
    }
    if (litLeft < 8) rackSlot ??= new THREE.Vector3(x, 2.55, rackZ + 0.2);
    box(RACK_W, 2.1, 0.95, '#3a4652', x, 1.05, rackZ);
    box(RACK_W + 0.02, 0.06, 0.97, '#3a3e45', x, 2.12, rackZ);
    // Планка цвета задачи над дверцей (как в «Мощностях»).
    if (spec.racksLit > i * 8) strips.push({ mesh: box(RACK_W - 0.06, 0.07, 0.02, spec.rackColors[i] ?? '#7dd87f', x, 2.03, rackZ + 0.49, root, 0.8), rack: i });
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
    const front = new THREE.Mesh(geo(new THREE.BoxGeometry(x1 - gx - 0.9, 2.6, 0.04)), glass);
    front.position.set((gx + 0.9 + x1) / 2, 1.3, z0 + 1.9);
    box(0.06, 2.6, 0.06, '#9aa1a9', gx + 0.9, 1.3, z0 + 1.9);
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

  // ---------- Витрина: стеклянный шкаф у левой стены, на полках награды моделей и кубки ----------
  const shelfZ = z0 + 2.2;
  const cabL = 1.7; // вдоль стены
  const cabD = 0.5;
  const cabH = 1.9;
  const cx = x0 + 0.06 + cabD / 2;
  const wood = '#7a5c43';
  box(cabD, 0.18, cabL, wood, cx, 0.09, shelfZ); // цоколь
  box(cabD, 0.06, cabL, wood, cx, cabH - 0.03, shelfZ); // крышка
  box(0.04, cabH, cabL, shade(wood, 0.25), x0 + 0.08, cabH / 2, shelfZ); // задняя стенка светлее
  for (const dz of [-cabL / 2 + 0.03, cabL / 2 - 0.03]) box(cabD, cabH, 0.05, wood, cx, cabH / 2, shelfZ + dz); // боковины
  const SHELF_Y = [0.18, 0.75, 1.32];
  for (const y of SHELF_Y.slice(1)) box(cabD - 0.06, 0.03, cabL - 0.08, '#e9edf0', cx, y, shelfZ);
  const vitrine = new THREE.MeshStandardMaterial({ color: '#d9f0f4', transparent: true, opacity: 0.2, roughness: 0.05, depthWrite: false });
  extraMats.push(vitrine);
  const front = new THREE.Mesh(geo(new THREE.BoxGeometry(0.02, cabH - 0.24, cabL - 0.1)), vitrine);
  front.position.set(cx + cabD / 2 - 0.01, 0.18 + (cabH - 0.24) / 2, shelfZ);
  front.renderOrder = 3;
  root.add(front);
  // Подсветка полок: тонкая светлая планка под крышкой
  box(0.04, 0.02, cabL - 0.14, '#fff6d8', cx + 0.12, cabH - 0.08, shelfZ).castShadow = false;
  // Награды: модель - подставка с цветной табличкой, кубок - за первое место (золото) или призовое (серебро)
  const items: ({ kind: 'model'; color: string; big: boolean } | { kind: 'cup'; gold: boolean })[] = [
    ...spec.cups.map((c) => ({ kind: 'cup' as const, gold: c === 'first' })),
    ...spec.models.map((m, i) => ({ kind: 'model' as const, color: m, big: i === 0 })),
  ];
  const perShelf = 4;
  const step = (cabL - 0.2) / perShelf;
  items.slice(0, perShelf * SHELF_Y.length).forEach((it, i) => {
    const shelf = SHELF_Y.length - 1 - Math.floor(i / perShelf); // сверху вниз: верхняя полка - самые важные
    const y = SHELF_Y[shelf] + 0.015;
    const z = shelfZ - (cabL - 0.2) / 2 + step / 2 + (i % perShelf) * step;
    const x = cx + 0.02;
    if (it.kind === 'cup') {
      const col = it.gold ? '#e3b93c' : '#c3c8ce';
      cyl(0.07, 0.04, '#3a3f46', x, y + 0.02, z);
      cyl(0.025, 0.1, col, x, y + 0.09, z);
      cyl(0.09, 0.14, col, x, y + 0.21, z);
    } else {
      const h = it.big ? 0.3 : 0.24;
      box(0.2, 0.05, 0.2, '#3a3f46', x, y + 0.025, z);
      box(0.05, h, 0.16, it.color, x - 0.02, y + 0.05 + h / 2, z).rotation.z = -0.15;
    }
  });

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
  const screenColor = spec.training ? '#3a7bd5' : '#4a5563';
  for (let i = 0; i < shown; i++) {
    const { x, z } = deskPos(i);
    desk(x, z, i);
    chairAt(x - 0.15, z + 0.85, i);
  }
  let ghostAt: THREE.Vector3 | null = null;
  if (ghosts) {
    const { x, z } = deskPos(shown);
    slotPad(x, z + 0.4, 2.0, 1.9);
    ghostBox(1.7, 0.07, 0.85, x, 0.76, z);
    for (const [dx, dz] of [
      [-0.78, -0.36],
      [0.78, -0.36],
      [-0.78, 0.36],
      [0.78, 0.36],
    ])
      ghostBox(0.06, 0.72, 0.06, x + dx, 0.37, z + dz);
    ghostBox(0.78, 0.48, 0.05, x - 0.15, 1.16, z - 0.28);
    ghostBox(0.08, 0.2, 0.08, x - 0.15, 0.88, z - 0.3);
    ghostBox(0.56, 0.1, 0.56, x - 0.15, 0.5, z + 0.85);
    ghostBox(0.56, 0.58, 0.1, x - 0.15, 0.82, z + 1.13);
    ghostAt = new THREE.Vector3(x, 1.75, z + 0.3);
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
    box(0.07, 0.03, 0.11, '#d9dbdf', x + 0.22, 0.81, z + 0.08).castShadow = false;
    box(0.24, 0.01, 0.2, '#2f3d44', x + 0.22, 0.8, z + 0.06).castShadow = false;
    if (i % 3 === 2) {
      // Второй монитор под углом.
      const m2 = box(0.5, 0.34, 0.04, '#25282d', x + 0.42, 1.1, z - 0.22);
      m2.rotation.y = -0.45;
      const s2 = box(0.44, 0.28, 0.01, screenColor, x + 0.43, 1.1, z - 0.2, root, spec.training ? 0.9 : 0.4);
      s2.rotation.y = -0.45;
      screens.push(s2);
      box(0.06, 0.18, 0.06, '#25282d', x + 0.42, 0.87, z - 0.24);
    }
    if (i % 4 === 0) {
      box(0.16, 0.05, 0.2, '#2b2f35', x - 0.62, 0.82, z + 0.1);
      box(0.05, 0.04, 0.18, '#e0574f', x - 0.67, 0.86, z + 0.1);
    }
    if (i % 4 === 2) for (let k = 0; k < 3; k++) box(0.22, 0.012, 0.3, '#f7f4ec', x - 0.62, 0.795 + k * 0.012, z + 0.05).rotation.y = 0.15 * k;
    // Строки кода на экране, пока идёт обучение.
    if (spec.training)
      for (let k = 0; k < 4; k++) box(0.18 + ((i + k * 3) % 4) * 0.08, 0.025, 0.005, '#e8f0ff', x - 0.4 + 0.09 + ((i + k * 3) % 4) * 0.04, 1.29 - k * 0.07, z - 0.244, root, 0.9).castShadow = false;
    if (i % 2 === 0) cyl(0.06, 0.12, SHIRTS[(i + 3) % SHIRTS.length], x + 0.6, 0.86, z + 0.1);
    else box(0.3, 0.04, 0.22, '#f2f2ee', x + 0.5, 0.81, z + 0.05).rotation.y = 0.3;
    // Тумба под столом, корзина, лампа или цветок - чтобы столы не были одинаковыми.
    box(0.42, 0.6, 0.7, '#8d7158', x + 0.55, 0.3, z);
    if (i % 2 === 1) cyl(0.13, 0.3, '#5d6b7a', x + 1.05, 0.15, z + 0.2);
    if (i % 3 === 0) {
      cyl(0.08, 0.03, '#25282d', x + 0.65, 0.81, z - 0.25);
      box(0.03, 0.35, 0.03, '#25282d', x + 0.65, 0.98, z - 0.25);
      box(0.22, 0.08, 0.12, '#e8c34a', x + 0.58, 1.15, z - 0.2, root, 0.6);
    } else if (i % 4 === 1) {
      cyl(0.07, 0.1, '#b5654a', x + 0.68, 0.84, z - 0.25);
      ball(0.11, '#5d9a55', x + 0.68, 0.98, z - 0.25);
    }
  }

  function chairAt(x: number, z: number, i: number) {
    const c = CHAIRS[i % CHAIRS.length];
    box(0.56, 0.1, 0.56, c, x, 0.5, z);
    box(0.56, 0.58, 0.1, c, x, 0.82, z + 0.28);
    cyl(0.04, 0.45, '#6b7276', x, 0.24, z);
    cyl(0.22, 0.04, '#6b7276', x, 0.03, z);
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

  // ---------- Стены: часы, доска объявлений, кондиционер, огнетушитель, жалюзи, кабель-канал ----------
  cyl(0.22, 0.04, '#f7f7f5', wbX + 1.75, 2.55, z0 + 0.03).rotation.x = Math.PI / 2;
  box(0.02, 0.14, 0.01, '#25282d', wbX + 1.75, 2.59, z0 + 0.06).castShadow = false;
  box(0.1, 0.02, 0.01, '#25282d', wbX + 1.79, 2.55, z0 + 0.06).castShadow = false;
  box(0.05, 0.8, 1.3, '#b98e5f', x0 + 0.03, 2.0, z0 + 4.2);
  const notes = ['#fff5b8', '#bfe3c3', '#f6c9c1', '#c9dcf6'];
  for (let k = 0; k < 7; k++) box(0.01, 0.16, 0.16, notes[k % 4], x0 + 0.07, 1.78 + (k % 3) * 0.22, z0 + 3.7 + Math.floor(k / 3) * 0.4 + (k % 2) * 0.08).castShadow = false;
  if (spec.racks > 0) {
    box(1.2, 0.34, 0.26, '#eef0f2', (rackX(0) + rackX(spec.racks - 1)) / 2, WALL_H - 0.3, z0 + 0.14);
    box(1.0, 0.03, 0.02, '#9aa1a9', (rackX(0) + rackX(spec.racks - 1)) / 2, WALL_H - 0.42, z0 + 0.28).castShadow = false;
    const ex = rackX(spec.racks - 1) - 0.65;
    cyl(0.09, 0.45, '#d64545', ex, 0.23, z0 + 0.25);
    box(0.06, 0.08, 0.06, '#25282d', ex, 0.5, z0 + 0.25);
    box(Math.max(0.5, rackX(spec.racks - 1) - (x0 + 5)), 0.03, 0.12, '#4a4f57', (x0 + 5 + rackX(spec.racks - 1)) / 2, 0.015, z0 + 0.35).castShadow = false;
  }
  for (let i = 0; i < room.windows; i++) {
    const wx = x0 + 5 + (winSpan * (i + 0.5)) / room.windows;
    for (let k = 0; k < 5; k++) box(1.75, 0.035, 0.02, '#e6e2da', wx, 2.5 - k * 0.09, z0 + 0.09).castShadow = false;
  }
  if (spec.stage >= 1) {
    box(0.06, 2.1, 1.0, '#8a6a4f', x0 + 0.03, 1.05, z1 - 0.8);
    cyl(0.03, 0.04, '#c9a227', x0 + 0.08, 1.0, z1 - 1.15).rotation.z = Math.PI / 2;
  }

  // ---------- Уголок отдыха и мелочи ----------
  const lx = x0 + 1.9;
  const lz = z1 - 1.6;
  box(2.2, 0.42, 0.95, '#6f5646', lx, 0.21, lz);
  box(2.2, 0.6, 0.25, '#654e40', lx, 0.62, lz + 0.4);
  box(0.25, 0.55, 0.95, '#654e40', lx - 1.05, 0.42, lz);
  box(0.25, 0.55, 0.95, '#654e40', lx + 1.05, 0.42, lz);
  box(1.1, 0.4, 0.6, '#8a6a4f', lx + 0.1, 0.2, lz - 1.2);
  box(0.4, 0.3, 0.12, '#c9a227', lx - 0.6, 0.55, lz + 0.18).rotation.x = -0.25;
  box(0.4, 0.3, 0.12, '#2f80e4', lx + 0.6, 0.55, lz + 0.18).rotation.x = -0.25;
  box(0.32, 0.02, 0.24, '#d64545', lx - 0.1, 0.41, lz - 1.15).rotation.y = 0.4;
  cyl(0.12, 0.03, '#25282d', lx + 1.55, 0.02, lz + 0.2);
  box(0.03, 1.5, 0.03, '#25282d', lx + 1.55, 0.77, lz + 0.2);
  cyl(0.18, 0.22, '#f2e6c9', lx + 1.55, 1.58, lz + 0.2);
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
  // Постеры на задней стене между доской и окнами.
  const posters = ['#35aebb', '#f2922c', '#7b5cd6'];
  for (let k = 0; k < 2; k++) {
    const px = x0 + 4.25 + k * 0.75;
    box(0.62, 0.84, 0.04, '#2f3d44', px, 1.85, z0 + 0.03);
    box(0.52, 0.74, 0.01, posters[(k + spec.stage) % posters.length], px, 1.85, z0 + 0.055).castShadow = false;
    box(0.36, 0.06, 0.01, '#ffffff', px, 2.0 - k * 0.1, z0 + 0.065).castShadow = false;
    ball(0.12, '#ffffff', px, 1.7, z0 + 0.06).scale.z = 0.1;
  }
  // Принтер на тумбе у серверной.
  if (spec.racks > 0) {
    const prx = rackX(spec.racks - 1) - 1.45;
    box(0.7, 0.66, 0.5, '#d8dadc', prx, 0.33, z0 + 0.4);
    box(0.6, 0.26, 0.44, '#f2f3f4', prx, 0.79, z0 + 0.4);
    box(0.4, 0.02, 0.2, '#ffffff', prx, 0.93, z0 + 0.52).castShadow = false;
    box(0.1, 0.04, 0.04, '#35aebb', prx + 0.2, 0.9, z0 + 0.63, root, 0.6);
  }
  // Ковёр под рабочими местами (офис и дальше).
  if (spec.stage >= 1 && shown > 0) {
    const a = deskPos(0);
    const b = deskPos(Math.max(0, Math.min(shown, capacity) - 1));
    const rx0 = Math.min(a.x, deskPos(Math.min(cols, shown) - 1).x) - 1.1;
    const rx1 = Math.max(a.x, deskPos(Math.min(cols, shown) - 1).x) + 1.1;
    sharp(rx1 - rx0, 0.015, b.z - a.z + 2.2, room.band, (rx0 + rx1) / 2, 0.008, (a.z + b.z) / 2 + 0.3).castShadow = false;
    sharp(rx1 - rx0 - 0.24, 0.02, b.z - a.z + 1.96, shade(room.floor, 0.04), (rx0 + rx1) / 2, 0.012, (a.z + b.z) / 2 + 0.3).castShadow = false;
  }
  // Вешалка у двери.
  cyl(0.15, 0.03, '#5d4836', x0 + 0.5, 0.02, z1 - 0.35);
  cyl(0.03, 1.7, '#5d4836', x0 + 0.5, 0.85, z1 - 0.35);
  ball(0.16, '#c0504d', x0 + 0.56, 1.55, z1 - 0.33).scale.set(0.8, 1.2, 0.6);

  // ---------- Снаружи: газон, кусты вдоль стен, деревья по углам ----------
  if (spec.base) {
    const hedge = shade(spec.base, -0.05);
    for (let x = x0 + 0.6; x < x1; x += 1.2) box(1.0, 0.45, 0.6, hedge, x, 0.22, z0 - WT - 0.55);
    for (let z = z0 + 0.6; z < z1; z += 1.2) box(0.6, 0.45, 1.0, hedge, x0 - WT - 0.55, 0.22, z);
    for (const [tx, tz] of [
      [x0 - 1.2, z0 - 1.2],
      [x1 + 0.9, z0 - 1.0],
      [x0 - 1.0, z1 + 0.9],
    ]) {
      cyl(0.12, 0.8, '#7a5a3c', tx, 0.4, tz);
      ball(0.7, shade(spec.base, 0.04), tx, 1.25, tz);
      ball(0.5, shade(spec.base, 0.08), tx + 0.25, 1.65, tz + 0.1);
    }
    sharp(1.4, 0.02, D + 1.6, '#e9e2d2', x1 + 1.0, 0.01, 0);
    // Здания главных соперников на газоне перед лабораторией: цвет лаборатории, этажей - по доле рынка. Дверь - со
    // стороны лаборатории: туда уходят клиенты из очереди.
    (spec.rivals ?? []).slice(0, 3).forEach((rv, i) => {
      const bx = x1 - 1.6 - i * 3.1;
      const bz = z1 + 1.45;
      const h = 0.55 * rv.floors + 0.3;
      box(1.8, h, 1.3, '#f1efe9', bx, h / 2, bz);
      box(1.86, 0.18, 1.36, rv.color, bx, h + 0.09, bz);
      for (let f = 0; f < rv.floors; f++) sharp(1.4, 0.18, 0.02, '#8fb3cc', bx, 0.42 + f * 0.55, bz + 0.66);
      sharp(0.42, 0.6, 0.02, shade(rv.color, -0.2), bx, 0.3, bz - 0.66);
      rivalDoors.push({ x: bx, z: bz - 0.8 });
      // Подписи домов на разной высоте: при взгляде сбоку дома стоят тесно, и подписи налезали друг на друга.
      rivalTops.push(new THREE.Vector3(bx, h + 0.25 + i * 0.6, bz));
    });
    // Флагшток страны лаборатории на газоне справа от дорожки (ближе к камере), полотнище - к входу.
    if (spec.flag) {
      const px = x1 + 2.0;
      const pz = z0 + 0.4;
      cyl(0.2, 0.08, '#9aa3ab', px, 0.04, pz);
      cyl(0.05, 3.5, '#c9cfd4', px, 1.75, pz);
      ball(0.08, '#e8c34a', px, 3.55, pz);
      const tex = flagTexture(spec.flag);
      const cloth = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
      extraMats.push(cloth);
      extraTex.push(tex);
      const fm = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.65, 1.1)), cloth);
      fm.rotation.y = -Math.PI / 2;
      fm.position.set(px, 2.9, pz + 0.85);
      fm.castShadow = true;
      root.add(fm);
    }
  }

  // ---------- Свет ----------
  // Мягкий яркий свет: сильнее рассеянный, тени с размытым краем.
  root.add(new THREE.HemisphereLight('#fffaf0', '#9a8f80', 2.1));
  const sun = new THREE.DirectionalLight('#fff6e8', 2.0);
  sun.shadow.radius = 5;
  sun.position.set(W * 0.5, 14, D * 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const ext = Math.max(W, D) * 0.75;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 50 });
  sun.shadow.bias = -0.0006;
  root.add(sun, sun.target);

  // ---------- Люди ----------
  const laneX = deskArea.xa - 0.25;
  const TZ = deskArea.za - (spec.stage >= 1 ? 0.75 : 0.95);
  const spots: Spot[] = [];
  const at = (x: number, z: number, face: number, act: Spot['act'], lane = TZ): Spot => ({ x, z, face, act, lane });
  spots.push(at(x0 + 1.15, z0 + 4.2, Math.PI / 2, 'drink'));
  spots.push(at(wbX + 0.85, z0 + 1.05, 0, 'look'));
  if (room.windows > 0) spots.push(at(x0 + 5 + winSpan / room.windows / 2, z0 + 1.0, 0, 'look'));
  if (spec.racks > 0) spots.push(at(rackX(spec.racks - 1) - 1.45, z0 + 1.0, 0, 'print'));
  if (spec.stage >= 1) spots.push(at(x0 + 0.95, z0 + 6.8, Math.PI / 2, 'drink'));
  for (let k = 0; k < Math.min(3, shown); k++) {
    const j = Math.floor(rand() * shown);
    const d = deskPos(j);
    spots.push(at(d.x + 0.45, d.z + 1.25, Math.PI * 0.75, 'chat', d.z + 1.4));
  }
  const gapX = rackX(spec.racks - 1) - 0.75 + 0.45;
  const serverSpots: Spot[] = [];
  for (let i = 0; i < Math.min(spec.racks, Math.ceil(spec.racksLit / 8)); i++) {
    const sp = at(rackX(i), rackZ + 0.95, 0, 'tap');
    if (spec.stage >= 1) sp.via = [{ x: gapX, z: TZ }, { x: gapX, z: rackZ + 0.95 }];
    serverSpots.push(sp);
  }
  const door = spec.stage >= 1 ? { x: x0 + 0.55, z: z1 - 0.8 } : { x: x0 + 0.7, z: z1 - 2.6 };
  const crowd = new Crowd(
    (g, color) => {
      const m = new THREE.Mesh(g, mat(color));
      m.castShadow = false;
      return m;
    },
    (g) => geos.add(g),
    laneX,
    spots,
    serverSpots,
    door,
    rand,
  );
  for (let i = 0; i < shown; i++) {
    const d = deskPos(i);
    crowd.addSeated(lookOf(i), { x: d.x - 0.15, z: d.z + 0.85 }, d.z + 1.4);
  }
  if (spec.research) crowd.addStanding({ ...lookOf(97), coat: true }, at(wbX, z0 + 0.95, 0, 'write'));
  let queueAt: THREE.Vector3 | null = null;
  // Клиенты в очереди на дорожке у входа, лицом к зданию: сколько стоит - live.visitors (доля рынка). Растёт доля -
  // новый клиент подходит по дорожке, падает - последний уходит к зданию соперника. Зал при этом не перестраивается.
  if (spec.base && spec.visitors) {
    const entry = { x: x1 + 1.0, z: z1 + 1.9 };
    for (let i = 0; i < 8; i++) crowd.addVisitor(lookOf(200 + i * 7), at(x1 + 1.0, z1 - 0.5 - i * 0.85, Math.PI / 2, 'look'), entry, i < live.visitors);
    queueAt = new THREE.Vector3(x1 + 1.0, 1.95, z1 - 0.5 - 1.5 * 0.85);
  }
  root.add(crowd.root);

  // ---------- Точки подписей ----------
  const anchors: Record<string, THREE.Vector3> = {};
  if (spec.racks > 0) anchors.servers = new THREE.Vector3((rackX(0) + rackX(spec.racks - 1)) / 2, 2.6, rackZ);
  anchors.research = new THREE.Vector3(wbX, 2.75, z0 + 0.1);
  if (shown > 0) {
    const last = deskPos(Math.min(shown, cols) - 1);
    anchors.training = new THREE.Vector3((deskPos(0).x + last.x) / 2, 1.75, deskPos(0).z - 0.3);
  }
  anchors.showcase = new THREE.Vector3(x0 + 0.55, 1.6, shelfZ);
  // Табло лаборатории над задней стеной (React рисует место в гонке и долю клиентов).
  if (spec.base) anchors.sign = new THREE.Vector3(x1 - 3.2, WALL_H + 0.9, z0 - 0.2);
  if (queueAt) anchors.queue = queueAt;
  rivalTops.forEach((p, i) => (anchors[`rival${i}`] = p));
  if (ghostAt) anchors.seats = ghostAt;
  anchors.rackSlot = rackSlot ?? new THREE.Vector3(rackX(Math.max(0, spec.racks - 1)) - 0.5, 2.55, rackZ + 0.2);
  if (!spec.research) anchors.researchSlot = new THREE.Vector3(wbX, 1.9, z0 + 0.3);
  if (!spec.training && shown > 0) anchors.trainSlot = new THREE.Vector3(deskPos(0).x - 0.15, 1.75, deskPos(0).z - 0.2);

  // ---------- Жизнь: огоньки, головы, экраны ----------
  let lastLit = -1;
  const paint = (now: number, animated: boolean, eventOn: boolean): boolean => {
    const trouble = live.trouble;
    const busy = Math.max(0.15, live.load);
    for (const l of leds) {
      const color = trouble ? '#e8c34a' : cur.rackColors[l.rack % Math.max(1, cur.rackColors.length)] ?? '#7dd87f';
      let on: boolean;
      if (eventOn) on = true;
      else if (!animated) on = l.seed < busy;
      else on = Math.sin(now / (trouble ? 420 : 160) + l.seed * 40) > 1 - 2 * busy * (0.6 + 0.4 * l.seed);
      l.mesh.material = on ? ledMat(color) : ledOff;
    }
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
    crowd.setVisitors(spec.visitors ? live.visitors : -1, rivalDoors);
    // На паузе очередь сразу нужной длины: при загрузке партии и после перестройки зала клиенты уже стоят.
    const snapped = spec.visitors && !animated ? crowd.snapVisitors(live.visitors) : false;
    const people = crowd.update(ctx.now, animated, ev ? { kind: ev.kind, seq: ev.seq, age } : null);
    const next = people.moving ? (ctx.slow ? 66 : 33) : eventOn ? 60 : animated ? (ctx.slow ? 200 : 90) : Infinity;
    return { dirty: dirty || people.dirty || snapped, next };
  };

  const box3 = new THREE.Box3(new THREE.Vector3(x0 - M, -0.6, z0 - M), new THREE.Vector3(x1 + M, WALL_H, z1 + M));
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
    patch: (next) => {
      if (!onlyRackColorsDiffer(cur, next) || next.kind !== 'lab') return false;
      cur = next;
      for (const s of strips) s.mesh.material = mat(next.rackColors[s.rack] ?? '#7dd87f', 0.8);
      paint(0, false, false);
      return true;
    },
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const m of mats.values()) m.dispose();
      for (const m of ledOn.values()) m.dispose();
      for (const m of extraMats) m.dispose();
      for (const t of extraTex) t.dispose();
      crowd.dispose();
      sun.shadow.map?.dispose();
    },
  };
}

/** Цвет темнее (k < 0) или светлее (k > 0). */
const PANTS = ['#3d4a5e', '#2f3d44', '#6b5a4a', '#4a5a3a', '#5a4a6b'];
const STYLES: Look['style'][] = ['short', 'bun', 'curly', 'long', 'short', 'bald'];

function lookOf(i: number): Look {
  return {
    shirt: SHIRTS[i % SHIRTS.length],
    pants: PANTS[(i * 3) % PANTS.length],
    skin: SKIN[(i * 7) % SKIN.length],
    hair: HAIR[(i * 5) % HAIR.length],
    style: STYLES[(i * 5 + 1) % STYLES.length],
    glasses: i % 3 === 1,
  };
}

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
}
