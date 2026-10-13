// Простой мощности: доля выделена, а работы для неё нет. Только чтение состояния, без изменений.

import { ALLOC_KEYS, pool, totalH100e } from './compute';
import { subsOpen } from './market';
import { canResearch } from './research';
import { START_DAY } from './time';
import type { Allocation, GameState, TechId } from './types';
import { TECH_IDS } from './types';

/** Куда вести игрока, чтобы исправить простой. */
export type IdleFix = 'research' | 'newModel' | 'contracts' | 'models' | 'mail' | 'compute';

export interface IdleItem {
  /** Доля, которая простаивает; 'free' - мощность не распределена вовсе. */
  kind: keyof Allocation | 'free';
  /** Сколько H100e простаивает. */
  h100e: number;
  /** Причина одной фразой: «исследование не выбрано». */
  reason: string;
  fix: IdleFix;
  /** Подпись кнопки-глагола. */
  fixLabel: string;
}

/** Первые дни новой игры предупреждений о простое нет: игрок только осваивается. */
export const IDLE_GRACE_START_DAYS = 14;
/** После изменения аренды предупреждения молчат столько дней. */
export const IDLE_GRACE_RENT_DAYS = 3;

/** Предупреждения о простое пока не показываем: начало партии или аренду только что меняли. */
export function idleQuiet(s: GameState): boolean {
  if (s.day < START_DAY + IDLE_GRACE_START_DAYS) return true;
  const c = s.compute.rentChangedDay;
  return c !== undefined && s.day - c < IDLE_GRACE_RENT_DAYS;
}

/** Меньше этой доли мощности простоем не считаем (округление ползунков). */
const MIN_IDLE_SHARE = 0.005;

function researchAvailable(s: GameState): boolean {
  return TECH_IDS.some((t: TechId) => canResearch(s, t));
}

/** Все места, где мощность сейчас простаивает; пусто - всё занято (или карт нет). */
export function idleCompute(s: GameState): IdleItem[] {
  const total = totalH100e(s);
  if (!(total > 0) || s.outcome) return [];
  const out: IdleItem[] = [];
  const has = (k: keyof Allocation): boolean => s.compute.alloc[k] > MIN_IDLE_SHARE;
  const sold = s.models.filter((m) => m.releasedDay !== null);

  if (has('experiments') && s.research.current === null && s.research.queue.length === 0) {
    out.push(
      researchAvailable(s)
        ? { kind: 'experiments', h100e: pool(s, 'experiments'), reason: 'исследование не выбрано', fix: 'research', fixLabel: 'Выбрать' }
        : { kind: 'experiments', h100e: pool(s, 'experiments'), reason: 'нечего исследовать', fix: 'compute', fixLabel: 'Изменить доли' },
    );
  }
  if (has('training') && !s.trainings.some((t) => !t.failed)) {
    out.push(
      s.trainings.length > 0
        ? { kind: 'training', h100e: pool(s, 'training'), reason: 'обучение ждёт вашего решения', fix: 'mail', fixLabel: 'Открыть' }
        : { kind: 'training', h100e: pool(s, 'training'), reason: 'обучение не запущено', fix: 'newModel', fixLabel: 'Начать' },
    );
  }
  if (has('contracts') && s.contracts.length === 0) {
    out.push(
      sold.length > 0
        ? { kind: 'contracts', h100e: pool(s, 'contracts'), reason: 'нет контрактов', fix: 'contracts', fixLabel: 'Выбрать' }
        : { kind: 'contracts', h100e: pool(s, 'contracts'), reason: 'нет контрактов и моделей', fix: 'compute', fixLabel: 'Изменить доли' },
    );
  }
  if (sold.length > 0 && has('api') && !sold.some((m) => m.onApi)) {
    out.push({ kind: 'api', h100e: pool(s, 'api'), reason: 'нет моделей на API', fix: 'models', fixLabel: 'Открыть' });
  }
  if (sold.length > 0 && subsOpen(s.day) && has('subs') && !sold.some((m) => m.onSubs)) {
    out.push({ kind: 'subs', h100e: pool(s, 'subs'), reason: 'нет моделей в подписке', fix: 'models', fixLabel: 'Открыть' });
  }
  const used = ALLOC_KEYS.reduce((a, k) => a + (s.compute.alloc[k] > 0 ? s.compute.alloc[k] : 0), 0);
  if (1 - used > MIN_IDLE_SHARE) {
    out.push({ kind: 'free', h100e: total * (1 - used), reason: 'доли распределены не полностью', fix: 'compute', fixLabel: 'Изменить доли' });
  }
  return out;
}

/** Предупреждения для игрока: то же, что idleCompute, но молчат в первые дни партии и сразу после смены аренды. */
export function idleWarnings(s: GameState): IdleItem[] {
  return idleQuiet(s) ? [] : idleCompute(s);
}

/** Сколько H100e простаивает всего. */
export function idleTotal(items: readonly IdleItem[]): number {
  return items.reduce((a, i) => a + i.h100e, 0);
}
