// Кампус дата-центра: макет площадки на подставке, который достраивается по этапам.
// Свободная площадка - земля с колышками. «Участок» - забор растёт по периметру, выровненная площадка,
// экскаватор. «Линия электропередачи» - опоры от края участка к подстанции. «Здание» - плита, колонны,
// стены растут по высоте, башенный кран. «Охлаждение» - крыша и чиллеры во дворе. Готовый дата-центр
// показан без крыши: внутри ряды стоек, их столько, сколько карт стоит (доля занятой мощности),
// цвет верха стойки - поколение карт. Грузовики у ворот - заказы в пути.
// Окружение по площадке: Техас - песок и кусты, Вирджиния - трава и лиственный лес,
// Швеция - снег и ели, Вашингтон - степь и река. Единица - метр.

import * as THREE from 'three';
import type { DcSiteId } from '../../data/datacenters';
import type { GpuId } from '../../sim/types';
import type { Content } from './engine';
import { GPU_LOOK } from './gpuLook';
import { GeoBatch, canvasTex, meshesOf, mtx, pbr, rng } from './kit';
import type { CampusSpec } from './specs';

const STAGES = 4;

interface SiteLook {
  ground: string;
  pad: string;
  side: string;
  sky: string;
  flora: 'shrub' | 'tree' | 'pine' | 'sage';
  floraColor: string;
  density: number;
  river?: boolean;
  snow?: boolean;
}

const SITE_LOOK: Record<DcSiteId, SiteLook> = {
  abilene: { ground: '#cdb486', pad: '#b9a37a', side: '#8a6a45', sky: '#e8dfd2', flora: 'shrub', floraColor: '#7b7744', density: 0.5 },
  ashburn: { ground: '#86a865', pad: '#a7a296', side: '#6b5236', sky: '#dfe7ee', flora: 'tree', floraColor: '#4e8a3d', density: 1 },
  lulea: { ground: '#eef2f6', pad: '#c9cdd2', side: '#6f6458', sky: '#e3e9f0', flora: 'pine', floraColor: '#2f5a3e', density: 1, snow: true },
  quincy: { ground: '#b4ad7c', pad: '#aaa597', side: '#7a6243', sky: '#e6e7dc', flora: 'sage', floraColor: '#8e9a68', density: 0.6, river: true },
};

/** Залы по мощности: число, ширина (x), глубина (z), высота стен. */
function hallsFor(mw: number): { n: number; w: number; d: number; h: number } {
  if (mw <= 5) return { n: 1, w: 34, d: 20, h: 8 };
  if (mw <= 20) return { n: 1, w: 56, d: 26, h: 10 };
  if (mw <= 50) return { n: 2, w: 56, d: 26, h: 10 };
  return { n: 3, w: 56, d: 26, h: 10 };
}

const HALL_GAP = 8;

/** Плита стены с вертикальными швами (повторяющаяся текстура). */
function wallTex(): THREE.CanvasTexture {
  return canvasTex(
    'campus-wall',
    128,
    128,
    (g, w, h) => {
      g.fillStyle = '#d3d8de';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#b5bcc4';
      for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(0, 0, w, 6);
    },
    { repeat: [1, 1] },
  );
}

interface Grow {
  obj: THREE.Object3D;
  from: number;
  delay: number;
}

