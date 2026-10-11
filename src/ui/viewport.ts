// Размер экрана: телефон (уже 768 px), планшет (768-1100 px) и компьютер. От него зависит раскладка партии.

import { useSyncExternalStore } from 'react';

export type Viewport = 'phone' | 'tablet' | 'desktop';

export const PHONE_MAX = 768;
export const TABLET_MAX = 1100;

export function viewportOf(width: number): Viewport {
  if (width < PHONE_MAX) return 'phone';
  if (width < TABLET_MAX) return 'tablet';
  return 'desktop';
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  window.addEventListener('orientationchange', cb);
  return () => {
    window.removeEventListener('resize', cb);
    window.removeEventListener('orientationchange', cb);
  };
}

export function useViewport(): Viewport {
  return useSyncExternalStore(
    subscribe,
    () => viewportOf(window.innerWidth),
    () => 'desktop',
  );
}

/** Основной указатель - палец: тогда наведения нет, и подсказки по нажатию нужны вместо него. */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
