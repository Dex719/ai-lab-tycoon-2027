// «Следующий шаг» на рабочем столе в первый год партии: одно дело, которое стоит сделать сейчас, и кнопка к нужному окну.
// Нужна новичку, который выключил обучение игре или уже прошёл его: первые месяцы ждать «Механизм внимания» не нужно,
// первая модель учится на LSTM и проходит тендеры 2017 года. Только чтение состояния.

import { CLIENTS } from '../data/clients';
import { benchDef } from '../sim/benchmarks';
import { computeOrdered, nextArrival, pool, totalH100e } from '../sim/compute';
import { canApply } from '../sim/contracts';
import { BANKRUPT_DAYS } from '../sim/constants';
import { formatDateShort, START_DAY } from '../sim/time';
import { modelScore } from '../sim/training';
import type { GameState, PlayerModel, Tender } from '../sim/types';
import { contractsNeedWithApplications, researchDaysAt, trainingDaysAt } from './forecast';
import { fmtH100e, fmtMoney } from './format';
import type { WindowId } from './windows';

export interface NextStep {
  id: 'broke' | 'rent' | 'rent-wait' | 'contract-power' | 'release' | 'research' | 'first-model' | 'transformer' | 'tender' | 'research-wait' | 'waiting' | 'stopped' | 'time';
  title: string;
  detail: string;
  /** Глагол на кнопке; null - кнопки нет. */
  action: string | null;
  /** Окно, которое открывает кнопка; 'play' - кнопка запускает время. */
  open: WindowId | 'play';
}

/** Подсказка видна только в первый год партии. */
export const NEXT_STEP_DAYS = 365;

function clientName(id: string): string {
  return CLIENTS.find((c) => c.id === id)?.name ?? 'Клиент';
}

/** Самый дорогой открытый тендер, который выпущенная модель проходит честным баллом; null - такого нет. */
export function bestOpenTender(s: GameState): { tender: Tender; model: PlayerModel } | null {
  const released = s.models.filter((m) => m.releasedDay !== null);
  let best: { tender: Tender; model: PlayerModel } | null = null;
  for (const t of s.tenders) {
    if (t.application !== null) continue;
    const model = released.find((m) => canApply(s, t, m) === null && modelScore(m, t.benchmark, true) >= t.requirement);
    if (model && (!best || t.payment > best.tender.payment)) best = { tender: t, model };
  }
  return best;
}

/** Самый дорогой открытый тендер без заявки (для подсказки, пока модель обучается). */
function richestTender(s: GameState): Tender | null {
  let best: Tender | null = null;
  for (const t of s.tenders) if (t.application === null && (!best || t.payment > best.payment)) best = t;
  return best;
}

/**
 * Следующий шаг или null: подсказка не нужна (обучение игре идёт, первый год прошёл, партия окончена или всё сделано).
 * speed - скорость игры: пока время ни разу не шло, а ждать уже есть чего, подсказка - запустить время.
 */
export function nextStep(s: GameState, speed = 1): NextStep | null {
  // Деньги в минусе - в любой год: плейтест 18.10, игрок 59 дней ждал банкротства и не знал, что делать.
  if (!s.outcome && s.cash < 0) {
    const left = Math.max(0, BANKRUPT_DAYS - s.finance.negativeDays);
    return {
      id: 'broke',
      title: `Деньги в минусе: до банкротства ${left} дн.`,
      detail: 'Верните часть карт в «Мощностях», чтобы аренда стала меньше дохода, или продайте долю в «Инвесторах».',
      action: 'Открыть «Мощности»',
      open: 'compute',
    };
  }
  const step = firstStep(s);
  if (step && step.id === 'waiting' && speed === 0 && s.day === START_DAY) {
    return {
      id: 'time',
      title: 'Запустите время',
      detail: 'Модель обучается, только пока идёт время: кнопка ▶ рядом с датой или пробел. Важные события сами ставят игру на паузу.',
      action: 'Запустить',
      open: 'play',
    };
  }
  return step;
}

