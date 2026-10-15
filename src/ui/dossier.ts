// Открыть досье лаборатории из любого места (сводка, баннер гонки): «Аналитика» переключается на вкладку
// «Лаборатории» и выбирает нужную лабораторию. Окно может быть ещё закрыто - тогда выбор забирается при открытии.

import type { LabId } from '../sim/types';
import type { WindowAlias, WindowId } from './windows';

let pending: LabId | null = null;
const listeners = new Set<() => void>();

export function openDossier(lab: LabId, open: (id: WindowId | WindowAlias) => void): void {
  pending = lab;
  for (const f of listeners) f();
  open('analytics');
}

/** Есть ли невыбранный запрос (окно решает, с какой вкладки открыться). */
export function dossierPending(): boolean {
  return pending !== null;
}

/** Забрать запрос: вернёт лабораторию один раз. */
export function takeDossier(): LabId | null {
  const lab = pending;
  pending = null;
  return lab;
}

export function onDossier(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
