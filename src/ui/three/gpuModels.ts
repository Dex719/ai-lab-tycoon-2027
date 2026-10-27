// Видеокарты Fermi Systems в 3D по поколениям. Основа - одобренная модель GTX 1080 (docs/gpu-art/opus):
// гранёный кожух, окно с рёбрами радиатора, планка крепления, текстолит с золотыми контактами.
// Серверные карты пассивные: вентиляторов нет, воздух гонят вентиляторы сервера, на планке только прорези.
// P100 - графитовый кожух с серебристыми гранями; V100 - золотистый с чёрными вставками; A100 - бронзовый
// с решёткой и разъёмами моста сверху; H100 и H200 - модули для серверной платы с высоким радиатором.
// Единица - сантиметр. Карта: длина по x (планка на -x), высота по y, лицевая сторона смотрит на +z.
// Модуль лежит на плате в плоскости xz, радиатор растёт вверх по y.

import * as THREE from 'three';
import type { GpuId } from '../../sim/types';
import { GPU_LOOK, type GpuLook } from './gpuLook';
import { GeoBatch, blobTex, brushedTex, cached, canvasTex, meshesOf, mtx, pbr, poly, polyPath, slab } from './kit';

type Pt = readonly [number, number];

/** Длина карты PCIe и верх кожуха, см (как у эталона). */
const L = 26.86;
const TOP = 5.55;
/** Координаты лицевой стороны в мм, как на чертеже: x от планки, y от верхнего края. */
const fx = (mm: number) => -L / 2 + mm / 10;
const fy = (mm: number) => TOP - mm / 10;
const P = (pts: readonly Pt[]) => pts.map(([x, y]) => [fx(x), fy(y)] as const);
/** Лицевая поверхность кожуха, z. */
const FZ = 2.0;

// ---------- Материалы ----------

function material(look: GpuLook, key: string): THREE.Material {
  switch (key) {
    case 'shell':
      return pbr(look.shell, 0.85, 0.36, { flatShading: true, side: THREE.DoubleSide, roughnessMap: brushedTex() });
    case 'shellHi':
      return pbr(new THREE.Color(look.shell).offsetHSL(0, 0, 0.08).getStyle(), 0.85, 0.28, { flatShading: true });
    case 'trim':
      return pbr(look.trim, 0.8, 0.34, { flatShading: true });
    case 'dark':
      return pbr('#2f3338', 0.75, 0.42, { flatShading: true });
    case 'darker':
      return pbr('#1b1d20', 0.5, 0.55, { flatShading: true });
    case 'black':
      return pbr('#0d0e10', 0.2, 0.6);
    case 'fin':
      return pbr('#9aa2ab', 0.85, 0.35);
    case 'finDark':
      return pbr('#25272c', 0.7, 0.45);
    case 'finAlu':
      return pbr('#c4c9cf', 0.9, 0.35);
    case 'copper':
      return pbr('#c47a4c', 1, 0.3);
    case 'pcb':
      return pbr('#15201a', 0.15, 0.65);
    case 'gold':
      return pbr('#d9ac4a', 1, 0.3);
    case 'back':
      return pbr('#1d1f22', 0.65, 0.45);
    case 'bracket':
      return pbr('#b8bdc2', 0.95, 0.28);
    case 'acrylic':
      return cached('g-acrylic', () => new THREE.MeshStandardMaterial({ color: '#0c0d0f', metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.38, depthWrite: false }));
    default:
      return pbr('#444');
  }
}

// ---------- Общие детали карт PCIe ----------

/** Текстолит, бэкплейт, контакты PCIe и разъём питания на дальнем торце. */
function addBoard(b: GeoBatch): void {
  b.box('pcb', 26.6, 10.25, 0.16, 0, 0.45, -1.52);
  b.box('back', 26.86, 9.95, 0.25, 0, 0.55, -1.76);
  b.box('black', 0.06, 9.4, 0.02, 0.4, 0.55, -1.89);
  // Контакты PCIe x16 и ключ
  b.box('gold', 8.9, 0.85, 0.17, (fx(38) + fx(127)) / 2, -5.1, -1.52);
  b.box('black', 0.25, 0.86, 0.2, fx(48.5), -5.1, -1.52);
  // Разъём питания 8 pin на дальнем торце (серверные карты питаются с торца)
  const ex = L / 2 + 0.45;
  b.box('darker', 0.9, 1.05, 2.0, ex, 3.6, 0.2);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) b.box('black', 0.02, 0.32, 0.32, ex + 0.45, 3.38 + j * 0.44, -0.46 + i * 0.44);
}

