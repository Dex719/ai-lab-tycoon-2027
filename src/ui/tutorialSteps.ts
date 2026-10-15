// Шаги обучения для новичков (.kiro/specs/ui-redesign/design.md, «Обучение»).
// Цель подсветки - элемент с data-tutorial="<id>"; берётся первый найденный из списка targets.
// Первая модель учится сразу, на LSTM, пока идёт «Механизм внимания»: её баллов хватает для тендеров 2017 года,
// и первые месяцы партии не проходят в ожидании исследования.

import { totalH100e } from '../sim/compute';
import type { GameState, Speed } from '../sim/types';
import type { WindowId } from './windows';

export interface TutorialCtx {
  open: ReadonlySet<WindowId>;
  speed: Speed;
}

export interface TutorialStep {
  title: string;
  text: string;
  /** Что подсветить: список data-tutorial по порядку предпочтения или функция от состояния партии. */
  targets: string[] | ((s: GameState) => string[]);
  /** Шаг закрывается сам, когда условие выполнено. Без условия - кнопкой «Далее». */
  done?: (s: GameState, ctx: TutorialCtx) => boolean;
}

/** Цели подсветки шага для текущего состояния. */
export function stepTargets(step: TutorialStep, s: GameState): string[] {
  return typeof step.targets === 'function' ? step.targets(s) : step.targets;
}

const released = (s: GameState) => s.models.some((m) => m.releasedDay !== null);

export const TUTORIAL: TutorialStep[] = [
  {
    title: 'Добро пожаловать',
    text: 'Вы руководите ИИ-лабораторией с 1 января 2017 года. На счету $3 млн. Цель - лучшая модель на «Арене» 31.12.2024.',
    targets: [],
  },
  {
    title: 'Мощности',
    text: 'Модели обучаются на видеокартах, карты арендуют в облаке. Откройте «Мощности».',
    targets: ['icon-compute'],
    done: (_s, ctx) => ctx.open.has('compute'),
  },
  {
    title: 'Аренда видеокарт',
    text: 'Нажмите «Арендовать». Для начала хватит предложенных 96 карт Fermi P100: подтвердите аренду.',
    targets: ['rent-confirm', 'rent-button', 'icon-compute'],
    done: (s) => totalH100e(s) > 0,
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
    text: 'Запустите время кнопкой ▶ на верхней панели или пробелом. Важные события сами ставят игру на паузу.',
    targets: ['speed-play'],
    done: (_s, ctx) => ctx.speed > 0,
  },
  {
    title: 'Тендеры',
    text: 'Пока модель обучается, откройте «Контракты». Клиенты платят за модель с нужным баллом на тесте.',
    targets: ['icon-contracts'],
    done: (s, ctx) => ctx.open.has('contracts') || released(s),
  },
  {
    title: 'Выпуск модели',
    text: 'Когда модель будет готова, откройте «Модели», выберите цену за 1 млн токенов и нажмите «Выпустить».',
    targets: (s) =>
      s.models.length > 0 ? ['release', 'icon-models'] : s.trainings.length > 0 ? ['icon-models'] : ['train-confirm', 'train-start', 'icon-newModel'],
    done: released,
  },
  {
    title: 'Заявка на тендер',
    text: 'В «Контрактах» выберите тендер, требование которого проходит ваша модель, и нажмите «Подать заявку».',
    targets: ['apply', 'icon-contracts'],
    done: (s) => s.contracts.length > 0 || s.tenders.some((t) => t.application !== null),
  },
  {
    title: 'Дальше самостоятельно',
    text:
      'Выигранный контракт берёт мощность из доли «Контракты»: если её мало, арендуйте ещё карты. ' +
      'После «Механизма внимания» обучите новую модель.',
    targets: ['icon-compute'],
  },
];
