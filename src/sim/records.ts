// Рекорды лаборатории (идея «Вовлечение», 18.10): лучший месяц выручки, лучшая модель, крупнейший контракт, больше всего
// подписчиков, доля рынка, мощность, команда. Считаются в конце месяца; побитый рекорд показывает итог месяца
// (ui/MonthStrip) и страница «Рекорды» в «Аналитике». Компания растёт, поэтому какой-то рекорд бьётся почти каждый
// месяц - это частая честная награда без денег. Первое значение записывается молча: рекордом считается улучшение.

import { totalH100e } from './compute';
import type { GameState, RecordEntry, RecordId } from './types';

export const RECORD_IDS: readonly RecordId[] = ['revenue', 'elo', 'contract', 'subs', 'share', 'compute', 'staff'];

export const RECORD_NAMES: Record<RecordId, string> = {
  revenue: 'Выручка за месяц',
  elo: 'Лучшая модель, Эло',
  contract: 'Крупнейший контракт',
  subs: 'Подписчиков',
  share: 'Доля рынка',
  compute: 'Мощность, H100e',
  staff: 'Сотрудников',
};

function value(s: GameState, id: RecordId): number {
  switch (id) {
    case 'revenue': {
      const h = s.finance.history.at(-1);
      return h ? h.income.api + h.income.subs + h.income.contracts : 0;
    }
    case 'elo':
      return s.models.reduce((b, m) => (m.releasedDay !== null ? Math.max(b, m.arenaElo) : b), 0);
    case 'contract':
      return s.contracts.reduce((b, c) => Math.max(b, c.tender.payment), 0);
    case 'subs':
      return s.market.playerSubs ?? 0;
    case 'share':
      return s.market.labShares.player ?? 0;
    case 'compute':
      return totalH100e(s);
    case 'staff':
      return s.staff?.people.filter((e) => e.startDay <= s.day).length ?? 0;
  }
}

/** Минимальный рост, чтобы считать рекорд побитым: шум долей и Эло не должен давать рекорд каждый месяц. */
const MIN_GAIN: Record<RecordId, number> = { revenue: 0.02, elo: 0.005, contract: 0.01, subs: 0.03, share: 0.03, compute: 0.03, staff: 0 };

/** Конец месяца: обновить рекорды; вернуть побитые в этом месяце (для проверок). */
export function recordsMonth(s: GameState): RecordId[] {
  const rec = (s.records ??= {});
  const broken: RecordId[] = [];
  for (const id of RECORD_IDS) {
    const v = value(s, id);
    if (!(v > 0)) continue;
    const old = rec[id];
    if (!old) {
      rec[id] = { value: v, day: s.day, prev: null };
      continue;
    }
    if (v > old.value * (1 + MIN_GAIN[id]) && v > old.value) {
      rec[id] = { value: v, day: s.day, prev: old.value };
      broken.push(id);
    }
  }
  return broken;
}

/** Рекорды, побитые в день day (итог месяца берёт день закрытия). */
export function recordsBrokenOn(s: GameState, day: number): { id: RecordId; entry: RecordEntry }[] {
  const out: { id: RecordId; entry: RecordEntry }[] = [];
  for (const id of RECORD_IDS) {
    const e = s.records?.[id];
    if (e && e.day === day && e.prev !== null) out.push({ id, entry: e });
  }
  return out;
}
