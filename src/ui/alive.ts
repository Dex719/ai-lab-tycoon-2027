// «Живость» интерфейса: плавное перестроение списков (FLIP), плавная смена содержимого вкладок.
// Только transform и opacity через Web Animations, по одному разу на событие; таймеров на кадр нет.

import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Пользователь просит меньше движения: все эффекты ниже тогда не запускаются. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Не трогать длинные списки: считаем только первые строки. */
const MAX_TRACKED = 80;
/** Если новых строк больше, чем это, список сменили целиком (другая папка, сортировка): анимация входа не нужна. */
const MAX_FRESH = 6;
const MAX_MOVED = 40;

/**
 * FLIP для списка: у дочерних элементов задай data-fk (стабильный ключ). Когда после перерисовки строка
 * сменила место, она плавно едет со старого (220 мс), новая строка появляется сверху вниз (200 мс).
 * Первая отрисовка не анимируется. Положение берём из offsetTop: прокрутка списка его не меняет.
 */
export function useFlip<T extends HTMLElement>(opts: { enter?: boolean } = {}): RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef<Map<string, number> | null>(null);
  const enter = opts.enter !== false;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) {
      prev.current = null;
      return;
    }
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-fk]')).slice(0, MAX_TRACKED);
    const was = prev.current;
    const now = new Map<string, number>();
    const fresh: HTMLElement[] = [];
    const moved: [HTMLElement, number][] = [];
    for (const el of els) {
      const k = el.dataset.fk as string;
      const top = el.offsetTop;
      now.set(k, top);
      if (!was) continue;
      const old = was.get(k);
      if (old === undefined) fresh.push(el);
      else if (Math.abs(old - top) > 1) moved.push([el, old - top]);
    }
    prev.current = now;
    if (!was || reducedMotion() || typeof root.animate !== 'function') return;
    if (enter && fresh.length > 0 && fresh.length <= MAX_FRESH) {
      for (const el of fresh) el.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' });
    }
    if (moved.length > 0 && moved.length <= MAX_MOVED) {
      for (const [el, dy] of moved) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    }
  });
  return ref;
}

/**
 * Смена вкладки в окне: всё, что идёт после полосы вкладок, коротко проявляется (140 мс, сдвиг 4 px).
 * Вешается один раз на рабочий стол и работает для любых кнопок .tab, поэтому окна не меняются.
 */
export function watchTabSwaps(root: HTMLElement): () => void {
  function onClick(e: MouseEvent) {
    const tab = e.target instanceof Element ? e.target.closest<HTMLElement>('.tab') : null;
    if (!tab || tab.classList.contains('on') || reducedMotion()) return;
    const bar = tab.parentElement;
    if (!bar) return;
    requestAnimationFrame(() => {
      for (let el = bar.nextElementSibling; el; el = el.nextElementSibling) {
        if (el instanceof HTMLElement && typeof el.animate === 'function') {
          el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 140, easing: 'ease-out' });
        }
      }
    });
  }
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
