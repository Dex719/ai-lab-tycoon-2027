// 3D-движок окон: один общий WebGL-рендерер на всю игру, кадры только по требованию.
// Каждый вид (превью карты, ферма, кампус) рисуется в общий рендерер и копируется в свой 2D-холст.
// Кадр рисуется, когда изменилась сцена, игрок тянет мышью или идёт короткая анимация; плавное вращение
// превью идёт, только пока вид на экране и вкладка видна. Нет видов - нет кадров; через 20 с простоя
// рендерер освобождается. Модуль подгружается динамическим импортом (View3D), в стартовый бандл не входит.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCampus } from './campus';
import { buildFarm } from './farm';
import { buildGpu } from './gpuModels';
import { disposeGeometries } from './kit';
import { getSettings } from '../settings';
import type { GpuId } from '../../sim/types';
import type { ViewSpec } from './specs';

// ---------- Содержимое вида ----------

export interface Framing {
  target: THREE.Vector3;
  /**
   * Что вписать в кадр: цилиндр вокруг вертикальной оси (для вращения по кругу: радиус и половина высоты)
   * или коробку (для вида под фиксированным углом).
   */
  fit: { orbit: { r: number; hh: number } } | { box: THREE.Box3 };
  yaw: number;
  pitch: number;
  minPitch: number;
  maxPitch: number;
  /** Насколько можно отклонить поворот от начального, радиан; без ограничения - вращение по кругу. */
  yawLimit?: number;
  fov?: number;
  /** Доля кадра, которую занимает объект. */
  fill?: number;
}

export interface Content {
  root: THREE.Object3D;
  framing: Framing;
  /** Цвет фона или null (прозрачный). */
  background: string | null;
  /** Яркость отражений окружения (0..1). */
  envIntensity?: number;
  /** Дымка цвета фона: начало и конец в долях расстояния до камеры. */
  fog?: [number, number];
  shadows?: boolean;
  /** Анимация появления: t - секунды с начала; true, пока нужны кадры. */
  animate?: (t: number) => boolean;
  dispose(): void;
}

function buildContent(spec: ViewSpec, prev: ViewSpec | null): Content {
  switch (spec.kind) {
    case 'gpu':
      return gpuContent(spec.gpu);
    case 'farm':
      return buildFarm(spec, prev?.kind === 'farm' ? prev : null);
    case 'campus':
      return buildCampus(spec, prev?.kind === 'campus' ? prev : null);
  }
}

/** Рамка превью, см: по самой длинной карте (PCIe 26,9 см) - радиус вращения и половина высоты. */
const GPU_FRAME = { r: 13.7, hh: 6.2 };

function gpuContent(gpu: GpuId): Content {
  const root = new THREE.Group();
  const model = buildGpu(gpu);
  root.add(model);
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(-8, 18, 14);
  const rim = new THREE.DirectionalLight('#dfe6ff', 1.1);
  rim.position.set(14, 6, -16);
  root.add(key, rim, new THREE.HemisphereLight('#ffffff', '#303236', 0.5));
  // Рамка по корпусу без тени-пятна: модель крупнее в кадре
  const box = new THREE.Box3();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.blob) box.expandByObject(m);
  });
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return {
    root,
    framing: {
      target: sphere.center.clone(),
      // Общий масштаб для всех поколений: модули короче карт PCIe, но выше - пропорции видны при сравнении.
      fit: { orbit: GPU_FRAME },
      yaw: -0.62,
      pitch: 0.36,
      minPitch: -0.2,
      maxPitch: 1.1,
      fov: 30,
      fill: 1,
    },
    background: null,
    envIntensity: 1,
    dispose: () => disposeGeometries(root, sharedGeometries(root)),
  };
}

/** Геометрии, которые нельзя освобождать: общие для всех видов (кэш карт). */
function sharedGeometries(root: THREE.Object3D): Set<THREE.BufferGeometry> {
  const keep = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.userData.shared) keep.add(m.geometry);
  });
  return keep;
}

/** Расстояние, при котором цилиндр (радиус r, половина высоты hh) виден целиком под наклоном pitch при любом повороте. */
function orbitDistance(o: { r: number; hh: number }, pitch: number, tv: number, th: number): number {
  const hEff = o.hh * Math.cos(pitch) + o.r * Math.abs(Math.sin(pitch));
  return Math.max(o.r / th, hEff / tv) + o.r * 0.25;
}

