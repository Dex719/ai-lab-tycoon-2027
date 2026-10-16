// Отклик на действия и награды: кольцо «действие принято», кольцо у значка окна, один бросок конфетти.
// Всё одноразовое, без таймеров на кадр: элемент появляется, играет CSS-анимацию (transform и opacity) и удаляется.
// Симуляцию не трогает. Движение выключается при prefers-reduced-motion.

export type FeelTone = 'accent' | 'good' | 'gold' | 'neutral';

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let root: HTMLElement | null = null;
function fxRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (root && root.isConnected) return root;
  root = document.createElement('div');
  root.className = 'fx-root';
  root.setAttribute('aria-hidden', 'true');
  document.body.appendChild(root);
  return root;
}

const MAX_RINGS = 6;

/** Тонкое кольцо вокруг прямоугольника: расходится и гаснет за 450 мс. */
export function ring(rect: DOMRect, tone: FeelTone, grow = 10): void {
  const host = fxRoot();
  if (!host || reducedMotion() || (typeof document !== 'undefined' && document.hidden)) return;
  if (host.querySelectorAll('.fx-ring').length >= MAX_RINGS) return;
  const el = document.createElement('span');
  el.className = `fx-ring ${tone}`;
  el.style.left = `${rect.left - grow / 2}px`;
  el.style.top = `${rect.top - grow / 2}px`;
  el.style.width = `${rect.width + grow}px`;
  el.style.height = `${rect.height + grow}px`;
  const done = () => el.remove();
  el.addEventListener('animationend', done, { once: true });
  window.setTimeout(done, 900);
  host.appendChild(el);
}

/** Кольцо у первого элемента по селектору (значок окна, строка цели). Нет элемента - ничего не делаем. */
export function ringAt(selector: string, tone: FeelTone, grow = 12): void {
  const el = typeof document !== 'undefined' ? document.querySelector(selector) : null;
  if (el) ring(el.getBoundingClientRect(), tone, grow);
}

// ---------- Действие принято ----------

let lastClick: { el: HTMLElement; at: number } | null = null;
/** Кнопка вне диалога, которая открыла диалог: когда подтверждение закрывается, кольцо проходит вокруг неё. */
let trigger: HTMLElement | null = null;
let wired = false;

/** Запомнить последнюю нажатую кнопку окна: если за этим кликом игра приняла действие, вокруг кнопки пройдёт кольцо. */
export function wireClicks(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target instanceof Element ? e.target.closest<HTMLElement>('.btn') : null;
      lastClick = t && !t.hasAttribute('disabled') && t.getAttribute('aria-disabled') !== 'true' ? { el: t, at: performance.now() } : null;
      if (t && !t.closest('[role="dialog"]')) trigger = t;
    },
    true,
  );
}

/** Вызывается из store.dispatch, когда действие игрока принято. */
export function landAction(): void {
  const c = lastClick;
  lastClick = null;
  if (!c || performance.now() - c.at > 150 || !c.el.isConnected) return;
  const main = c.el.classList.contains('big') || c.el.classList.contains('primary');
  // Кольцо - после перерисовки: кнопка закрывшегося диалога исчезла, и кольцо над пустым местом было бы ошибкой.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = c.el.isConnected ? c.el : trigger && trigger.isConnected ? trigger : null;
      if (el) ring(el.getBoundingClientRect(), main ? 'accent' : 'neutral', main ? 12 : 8);
    }),
  );
}

// ---------- Награды ----------

export type FeelEvent = 'ready' | 'research' | 'contract' | 'goal' | 'first' | 'rankUp';

/** Награда по размеру события: рядовое (обучено, исследовано) - кольцо у значка, редкое (первое место) - ещё и конфетти. */
export function celebrate(kind: FeelEvent): void {
  switch (kind) {
    case 'ready':
      ringAt('[data-tutorial="icon-models"]', 'accent');
      break;
    case 'research':
      ringAt('[data-tutorial="icon-research"]', 'accent');
      break;
    case 'contract':
      ringAt('[data-tutorial="icon-contracts"]', 'gold');
      break;
    case 'goal':
      window.setTimeout(() => ringAt('.goal-row.just-done', 'good', 6), 60);
      break;
    case 'rankUp':
      ringAt('.ar-strip', 'good', 8);
      break;
    case 'first':
      ringAt('.ar-strip', 'gold', 8);
      confetti();
      break;
  }
}

const PAPER = ['#e0a32e', '#3a7bd5', '#3fae6a', '#e0702e', '#7a58c8', '#f2f2f2'];

/** Один бросок плоских бумажных квадратиков за 1,3 с: холст появляется и исчезает вместе с анимацией. */
export function confetti(): void {
  const host = fxRoot();
  if (!host || reducedMotion() || document.hidden || host.querySelector('.fx-confetti')) return;
  const cv = document.createElement('canvas');
  cv.className = 'fx-confetti';
  const w = (cv.width = window.innerWidth);
  const h = (cv.height = window.innerHeight);
  const g = cv.getContext('2d');
  if (!g) return;
  host.appendChild(cv);
  const N = 44;
  const ox = w / 2;
  const oy = h * 0.42;
  const p = Array.from({ length: N }, (_, i) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.1;
    const v = 380 + Math.random() * 520;
    return {
      x: ox + (Math.random() - 0.5) * 120, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      s: 5 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 12, c: PAPER[i % PAPER.length],
    };
  });
  const T = 1300;
  const t0 = performance.now();
  let last = t0;
  const step = (t: number) => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const k = (t - t0) / T;
    if (k >= 1) {
      cv.remove();
      return;
    }
    g.clearRect(0, 0, w, h);
    g.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    for (const q of p) {
      q.vy += 1100 * dt;
      q.vx *= 1 - 1.6 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.r += q.vr * dt;
      g.save();
      g.translate(q.x, q.y);
      g.rotate(q.r);
      g.fillStyle = q.c;
      g.fillRect(-q.s / 2, -q.s / 3, q.s, (q.s * 2) / 3);
      g.restore();
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
