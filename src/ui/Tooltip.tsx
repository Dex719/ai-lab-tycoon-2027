// Свои подсказки вместо встроенных браузерных: пока курсор над элементом, его title лежит в data-tip
// (встроенная подсказка не всплывает), а слой рисует подсказку рядом. Когда курсор уходит, title возвращается:
// React дальше сам меняет или снимает его, и устаревший текст не остаётся. Наведение показывает подсказку
// с задержкой, касание на телефоне - сразу и на 2,5 с.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const DELAY_MS = 350;
const TOUCH_MS = 2500;
const GAP = 6;
const EDGE = 8;

interface Tip {
  text: string;
  x: number; // центр якоря по горизонтали
  y: number; // верх (below) или низ (above) подсказки
  below: boolean;
}

/** Текст подсказки элемента: на время наведения title переносится в data-tip. */
function tipOf(el: HTMLElement): string | null {
  const title = el.getAttribute('title');
  if (title !== null) {
    el.dataset.tip = title;
    el.removeAttribute('title');
  }
  return el.dataset.tip || null;
}

/** Вернуть title на место (если React не поставил новый за время наведения). */
function restore(el: HTMLElement | null): void {
  if (!el || el.dataset.tip === undefined) return;
  if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip);
  delete el.dataset.tip;
}

function placeFor(el: HTMLElement, text: string): Tip {
  const r = el.getBoundingClientRect();
  const below = r.bottom + 72 < window.innerHeight || r.top < 72;
  return { text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [dx, setDx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let watch = 0;
    let anchor: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      window.clearInterval(watch);
      watch = 0;
      restore(anchor);
      anchor = null;
      setTip(null);
    };
    // Элемент под курсором может исчезнуть без mouseout (окно закрылось, список перерисовался):
    // пока подсказка видна, раз в 300 мс проверяем, что он ещё на странице.
    const show = (el: HTMLElement, text: string) => {
      setTip(placeFor(el, text));
      window.clearInterval(watch);
      watch = window.setInterval(() => {
        if (!el.isConnected) hide();
      }, 300);
    };
    const target = (e: Event): HTMLElement | null => {
      const t = e.target;
      if (!(t instanceof Element)) return null;
      return t.closest<HTMLElement>('[title], [data-tip]');
    };
    const onOver = (e: Event) => {
      const el = target(e);
      if (!el) return;
      if (el === anchor) return;
      const text = tipOf(el);
      if (!text) {
        restore(el);
        return;
      }
      restore(anchor);
      anchor = el;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (anchor === el && el.isConnected) show(el, text);
      }, DELAY_MS);
    };
    const onOut = (e: Event) => {
      const el = target(e);
      if (!el || el !== anchor) return;
      const to = (e as MouseEvent).relatedTarget;
      if (to instanceof Node && el.contains(to)) return;
      hide();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') {
        hide();
        return;
      }
      const el = target(e);
      if (!el) {
        hide();
        return;
      }
      if (el !== anchor) restore(anchor);
      const text = tipOf(el);
      if (!text) {
        hide();
        return;
      }
      window.clearTimeout(timer);
      anchor = el;
      show(el, text);
      timer = window.setTimeout(hide, TOUCH_MS);
    };
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(watch);
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Подсказка не должна выходить за край экрана: после отрисовки сдвигаем её внутрь.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !tip) {
      setDx(0);
      return;
    }
    const r = el.getBoundingClientRect();
    let shift = 0;
    if (r.left < EDGE) shift = EDGE - r.left;
    else if (r.right > window.innerWidth - EDGE) shift = window.innerWidth - EDGE - r.right;
    setDx(shift);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      className={`tip ${tip.below ? 'below' : 'above'}`}
      role="tooltip"
      style={{ left: tip.x + dx, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