/** Планка крепления без видеовыходов: серверной карте они не нужны, вместо них прорези для воздуха. */
function addBracket(b: GeoBatch): void {
  const BX = -L / 2 - 0.12;
  b.box('bracket', 0.1, 11.15, 4.1, BX, 0.27, 0);
  b.box('bracket', 0.1, 1.2, 0.7, BX, -5.9, -1.05);
  b.box('bracket', 1.05, 0.1, 4.1, BX - 0.5, 5.8, 0);
  const face = BX - 0.06;
  for (let r = 0; r < 12; r++) for (let c = 0; c < 3; c++) b.box('black', 0.12, 0.38, 0.9, face - 0.01, 4.6 - r * 0.78, -1.15 + c * 1.15);
}

/** Решётка на дальнем торце: через неё проходит воздух от вентиляторов сервера. */
function addEndGrille(b: GeoBatch): void {
  const ex = L / 2 + 0.02;
  b.box('darker', 0.06, 8.6, 3.4, ex, 0.0, 0.3);
  for (let r = 0; r < 9; r++) b.box('black', 0.08, 0.5, 3.0, ex + 0.02, 3.6 - r * 0.95, 0.3);
}

/** Тонкая полоса на верхнем торце под светящейся надписью. */
function addTopStrip(b: GeoBatch, x: number, w: number): void {
  b.box('black', w + 0.6, 0.06, 2.0, x, TOP + 0.24, 0.45);
}

interface Built {
  geos: Map<string, THREE.BufferGeometry>;
  /** Светящаяся надпись на верхнем торце: центр по x и ширина. */
  logo: { x: number; y: number; z: number; w: number; rx: number };
  /** Табличка с моделью на лицевой стороне. */
  label: { x: number; y: number; z: number; w: number; color: string };
}

// ---------- P100 и V100: окно с рёбрами ----------

