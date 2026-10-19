// Общие помощники 3D: сборка статичной геометрии в одну сетку на материал, материалы и текстуры с холста (кэш).
// Модуль грузится только вместе с three.js (динамический импорт из View3D), в стартовый бандл не попадает.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------- Матрицы и формы ----------

/** Матрица из позиции, поворота (радианы) и масштаба. */
export function mtx(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Многоугольник по точкам. */
export function poly(pts: readonly (readonly [number, number])[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

export function polyPath(pts: readonly (readonly [number, number])[]): THREE.Path {
  const p = new THREE.Path();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

/** Плита со скосом: лицевая сторона на z = depth + bevel. */
export function slab(shape: THREE.Shape, depth: number, bevel: number, curveSegments = 12): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments,
  });
}

// ---------- Сборка геометрии ----------

/**
 * Сборщик статичной геометрии: детали добавляются с матрицей и ключом материала, на выходе - одна сетка на материал.
 * Видеокарта из сотен деталей рисуется за десяток вызовов отрисовки.
 */
export class GeoBatch {
  private parts = new Map<string, THREE.BufferGeometry[]>();

  add(mat: string, geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    g.morphAttributes = {};
    const list = this.parts.get(mat) ?? [];
    list.push(g);
    this.parts.set(mat, list);
  }

  box(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    this.add(mat, new THREE.BoxGeometry(w, h, d), mtx(x, y, z, rx, ry, rz));
  }

  /** Цилиндр вдоль оси y (повернуть - через rx/rz). */
  cyl(mat: string, r: number, h: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, seg = 16, r2 = r): void {
    this.add(mat, new THREE.CylinderGeometry(r, r2, h, seg), mtx(x, y, z, rx, ry, rz));
  }

  has(mat: string): boolean {
    return this.parts.has(mat);
  }

  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [k, list] of this.parts) {
      const merged = mergeGeometries(list);
      if (merged) {
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        out.set(k, merged);
      }
      for (const g of list) g.dispose();
    }
    this.parts.clear();
    return out;
  }
}

// ---------- Текстуры ----------

const texCache = new Map<string, THREE.CanvasTexture>();

/** Текстура с холста: одна на ключ, живёт всё время (их немного и они маленькие). */
export function canvasTex(
  key: string,
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  opts: { srgb?: boolean; repeat?: [number, number] } = {},
): THREE.CanvasTexture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(cv);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...opts.repeat);
  }
  texCache.set(key, t);
  return t;
}

/** Детерминированный шум: одинаковая картинка при каждом запуске. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Мягкая круглая тень под предметом (дешевле карты теней). */
export function blobTex(): THREE.CanvasTexture {
  return canvasTex('blob', 128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.38)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

/** Шлифованный металл: тонкие продольные полосы (карта шероховатости). */
export function brushedTex(): THREE.CanvasTexture {
  return canvasTex(
    'brushed',
    256,
    256,
    (g, w, h) => {
      const r = rng(7);
      g.fillStyle = '#8a8a8a';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const y = r() * h;
        const v = 110 + Math.floor(r() * 60);
        g.fillStyle = `rgba(${v},${v},${v},0.35)`;
        g.fillRect(0, y, w, 0.6 + r());
      }
    },
    { srgb: false },
  );
}

// ---------- Материалы ----------

const matCache = new Map<string, THREE.Material>();

/** Материал по ключу: создаётся один раз. */
export function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = matCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    matCache.set(key, m);
  }
  return m;
}

/** Простой физический материал по цвету (кэшируется по параметрам). */
export function pbr(color: string, metalness = 0, roughness = 0.6, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = `pbr|${color}|${metalness}|${roughness}|${JSON.stringify(extra, (k, v) => (v instanceof THREE.Texture ? v.uuid : k === 'side' ? String(v) : v))}`;
  return cached(key, () => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra }));
}

/** Светящийся материал (огоньки, подсветка): не зависит от освещения и тонального сжатия - яркий цвет как есть. */
export function glow(color: string, intensity = 1): THREE.MeshBasicMaterial {
  return cached(`glow|${color}|${intensity}`, () => {
    const c = new THREE.Color(color).multiplyScalar(Math.min(1.6, intensity));
    return new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  });
}

/** Сетки из собранных геометрий: ключ материала → материал через resolve. */
export function meshesOf(geos: Map<string, THREE.BufferGeometry>, resolve: (key: string) => THREE.Material, shadows = false): THREE.Group {
  const g = new THREE.Group();
  for (const [k, geo] of geos) {
    const m = new THREE.Mesh(geo, resolve(k));
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    g.add(m);
  }
  return g;
}

/** Освободить геометрии внутри объекта (материалы и текстуры общие и живут в кэше). */
export function disposeGeometries(root: THREE.Object3D, keep?: Set<THREE.BufferGeometry>): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && !keep?.has(m.geometry)) m.geometry.dispose();
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) im.dispose();
  });
}
