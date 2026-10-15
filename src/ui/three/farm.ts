// Ферма карт: машинный зал со стойками. В стойке 4 сервера по 8 карт; серверы карт PCIe высотой 4U,
// серверы модулей с высокими радиаторами - 8U, поэтому стойки новых поколений заполнены плотнее.
// Лицевая панель сервера - цвета поколения (графит, золото, бронза, серебро, чёрный с медью).
// У первой стойки верхний сервер выдвинут: видно 8 карт внутри. Новые стойки опускаются сверху (0,6 с).
// Стойки и серверы рисуются через InstancedMesh: сотни стоек - десяток вызовов отрисовки.

import * as THREE from 'three';
import type { GpuId } from '../../sim/types';
import type { Content } from './engine';
import { GPU_LOOK } from './gpuLook';
import { GeoBatch, canvasTex, glow, mtx, pbr } from './kit';
import { farmLayout, type FarmRack, type FarmSpec } from './specs';

/** Стойка, м: ширина, высота, глубина. */
const RW = 0.6;
const RH = 2.0;
const RD = 1.1;
const U = 0.0445;
/** Низ первого сервера и верх рабочей зоны стойки. */
const SLOT0 = 0.12;
const SLOT_TOP = 1.86;
const FRONT = RD / 2;
/** Шаг стоек в ряду и шаг рядов (стойка + проход). */
const PITCH_X = RW + 0.02;
const PITCH_Z = RD + 1.8;

function serverU(gpu: GpuId): number {
  return GPU_LOOK[gpu].form === 'module' ? 8 : 4;
}

// ---------- Геометрия частей (кэш) ----------

type Parts = Map<string, THREE.BufferGeometry>;
const partsCache = new Map<string, Parts>();

function cachedParts(key: string, make: () => Parts): Parts {
  let p = partsCache.get(key);
  if (!p) {
    p = make();
    partsCache.set(key, p);
  }
  return p;
}

/** Корпус стойки: стойки рамы, боковые стенки, крыша, цоколь, тёмная задняя стенка. */
function rackParts(): Parts {
  return cachedParts('rack', () => {
    const b = new GeoBatch();
    const t = 0.04;
    for (const sx of [-1, 1]) {
      b.box('rackSide', 0.02, RH - 0.08, RD - 0.04, sx * (RW / 2 - 0.01), RH / 2, 0);
      for (const sz of [-1, 1]) b.box('rackFrame', t, RH, t, sx * (RW / 2 - t / 2), RH / 2, sz * (RD / 2 - t / 2));
      // Монтажные рейки с отверстиями видны по краям лицевой стороны
      b.box('rackRail', 0.03, SLOT_TOP - SLOT0 + 0.04, 0.01, sx * (RW / 2 - 0.045), (SLOT0 + SLOT_TOP) / 2, FRONT - 0.035);
    }
    b.box('rackFrame', RW, 0.05, RD, 0, RH - 0.025, 0);
    b.box('rackFrame', RW, 0.1, RD, 0, 0.05, 0);
    b.box('rackInner', RW - 0.06, SLOT_TOP - SLOT0, 0.01, 0, (SLOT0 + SLOT_TOP) / 2, -RD / 2 + 0.06);
    // Кабельный лоток на крыше
    b.box('rackRail', RW * 0.7, 0.03, 0.12, 0, RH + 0.015, -RD / 2 + 0.2);
    return b.build();
  });
}

/** Коммутатор 1U наверху стойки: чёрный, с рядом зелёных огоньков. */
function switchParts(): Parts {
  return cachedParts('switch', () => {
    const b = new GeoBatch();
    b.box('switch', RW - 0.08, U - 0.004, 0.02, 0, U / 2, 0.01);
    for (let i = 0; i < 12; i++) b.box('ledGreen', 0.012, 0.006, 0.004, -0.2 + i * 0.026, U * 0.62, 0.022);
    for (let i = 0; i < 12; i++) b.box('portDark', 0.016, 0.01, 0.004, -0.2 + i * 0.026, U * 0.3, 0.022);
    return b.build();
  });
}