export function buildCampus(spec: CampusSpec, prev: CampusSpec | null): Content {
  const look = SITE_LOOK[spec.site];
  const root = new THREE.Group();
  const halls = hallsFor(spec.mw ?? 20);
  const blockD = halls.n * halls.d + (halls.n - 1) * HALL_GAP;
  // Участок: здание в центре, слева подстанция, справа двор с чиллерами, спереди стоянка и ворота
  const plot = { x0: -halls.w / 2 - 28, x1: halls.w / 2 + 26, z0: -blockD / 2 - 8, z1: blockD / 2 + 22 };
  const margin = 9;
  const tile = { x0: plot.x0 - margin, x1: plot.x1 + margin, z0: plot.z0 - margin, z1: plot.z1 + margin };
  const tw = tile.x1 - tile.x0;
  const td = tile.z1 - tile.z0;
  const tcx = (tile.x0 + tile.x1) / 2;
  const tcz = (tile.z0 + tile.z1) / 2;
  const built = spec.mw !== null;
  const st = built ? spec.stage : -1;
  const p = spec.progress;
  const done = (stage: number) => st > stage;
  const at = (stage: number) => st === stage;
  const grows: Grow[] = [];
  const pst = prev && prev.site === spec.site && prev.mw === spec.mw ? prev : null;
  /** Новый элемент (по сравнению с прошлой сценой) растёт снизу вверх. */
  const growIfNew = (obj: THREE.Object3D, isNew: boolean, delay = 0, from = 0) => {
    if (isNew) grows.push({ obj, from, delay });
  };

  const b = new GeoBatch();

  // ---------- Подставка-макет ----------
  b.box('tileSide', tw, 3, td, tcx, -1.5, tcz);
  b.box('ground', tw, 0.2, td, tcx, 0.1, tcz);
  if (look.river) b.box('water', tw, 0.08, 6, tcx, 0.2, tile.z0 + 3.4);

  // ---------- Окружение: растения по краю подставки ----------
  {
    const r = rng(spec.site.length * 977 + 13);
    const count = Math.round(56 * look.density);
    for (let i = 0; i < count; i++) {
      let x = tile.x0 + 2 + r() * (tw - 4);
      let z = tile.z0 + 2 + r() * (td - 4);
      const inside = x > plot.x0 - 3 && x < plot.x1 + 3 && z > plot.z0 - 3 && z < plot.z1 + 3;
      if (inside) {
        // Вытолкнуть к ближайшему краю подставки
        const dx = Math.min(x - tile.x0, tile.x1 - x);
        const dz = Math.min(z - tile.z0, tile.z1 - z);
        if (dx < dz) x = x - tile.x0 < tile.x1 - x ? tile.x0 + 1.5 + r() * (margin - 3) : tile.x1 - 1.5 - r() * (margin - 3);
        else z = z - tile.z0 < tile.z1 - z ? tile.z0 + 1.5 + r() * (margin - 3) : tile.z1 - 1.5 - r() * (margin - 3);
      }
      if (look.river && z < tile.z0 + 7) z = tile.z0 + 7.5 + r() * 1.5;
      const s = 0.7 + r() * 0.6;
      if (look.flora === 'tree') {
        b.cyl('trunk', 0.35 * s, 3 * s, x, 1.5 * s + 0.2, z, 0, 0, 0, 6);
        b.add('flora', new THREE.IcosahedronGeometry(2.6 * s, 0), mtx(x, 4.4 * s + 0.2, z, r(), r(), 0));
      } else if (look.flora === 'pine') {
        b.cyl('trunk', 0.3 * s, 1.6 * s, x, 0.8 * s + 0.2, z, 0, 0, 0, 6);
        for (let k = 0; k < 3; k++) {
          b.add('flora', new THREE.ConeGeometry((2.4 - k * 0.6) * s, 2.6 * s, 7), mtx(x, (2.2 + k * 1.5) * s + 0.2, z));
          b.add('snowCap', new THREE.ConeGeometry((1.0 - k * 0.22) * s, 1.0 * s, 7), mtx(x, (3.05 + k * 1.5) * s + 0.2, z));
        }
      } else {
        b.add('flora', new THREE.IcosahedronGeometry(1.1 * s, 0), mtx(x, 0.6 * s + 0.2, z, r(), r(), 0, 1.4, 0.7, 1.2));
        if (look.flora === 'shrub' && r() < 0.3) b.add('rock', new THREE.DodecahedronGeometry(0.7 * s, 0), mtx(x + 2, 0.4, z + 1, r(), r(), r()));
      }
    }
  }

  // ---------- Свободная площадка: колышки по углам, лента по контуру будущего здания, щит у дороги ----------
  if (!built) {
    for (const [x, z] of [
      [plot.x0, plot.z0],
      [plot.x1, plot.z0],
      [plot.x0, plot.z1],
      [plot.x1, plot.z1],
    ]) {
      b.box('stake', 0.4, 2.4, 0.4, x, 1.4, z);
      b.box('flag', 1.2, 0.7, 0.06, x + 0.7, 2.3, z);
    }
    const bx = halls.w / 2;
    const bz = blockD / 2;
    for (const [w, d, x, z] of [
      [halls.w, 0.35, 0, -bz],
      [halls.w, 0.35, 0, bz],
      [0.35, blockD, -bx, 0],
      [0.35, blockD, bx, 0],
    ] as const) b.box('tape', w, 0.12, d, x, 0.27, z);
    for (const [x, z] of [[-bx, -bz], [bx, -bz], [-bx, bz], [bx, bz]] as const) b.box('stake', 0.3, 1.4, 0.3, x, 0.9, z);
    // Щит у дороги
    b.box('post', 0.3, 4, 0.3, -4, 2.2, plot.z1 + 2);
    b.box('post', 0.3, 4, 0.3, 4, 2.2, plot.z1 + 2);
    b.box('sign', 10, 3.2, 0.2, 0, 3.6, plot.z1 + 2.15);
    b.box('signStripe', 10, 0.6, 0.22, 0, 2.3, plot.z1 + 2.15);
  }

  // ---------- Участок: площадка, забор, техника ----------
  if (built) {
    b.box('pad', plot.x1 - plot.x0 - 2, 0.06, plot.z1 - plot.z0 - 2, (plot.x0 + plot.x1) / 2, 0.23, (plot.z0 + plot.z1) / 2);
    // Забор по периметру: столбы через 4 м и две перекладины; на этапе «Участок» - на долю прогресса
    const per: [number, number][] = [];
    const step = 4;
    const pushSide = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const k = Math.max(1, Math.round(len / step));
      for (let i = 0; i < k; i++) per.push([ax + ((bx - ax) * i) / k, az + ((bz - az) * i) / k]);
    };
    pushSide(plot.x0, plot.z1, plot.x0, plot.z0);
    pushSide(plot.x0, plot.z0, plot.x1, plot.z0);
    pushSide(plot.x1, plot.z0, plot.x1, plot.z1);
    pushSide(plot.x1, plot.z1, plot.x0, plot.z1);
    const gateL = -6;
    const gateR = 6;
    const posts = at(0) ? Math.floor(per.length * p) : per.length;
    for (let i = 0; i < posts; i++) {
      const [x, z] = per[i];
      const front = Math.abs(z - plot.z1) < 0.01;
      if (front && x > gateL && x < gateR) continue;
      b.box('fence', 0.15, 2.4, 0.15, x, 1.4, z);
      const [nx, nz] = per[(i + 1) % per.length];
      if (i + 1 >= posts && at(0)) continue;
      const nfront = Math.abs(nz - plot.z1) < 0.01 && Math.abs(z - plot.z1) < 0.01;
      if (nfront && ((x <= gateL && nx > gateL) || (x >= gateR && nx < gateR) || (x > gateL && x < gateR))) continue;
      const len = Math.hypot(nx - x, nz - z);
      const ang = Math.atan2(nz - z, nx - x);
      for (const y of [1.0, 2.4]) b.box('fence', len, 0.08, 0.08, (x + nx) / 2, y, (z + nz) / 2, 0, -ang, 0);
      b.box('mesh', len, 1.5, 0.02, (x + nx) / 2, 1.7, (z + nz) / 2, 0, -ang, 0);
    }
    // Вагончик стройки (пока не готово)
    if (st < STAGES) {
      b.box('trailer', 10, 2.8, 3, plot.x1 - 9, 1.65, plot.z1 - 4);
      b.box('trailerWin', 6, 0.9, 0.05, plot.x1 - 9, 2.2, plot.z1 - 2.48);
    }
    // Экскаватор и кучи земли - на этапе «Участок»
    if (at(0)) {
      // Экскаватор и самосвал - в масштабе 1,6, чтобы читались с высоты макета
      const e = new GeoBatch();
      e.box('yellow', 3.2, 1.6, 2.4, 0, 1.3, 0);
      e.box('yellow', 1.8, 1.6, 1.8, -0.3, 2.8, -0.2);
      e.box('glass', 1.0, 0.9, 0.05, -0.3, 2.9, 0.72);
      e.box('track', 4.2, 0.8, 0.9, 0, 0.4, -1.1);
      e.box('track', 4.2, 0.8, 0.9, 0, 0.4, 1.1);
      e.box('yellow', 4.5, 0.4, 0.4, 3.4, 2.8, 0, 0, 0, -0.5);
      e.box('yellow', 0.4, 2.6, 0.4, 5.4, 1.8, 0, 0, 0, 0.3);
      e.box('steelDark', 1.2, 0.9, 1.2, 5.8, 0.6, 0);
      e.box('truckCab', 2.4, 2.4, 2.4, -9, 1.4, 4);
      e.box('yellow', 2.6, 1.6, 5, -9, 1.2, 0.2);
      e.box('dirt', 2.2, 0.6, 4.4, -9, 2.2, 0.2);
      for (const [wx, wz] of [[-10.2, 4], [-7.8, 4], [-10.2, -1.5], [-7.8, -1.5]] as const) e.cyl('tire', 0.55, 0.45, wx, 0.55, wz, 0, 0, Math.PI / 2, 10);
      const machines = meshesOf(e.build(), mat, true);
      machines.scale.setScalar(1.6);
      machines.position.set(-halls.w / 6, 0.25, 3);
      machines.rotation.y = 0.5;
      root.add(machines);
      for (let i = 0; i < 3; i++) b.add('dirt', new THREE.ConeGeometry(3.4 + i * 0.8, 2.6 + i * 0.5, 8), mtx(halls.w / 4 + i * 6, 1.4, -4 + i * 3));
    }
  }

  // ---------- Линия электропередачи и подстанция ----------
  const subX = plot.x0 + 12;
  const subZ = -blockD / 4;
  if (built && st >= 1) {
    const N = 4;
    const pylons = at(1) ? Math.max(1, Math.ceil(p * N)) : N;
    const prevPylons = pst ? (pst.stage > 1 ? N : pst.stage === 1 ? Math.max(1, Math.ceil(pst.progress * N)) : 0) : pylons;
    const tops: THREE.Vector3[] = [];
    for (let i = 0; i < pylons; i++) {
      const x = tile.x0 + 4 + i * ((subX - 8 - (tile.x0 + 4)) / (N - 1));
      const z = subZ + (N - 1 - i) * 3;
      const g = new GeoBatch();
      const H = 17;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box('pylon', 0.3, H, 0.3, sx * 1.1, H / 2, sz * 1.1, sz * 0.06, 0, -sx * 0.06);
      for (let k = 1; k < 5; k++) g.box('pylon', 2.4 - k * 0.25, 0.15, 2.4 - k * 0.25, 0, k * 3.2, 0);
      g.box('pylon', 0.25, 0.25, 9, 0, H - 2.5, 0);
      g.box('pylon', 0.25, 0.25, 6, 0, H - 0.6, 0);
      for (const zz of [-4.2, 0, 4.2]) g.box('insulator', 0.25, 0.9, 0.25, 0, H - 3.2, zz);
      const mesh = meshesOf(g.build(), mat, true);
      mesh.position.set(x, 0.2, z);
      root.add(mesh);
      growIfNew(mesh, !!pst && i >= prevPylons, (i - prevPylons) * 0.12);
      tops.push(new THREE.Vector3(x, 0.2 + H - 3.65, z));
    }
    // Провода между опорами и до подстанции
    const wireTo = (a: THREE.Vector3, c: THREE.Vector3) => {
      for (const dz of [-4.2, 0, 4.2]) {
        const s = new THREE.Vector3(a.x, a.y, a.z + dz);
        const e = new THREE.Vector3(c.x, c.y, c.z + dz);
        const len = s.distanceTo(e);
        const mid = s.clone().add(e).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), e.clone().sub(s).normalize());
        const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
        b.add('wire', new THREE.CylinderGeometry(0.06, 0.06, len, 4), m);
      }
    };
    for (let i = 0; i + 1 < tops.length; i++) wireTo(tops[i], tops[i + 1]);
    const subOn = done(1) || (at(1) && p >= 0.6);
    if (subOn) {
      if (tops.length === N) wireTo(tops[N - 1], new THREE.Vector3(subX - 4, 7, subZ));
      // Подстанция: площадка с гравием, трансформаторы, портал
      b.box('gravel', 16, 0.08, 20, subX, 0.3, subZ);
      for (let i = 0; i < 3; i++) {
        const z = subZ - 6 + i * 6;
        b.box('transformer', 4, 3.2, 3.4, subX + 1.5, 1.9, z);
        for (let k = 0; k < 6; k++) b.box('transformerFin', 0.12, 2.6, 3.0, subX - 0.6 - k * 0.25, 1.6, z);
        for (let k = 0; k < 3; k++) b.box('insulator', 0.3, 1.2, 0.3, subX + 0.5 + k, 4.1, z);
      }
      for (const z of [subZ - 9, subZ + 9]) b.box('pylon', 0.35, 8, 0.35, subX - 4, 4.2, z);
      b.box('pylon', 0.3, 0.3, 18, subX - 4, 8, subZ);
    }
  }

  // ---------- Здание ----------
  const H = halls.h;
  const wallMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: wallTex().clone(), roughness: 0.7, metalness: 0.15 });
  wallMat.map!.wrapS = wallMat.map!.wrapT = THREE.RepeatWrapping;
  wallMat.map!.repeat.set(halls.w / 4, 1);
  wallMat.map!.needsUpdate = true;
  const hallZ = (k: number) => -blockD / 2 + halls.d / 2 + k * (halls.d + HALL_GAP);
  const hallProgress = (k: number, stage: number, prog: number) =>
    stage > 2 ? 1 : stage === 2 ? Math.max(0, Math.min(1, prog * halls.n - k)) : 0;
  const ready = st >= STAGES;
  if (built && st >= 2) {
    for (let k = 0; k < halls.n; k++) {
      const hz = hallZ(k);
      const hp = hallProgress(k, st, p);
      const php = pst ? hallProgress(k, pst.stage, pst.progress) : hp;
      // Плита фундамента
      b.box('slab', halls.w + 2, 0.5, halls.d + 2, 0, 0.45, hz);
      if (hp <= 0) continue;
      // Колонны каркаса
      for (let x = -halls.w / 2; x <= halls.w / 2 + 0.01; x += halls.w / Math.round(halls.w / 7)) {
        for (const z of [hz - halls.d / 2, hz + halls.d / 2]) b.box('steel', 0.45, H, 0.45, x, 0.7 + H / 2, z);
      }
      // Стены: растут снизу вверх, на готовом дата-центре - без крыши (видно зал)
      const wall = new THREE.Group();
      const wh = H * hp;
      const addWall = (w: number, d: number, x: number, z: number, height = wh) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), wallMat);
        m.scale.y = height;
        m.position.set(x, 0.7 + height / 2, z);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.wallH = height;
        wall.add(m);
      };
      addWall(halls.w, 0.35, 0, hz - halls.d / 2);
      // У готового зала передняя стена срезана, как на макете в разрезе: видно ряды стоек
      addWall(halls.w, 0.35, 0, hz + halls.d / 2, ready ? Math.min(wh, 2.4) : wh);
      addWall(0.35, halls.d, -halls.w / 2, hz);
      addWall(0.35, halls.d, halls.w / 2, hz);
      root.add(wall);
      if (pst && hp > php + 1e-6) {
        const from = php / hp;
        for (const m of wall.children) grows.push({ obj: m, from, delay: 0 });
      }
      // Крыша на этапе «Охлаждение»; у готового - только парапет, зал открыт
      if (st === 3) b.box('roof', halls.w + 0.6, 0.4, halls.d + 0.6, 0, 0.7 + H + 0.2, hz);
      if (ready) {
        b.box('parapet', halls.w + 0.7, 0.5, 0.5, 0, 0.7 + H + 0.25, hz - halls.d / 2);
        b.box('parapet', 0.5, 0.5, halls.d, -halls.w / 2, 0.7 + H + 0.25, hz);
        b.box('parapet', 0.5, 0.5, halls.d, halls.w / 2, 0.7 + H + 0.25, hz);
        b.box('hallFloor', halls.w - 0.4, 0.05, halls.d - 0.4, 0, 0.73, hz);
      }
      // Ворота погрузки на передней стене первого зала
      if (k === halls.n - 1 && hp >= 1) {
        for (const x of [-halls.w / 4, halls.w / 4]) b.box('door', 4.5, 4.6, 0.1, x, 0.7 + 2.3, hz + halls.d / 2 + 0.2);
      }
    }
    // Башенный кран, пока строится здание
    if (at(2)) {
      const k = Math.min(halls.n - 1, Math.floor(p * halls.n));
      const cx = halls.w / 2 + 6;
      const cz = hallZ(k);
      const CH = H + 16;
      b.box('crane', 1.6, CH, 1.6, cx, 0.7 + CH / 2, cz);
      for (let y = 2; y < CH; y += 2) b.box('craneDark', 1.65, 0.12, 1.65, cx, 0.7 + y, cz);
      b.box('crane', 30, 1.0, 1.0, cx - 10, 0.7 + CH - 0.5, cz);
      b.box('craneDark', 3, 2, 2.6, cx + 5, 0.7 + CH - 1.5, cz);
      b.box('glass', 1.6, 1.4, 1.6, cx + 0.2, 0.7 + CH - 2.4, cz + 1.2);
      b.box('wire', 0.06, 8, 0.06, cx - 18, 0.7 + CH - 4.5, cz);
      b.box('steel', 3, 0.5, 0.5, cx - 18, 0.7 + CH - 8.6, cz);
    }
  }

  // ---------- Охлаждение: чиллеры во дворе и генераторы ----------
  const chillers = halls.n * 6;
  if (built && st >= 3) {
    const count = at(3) ? Math.ceil(p * chillers) : chillers;
    const prevCount = pst ? (pst.stage > 3 ? chillers : pst.stage === 3 ? Math.ceil(pst.progress * chillers) : 0) : count;
    const yardX = halls.w / 2 + 8;
    for (let i = 0; i < count; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const g = new GeoBatch();
      g.box('chiller', 6, 2.4, 2.6, 0, 1.4, 0);
      for (let f = 0; f < 3; f++) {
        g.cyl('fanRing', 0.95, 0.12, -2 + f * 2, 2.66, 0, 0, 0, 0, 16);
        g.cyl('fanHole', 0.82, 0.14, -2 + f * 2, 2.67, 0, 0, 0, 0, 16);
      }
      const mesh = meshesOf(g.build(), mat, true);
      mesh.position.set(yardX + 3.5 + col * 7.5, 0.2, -blockD / 2 + 3 + row * 3.6);
      root.add(mesh);
      growIfNew(mesh, !!pst && i >= prevCount, (i - prevCount) * 0.06);
    }
    if (done(3) || p >= 0.5) {
      for (let i = 0; i < halls.n * 2; i++) {
        b.box('generator', 7, 3, 2.8, yardX + 7, 1.7, blockD / 2 - 1 - i * 3.6 + 2);
        b.cyl('steelDark', 0.3, 1.6, yardX + 9.5, 3.9, blockD / 2 - 1 - i * 3.6 + 2, 0, 0, 0, 8);
      }
    }
  }

  // ---------- Готовый дата-центр: стойки внутри, стоянка, грузовики ----------
  let racksMesh: THREE.InstancedMesh[] = [];
  const rackGrow: { mesh: THREE.InstancedMesh; index: number; base: THREE.Matrix4; order: number }[] = [];
  if (ready) {
    const rowsPerHall = Math.max(1, Math.floor((halls.d - 4) / 2.6));
    const perRow = Math.max(1, Math.floor((halls.w - 6) / 0.64));
    const slots: THREE.Vector3[] = [];
    for (let k = halls.n - 1; k >= 0; k--) {
      for (let r = 0; r < rowsPerHall; r++) {
        for (let c = 0; c < perRow; c++) {
          slots.push(new THREE.Vector3(-((perRow - 1) * 0.64) / 2 + c * 0.64, 0.75, hallZ(k) + halls.d / 2 - 2.6 - r * 2.6));
        }
      }
    }
    const total = Math.round(spec.fill * slots.length);
    const prevTotal = pst && pst.stage >= STAGES ? Math.round(pst.fill * slots.length) : total;
    // Цвет поколения по долям карт
    const mixTotal = spec.mix.reduce((n, g) => n + g.cards, 0) || 1;
    const gens: GpuId[] = [];
    let acc = 0;
    for (const g of spec.mix) {
      const upto = Math.round(((acc + g.cards) / mixTotal) * total);
      while (gens.length < upto) gens.push(g.gpu);
      acc += g.cards;
    }
    while (gens.length < total) gens.push(spec.mix[spec.mix.length - 1]?.gpu ?? 'p100');
    const byGen = new Map<GpuId, number[]>();
    gens.forEach((g, i) => byGen.set(g, [...(byGen.get(g) ?? []), i]));
    const body = new THREE.BoxGeometry(0.6, 2.0, 1.1);
    body.translate(0, 1.0, 0);
    const cap = new THREE.BoxGeometry(0.6, 0.06, 1.1);
    cap.translate(0, 2.03, 0);
    const front = new THREE.BoxGeometry(0.5, 1.6, 0.02);
    front.translate(0, 1.0, 0.56);
    const bodyMesh = new THREE.InstancedMesh(body, pbr('#15171b', 0.5, 0.55), Math.max(1, total));
    bodyMesh.count = total;
    racksMesh.push(bodyMesh);
    for (let i = 0; i < total; i++) {
      const m = mtx(slots[i].x, slots[i].y, slots[i].z);
      bodyMesh.setMatrixAt(i, m);
      if (i >= prevTotal) rackGrow.push({ mesh: bodyMesh, index: i, base: m, order: i - prevTotal });
    }
    for (const [g, idx] of byGen) {
      // Верх стойки чёрный, лицевые панели серверов - цвета поколения, без подсветки
      const capMesh = new THREE.InstancedMesh(cap, pbr('#202226', 0.5, 0.55), idx.length);
      const frontMesh = new THREE.InstancedMesh(front, pbr(GPU_LOOK[g].bezel, 0.6, 0.4), idx.length);
      idx.forEach((i, j) => {
        const m = mtx(slots[i].x, slots[i].y, slots[i].z);
        capMesh.setMatrixAt(j, m);
        frontMesh.setMatrixAt(j, m);
        if (i >= prevTotal) {
          rackGrow.push({ mesh: capMesh, index: j, base: m, order: i - prevTotal });
          rackGrow.push({ mesh: frontMesh, index: j, base: m, order: i - prevTotal });
        }
      });
      racksMesh.push(capMesh, frontMesh);
    }
    for (const m of racksMesh) {
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = true;
      m.receiveShadow = true;
      m.computeBoundingSphere();
      root.add(m);
    }
    // Стоянка с машинами у ворот
    const lotZ = blockD / 2 + 12;
    b.box('asphalt', 30, 0.05, 12, -halls.w / 2 + 16, 0.28, lotZ);
    const r = rng(41);
    const carColors = ['carRed', 'carBlue', 'carWhite', 'carGrey'];
    for (let i = 0; i < 7; i++) {
      if (r() < 0.25) continue;
      const x = -halls.w / 2 + 5 + i * 3.6;
      const c = carColors[Math.floor(r() * carColors.length)];
      b.box(c, 1.9, 0.8, 4.2, x, 0.75, lotZ - 2.5);
      b.box(c, 1.7, 0.6, 2.2, x, 1.45, lotZ - 2.7);
      b.box('glass', 1.72, 0.45, 2.0, x, 1.45, lotZ - 2.7);
    }
  }
  // Грузовики с картами у ворот (заказы в пути)
  if (ready && spec.trucks > 0) {
    const dockZ = blockD / 2 + 9;
    for (let i = 0; i < spec.trucks; i++) {
      const x = halls.w / 4 - i * 9 + 6;
      b.box('truckBox', 2.5, 3.0, 9, x, 2.0, dockZ + 4.5);
      b.box('truckCab', 2.5, 2.6, 2.4, x, 1.8, dockZ + 10.4);
      b.box('glass', 2.3, 0.9, 0.05, x, 2.5, dockZ + 11.62);
      for (const wz of [dockZ + 1.5, dockZ + 7, dockZ + 10.5]) for (const sx of [-1, 1]) b.cyl('tire', 0.5, 0.4, x + sx * 1.15, 0.7, wz, 0, 0, Math.PI / 2, 10);
    }
  }

  // ---------- Сборка статики ----------
  const statics = meshesOf(b.build(), mat, true);
  root.add(statics);

  // ---------- Свет ----------
  root.add(new THREE.HemisphereLight('#ffffff', '#6b6355', 1.25));
  const sun = new THREE.DirectionalLight('#fff3df', 2.6);
  const ext = Math.max(tw, td);
  sun.position.set(tcx - ext * 0.35, ext * 0.8, tcz + ext * 0.55);
  sun.target.position.set(tcx, 0, tcz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -ext * 0.7;
  sc.right = ext * 0.7;
  sc.top = ext * 0.7;
  sc.bottom = -ext * 0.7;
  sc.near = 1;
  sc.far = ext * 3;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  root.add(sun, sun.target);

  // ---------- Анимация: новые элементы растут, новые стойки поднимаются ----------
  const DUR = 0.7;
  const targets = grows.map((g) => ({ ...g, sy: g.obj.scale.y, y: g.obj.position.y }));
  const rackStagger = Math.min(0.004, 0.8 / Math.max(1, rackGrow.length / 3));
  const tmp = new THREE.Matrix4();
  const animate =
    targets.length || rackGrow.length
      ? (t: number) => {
          let going = false;
          for (const g of targets) {
            const k = Math.max(0, Math.min(1, (t - g.delay) / DUR));
            if (k < 1) going = true;
            const e = 1 - Math.pow(1 - k, 3);
            const s = g.from + (1 - g.from) * e;
            g.obj.scale.y = Math.max(0.001, g.sy * s);
            const wh = g.obj.userData.wallH as number | undefined;
            if (wh !== undefined) g.obj.position.y = 0.7 + (wh * s) / 2;
          }
          const touched = new Set<THREE.InstancedMesh>();
          for (const r of rackGrow) {
            const k = Math.max(0, Math.min(1, (t - r.order * rackStagger) / 0.45));
            if (k < 1) going = true;
            tmp.copy(r.base);
            const e = 1 - Math.pow(1 - k, 3);
            tmp.multiply(new THREE.Matrix4().makeScale(1, Math.max(0.001, e), 1));
            r.mesh.setMatrixAt(r.index, tmp);
            touched.add(r.mesh);
          }
          for (const m of touched) m.instanceMatrix.needsUpdate = true;
          return going;
        }
      : undefined;
  if (animate) animate(0);

  const box = new THREE.Box3(new THREE.Vector3(tile.x0, -3, tile.z0), new THREE.Vector3(tile.x1, Math.max(12, H + 4), tile.z1));
  return {
    root,
    framing: {
      target: new THREE.Vector3(tcx, 2, tcz),
      fit: { box },
      yaw: -0.55,
      pitch: ready ? 0.78 : 0.62,
      minPitch: 0.3,
      maxPitch: 1.35,
      yawLimit: 1.3,
      fov: 30,
      fill: 0.96,
    },
    background: look.sky,
    envIntensity: 0.6,
    shadows: true,
    animate,
    dispose: () => {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const m of racksMesh) m.dispose();
      racksMesh = [];
      wallMat.map?.dispose();
      wallMat.dispose();
      sun.shadow.map?.dispose();
    },
  };

  function mat(key: string): THREE.Material {
    switch (key) {
      case 'tileSide':
        return pbr(look.side, 0, 0.95);
      case 'ground':
        return pbr(look.ground, 0, 0.95);
      case 'water':
        return pbr('#4d7ea6', 0.1, 0.25);
      case 'pad':
        return pbr(look.pad, 0, 0.95);
      case 'flora':
        return pbr(look.floraColor, 0, 0.85, { flatShading: true });
      case 'trunk':
        return pbr('#5a4330', 0, 0.9);
      case 'snowCap':
        return pbr(look.snow ? '#f4f7fa' : look.floraColor, 0, 0.8, { flatShading: true });
      case 'rock':
        return pbr('#9b8f7b', 0, 0.9, { flatShading: true });
      case 'stake':
      case 'post':
        return pbr('#8a6a45', 0, 0.8);
      case 'flag':
      case 'tape':
        return pbr('#ee7a2a', 0, 0.7);
      case 'signStripe':
        return pbr('#2f80e4', 0, 0.6);
      case 'sign':
        return pbr('#f2f3f4', 0, 0.6);
      case 'fence':
        return pbr('#9aa1a9', 0.8, 0.4);
      case 'mesh':
        return pbr('#aab1b9', 0.6, 0.5, { transparent: true, opacity: 0.35 });
      case 'trailer':
        return pbr('#e9e4d8', 0.1, 0.7);
      case 'trailerWin':
      case 'glass':
        return pbr('#2a3b4f', 0.4, 0.15);
      case 'yellow':
        return pbr('#e3b12b', 0.3, 0.5);
      case 'track':
        return pbr('#2a2b2e', 0.3, 0.8);
      case 'dirt':
        return pbr('#8b6b4a', 0, 0.95, { flatShading: true });
      case 'pylon':
        return pbr('#8d949c', 0.8, 0.45);
      case 'insulator':
        return pbr('#6d8296', 0.3, 0.3);
      case 'wire':
        return pbr('#30343a', 0.6, 0.5);
      case 'gravel':
        return pbr('#a7a59f', 0, 0.95);
      case 'transformer':
        return pbr('#6f7c70', 0.5, 0.55);
      case 'transformerFin':
        return pbr('#5d695e', 0.5, 0.6);
      case 'slab':
        return pbr('#b1ada4', 0, 0.9);
      case 'steel':
        return pbr('#6d737b', 0.8, 0.45);
      case 'steelDark':
        return pbr('#3a3e44', 0.7, 0.5);
      case 'roof':
        return pbr('#9aa0a7', 0.4, 0.7);
      case 'parapet':
        return pbr('#c3c8ce', 0.3, 0.7);
      case 'hallFloor':
        return pbr('#4a4f57', 0.2, 0.8);
      case 'door':
        return pbr('#7c838c', 0.7, 0.4);
      case 'crane':
        return pbr('#e0b028', 0.4, 0.5);
      case 'craneDark':
        return pbr('#3d3a33', 0.4, 0.6);
      case 'chiller':
        return pbr('#e6e9ec', 0.3, 0.55);
      case 'fanRing':
        return pbr('#9aa1a9', 0.6, 0.4);
      case 'fanHole':
        return pbr('#1c1e22', 0.2, 0.7);
      case 'generator':
        return pbr('#d9dcd5', 0.3, 0.6);
      case 'asphalt':
        return pbr('#3b3e43', 0, 0.9);
      case 'carRed':
        return pbr('#b8443a', 0.5, 0.35);
      case 'carBlue':
        return pbr('#3d64a8', 0.5, 0.35);
      case 'carWhite':
        return pbr('#e9ebee', 0.5, 0.35);
      case 'carGrey':
        return pbr('#7b8087', 0.5, 0.35);
      case 'truckBox':
        return pbr('#f1f2f3', 0.2, 0.6);
      case 'truckCab':
        return pbr('#2f6fb3', 0.5, 0.4);
      case 'tire':
        return pbr('#141518', 0, 0.9);
      default:
        return pbr('#888');
    }
  }
}