function buildWindowCard(variant: 'p' | 'v'): Built {
  const b = new GeoBatch();
  // P100: длинное окно почти во всю карту. V100: окно короче, справа гранёная плита со стрелками.
  const winEnd = variant === 'p' ? 236 : 196;
  const WIN: Pt[] = [
    [14, 20],
    [winEnd, 20],
    [winEnd + 14, 34],
    [winEnd + 14, 68],
    [winEnd, 82],
    [14, 82],
  ];
  const HOLE: Pt[] = [
    [12, 18],
    [winEnd + 1, 18],
    [winEnd + 16, 33],
    [winEnd + 16, 69],
    [winEnd + 1, 84],
    [12, 84],
  ];
  {
    const s = poly(P([
      [2, 2],
      [266.6, 2],
      [266.6, 98],
      [2, 98],
    ]));
    s.holes.push(polyPath(P(HOLE)));
    b.add('shell', slab(s, 2.9, 0.21, 22), mtx(0, 0, -1.12));
  }
  const plate = (pts: Pt[], mat: string, depth: number, bevel: number, holes: Pt[][] = []) => {
    const s = poly(P(pts));
    for (const h of holes) s.holes.push(polyPath(P(h)));
    b.add(mat, slab(s, depth, bevel), mtx(0, 0, FZ));
  };
  const hi = variant === 'p' ? 'trim' : 'trim';
  plate([[6, 3.5], [winEnd + 26, 3.5], [winEnd + 18, 12.5], [10, 12.5]], hi, 0.04, 0.14);
  plate([[10, 89.5], [winEnd + 18, 89.5], [winEnd + 26, 96.5], [6, 96.5]], variant === 'p' ? 'shellHi' : 'trim', 0.04, 0.14);
  plate(
    [[8, 14], [winEnd + 4, 14], [winEnd + 20, 30], [winEnd + 20, 72], [winEnd + 4, 88], [8, 88]],
    variant === 'p' ? 'dark' : 'darker',
    0.03,
    0.1,
    [HOLE],
  );
  if (variant === 'p') {
    // Торцевая гранёная вставка справа
    plate([[256, 10], [265, 6], [265, 94], [256, 90]], 'trim', 0.02, 0.1);
    plate([[244, 22], [252, 16], [252, 84], [244, 78]], 'dark', 0.02, 0.08);
  } else {
    // Правая плита со стрелками-гранями
    const x0 = winEnd + 24;
    plate([[x0, 8], [262, 8], [262, 92], [x0, 92], [x0 + 8, 50]], 'shellHi', 0.06, 0.14);
    for (let i = 0; i < 3; i++) {
      const cx = x0 + 12 + i * 10;
      plate([[cx, 30], [cx + 4, 30], [cx + 10, 50], [cx + 4, 70], [cx, 70], [cx + 6, 50]], 'trim', 0.1, 0.06);
    }
  }
  // Окно: подложка, рёбра радиатора, акрил
  const wx0 = fx(14);
  const wx1 = fx(winEnd + 14);
  b.box('darker', wx1 - wx0, 7.6, 1.0, (wx0 + wx1) / 2, fy(51), -0.95);
  for (let x = 16; x <= winEnd + 12; x += 2.6) b.box('fin', 0.05, 6.3, 2.6, fx(x), fy(51), 0.1);
  // Тепловые трубки поперёк рёбер
  for (const y of [38, 64]) b.cyl('copper', 0.22, (wx1 - wx0) * 0.96, (wx0 + wx1) / 2, fy(y), -0.2, 0, 0, Math.PI / 2, 10);
  b.add('acrylic', new THREE.ShapeGeometry(poly(P(WIN))), mtx(0, 0, FZ - 0.05));
  addBoard(b);
  addBracket(b);
  addEndGrille(b);
  addTopStrip(b, fx(150), 9);
  return {
    geos: b.build(),
    logo: { x: fx(150), y: TOP + 0.28, z: 0.45, w: 9, rx: -Math.PI / 2 },
    label: { x: fx(40), y: fy(76), z: FZ + 0.02, w: 4.2, color: variant === 'p' ? '#9aa1a9' : '#d8b874' },
  };
}

// ---------- A100: решётка и мост сверху ----------

function buildLatticeCard(): Built {
  const b = new GeoBatch();
  {
    const s = poly(P([
      [2, 2],
      [266.6, 2],
      [266.6, 98],
      [2, 98],
    ]));
    b.add('shell', slab(s, 2.9, 0.21, 8), mtx(0, 0, -1.12));
  }
  // Рамка решётки и чёрная полоса справа с табличкой
  const frame = poly(P([
    [8, 8],
    [214, 8],
    [214, 92],
    [8, 92],
  ]));
  frame.holes.push(polyPath(P([
    [12, 12],
    [210, 12],
    [210, 88],
    [12, 88],
  ])));
  b.add('shellHi', slab(frame, 0.04, 0.1), mtx(0, 0, FZ));
  b.add('trim', slab(poly(P([[220, 6], [262, 6], [262, 94], [220, 94]])), 0.04, 0.12), mtx(0, 0, FZ));
  // Решётка: ромбы со скосом, под ними тёмная подложка
  b.box('darker', fx(210) - fx(12), 7.6, 0.3, (fx(12) + fx(210)) / 2, fy(50), FZ - 0.1);
  const dz = FZ + 0.08;
  for (let ix = 0; ix < 33; ix++) {
    for (let iy = 0; iy < 13; iy++) {
      const x = 15.5 + ix * 6 + (iy % 2) * 3;
      if (x > 208) continue;
      const y = 15 + iy * 5.9;
      const g = slab(poly([[0, -0.26], [0.26, 0], [0, 0.26], [-0.26, 0]]), 0.12, 0.05, 1);
      b.add('shell', g, mtx(fx(x), fy(y), dz - 0.12));
    }
  }
  // Разъёмы моста на верхнем торце (три гребёнки)
  for (let i = 0; i < 3; i++) {
    const x = fx(40 + i * 26);
    b.box('darker', 2.0, 0.5, 0.9, x, TOP + 0.25, -1.3);
    b.box('gold', 1.8, 0.08, 0.5, x, TOP + 0.52, -1.3);
  }
  addBoard(b);
  addBracket(b);
  addEndGrille(b);
  addTopStrip(b, fx(170), 7);
  return {
    geos: b.build(),
    logo: { x: fx(170), y: TOP + 0.28, z: 0.45, w: 7, rx: -Math.PI / 2 },
    label: { x: fx(241), y: fy(50), z: FZ + 0.2, w: 3.8, color: '#e2b46a' },
  };
}