function firstStep(s: GameState): NextStep | null {
  if (s.tutorial.active || s.outcome || s.day >= START_DAY + NEXT_STEP_DAYS) return null;

  if (!computeOrdered(s)) {
    return { id: 'rent', title: 'Арендуйте видеокарты', detail: 'На них обучаются модели и выполняются контракты.', action: 'Арендовать', open: 'compute' };
  }
  const arrival = totalH100e(s) <= 0 ? nextArrival(s) : null;
  if (arrival && s.research.current === null && s.research.done.length === 0) {
    return {
      id: 'rent-wait',
      title: 'Карты в пути',
      detail: `Видеокарты придут ${formatDateShort(arrival.day)}. Пока выберите исследование: команда работает и без карт.`,
      action: 'Исследования',
      open: 'research',
    };
  }

  // Заявки считаются вместе с контрактами: мощность лучше добавить до победы, иначе первые дни контракта пропадут.
  const need = contractsNeedWithApplications(s);
  const have = pool(s, 'contracts');
  if (need !== null && need > have * 1.02 + 1e-9) {
    return {
      id: 'contract-power',
      title: s.contracts.length > 0 ? 'Контракт не успеет к сроку' : 'Заявке на тендер мало мощности',
      detail: `Доле «Контракты» нужно ${fmtH100e(need)} H100e, сейчас ${fmtH100e(have)}. Арендуйте карты или поднимите долю.`,
      action: 'Добавить мощность',
      open: 'compute',
    };
  }

  const released = s.models.some((m) => m.releasedDay !== null);
  const waiting = s.models.find((m) => m.releasedDay === null);
  if (!released && waiting) {
    return {
      id: 'release',
      title: `Выпустите модель «${waiting.name}»`,
      detail: 'Заявку на тендер подают выпущенной моделью.',
      action: 'Выпустить',
      open: 'models',
    };
  }

  const attentionDone = s.research.done.includes('attention');
  if (!attentionDone && s.research.current === null && s.research.queue.length === 0) {
    return {
      id: 'research',
      title: 'Начните исследование «Механизм внимания»',
      detail: 'Обучение новых моделей станет эффективнее в 7 раз.',
      action: 'Выбрать',
      open: 'research',
    };
  }

  if (s.models.length === 0 && s.trainings.length === 0) {
    return {
      id: 'first-model',
      title: 'Обучите первую модель',
      detail: attentionDone
        ? 'Её баллов хватит для первых тендеров.'
        : 'Пока идёт исследование, модель учится на прежней архитектуре LSTM. Её баллов хватит для первых тендеров.',
      action: 'Начать обучение',
      open: 'newModel',
    };
  }

  const transformer = s.models.some((m) => m.arch === 'transformer') || s.trainings.some((t) => t.arch === 'transformer');
  if (attentionDone && !transformer) {
    return {
      id: 'transformer',
      title: 'Обучите модель на «Трансформере»',
      detail: '«Механизм внимания» изучен: при тех же затратах модель будет заметно сильнее прежней.',
      action: 'Начать обучение',
      open: 'newModel',
    };
  }

  if (s.contracts.length === 0 && !s.tenders.some((t) => t.application !== null)) {
    const fit = bestOpenTender(s);
    if (fit) {
      const t = fit.tender;
      return {
        id: 'tender',
        title: 'Подайте заявку на тендер',
        detail: `${clientName(t.clientId)} платит ${fmtMoney(t.payment)} за модель с баллом ${benchDef(t.benchmark).name} от ${t.requirement} %.`,
        action: 'Выбрать тендер',
        open: 'contracts',
      };
    }
  }

  // Первая модель выпущена, «Механизм внимания» ещё идёт: доля «Обучение» стоит без дела до его конца.
  const cur = s.research.current;
  if (released && !attentionDone && cur === 'attention' && !s.trainings.some((t) => !t.failed) && s.compute.alloc.training > 0) {
    const days = researchDaysAt(s, cur, s.compute.alloc.experiments);
    return {
      id: 'research-wait',
      title: `«Механизм внимания»: готово ${Number.isFinite(days) ? formatDateShort(s.day + Math.max(1, days)) : 'не скоро'}`,
      detail: 'После него новая модель будет заметно сильнее. До тех пор свободную долю «Обучение» можно отдать исследованию или контрактам.',
      action: 'Изменить доли',
      open: 'compute',
    };
  }

  if (s.models.length === 0) {
    const run = s.trainings.find((t) => !t.failed) ?? s.trainings[0];
    if (run?.failed) {
      return {
        id: 'stopped',
        title: `Обучение «${run.plan.name}» остановлено`,
        detail: 'Как продолжить, решается в письме о срыве обучения.',
        action: 'Открыть почту',
        open: 'mail',
      };
    }
    const days = run ? trainingDaysAt(s, run, s.compute.alloc.training) : null;
    if (run && days === null) {
      return {
        id: 'stopped',
        title: `Обучение «${run.plan.name}» стоит`,
        detail: 'Доля «Обучение» в «Мощностях» равна 0 %.',
        action: 'Изменить доли',
        open: 'compute',
      };
    }
    const t = richestTender(s);
    return {
      id: 'waiting',
      title: run ? `«${run.plan.name}» обучается${days !== null ? `, готово ${formatDateShort(s.day + days)}` : ''}` : 'Модель обучается',
      detail: t
        ? `Открыт тендер: ${clientName(t.clientId)} платит ${fmtMoney(t.payment)} за ${benchDef(t.benchmark).name} от ${t.requirement} %. Новые появляются каждый месяц.`
        : 'Тендеры для выпущенной модели появляются каждый месяц.',
      action: t ? 'Открыть тендеры' : null,
      open: 'contracts',
    };
  }

  return null;
}