/** Заглушка пустых юнитов: высота 1 (масштабируется по y). */
function blankParts(): Parts {
  return cachedParts('blank', () => {
    const b = new GeoBatch();
    b.box('blank', RW - 0.08, 1, 0.012, 0, 0.5, 0.006);
    return b.build();
  });
}

/** Лицевая панель сервера своего поколения (начало координат - низ по центру, лицо на z = 0). */
function serverParts(gpu: GpuId): Parts {
  return cachedParts(`server-${gpu}`, () => {
    const look = GPU_LOOK[gpu];
    const h = serverU(gpu) * U - 0.004;
    const w = RW - 0.08;
    const b = new GeoBatch();
    b.box(`face-${gpu}`, w, h, 0.02, 0, h / 2, 0.01);
    // Ушки с ручками
    for (const sx of [-1, 1]) {
      b.box('handle', 0.012, h * 0.6, 0.02, sx * (w / 2 - 0.02), h / 2, 0.03);
    }
    if (look.form === 'pcie') {
      // Сверху отсеки дисков, ниже решётка вентиляторов
      for (let i = 0; i < 8; i++) b.box('bay', 0.052, h * 0.24, 0.006, -0.2 + i * 0.057, h * 0.8, 0.021);
      b.box('grille', w - 0.1, h * 0.46, 0.006, 0, h * 0.34, 0.021);
      for (let i = 0; i < 5; i++) b.box(`trim-${gpu}`, w - 0.12, 0.004, 0.004, 0, h * 0.16 + i * h * 0.08, 0.025);
      b.box('ledGreen', 0.008, 0.008, 0.004, w / 2 - 0.045, h * 0.8, 0.024);
      b.box('ledBlue', 0.008, 0.008, 0.004, w / 2 - 0.06, h * 0.8, 0.024);
    } else {
      // Большая решётка во всю панель, ряд лотков для дисков снизу, два огонька состояния
      b.box('grille', w - 0.08, h * 0.6, 0.006, 0, h * 0.5, 0.021);
      for (let i = 0; i < 9; i++) b.box(`trim-${gpu}`, 0.004, h * 0.58, 0.004, -0.2 + i * 0.05, h * 0.5, 0.025);
      for (let i = 0; i < 6; i++) b.box('bay', 0.06, h * 0.08, 0.006, -0.17 + i * 0.068, h * 0.1, 0.021);
      b.box('ledGreen', 0.008, 0.008, 0.004, w / 2 - 0.045, h * 0.88, 0.024);
      b.box('ledBlue', 0.008, 0.008, 0.004, w / 2 - 0.06, h * 0.88, 0.024);
    }
    return b.build();
  });
}