// ---------- H100 и H200: модуль с высоким радиатором ----------

function buildModule(look: GpuLook, tall: boolean): Built {
  const b = new GeoBatch();
  const [W, D] = look.size; // длина по x, глубина по z (третье число - высота)
  const finH = tall ? 8.4 : 7.0;
  const baseY = 0.4;
  // Плата модуля и разъёмы снизу
  b.box('pcb', W, 0.22, D, 0, 0.11, 0);
  for (const z of [-D / 4, D / 4]) {
    b.box('darker', W * 0.55, 0.5, 1.1, 0, -0.25, z);
    for (let i = 0; i < 18; i++) b.box('gold', 0.18, 0.06, 0.7, -W * 0.25 + i * (W * 0.5 / 17), -0.52, z);
  }
  // Медное основание; рёбра поперёк модуля - с длинных сторон видны торцы пластин
  b.box('copper', W - 0.8, 0.5, D - 0.6, 0, baseY, 0);
  const finY = baseY + 0.25 + finH / 2;
  const fins = tall ? 58 : 50;
  const fx0 = -(W - 1.0) / 2;
  const fstep = (W - 1.0) / (fins - 1);
  for (let i = 0; i < fins; i++) b.box(tall ? 'finDark' : 'finAlu', 0.07, finH, D - 0.5, fx0 + i * fstep, finY, 0);
  // Торцевые стенки кожуха
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) b.box('shell', 0.2, finH + 0.4, D, x, finY, 0);
  const topY = baseY + 0.25 + finH + 0.12;
  if (tall) {
    // H200: крышка с окном, под ним медные тепловые трубки поверх рёбер
    const cover = poly([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]]);
    cover.holes.push(polyPath([[-W / 2 + 1.6, -D / 2 + 2.6], [W / 2 - 1.6, -D / 2 + 2.6], [W / 2 - 1.6, D / 2 - 2.6], [-W / 2 + 1.6, D / 2 - 2.6]]));
    b.add('shell', slab(cover, 0.18, 0.04, 4), mtx(0, topY - 0.1, 0, -Math.PI / 2));
    for (let i = 0; i < 5; i++) b.cyl('copper', 0.32, W - 2.2, 0, topY - 0.25, -D / 2 + 3.2 + i * ((D - 6.4) / 4), 0, 0, Math.PI / 2, 12);
    b.box('finDark', W - 3.2, 0.2, D - 5.2, 0, topY - 0.7, 0);
  } else {
    // H100: сплошная крышка с гранёной вставкой
    b.box('shell', W, 0.24, D, 0, topY, 0);
    b.add('trim', slab(poly([[-W / 2 + 0.6, -D / 2 + 1.2], [W / 2 - 3.6, -D / 2 + 1.2], [W / 2 - 2.2, 0], [W / 2 - 3.6, D / 2 - 1.2], [-W / 2 + 0.6, D / 2 - 1.2]]), 0.05, 0.1), mtx(0, topY + 0.1, 0, -Math.PI / 2));
  }
  // Окантовка крышки по длинным сторонам
  for (const z of [-D / 2 - 0.02, D / 2 + 0.02]) b.box('trim', W, 0.32, 0.06, 0, topY - 0.05, z);
  // Пружинные винты по углам
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.cyl('bracket', 0.32, 0.5, sx * (W / 2 - 0.5), topY + 0.25, sz * (D / 2 - 0.5), 0, 0, 0, 14);
    b.cyl('black', 0.14, 0.04, sx * (W / 2 - 0.5), topY + 0.51, sz * (D / 2 - 0.5), 0, 0, 0, 10);
  }
  // Светящаяся полоса вдоль переднего края крышки
  b.box('black', W * 0.62, 0.06, 0.5, -W * 0.12, topY + 0.13, D / 2 - 0.6);
  return {
    geos: b.build(),
    logo: { x: -W * 0.12, y: topY + 0.17, z: D / 2 - 0.6, w: W * 0.58, rx: -Math.PI / 2 },
    label: { x: -W * 0.08, y: topY + 0.17, z: -0.6, w: 6.4, color: tall ? '#d8a46a' : '#3a3e45' },
  };
}