function direction(yaw: number, pitch: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

// ---------- Общий рендерер ----------

let renderer: THREE.WebGLRenderer | null = null;
let envTex: THREE.Texture | null = null;
let releaseTimer: number | undefined;
const RELEASE_MS = 20_000;

/** Счётчики для проверки «ничего не крутится»: в консоли - window.__render3d. */
export const stats = { frames: 0, views: 0, loopRunning: false, renderer: false };

function getRenderer(wPx: number, hPx: number): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'default' });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap в three r18x убран и даёт предупреждение в консоли
    renderer.setScissorTest(true);
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    stats.renderer = true;
  }
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x < wPx || size.y < hPx) renderer.setSize(Math.max(size.x, wPx, 64), Math.max(size.y, hPx, 64), false);
  return renderer;
}

function scheduleRelease(): void {
  window.clearTimeout(releaseTimer);
  if (views.size > 0) return;
  releaseTimer = window.setTimeout(() => {
    if (views.size > 0 || !renderer) return;
    envTex?.dispose();
    envTex = null;
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = null;
    stats.renderer = false;
  }, RELEASE_MS);
}

// ---------- Качество и предел кадров (из «Настроек») ----------

/** Плотность пикселей 3D по качеству: низкое - мельче экрана, среднее - не больше 1,5, высокое - до 2. */
function viewDpr(): number {
  const dpr = window.devicePixelRatio || 1;
  const q = getSettings().quality3d;
  if (q === 'low') return Math.min(dpr, 1) * 0.75;
  if (q === 'mid') return Math.min(dpr, 1.5);
  return Math.min(dpr, 2);
}

function shadowsAllowed(): boolean {
  return getSettings().quality3d !== 'low';
}

/** Применить новые настройки качества ко всем открытым 3D-видам. */
export function applyQuality(): void {
  for (const v of views) v.refreshSize();
}

// ---------- Цикл кадров ----------

const views = new Set<View>();
let raf = 0;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function schedule(): void {
  if (raf || views.size === 0) return;
  raf = requestAnimationFrame(frame);
  stats.loopRunning = true;
}

let lastTick = 0;

function frame(now: number): void {
  raf = 0;
  const fps = getSettings().fps;
  // Предел кадров: слишком ранний кадр пропускаем и ждём следующего (запас 1 мс на дрожание таймера).
  if (fps > 0 && lastTick && now - lastTick < 1000 / fps - 1) {
    raf = requestAnimationFrame(frame);
    return;
  }
  lastTick = now;
  let again = false;
  for (const v of views) if (v.step(now)) again = true;
  stats.loopRunning = again;
  if (again) schedule();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      for (const v of views) v.markDirty();
      schedule();
    }
  });
}

// ---------- Вид ----------

export interface ViewOptions {
  /** Вращать мышью. */
  interactive: boolean;
  /** Плавно вращать, пока игрок не трогает (только превью карты). */
  autoRotate: boolean;
  /** WebGL недоступен: вид прячется, окно работает без 3D. */
  onFail?: () => void;
}

/** WebGL не завёлся: больше не пытаемся. */
let webglFailed = false;

/** Скорость плавного вращения, радиан в секунду (оборот за ~40 с). */
const AUTO_SPEED = 0.16;
/** После того как игрок отпустил мышь, плавное вращение возобновляется через столько мс. */
const AUTO_RESUME_MS = 3000;
/** Плавное вращение рисуется не чаще 30 кадров в секунду. */
const AUTO_FRAME_MS = 33;

