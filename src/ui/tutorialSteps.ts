// Шаги обучения для новичков (.kiro/specs/ui-redesign/design.md, «Обучение»).
// Цель подсветки - элемент с data-tutorial="<id>"; берётся первый найденный из списка targets.
// Первая модель учится сразу, на LSTM, пока идёт «Механизм внимания»: её баллов хватает для тендеров 2017 года,
// и первые месяцы партии не проходят в ожидании исследования.

import { computeOrdered, orderedH100e, pool } from '../sim/compute';
import { canApply, contractWorkFor } from '../sim/contracts';
import { CLIENTS } from '../data/clients';
import { modelScore } from '../sim/training';
import { goalOfferOpen } from '../sim/goals';
import type { GameState, Speed } from '../sim/types';
import { contractsNeedWith, contractsNeedWithApplications, trainingDaysAt } from './forecast';
import { formatDateShort } from '../sim/time';
import { fmtH100e, fmtInt, h100ePerCard } from './format';
import type { WindowId } from './windows';

export interface TutorialCtx {
  open: ReadonlySet<WindowId>;
  speed: Speed;
}

export interface TutorialStep {
  title: string;
  /** Текст шага; функция - если в нём живые числа партии. */
  text: string | ((s: GameState) => string);
  /** Что подсветить: список data-tutorial по порядку предпочтения или функция от состояния партии. */
  targets: string[] | ((s: GameState) => string[]);
  /** Шаг закрывается сам, когда условие выполнено. Без условия - кнопкой «Далее». */
  done?: (s: GameState, ctx: TutorialCtx) => boolean;
}

/** Текст шага для текущего состояния. */
export function stepText(step: TutorialStep, s: GameState): string {
  return typeof step.text === 'function' ? step.text(s) : step.text;
}

/** Цели подсветки шага для текущего состояния. */
export function stepTargets(step: TutorialStep, s: GameState): string[] {
  return typeof step.targets === 'function' ? step.targets(s) : step.targets;
}

/**
 * Тендер для первой заявки: проходит выпущенная модель (по честному баллу) и хватает мощности вместе с уже взятым.
 * fit - лучший посильный (самый дорогой), minNeed - сколько нужно самому лёгкому подходящему, если посильных нет.
 */
export function tutorialTender(s: GameState): { fit: { client: string; need: number } | null; minNeed: number | null } {
  const models = s.models.filter((m) => m.releasedDay !== null);
  const cap = orderedH100e(s) * 1.02 + 1e-9;
  let fit: { client: string; need: number; pay: number } | null = null;
  let minNeed: number | null = null;
  for (const t of s.tenders) {
    if (t.application !== null) continue;
    for (const m of models) {
      if (canApply(s, t, m) !== null || modelScore(m, t.benchmark, true) < t.requirement) continue;
      const need = contractsNeedWith(s, { work: contractWorkFor(s, t, m), days: t.durationDays }) ?? 0;
      if (minNeed === null || need < minNeed) minNeed = need;
      if (need <= cap && (!fit || t.payment > fit.pay)) fit = { client: CLIENTS.find((c) => c.id === t.clientId)?.name ?? t.clientId, need, pay: t.payment };
    }
  }
  return { fit: fit && { client: fit.client, need: fit.need }, minNeed };
}

/** «≈120 карт»: сколько карт нынешнего вида добавят h H100e. */
function moreCards(s: GameState, h: number): string {
  return `≈${fmtInt(Math.max(1, Math.ceil(h / h100ePerCard(s))))} карт`;
}

const released = (s: GameState) => s.models.some((m) => m.releasedDay !== null);

/** Доли «Контракты» хватит контрактам и поданным заявкам к сроку (или заявок и контрактов нет: тендер проигран). */
export function contractPowerEnough(s: GameState): boolean {
  const need = contractsNeedWithApplications(s);
  return need === null || need <= pool(s, 'contracts') * 1.02 + 1e-9;
}

