// Шаги обучения для новичков. Восемь шагов, каждый - одно действие, подсвечена ровно та кнопка, которую нужно нажать
// (плейтест 19.10: прежние 12 шагов с долями мощности и H100e «никто не пройдёт»). Цель подсветки - элемент с
// data-tutorial="<id>"; берётся первый видимый из списка targets. Первая модель учится сразу, на LSTM, пока идёт
// «Механизм внимания»: её баллов хватает для тендеров 2017 года. Мощность под заявку выделяет сама игра (Tutorial.tsx).

import { availableGpus, computeOrdered, orderedCount, orderedH100e, pool, setAllocation, totalH100e } from '../sim/compute';
import { toAllocation } from './alloc';
import { GPUS } from '../data/gpus';
import { canApply, contractWorkFor } from '../sim/contracts';
import { CLIENTS } from '../data/clients';
import { modelScore } from '../sim/training';
import { goalOfferOpen } from '../sim/goals';
import type { GameState, GpuId, Speed } from '../sim/types';
import { contractsNeedWith, contractsNeedWithApplications, trainingDaysAt } from './forecast';
import { formatDateShort } from '../sim/time';
import { fmtInt } from './format';
import { ruPlural } from '../sim/text';
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
 * Какая часть всех карт должна покрыть заявку на шаге «Первый заказ» (посильный тендер). Доля «Контракты» берётся с запасом
 * 5 % и не больше TUTOR_CONTRACT_MAX_PCT: исследованию остаётся 15 %, продаже по API - 5 %, обучению - не меньше 10 %, чтобы
 * следующая модель после обучения игре не стояла без мощности.
 */
export const TUTOR_CONTRACT_SHARE = 0.65;
export const TUTOR_CONTRACT_MAX_PCT = 70;

/**
 * Доли на время обучения игре, с шага «Первый заказ»: контрактам - сколько нужно заявке и контракту (+5 %), исследованию
 * 15 %, продаже по API 5 %, остальное - обучению. Игрок доли не двигает (плейтест 19.10). Без мощности - ничего не меняет.
 */
export function tutorialPower(s: GameState): void {
  const total = totalH100e(s);
  if (!(total > 0)) return;
  const need = contractsNeedWithApplications(s) ?? 0;
  const contracts = Math.min(TUTOR_CONTRACT_MAX_PCT, Math.ceil((need / total) * 105));
  const api = s.models.some((m) => m.releasedDay !== null && m.onApi) ? 5 : 0;
  const experiments = s.research.current !== null ? 15 : 0;
  const training = Math.max(0, 100 - contracts - api - experiments);
  setAllocation(s, toAllocation({ training, contracts, experiments, api, subs: 0 }));
}

/**
 * Тендер для первой заявки: его проходит выпущенная модель (по честному баллу), и на него хватит TUTOR_CONTRACT_SHARE карт.
 * fit - лучший посильный (самый дорогой), minNeed - сколько нужно самому лёгкому подходящему, если посильных нет.
 */
export function tutorialTender(s: GameState): { fit: { id: string; client: string; need: number } | null; minNeed: number | null } {
  const models = s.models.filter((m) => m.releasedDay !== null);
  const cap = orderedH100e(s) * TUTOR_CONTRACT_SHARE + 1e-9;
  let fit: { id: string; client: string; need: number; pay: number } | null = null;
  let minNeed: number | null = null;
  for (const t of s.tenders) {
    if (t.application !== null) continue;
    for (const m of models) {
      if (canApply(s, t, m) !== null || modelScore(m, t.benchmark, true) < t.requirement) continue;
      const need = contractsNeedWith(s, { work: contractWorkFor(s, t, m), days: t.durationDays }) ?? 0;
      if (minNeed === null || need < minNeed) minNeed = need;
      if (need <= cap && (!fit || t.payment > fit.pay)) {
        fit = { id: t.id, client: CLIENTS.find((c) => c.id === t.clientId)?.name ?? t.clientId, need, pay: t.payment };
      }
    }
  }
  return { fit: fit && { id: fit.id, client: fit.client, need: fit.need }, minNeed };
}

/**
 * Сколько всего карт нужно на шаге «Первый заказ», чтобы появился посильный тендер (null - докупать не нужно). Окно аренды
 * подставляет это число, чтобы новичку не считать «96 + 19» самому (плейтест 19.10).
 */
export function tutorialRentGoal(s: GameState): { id: GpuId; count: number } | null {
  if (!s.tutorial.active || TUTORIAL[s.tutorial.step]?.title !== ORDER_STEP_TITLE) return null;
  const { fit, minNeed } = tutorialTender(s);
  if (fit || minNeed === null) return null;
  const id = GPUS.find((g) => s.compute.rented[g.id] > 0)?.id ?? availableGpus(s)[0]?.id;
  const def = GPUS.find((g) => g.id === id);
  if (!id || !def) return null;
  const others = orderedH100e(s) - orderedCount(s, id) * def.h100e;
  const count = Math.ceil((minNeed / TUTOR_CONTRACT_SHARE - others) / def.h100e) + 1;
  return count > orderedCount(s, id) ? { id, count } : null;
}