/** Выдвинутый сервер с 8 картами внутри (начало - низ по центру лицевой панели). */
function openServer(gpu: GpuId): THREE.Group {
  const look = GPU_LOOK[gpu];
  const h = serverU(gpu) * U - 0.004;
  const w = RW - 0.08;
  const depth = 0.78;
  const b = new GeoBatch();
  // Шасси без крышки: дно, борта, задняя стенка
  b.box('chassis', w, 0.006, depth, 0, 0.003, -depth / 2);
  for (const sx of [-1, 1]) b.box('chassis', 0.006, h, depth, sx * (w / 2 - 0.003), h / 2, -depth / 2);
  b.box('chassis', w, h, 0.006, 0, h / 2, -depth + 0.003);
  // Вентиляторы поперёк шасси
  for (let i = 0; i < 6; i++) b.cyl('fanDark', 0.03, 0.02, -0.21 + i * 0.084, h * 0.45, -depth + 0.12, Math.PI / 2, 0, 0, 14);
  const shell = `card-${gpu}`;
  const trim = `trim-${gpu}`;
  if (look.form === 'pcie') {
    // 8 карт стоят в ряд, длинной стороной вдоль сервера
    const [l, hh, t] = look.size.map((v) => v / 100) as [number, number, number];
    for (let i = 0; i < 8; i++) {
      const x = -0.19 + i * 0.054;
      b.box('pcb', 0.004, hh * 0.92, l, x - t / 2 - 0.002, hh / 2 + 0.01, -0.12 - l / 2);
      b.box(shell, t, hh * 0.86, l, x, hh * 0.46 + 0.012, -0.12 - l / 2);
      b.box(trim, 0.002, hh * 0.4, l * 0.7, x + t / 2 + 0.001, hh * 0.46 + 0.012, -0.12 - l / 2);
    }
  } else {
    // 8 модулей с радиаторами на плате: 2 × 4
    // Модуль: длина по x, глубина по z, высота радиатора
    const [l, d, t] = look.size.map((v) => v / 100) as [number, number, number];
    b.box('pcb', w - 0.04, 0.01, depth - 0.24, 0, 0.01, -0.12 - (depth - 0.24) / 2);
    for (let ix = 0; ix < 2; ix++) {
      for (let iz = 0; iz < 4; iz++) {
        const x = -0.08 + ix * 0.165;
        const z = -0.17 - iz * 0.125;
        b.box('copper', l * 0.96, 0.012, d * 0.95, x, 0.02, z);
        b.box(shell, l * 0.98, t * 0.92, d, x, 0.026 + (t * 0.92) / 2, z);
        b.box(trim, l * 0.6, 0.003, d * 0.6, x, 0.026 + t * 0.92 + 0.002, z);
      }
    }
  }
  const g = new THREE.Group();
  for (const [k, geo] of b.build()) {
    const m = new THREE.Mesh(geo, partMaterial(k));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  // Лицевая панель выдвинутого сервера
  for (const [k, geo] of serverParts(gpu)) {
    const m = new THREE.Mesh(geo, partMaterial(k));
    m.userData.shared = true;
    g.add(m);
  }
  return g;
}

// ---------- Материалы ----------

function partMaterial(key: string): THREE.Material {
  // Планка задачи на стойке: плоский цвет доли мощности, без свечения.
  const task = /^task-(#[0-9a-f]{6})$/i.exec(key);
  if (task) return pbr(task[1], 0.1, 0.55);
  const gen = /^(face|trim|card)-(\w+)$/.exec(key);
  if (gen) {
    const look = GPU_LOOK[gen[2] as GpuId];
    if (gen[1] === 'face') return pbr(look.bezel, 0.75, 0.38);
    if (gen[1] === 'card') return pbr(look.shell, 0.8, 0.36);
    return pbr(look.trim, 0.6, 0.4);
  }
  switch (key) {
    case 'rackFrame':
      return pbr('#16181c', 0.6, 0.5);
    case 'rackSide':
      return pbr('#262a31', 0.5, 0.55);
    case 'rackRail':
      return pbr('#3b4048', 0.7, 0.45);
    case 'rackInner':
      return pbr('#0c0d10', 0.2, 0.8);
    case 'switch':
      return pbr('#121316', 0.4, 0.5);
    case 'ledGreen':
      return glow('#3ccf6b', 1);
    case 'ledBlue':
      return glow('#4aa3ff', 0.9);
    case 'tray':
      return pbr('#e2b72c', 0.2, 0.55);
    case 'rod':
      return pbr('#8c9198', 0.8, 0.4);
    case 'portDark':
      return pbr('#050506', 0, 0.8);
    case 'blank':
      return pbr('#1d2026', 0.5, 0.6);
    case 'handle':
      return pbr('#9ea4ab', 0.9, 0.3);
    case 'bay':
      return pbr('#101114', 0.3, 0.6);
    case 'grille':
      return pbr('#0e0f12', 0.3, 0.7);
    case 'chassis':
      return pbr('#7d838b', 0.85, 0.4);
    case 'fanDark':
      return pbr('#15171a', 0.2, 0.6);
    case 'pcb':
      return pbr('#15201a', 0.15, 0.65);
    case 'copper':
      return pbr('#c47a4c', 1, 0.3);
    default:
      return pbr('#555');
  }
}

/** Плитки фальшпола: серые квадраты 60 см со швами, в проходах - перфорированные. */
function floorTex(): THREE.CanvasTexture {
  return canvasTex(
    'farm-floor',
    256,
    512,
    (g, w, h) => {
      g.fillStyle = '#a3a8af';
      g.fillRect(0, 0, w, h);
      const tile = w;
      for (let i = 0; i < 2; i++) {
        const y = i * tile;
        g.fillStyle = i === 0 ? '#c9cdd2' : '#c2c6cc';
        g.fillRect(3, y + 3, tile - 6, tile - 6);
        if (i === 1) {
          g.fillStyle = '#9da3aa';
          for (let a = 0; a < 12; a++) for (let c = 0; c < 12; c++) g.fillRect(20 + c * 19, y + 20 + a * 19, 8, 8);
        }
      }
    },
    { repeat: [1, 1] },
  );
}

// ---------- Сборка зала ----------

/** Цвет задачи для каждой стойки: стойки по порядку делятся между долями пропорционально (первые - первой доле). */
function rackTasks(tasks: { color: string; share: number }[] | undefined, n: number): (string | null)[] {
  const out: (string | null)[] = new Array(n).fill(null);
  const live = (tasks ?? []).filter((t) => t.share > 0);
  const sum = live.reduce((a, t) => a + t.share, 0);
  if (n === 0 || sum <= 0) return out;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * sum;
    let acc = 0;
    for (const t of live) {
      acc += t.share;
      if (x <= acc) {
        out[i] = t.color;
        break;
      }
    }
    out[i] ??= live[live.length - 1].color;
  }
  return out;
}

/** Планка над серверами на лицевой стороне стойки: во всю ширину, 9 см. */
function taskParts(color: string): Parts {
  return cachedParts(`task-${color}`, () => {
    const b = new GeoBatch();
    b.box(`task-${color}`, RW - 0.04, 0.09, 0.012, 0, 0.045, 0);
    return b.build();
  });
}

interface Slot {
  mesh: THREE.InstancedMesh;
  index: number;
  base: THREE.Matrix4;
  rack: number;
}

function columnsFor(n: number, wide: boolean): number {
  return Math.min(wide ? 40 : 24, Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * (wide ? 7 : 2.4))))));
}