export const TUTORIAL: TutorialStep[] = [
  // Окно «Цели 2017 года» открывается сразу и держит время: первый шаг - выбрать цели в нём.
  {
    title: 'Цели года',
    text: 'Вы руководите ИИ-лабораторией с 1 января 2017 года. Отметьте три цели на год и нажмите «Принять цели»: за каждую выполненную - награда.',
    targets: ['goals-accept'],
    done: (s) => !goalOfferOpen(s),
  },
  {
    title: 'Мощности',
    text: 'Главная цель - лучшая модель на «Арене» 31.12.2024. Модели обучаются на видеокартах из облака: откройте «Мощности».',
    targets: ['icon-compute'],
    done: (_s, ctx) => ctx.open.has('compute'),
  },
  {
    title: 'Аренда видеокарт',
    text: 'Нажмите «Арендовать». Для начала хватит предложенных 96 карт Fermi P100: подтвердите аренду. Карты придут примерно через неделю.',
    targets: ['rent-confirm', 'rent-button', 'icon-compute'],
    done: (s) => computeOrdered(s),
  },
  {
    title: 'Доли мощности',
    text: 'Мощность делится между обучением, контрактами, исследованиями и API. Для начала подойдут доли по умолчанию.',
    targets: ['alloc', 'icon-compute'],
  },
  {
    title: 'Исследование',
    text: 'Откройте «Исследования» и начните «Механизм внимания»: обучение новых моделей станет эффективнее в 7 раз.',
    targets: ['research-start', 'tech-attention', 'icon-research'],
    done: (s) => s.research.current !== null || s.research.done.length > 0,
  },
  {
    title: 'Первая модель',
    text: 'Пока идёт исследование, обучите первую модель на прежней архитектуре LSTM: откройте «Новая модель» и нажмите «Начать обучение».',
    targets: ['train-confirm', 'train-start', 'icon-newModel'],
    done: (s) => s.trainings.length > 0 || s.models.length > 0,
  },
  {
    title: 'Время',
    text: 'Запустите время кнопкой ▶ рядом с датой или пробелом. Важные события сами ставят игру на паузу.',
    targets: ['speed-play'],
    done: (_s, ctx) => ctx.speed > 0,
  },
  {
    title: 'Тендеры',
    text: 'Откройте «Контракты»: клиент платит за модель с нужным баллом. Не успеете к сроку - штраф, минус репутация, без оплаты.',
    targets: ['icon-contracts'],
    done: (s, ctx) => ctx.open.has('contracts') || released(s),
  },
  {
    title: 'Выпуск модели',
    // Пока модель учится, шаг может висеть два-три месяца игры (плейтест 17.10): говорим срок и предлагаем ускорить время.
    text: (s) => {
      const run = s.trainings.find((t) => !t.failed);
      if (s.models.length === 0 && run) {
        const left = trainingDaysAt(s, run, s.compute.alloc.training);
        const when = left !== null ? `будет готова ${formatDateShort(s.day + left)}, через ${left} дн.` : 'ждёт мощности в доле «Обучение»';
        return `Модель ${when} Ускорьте время кнопкой ▶▶▶: игра сама встанет на паузу, когда модель будет готова.`;
      }
      return 'Модель готова: откройте «Модели», выберите цену за 1 млн токенов и нажмите «Выпустить».';
    },
    targets: (s) =>
      s.models.length > 0 ? ['release', 'icon-models'] : s.trainings.length > 0 ? ['speed-fast', 'icon-models'] : ['train-confirm', 'train-start', 'icon-newModel'],
    done: released,
  },
  {
    title: 'Заявка на тендер',
    text: (s) => {
      const { fit, minNeed } = tutorialTender(s);
      if (fit) return `В «Контрактах» подайте заявку на тендер «${fit.client}»: ему хватит вашей мощности (${fmtH100e(fit.need)} H100e в день).`;
      if (minNeed !== null) {
        return `Тендерам нужно от ${fmtH100e(minNeed)} H100e в день, а у вас ${fmtH100e(orderedH100e(s))}. Арендуйте ещё ${moreCards(s, minNeed - orderedH100e(s))}, потом подайте заявку.`;
      }
      return 'В «Контрактах» выберите тендер, требование которого проходит ваша модель, и нажмите «Подать заявку».';
    },
    targets: (s) => (tutorialTender(s).fit || tutorialTender(s).minNeed === null ? ['apply', 'icon-contracts'] : ['rent-button', 'icon-compute']),
    done: (s) => s.contracts.length > 0 || s.tenders.some((t) => t.application !== null),
  },
  // Без этого шага первый контракт срывался: долям по умолчанию (20 % от 96 карт) мало для тендеров 2017 года.
  {
    title: 'Мощность для контракта',
    text: (s) => {
      const need = contractsNeedWithApplications(s);
      const have = pool(s, 'contracts');
      const all = orderedH100e(s);
      if (need !== null && need > all * 1.02) {
        return `Контрактам нужно ${fmtH100e(need)} H100e в день, а всей мощности ${fmtH100e(all)}. Арендуйте ещё ${moreCards(s, need - all)}: придут через неделю.`;
      }
      const nums = need === null ? '' : `Нужно контрактам: ${fmtH100e(need)} H100e, выделено ${fmtH100e(have)}. `;
      return `${nums}В «Мощностях» нажмите «Как нужно» или сдвиньте границу доли «Контракты».`;
    },
    targets: (s) => {
      const need = contractsNeedWithApplications(s);
      return need !== null && need > orderedH100e(s) * 1.02 ? ['rent-button', 'icon-compute'] : ['alloc', 'icon-compute'];
    },
    done: contractPowerEnough,
  },
  {
    title: 'Дальше самостоятельно',
    text: 'После «Механизма внимания» обучите новую модель: при тех же затратах она будет заметно сильнее.',
    targets: ['icon-newModel'],
  },
];