export class View {
  private ctx: CanvasRenderingContext2D;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 5000);
  private content: Content | null = null;
  private spec: ViewSpec | null = null;
  private contentStart = 0;
  private animating = false;
  private wPx = 0;
  private hPx = 0;
  private yaw = 0;
  private pitch = 0;
  private distance = 10;
  private dragging: { x: number; y: number; id: number } | null = null;
  private lastInteract = -Infinity;
  private lastFrame = 0;
  private lastRender = 0;
  private visible = true;
  private dirty = true;
  private io: IntersectionObserver | null = null;
  private disposed = false;
  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: ViewOptions,
  ) {
    this.ctx = canvas.getContext('2d')!;
    views.add(this);
    stats.views = views.size;
    window.clearTimeout(releaseTimer);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((entries) => {
        const vis = entries.some((e) => e.isIntersecting);
        if (vis !== this.visible) {
          this.visible = vis;
          if (vis) {
            this.dirty = true;
            schedule();
          }
        }
      });
      this.io.observe(canvas);
    }
    if (opts.interactive) this.bindPointer();
  }

  setSpec(spec: ViewSpec): void {
    if (this.disposed) return;
    const prev = this.spec;
    const sameKind = prev?.kind === spec.kind;
    if (this.content) {
      this.scene.remove(this.content.root);
      this.content.dispose();
    }
    this.spec = spec;
    this.content = buildContent(spec, prev);
    this.scene.add(this.content.root);
    this.scene.background = this.content.background ? new THREE.Color(this.content.background) : null;
    this.scene.environmentIntensity = this.content.envIntensity ?? 1;
    const f = this.content.framing;
    // Тот же вид с новыми данными (стало больше стоек, прошёл этап стройки) - угол камеры игрока сохраняется.
    if (!sameKind || spec.kind === 'gpu') {
      this.yaw = f.yaw;
      this.pitch = f.pitch;
    }
    this.camera.fov = f.fov ?? 30;
    this.fit();
    this.contentStart = performance.now();
    this.animating = !!this.content.animate && !reducedMotion?.matches;
    if (!this.animating) this.content.animate?.(Infinity);
    this.markDirty();
  }

  private cssW = 0;
  private cssH = 0;

  refreshSize(): void {
    if (this.cssW > 0) this.resize(this.cssW, this.cssH, true);
  }

  resize(cssW: number, cssH: number, force = false): void {
    this.cssW = cssW;
    this.cssH = cssH;
    const dpr = viewDpr();
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (w === this.wPx && h === this.hPx) {
      if (force) this.markDirty();
      return;
    }
    this.wPx = w;
    this.hPx = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.camera.aspect = w / h;
    this.fit();
    this.markDirty();
  }

  /** Вернуть камеру к начальному углу. */
  reset(): void {
    if (!this.content) return;
    this.yaw = this.content.framing.yaw;
    this.pitch = this.content.framing.pitch;
    this.markDirty();
  }

  markDirty(): void {
    this.dirty = true;
    schedule();
  }

  /** Шаг цикла: true, если нужен следующий кадр. */
  step(now: number): boolean {
    if (this.disposed || !this.content || webglFailed) return false;
    if (!this.visible || document.hidden || this.wPx < 2 || this.hPx < 2) return false;
    const dt = Math.min(0.1, Math.max(0, (now - (this.lastFrame || now)) / 1000));
    this.lastFrame = now;
    let more = false;
    const auto = this.opts.autoRotate && !reducedMotion?.matches && !this.dragging && now - this.lastInteract > AUTO_RESUME_MS;
    if (auto) {
      more = true;
      if (now - this.lastRender >= AUTO_FRAME_MS) {
        this.yaw += AUTO_SPEED * Math.min(dt * 2, 0.1, (now - this.lastRender) / 1000);
        this.dirty = true;
      }
    }
    if (this.animating) {
      const going = this.content.animate!((now - this.contentStart) / 1000);
      this.dirty = true;
      if (going) more = true;
      else this.animating = false;
    }
    if (this.dirty) {
      try {
        this.render();
      } catch {
        webglFailed = true;
      }
      if (webglFailed) {
        this.opts.onFail?.();
        return false;
      }
      this.lastRender = now;
      this.dirty = false;
    }
    return more;
  }

  private fit(): void {
    if (!this.content) return;
    const f = this.content.framing;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const tv = Math.tan(vFov / 2);
    const th = tv * this.camera.aspect;
    const fill = f.fill ?? 0.9;
    if ('orbit' in f.fit) {
      this.distance = orbitDistance(f.fit.orbit, this.pitch, tv, th) / fill;
    } else {
      // Коробка под начальным углом: расстояние, при котором все 8 углов в кадре.
      const dir = this.direction(f.yaw, f.pitch);
      const fwd = dir.clone().negate();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const b = f.fit.box;
      let d = 0.1;
      for (let i = 0; i < 8; i++) {
        const p = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(f.target);
        const x = Math.abs(p.dot(right));
        const y = Math.abs(p.dot(up));
        const z = p.dot(fwd);
        d = Math.max(d, x / (th * fill) - z, y / (tv * fill) - z);
      }
      this.distance = d;
    }
    if (f && this.content.fog && this.content.background) {
      const [a, b] = this.content.fog;
      this.scene.fog = new THREE.Fog(this.content.background, this.distance * a, this.distance * b);
    } else this.scene.fog = null;
    this.camera.near = Math.max(0.01, this.distance / 200);
    this.camera.far = this.distance * 20;
    this.camera.updateProjectionMatrix();
  }

  private direction(yaw: number, pitch: number): THREE.Vector3 {
    return direction(yaw, pitch);
  }

  private render(): void {
    if (!this.content) return;
    const f = this.content.framing;
    this.camera.position.copy(f.target).addScaledVector(this.direction(this.yaw, this.pitch), this.distance);
    this.camera.lookAt(f.target);
    const r = getRenderer(this.wPx, this.hPx);
    this.scene.environment = envTex;
    r.shadowMap.enabled = !!this.content.shadows && shadowsAllowed();
    r.setViewport(0, 0, this.wPx, this.hPx);
    r.setScissor(0, 0, this.wPx, this.hPx);
    r.setClearColor(0x000000, 0);
    r.render(this.scene, this.camera);
    const rh = r.domElement.height;
    this.ctx.clearRect(0, 0, this.wPx, this.hPx);
    this.ctx.drawImage(r.domElement, 0, rh - this.hPx, this.wPx, this.hPx, 0, 0, this.wPx, this.hPx);
    stats.frames++;
  }

  private bindPointer(): void {
    const c = this.canvas;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.dragging = { x: e.clientX, y: e.clientY, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging || e.pointerId !== this.dragging.id || !this.content) return;
      const dx = e.clientX - this.dragging.x;
      const dy = e.clientY - this.dragging.y;
      this.dragging.x = e.clientX;
      this.dragging.y = e.clientY;
      const f = this.content.framing;
      this.yaw -= dx * 0.009;
      if (f.yawLimit !== undefined) this.yaw = Math.max(f.yaw - f.yawLimit, Math.min(f.yaw + f.yawLimit, this.yaw));
      this.pitch = Math.max(f.minPitch, Math.min(f.maxPitch, this.pitch + dy * 0.007));
      if ('orbit' in f.fit) this.fit();
      this.lastInteract = performance.now();
      this.markDirty();
    };
    const up = (e: PointerEvent) => {
      if (!this.dragging || e.pointerId !== this.dragging.id) return;
      this.dragging = null;
      this.lastInteract = performance.now();
      c.classList.remove('dragging');
      schedule();
    };
    const dbl = () => {
      this.lastInteract = performance.now();
      this.reset();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', dbl);
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
      c.removeEventListener('dblclick', dbl);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.io?.disconnect();
    for (const f of this.cleanup) f();
    if (this.content) {
      this.scene.remove(this.content.root);
      this.content.dispose();
      this.content = null;
    }
    views.delete(this);
    stats.views = views.size;
    if (views.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      stats.loopRunning = false;
    }
    scheduleRelease();
  }
}