// ---------- Надписи ----------

function logoTex(text: string): THREE.CanvasTexture {
  return canvasTex(`gpu-logo-${text}`, 1024, 128, (c, w, h) => {
    c.fillStyle = '#15171a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#b9bec5';
    c.font = '900 84px "Segoe UI", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 4);
  });
}

function labelTex(text: string, color: string): THREE.CanvasTexture {
  return canvasTex(`gpu-label-${text}-${color}`, 512, 96, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    c.font = '700 64px "Segoe UI", Arial, sans-serif';
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillText(text, w / 2, h / 2 + 3);
  });
}

// ---------- Сборка ----------

const geoCache = new Map<GpuId, Built>();

function built(id: GpuId): Built {
  let g = geoCache.get(id);
  if (!g) {
    const look = GPU_LOOK[id];
    g =
      id === 'p100'
        ? buildWindowCard('p')
        : id === 'v100'
          ? buildWindowCard('v')
          : id === 'a100'
            ? buildLatticeCard()
            : buildModule(look, id === 'h200');
    geoCache.set(id, g);
  }
  return g;
}

/**
 * Модель карты: группа с центром в середине корпуса, тень-пятно снизу.
 * Карты PCIe стоят на ребре (контактами вниз), модули лежат радиатором вверх.
 */
export function buildGpu(id: GpuId): THREE.Group {
  const look = GPU_LOOK[id];
  const b = built(id);
  const root = new THREE.Group();
  const body = meshesOf(b.geos, (k) => material(look, k));
  // Геометрия корпуса общая для всех видов (кэш): при смене сцены её не освобождают.
  body.traverse((o) => (o.userData.shared = true));
  root.add(body);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(b.logo.w, b.logo.w / 8),
    // Надпись на торце напечатана, а не светится: у серверных карт нет подсветки
    cached(`gpu-logo-mat-${id}`, () => new THREE.MeshStandardMaterial({ map: logoTex('FERMI'), metalness: 0.3, roughness: 0.55 })),
  );
  logo.position.set(b.logo.x, b.logo.y, b.logo.z);
  logo.rotation.x = b.logo.rx;
  root.add(logo);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(b.label.w, b.label.w * (96 / 512)),
    cached(`gpu-label-mat-${id}`, () => new THREE.MeshStandardMaterial({ map: labelTex(look.short, b.label.color), transparent: true, metalness: 0.4, roughness: 0.4, depthWrite: false })),
  );
  label.position.set(b.label.x, b.label.y, b.label.z);
  if (look.form === 'module') label.rotation.x = -Math.PI / 2;
  root.add(label);
  // Тень-пятно на «полу»
  const floorY = look.form === 'module' ? -0.6 : -5.75;
  const [sx, sz] = look.size;
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(look.form === 'module' ? sx * 1.5 : sx * 1.25, look.form === 'module' ? sz * 1.5 : 10),
    cached('gpu-blob', () => new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: 0.6, toneMapped: false })),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = floorY;
  blob.userData.blob = true;
  root.add(blob);
  return root;
}