/** Сколько стоек каждого поколения было на схеме раньше: новые стойки сверх этого числа опускаются сверху. */
function countsByGpu(racks: FarmRack[]): Map<GpuId, number> {
  const m = new Map<GpuId, number>();
  for (const r of racks) m.set(r.gpu, (m.get(r.gpu) ?? 0) + 1);
  return m;
}

export function buildFarm(spec: FarmSpec, prev: FarmSpec | null): Content {
  const layout = farmLayout(spec.groups);
  const racks = layout.racks;
  const root = new THREE.Group();
  const n = racks.length;
  const cols = columnsFor(Math.max(1, n), !!spec.wide);
  const pos = racks.map((_, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    return new THREE.Vector3((c - (inRow - 1) / 2) * PITCH_X, 0, -r * PITCH_Z);
  });

  // Какие стойки новые (для анимации)
  const prevCounts = prev ? countsByGpu(farmLayout(prev.groups).racks) : null;
  const seen = new Map<GpuId, number>();
  const fresh = racks.map((r) => {
    const k = (seen.get(r.gpu) ?? 0) + 1;
    seen.set(r.gpu, k);
    return prevCounts !== null && layout.scale === 1 && k > (prevCounts.get(r.gpu) ?? 0);
  });

  // Выдвинутый сервер: верхний в первой стойке (если стоек немного и масштаб 1:1)
  const openRack = n > 0 && n <= 160 && layout.scale === 1 ? 0 : -1;

  // Сбор экземпляров: ключ «часть|материал» → список (матрица, стойка)
  const inst = new Map<string, { geo: THREE.BufferGeometry; mat: string; items: { m: THREE.Matrix4; rack: number }[] }>();
  const put = (parts: Parts, partKey: string, m: THREE.Matrix4, rack: number) => {
    for (const [mat, geo] of parts) {
      const key = `${partKey}|${mat}`;
      let e = inst.get(key);
      if (!e) {
        e = { geo, mat, items: [] };
        inst.set(key, e);
      }
      e.items.push({ m, rack });
    }
  };
  const rp = rackParts();
  const sp = switchParts();
  const bp = blankParts();
  const taskOf = rackTasks(spec.tasks, n);
  racks.forEach((r, i) => {
    const p = pos[i];
    put(rp, 'rack', mtx(p.x, 0, p.z), i);
    put(sp, 'switch', mtx(p.x, SLOT_TOP - U, p.z + FRONT - 0.02), i);
    const h = serverU(r.gpu) * U;
    for (let k = 0; k < r.servers; k++) {
      if (i === openRack && k === r.servers - 1) continue;
      put(serverParts(r.gpu), `server-${r.gpu}`, mtx(p.x, SLOT0 + k * h, p.z + FRONT - 0.02), i);
    }
    const color = taskOf[i];
    if (color) put(taskParts(color), `task-${color}`, mtx(p.x, SLOT_TOP + 0.02, p.z + FRONT + 0.004), i);
    const used = SLOT0 + r.servers * h;
    const blankH = SLOT_TOP - U - used;
    if (blankH > 0.01) put(bp, 'blank', mtx(p.x, used, p.z + FRONT - 0.02, 0, 0, 0, 1, blankH, 1), i);
  });

  const slots: Slot[] = [];
  for (const e of inst.values()) {
    const mesh = new THREE.InstancedMesh(e.geo, partMaterial(e.mat), e.items.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.shared = true;
    e.items.forEach((it, idx) => {
      mesh.setMatrixAt(idx, it.m);
      if (fresh[it.rack]) slots.push({ mesh, index: idx, base: it.m, rack: it.rack });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
  }

  // Над каждым рядом - жёлтый лоток для оптики на стойках (лестничный лоток поверх ряда, как в настоящих залах)
  {
    const rowsZ = [...new Set(pos.map((p) => p.z))];
    const tb = new GeoBatch();
    for (const z of rowsZ) {
      const xs = pos.filter((p) => p.z === z).map((p) => p.x);
      const x0 = Math.min(...xs) - RW / 2 + 0.05;
      const x1 = Math.max(...xs) + RW / 2 - 0.05;
      const ty = RH + 0.14;
      const tz = z - 0.2;
      tb.box('tray', x1 - x0, 0.015, 0.3, (x0 + x1) / 2, ty, tz);
      for (const sz of [-1, 1]) tb.box('tray', x1 - x0, 0.07, 0.012, (x0 + x1) / 2, ty + 0.035, tz + sz * 0.15);
      for (const x of xs) tb.box('rod', 0.03, 0.12, 0.03, x, RH + 0.07, tz);
    }
    if (rowsZ.length) {
      for (const [k, geo] of tb.build()) {
        const m = new THREE.Mesh(geo, partMaterial(k));
        m.castShadow = true;
        root.add(m);
      }
    }
  }

  // Пустая ферма: пунктирный контур места под первую стойку
  if (n === 0) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(RW, RH, RD));
    const line = new THREE.LineSegments(edges, new THREE.LineDashedMaterial({ color: '#5d636c', dashSize: 0.12, gapSize: 0.08 }));
    line.computeLineDistances();
    line.position.set(0, RH / 2, 0);
    root.add(line);
  }

  let open: THREE.Group | null = null;
  if (openRack === 0) {
    const r = racks[0];
    const h = serverU(r.gpu) * U;
    open = openServer(r.gpu);
    open.position.set(pos[0].x, SLOT0 + (r.servers - 1) * h, pos[0].z + FRONT - 0.02 + 0.5);
    root.add(open);
  }

  // Пол
  const span = new THREE.Box3();
  for (const p of pos) span.expandByPoint(p);
  if (n === 0) span.expandByPoint(new THREE.Vector3());
  const fw = span.max.x - span.min.x + RW + 3;
  const fd = span.max.z - span.min.z + RD + 3.4;
  const floorMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0.1, map: floorTex().clone() });
  floorMat.map!.wrapS = floorMat.map!.wrapT = THREE.RepeatWrapping;
  floorMat.map!.repeat.set(fw / 0.6, fd / 1.2);
  floorMat.map!.needsUpdate = true;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((span.min.x + span.max.x) / 2, 0, (span.min.z + span.max.z) / 2 + 0.25);
  floor.receiveShadow = true;
  root.add(floor);

  // Свет: холодный общий, тёплый ключевой с тенями
  // Ровный белый свет машинного зала: светлый потолок сверху, светлый пол снизу
  root.add(new THREE.HemisphereLight('#ffffff', '#9a9fa6', 1.7));
  const key = new THREE.DirectionalLight('#ffffff', 1.7);
  const cx = (span.min.x + span.max.x) / 2;
  const cz = (span.min.z + span.max.z) / 2;
  const ext = Math.max(fw, fd);
  key.position.set(cx - ext * 0.4, ext * 0.9 + 4, cz + ext * 0.7 + 3);
  key.target.position.set(cx, 0, cz);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -ext * 0.75;
  sc.right = ext * 0.75;
  sc.top = ext * 0.75;
  sc.bottom = -ext * 0.75;
  sc.near = 0.5;
  sc.far = ext * 3 + 20;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  root.add(key, key.target);
  const fill = new THREE.DirectionalLight('#ffffff', 0.5);
  fill.position.set(cx + ext, ext * 0.4, cz + ext * 0.3);
  root.add(fill);

  const box = new THREE.Box3(new THREE.Vector3(span.min.x - RW / 2, 0, span.min.z - RD / 2), new THREE.Vector3(span.max.x + RW / 2, RH, span.max.z + RD / 2 + (open ? 0.6 : 0)));
  // Маленькую ферму не приближаем вплотную: минимальный размер кадра - как у 4 стоек.
  const minW = 4 * PITCH_X;
  if (box.max.x - box.min.x < minW) {
    const c = (box.max.x + box.min.x) / 2;
    box.min.x = c - minW / 2;
    box.max.x = c + minW / 2;
  }
  const target = box.getCenter(new THREE.Vector3());
  target.y = RH * 0.42;

  // Анимация: новые стойки опускаются сверху по очереди
  const DROP = 2.6;
  const DUR = 0.55;
  const STAGGER = Math.min(0.04, 0.8 / Math.max(1, new Set(slots.map((s) => s.rack)).size));
  const order = [...new Set(slots.map((s) => s.rack))];
  const delay = new Map(order.map((r, i) => [r, i * STAGGER]));
  const tmp = new THREE.Matrix4();
  const animate = slots.length
    ? (t: number) => {
        let going = false;
        const touched = new Set<THREE.InstancedMesh>();
        for (const s of slots) {
          const local = Math.max(0, Math.min(1, (t - (delay.get(s.rack) ?? 0)) / DUR));
          if (local < 1) going = true;
          // Падение с лёгким отскоком в конце
          const e = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
          const bounce = local > 0.7 && local < 1 ? Math.sin(((local - 0.7) / 0.3) * Math.PI) * 0.04 : 0;
          const dy = (1 - e) * DROP + bounce;
          tmp.copy(s.base);
          tmp.elements[13] += dy;
          s.mesh.setMatrixAt(s.index, tmp);
          touched.add(s.mesh);
        }
        for (const m of touched) m.instanceMatrix.needsUpdate = true;
        return going;
      }
    : undefined;
  if (animate) animate(0);

  return {
    root,
    framing: {
      target,
      fit: { box },
      yaw: -0.5,
      pitch: n > 24 ? 0.66 : n > 6 ? 0.5 : 0.36,
      minPitch: 0.18,
      maxPitch: 1.1,
      yawLimit: 0.9,
      fov: 32,
      fill: 0.92,
    },
    background: '#d4d7db',
    envIntensity: 0.6,
    fog: [1.15, 3.2],
    shadows: true,
    animate,
    dispose: () => {
      floor.geometry.dispose();
      floorMat.map?.dispose();
      floorMat.dispose();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if ((m.isMesh || (o as THREE.LineSegments).isLineSegments) && !m.userData.shared) m.geometry.dispose();
        if ((o as THREE.LineSegments).isLineSegments) ((o as THREE.LineSegments).material as THREE.Material).dispose();
      });
      for (const c of root.children) if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
      key.shadow.map?.dispose();
    },
  };
}