export function createView(canvas: HTMLCanvasElement, opts: ViewOptions): View {
  return new View(canvas, opts);
}

// ---------- Миниатюры ----------

const thumbCache = new Map<string, string>();

/** Картинка карты (data URL) для списков: рисуется один раз на тип и размер. */
export function gpuThumb(gpu: GpuId, cssW: number, cssH: number): string {
  if (webglFailed) throw new Error('WebGL недоступен');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  const key = `${gpu}|${w}x${h}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const c = gpuContent(gpu);
  const scene = new THREE.Scene();
  scene.add(c.root);
  const cam = new THREE.PerspectiveCamera(26, w / h, 0.1, 500);
  const f = c.framing;
  const dir = direction(-0.5, 0.32);
  const tv = Math.tan(THREE.MathUtils.degToRad(13));
  const dist = 'orbit' in f.fit ? orbitDistance(f.fit.orbit, 0.32, tv, tv * (w / h)) * 0.92 : 50;
  cam.position.copy(f.target).addScaledVector(dir, dist);
  cam.lookAt(f.target);
  const r = getRenderer(w, h);
  scene.environment = envTex;
  r.shadowMap.enabled = false;
  r.setViewport(0, 0, w, h);
  r.setScissor(0, 0, w, h);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(r.domElement, 0, r.domElement.height - h, w, h, 0, 0, w, h);
  const url = out.toDataURL('image/png');
  thumbCache.set(key, url);
  scene.remove(c.root);
  c.dispose();
  stats.frames++;
  scheduleRelease();
  return url;
}

// Только в разработке: проверка «ничего не крутится» из консоли.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __render3d: typeof stats }).__render3d = stats;
