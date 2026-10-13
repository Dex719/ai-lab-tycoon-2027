// Шаги обучения для новичков (.kiro/specs/ui-redesign/design.md, «Обучение»).
// Цель подсветки - элемент с data-tutorial="<id>"; берётся первый найденный из списка targets.

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
  targets: string[];
  /** Шаг закрывается сам, когда условие выполнено. Без условия - кнопкой «Далее». */
  done?: (s: GameState, ctx: TutorialCtx) => boolean;
}

export const TUTORIAL: TutorialStep[] = [
  {
    title: 'Добро пожаловать',
    text:
      'Вы руководите ИИ-лабораторией с 1 января 2017 года. На счету $3 млн. Цель - 1-е место среди моделей в продаже ' +
      'на 31.12.2024. Обучение покажет первые шаги, его можно пропустить.',
    targets: [],
  },
  {
    title: 'Мощности',
    text: 'Модели обучаются на видеокартах, их арендуют в облаке. Откройте «Мощности».',
    targets: ['icon-compute'],
    done: (_s, ctx) => ctx.open.has('compute'),
  },
  {
    title: 'Аренда видеокарт',
    text: 'Нажмите «Арендовать», выберите Fermi P100 и количество. Для начала хватит 90-100 карт: около $130 тыс. в месяц.',
    targets: ['rent-button', 'icon-compute'],
    done: (s) => totalH100e(s) > 0,
  },
  {
    title: 'Распределение мощности',
    text:
      'Мощность делится между обучением, контрактами, исследованиями и API. ' +
      'Пока моделей нет, большую часть отдайте исследованиям. Введите доли и нажмите «Распределить».',
    targets: ['alloc', 'icon-compute'],
  },
  {
    title: 'Исследования',
    text:
      'Откройте «Исследования» и нажмите «Механизм внимания». Выберите мощность и нажмите «Начать исследование». ' +
      'Без этой технологии модели обучаются примерно в 7 раз хуже. Следующие технологии можно поставить в очередь.',
    targets: ['research-start', 'tech-attention', 'icon-research'],
    done: (s) => s.research.current === 'attention' || s.research.done.includes('attention'),
  },
  {
    title: 'Время',
    text: 'Запустите время кнопкой ▶ на верхней панели или пробелом. Важные события сами ставят игру на паузу.',
    targets: ['speed-play'],
    done: (_s, ctx) => ctx.speed > 0,
  },
  {
    title: 'Первая модель',
    text:
      'Когда «Механизм внимания» будет изучен, верните часть мощности на обучение в «Мощностях». ' +
      'Затем откройте «Новая модель», выберите уровень «Средняя» и нажмите «Начать обучение». Стоимость и срок покажет окно подтверждения.',
    targets: ['train-start', 'icon-newModel'],
    done: (s) => s.trainings.length > 0 || s.models.length > 0,
  },
  {
    title: 'Выпуск модели',
    text:
      'Готовая модель появится в окне «Модели». Укажите цену за 1 млн токенов и нажмите «Выпустить». ' +
      'Запросы по API обслуживает доля «API» в «Мощностях», позже появится и продажа по подписке.',
    targets: ['release', 'icon-models'],
    done: (s) => s.models.some((m) => m.releasedDay !== null),
  },
  {
    title: 'Контракты',
    text: 'Контракты на дообучение приносят первые деньги. В «Контрактах» выберите тендер, требование которого ваша модель проходит, и подайте заявку.',
    targets: ['apply', 'icon-contracts'],
    done: (s) => s.contracts.length > 0 || s.tenders.some((t) => t.application !== null),
  },
  {
    title: 'Дальше самостоятельно',
    text:
      'Рынок, рейтинги и финансы - в «Аналитике». Деньги на крупные модели дают «Инвесторы». ' +
      'Побеждает лаборатория, чья модель на 31.12.2024 первая по Эло среди моделей в продаже.',
    targets: ['icon-analytics', 'icon-investors'],
  },
];