const released = (s: GameState) => s.models.some((m) => m.releasedDay !== null);
const applied = (s: GameState) => s.contracts.length > 0 || s.tenders.some((t) => t.application !== null);

/** Доли «Контракты» хватит контрактам и поданным заявкам к сроку (или заявок и контрактов нет: тендер проигран). */
export function contractPowerEnough(s: GameState): boolean {
  const need = contractsNeedWithApplications(s);
  return need === null || need <= pool(s, 'contracts') * 1.02 + 1e-9;
}

/** Шаг, с которого игра сама выделяет мощность под заявку и контракт (Tutorial.tsx). */
export const ORDER_STEP_TITLE = 'Первый заказ';

export const TUTORIAL: TutorialStep[] = [
  // Окно «Цели 2017 года» открывается сразу и держит время: первый шаг - выбрать цели в нём.
  {
    title: 'Цели года',
    text: 'Отметьте три цели на 2017 год и нажмите «Принять цели». За каждую выполненную - награда.',
    targets: ['goals-accept'],
    done: (s) => !goalOfferOpen(s),
  },
  {
    title: 'Видеокарты',
    text: 'Модели учатся на видеокартах из облака. Откройте «Мощности», нажмите «Арендовать» и подтвердите: карты заработают сразу.',
    targets: ['rent-confirm', 'rent-button', 'icon-compute'],
    done: (s) => computeOrdered(s),
  },
  {
    title: 'Исследование',
    text: 'Откройте «Исследования» и начните «Механизм внимания». После него новые модели будут в 7 раз сильнее.',
    targets: ['research-start', 'tech-attention', 'icon-research'],
    done: (s) => s.research.current !== null || s.research.done.length > 0,
  },
  {
    title: 'Первая модель',
    text: 'Откройте «Новая модель» и нажмите «Начать обучение». Настройки по умолчанию подойдут.',
    targets: ['train-confirm', 'train-start', 'icon-newModel'],
    done: (s) => s.trainings.length > 0 || s.models.length > 0,
  },
  {
    title: 'Время',
    text: (s) => {
      const run = s.trainings.find((t) => !t.failed);
      const left = run ? trainingDaysAt(s, run, s.compute.alloc.training) : null;
      const when = left !== null ? ` Модель будет готова ${formatDateShort(s.day + left)}.` : '';
      return `Нажмите ▶▶▶ рядом с датой, время пойдёт быстро.${when} Игра сама встанет на паузу.`;
    },
    targets: ['speed-fast', 'speed-play'],
    done: (s, ctx) => ctx.speed > 0 || s.models.length > 0,
  },
  {
    title: 'Выпуск модели',
    // Пока модель учится, шаг может висеть месяц-полтора игры: говорим срок, игра сама встанет на паузу.
    text: (s) => {
      const run = s.trainings.find((t) => !t.failed);
      if (s.models.length === 0 && run) {
        const left = trainingDaysAt(s, run, s.compute.alloc.training);
        return left !== null
          ? `Модель учится и будет готова ${formatDateShort(s.day + left)}. Ждите: игра встанет на паузу.`
          : 'Модели не хватает мощности: в «Мощностях» нажмите «Как нужно».';
      }
      return 'Модель готова. Откройте «Модели» и нажмите «Выпустить». Ред-тиминг в том же окне понадобится со второй модели.';
    },
    targets: (s) =>
      s.models.length > 0 ? ['release', 'icon-models'] : s.trainings.length > 0 ? ['speed-fast', 'icon-models'] : ['train-confirm', 'train-start', 'icon-newModel'],
    done: released,
  },
  {
    title: ORDER_STEP_TITLE,
    text: (s) => {
      const { fit, minNeed } = tutorialTender(s);
      // Название клиента с кавычками внутри («Гостиницы «Золотой Берег»») второй раз в кавычки не берём.
      const who = fit && (fit.client.includes('«') ? fit.client : `«${fit.client}»`);
      if (fit) return `Клиенты платят за модель с нужным баллом. Откройте «Контракты», выберите ${who} и нажмите «Подать заявку».`;
      const goal = tutorialRentGoal(s);
      if (minNeed !== null && goal) {
        const more = goal.count - orderedCount(s, goal.id);
        return `Тендерам нужно больше карт. В «Мощностях» нажмите «Арендовать»: нужное число (ещё ${fmtInt(more)} ${ruPlural(more, 'карта', 'карты', 'карт')}) уже подставлено.`;
      }
      return 'Подходящий тендер появится в ближайшие недели. Нажмите ▶ и откройте «Контракты», когда он придёт.';
    },
    targets: (s) => {
      const { fit, minNeed } = tutorialTender(s);
      if (fit) return ['tender-fit', 'apply', 'icon-contracts'];
      return minNeed !== null ? ['rent-confirm', 'rent-button', 'icon-compute'] : ['speed-play', 'icon-contracts'];
    },
    done: applied,
  },
  {
    title: 'Дальше сами',
    text: 'Мощность под заказ выделена. Деньги дают контракты и API, модели сильнее после исследований. Кончатся деньги - «Инвесторы».',
    targets: [],
  },
];
