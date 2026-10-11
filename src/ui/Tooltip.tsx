// Свои подсказки вместо встроенных браузерных: у элемента с атрибутом title текст переносится в data-tip
// (встроенная подсказка больше не всплывает), а слой рисует подсказку рядом с элементом. Наведение показывает её
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

/** Текст подсказки элемента: title переносится в data-tip при первом наведении. */
function tipOf(el: HTMLElement): string | null {
  const title = el.getAttribute('title');
  if (title !== null) {
    el.dataset.tip = title;
    el.removeAttribute('title');
  }
  return el.dataset.tip ?? null;
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
    let anchor: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      anchor = null;
      setTip(null);
    };
    const target = (e: Event): HTMLElement | null => {
      const t = e.target;
      if (!(t instanceof Element)) return null;
      return t.closest<HTMLElement>('[title], [data-tip]');
    };
    const onOver = (e: Event) => {
      const el = target(e);
      if (!el) return;
      const text = tipOf(el);
      if (!text || el === anchor) return;
      anchor = el;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (anchor === el && el.isConnected) setTip(placeFor(el, text));
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
      const text = el ? tipOf(el) : null;
      if (!el || !text) {
        hide();
        return;
      }
      window.clearTimeout(timer);
      anchor = el;
      setTip(placeFor(el, text));
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
