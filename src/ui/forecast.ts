// Прогнозы сроков для интерфейса: когда закончится исследование, проект обучения или контракт при заданной доле
// мощности. Только чтение состояния; формулы те же, что в симуляции (research.progressDay, training.progressDay,
// contracts.progressDay), поэтому срок в окне совпадает с тем, что случится в игре.

import { totalH100e } from '../sim/compute';
import { RP_BASE, RP_K, TRAIN_FLOP_PER_H100E_DAY } from '../sim/constants';
import { trainSpeedMult } from '../sim/lateState';
import { researchDaysLeft } from '../sim/research';
import type { GameState, TechId, TrainingRun } from '../sim/types';

/** Очков исследования в день при доле experiments (0…1) от всей мощности: команда даёт RP_BASE и без карт. */
export function rpAtShare(s: GameState, share: number): number {
  const power = totalH100e(s) * share;
  return RP_BASE + RP_K * Math.sqrt(power > 0 ? power : 0);
}

/** Дней до конца технологии при доле experiments (0…1); Infinity - дольше 10 лет. */
export function researchDaysAt(s: GameState, tech: TechId, share: number): number {
  return researchDaysLeft(s, tech, rpAtShare(s, share));
}

/** Дней до конца проекта обучения при доле training (0…1), доля делится поровну между проектами; null - мощности нет или проект стоит. */
export function trainingDaysAt(s: GameState, run: TrainingRun, share: number): number | null {
  if (run.failed) return null;
  const perDay = ((totalH100e(s) * share) / Math.max(1, s.trainings.length)) * TRAIN_FLOP_PER_H100E_DAY * trainSpeedMult(s);
  if (!(perDay > 0)) return null;
  return Math.max(1, Math.ceil((run.flopTotal - run.flopDone) / perDay));
}

/**
 * Сколько H100e нужно доле «Контракты», чтобы все контракты успели к сроку. Доля делится поровну, поэтому нужно
 * «самый требовательный контракт × число контрактов». null - контрактов нет.
 */
export function contractsNeed(s: GameState): number | null {
  if (s.contracts.length === 0) return null;
  let worst = 0;
  for (const c of s.contracts) {
    const left = Math.max(0, c.tender.work - c.workDone);
    const days = Math.max(1, c.deadlineDay - s.day);
    worst = Math.max(worst, left / days);
  }
  return worst * s.contracts.length;
}

/**
 * То же с поданными заявками: сколько H100e понадобится доле «Контракты», если все заявки выиграют.
 * Заявка считается как контракт, который только начался. null - ни контрактов, ни заявок.
 */
export function contractsNeedWithApplications(s: GameState): number | null {
  const apps = s.tenders.filter((t) => t.application !== null);
  if (s.contracts.length === 0 && apps.length === 0) return null;
  let worst = 0;
  for (const c of s.contracts) {
    const left = Math.max(0, c.tender.work - c.workDone);
    worst = Math.max(worst, left / Math.max(1, c.deadlineDay - s.day));
  }
  for (const t of apps) worst = Math.max(worst, (t.application?.work ?? t.work) / Math.max(1, t.durationDays));
  return worst * (s.contracts.length + apps.length);
}
