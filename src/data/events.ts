// Исторические и механические события среза (FR-11). TSK-009.
// Эффекты - функции над состоянием; в сохранение попадают только id события и номер выбора.
// Варианты выбора в письме заданы заранее, поэтому событие с ветками сделано парой:
// из двух событий срабатывает ровно одно (условия не пересекаются, плюс проверка «другое не срабатывало»).

import {
  ALGO_MULT,
  ARENA_OPEN_DATE,
  ATTENTION_PAPER_DISCOUNT,
  BOARD_BUYBACK_PREMIUM,
  BOARD_BUYBACK_SHARE,
  BOARD_DEFEND_REP,
  BOARD_PLAN_HYPE,
  BOARD_PLAN_VALUATION_MULT,
  CHAT_MOMENT_BRAND,
  CHAT_MOMENT_DATE,
  EXPORT_CONTROL_BRAND,
  FAIL_CHOICE_DAYS,
  FAIL_CONTINUE_PENALTY,
  FAIL_ROLLBACK,
  FOUNDER_BOARD_SHARE,
} from '../sim/constants';
import { availableGpus, rentPerGpuDay } from '../sim/compute';
import { addModifier, FOREVER } from '../sim/events';
import { spend } from '../sim/finance';
import { BOARD_PLAN_FLAG, buyBackShares, buybackCost } from '../sim/investors';
import { bestElo } from '../sim/leaderboard';
import { RIVALRY_EVENTS } from '../sim/rivalry';
import { endSentence, pointsWord, timesWord } from '../sim/text';
import { dateToDay } from '../sim/time';
import { applyFailChoice } from '../sim/training';
import type { GameState, GpuDef, HypeOwner, Mail, PlayerModel } from '../sim/types';
import { GPUS } from './gpus';
import { LABS } from './labs';

export interface EventChoiceDef {
  label: string;
  hint: string; // коротко, что будет: «+15 репутации, −$200 тыс.»
  apply: (s: GameState) => void;
}

export interface EventDef {
  id: string;
  /** Дата срабатывания или условие (проверяется ежедневно, пока событие не сработало). */
  when: { date: string } | { check: (s: GameState) => boolean };
  /** Повторяемые события (срыв обучения) запускаются только явно через triggerEvent. */
  repeatable?: boolean;
  mail: (s: GameState) => { title: string; body: string; kind: Mail['kind'] };
  onFire?: (s: GameState) => void;
  choices?: EventChoiceDef[];
  /** Сколько дней можно отложить ответ (по умолчанию CHOICE_DAYS). */
  choiceDays?: number;
  /** Вариант, который выберется сам по истечении срока (по умолчанию последний). */
  defaultChoice?: number;
}

// ---------- Даты и числа событий ----------

const ATTENTION_DATE = '2017-06-12';
const CHAT_DATE = CHAT_MOMENT_DATE; // чат-момент: с него же открыт канал подписок (sim/market.subsOpen)
const SHORTAGE_END = '2024-03-31';
/** Строка о канале подписок в письмах чат-момента: с этого дня модели можно продавать по подписке. */
const SUBS_OPEN_NOTE = 'С этого дня модели можно продавать по подписке: включите её в окне «Модели» и выделите долю «Подписки» в «Мощностях».';
const AD_COST = 300_000; // реклама своего API после открытия GTP-3

// ---------- Помощники ----------

/** Деньги для писем: «$1,2 млн», «$350 тыс.», «$800». Пороги чуть ниже круглых, чтобы после округления не вышло «$1000 тыс.». */
export function money(n: number): string {
  const dec = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
  if (n >= 1e9 - 5e4) return `$${dec(n / 1e9)} млрд`;
  if (n >= 1e6 - 500) return `$${dec(n / 1e6)} млн`;
  if (n >= 1e3 - 0.5) return `$${dec(n / 1e3)} тыс.`;
  return `$${Math.round(n)}`;
}

const clamp100 = (x: number): number => Math.max(0, Math.min(100, x));

/** «48,5» из 0,485: доля основателя с десятыми. */
function fmtShare(share: number): string {
  return String(Math.round(share * 1000) / 10).replace('.', ',');
}

function addHype(s: GameState, owner: HypeOwner, delta: number): void {
  s.hype[owner] = clamp100(s.hype[owner] + delta);
}

function addReputation(s: GameState, delta: number): void {
  s.reputation = clamp100(s.reputation + delta);
}

/** Лучшая выпущенная модель игрока с RLHF (по Эло) или null. */
function bestChatModel(s: GameState): PlayerModel | null {
  let best: PlayerModel | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || !m.rlhf) continue;
    if (best === null || m.arenaElo > best.arenaElo) best = m;
  }
  return best;
}

/** «Ваш момент» ChatGTP: у игрока выпущен чат с RLHF и его Эло не ниже лучшей модели OpenBrain. */
function playerChatMoment(s: GameState): boolean {
  const m = bestChatModel(s);
  return m !== null && m.arenaElo >= bestElo(s, 'openbrain');
}

const CHINESE_LABS = LABS.filter((l) => l.chinese);

/** Экспортный запрет: бренд китайских лабораторий падает навсегда (два запрета вместе дают EXPORT_CONTROL_BRAND). */
function exportControls(id: string, date: string, title: string, body: string): EventDef {
  return {
    id,
    when: { date },
    mail: () => ({ kind: 'news', title, body }),
    onFire: (s) => {
      for (const lab of CHINESE_LABS) {
        addModifier(s, {
          id: `${id}-${lab.id}`,
          kind: 'labBrand',
          target: lab.id,
          add: EXPORT_CONTROL_BRAND / 2,
          untilDay: FOREVER,
        });
      }
      s.flags.exportControls = true; // флаг из design.md: интерфейс может показать пометку
    },
  };
}

const CHINESE_NAMES = CHINESE_LABS.map((l) => l.name).join(', ');


/** Новость о новом поколении GPU: насколько дешевле стал H100e-день по сравнению с лучшим прежним вариантом. */
function gpuEvent(gpu: GpuDef): EventDef {
  return {
    id: `gpu-${gpu.id}`,
    when: { date: gpu.availableFrom },
    mail: (s) => {
      const perH = (id: GpuDef['id']) => rentPerGpuDay(s, id) / GPUS.find((g) => g.id === id)!.h100e;
      const older = availableGpus(s).filter((g) => g.id !== gpu.id);
      const best = older.length ? Math.min(...older.map((g) => perH(g.id))) : null;
      const now = perH(gpu.id);
      const gain =
        best !== null && best > now
          ? ` Вычисления на ней дешевле ${timesWord(best / now)}, чем на любой из прежних карт.`
          : '';
      return {
        kind: 'news',
        title: `Вышла новая видеокарта: ${gpu.name}`,
        body:
          `${gpu.name} доступна в облаке. Мощность одной карты - ${String(Math.round(gpu.h100e * 100) / 100).replace('.', ',')} H100e, ` +
          `аренда - ${money(rentPerGpuDay(s, gpu.id))} в день за карту (${money(now)} за H100e в день).${gain} ` +
          'Арендовать карту можно в окне «Мощности».',
      };
    },
  };
}

export const EVENTS: EventDef[] = [
  // 1. Статья о механизме внимания (12.06.2017): две ветки, срабатывает одна.
  {
    id: 'attention-paper-player',
    when: {
      check: (s) =>
        s.day >= dateToDay(ATTENTION_DATE) &&
        s.research.done.includes('attention') &&
        !s.firedEvents.includes('attention-paper-public'),
    },
    mail: () => ({
      kind: 'event',
      title: 'Механизм внимания изучен до публикации Gogle',
      body:
        'Gogle публикует статью «Внимание - всё, что нужно». Лаборатория уже завершила такое же исследование. ' +
        'Результаты можно опубликовать первыми или оставить метод в секрете.',
    }),
    choices: [
      {
        label: 'Опубликовать статью',
        hint: '+15 репутации, +20 шумихи',
        apply: (s) => {
          addReputation(s, 15);
          addHype(s, 'player', 20);
        },
      },
      {
        label: 'Оставить в секрете',
        hint: `+1 уровень алгоритмов, обучение эффективнее в ${String(ALGO_MULT).replace('.', ',')} раза`,
        apply: (s) => {
          s.research.algoLevel += 1;
        },
      },
    ],
  },
  {
    id: 'attention-paper-public',
    when: {
      check: (s) =>
        s.day >= dateToDay(ATTENTION_DATE) &&
        !s.research.done.includes('attention') &&
        !s.firedEvents.includes('attention-paper-player'),
    },
    mail: () => ({
      kind: 'news',
      title: 'Gogle опубликовала статью «Внимание - всё, что нужно»',
      body:
        'Исследователи Gogle описали архитектуру без рекуррентных сетей: она обучается быстрее и даёт более высокое качество. ' +
        'Идея доступна всем лабораториям. ' +
        `Исследование «Механизм внимания» подешевело на ${Math.round((1 - ATTENTION_PAPER_DISCOUNT) * 100)} %.`,
    }),
    onFire: (s) => {
      addModifier(s, {
        id: 'attention-paper-discount',
        kind: 'researchCost',
        target: 'attention',
        mult: ATTENTION_PAPER_DISCOUNT,
        untilDay: FOREVER,
      });
      addHype(s, 'gogle', 10);
    },
  },

  // 2. «Слишком опасно для публикации» (14.02.2019).
  {
    id: 'gpt2-withheld',
    when: { date: '2019-02-14' },
    mail: () => ({
      kind: 'event',
      title: 'OpenBrain не опубликовала GTP-2 целиком',
      body:
        'OpenBrain представила языковую модель GTP-2, но не опубликовала её полностью. ' +
        'По данным компании, такую модель легко использовать для фальшивых новостей и спама. ' +
        'Одни одобряют осторожность, другие считают решение рекламным ходом.',
    }),
    choices: [
      {
        label: 'Поддержать осторожность',
        hint: '+8 репутации',
        apply: (s) => {
          addReputation(s, 8);
        },
      },
      {
        label: 'Назвать это рекламным ходом',
        hint: '+10 шумихи, −3 репутации',
        apply: (s) => {
          addHype(s, 'player', 10);
          addReputation(s, -3);
        },
      },
      {
        label: 'Не комментировать',
        hint: 'без изменений',
        apply: () => {},
      },
    ],
  },

  // 3. API большой модели (11.06.2020).
  {
    id: 'gpt3-api',
    when: { date: '2020-06-11' },
    mail: () => ({
      kind: 'event',
      title: 'OpenBrain открыла API для GTP-3',
      body:
        'OpenBrain открыла API GTP-3 для разработчиков по заявкам; через несколько месяцев доступ станет платным для всех: ' +
        '$60 за 1 млн токенов. ' +
        'Спрос на языковые модели вырос в несколько раз, клиенты сравнивают цены и качество. ' +
        `Реклама собственного API стоит ${endSentence(money(AD_COST))}`,
    }),
    choices: [
      {
        label: 'Запустить рекламу своего API',
        hint: `−${money(AD_COST)}, +15 шумихи`,
        apply: (s) => {
          spend(s, 'overhead', AD_COST);
          addHype(s, 'player', 15);
        },
      },
      {
        label: 'Отказаться от рекламы',
        hint: '+3 репутации',
        apply: (s) => {
          addReputation(s, 3);
        },
      },
    ],
  },

  // 4. «ChatGTP» (30.11.2022): ветка «Ваш момент», если у игрока уже есть сильный чат.
  {
    id: 'chat-moment-player',
    when: {
      check: (s) =>
        s.day >= dateToDay(CHAT_DATE) && !s.firedEvents.includes('chat-moment-rival') && playerChatMoment(s),
    },
    mail: (s) => {
      const best = bestChatModel(s);
      const who = best ? `чата «${best.name}»` : 'чата лаборатории';
      return {
        kind: 'news',
        title: 'Чат лаборатории не уступает моделям OpenBrain',
        body:
          'После запуска ChatGTP интерес к чат-ботам резко вырос. ' +
          `Эло ${who} не ниже, чем у лучшей модели OpenBrain. ` +
          'Шумиха +40, репутация +10. ' +
          SUBS_OPEN_NOTE,
      };
    },
    onFire: (s) => {
      addHype(s, 'player', 40);
      addReputation(s, 10);
      s.flags.chatMomentPlayer = true;
    },
  },
  {
    id: 'chat-moment-rival',
    when: {
      check: (s) =>
        s.day >= dateToDay(CHAT_DATE) && !s.firedEvents.includes('chat-moment-player') && !playerChatMoment(s),
    },
    mail: () => ({
      kind: 'event',
      title: 'ChatGTP: OpenBrain открыла чат-бота для всех',
      body:
        'OpenBrain открыла ChatGTP - чат-бота для свободного диалога. ' +
        'За пять дней им воспользовался миллион человек. ' +
        'Бренд OpenBrain укрепился, клиенты ожидают чат-ботов и от других лабораторий. ' +
        SUBS_OPEN_NOTE,
    }),
    onFire: (s) => {
      addModifier(s, {
        id: 'chat-moment-brand',
        kind: 'labBrand',
        target: 'openbrain',
        add: CHAT_MOMENT_BRAND,
        untilDay: FOREVER,
      });
      addHype(s, 'openbrain', 30);
    },
    choices: [
      {
        label: 'Объявить о своём чате',
        hint: '+15 шумихи, если выпущена модель с RLHF',
        apply: (s) => {
          if (bestChatModel(s) !== null) addHype(s, 'player', 15);
        },
      },
      {
        label: 'Ждать',
        hint: 'без изменений',
        apply: () => {},
      },
    ],
  },

  // 5. Дефицит GPU (01.04.2023): временные модификаторы лимита и цены аренды.
  {
    id: 'gpu-shortage',
    when: { date: '2023-04-01' },
    mail: () => ({
      kind: 'event',
      title: 'Дефицит видеокарт в облаках',
      body:
        'Спрос на видеокарты превысил предложение. ' +
        'До 31 марта 2024 года лимит аренды снижен вдвое, а цены выше на 20 %. ' +
        'Посредники предлагают карты вне очереди по повышенной цене.',
    }),
    onFire: (s) => {
      const untilDay = dateToDay(SHORTAGE_END);
      addModifier(s, { id: 'gpu-shortage-cap', kind: 'rentCap', mult: 0.5, untilDay });
      addModifier(s, { id: 'gpu-shortage-price', kind: 'rentPrice', mult: 1.2, untilDay });
    },
    choices: [
      {
        label: 'Арендовать через посредников',
        hint: 'лимит аренды возвращается к норме, цена аренды ×1,6 вместо ×1,2 до 31.03.2024',
        apply: (s) => {
          s.modifiers = s.modifiers.filter((m) => m.id !== 'gpu-shortage-cap');
          addModifier(s, { id: 'gpu-shortage-price', kind: 'rentPrice', mult: 1.6, untilDay: dateToDay(SHORTAGE_END) });
        },
      },
      {
        label: 'Ждать',
        hint: 'лимит аренды −50 %, цена аренды +20 % до 31.03.2024',
        apply: () => {},
      },
    ],
  },

  // 6. Экспортные запреты на чипы: бренд китайских лабораторий.
  exportControls(
    'export-controls-2022',
    '2022-10-07',
    'США ограничили продажу чипов в Китай',
    'Власти США запретили поставки в Китай самых мощных ускорителей для нейросетей. ' +
      `Лабораториям ${CHINESE_NAMES} труднее строить большие кластеры, и их бренд у зарубежных клиентов снижается. ` +
      'Остальных лабораторий запрет почти не касается.',
  ),
  exportControls(
    'export-controls-2023',
    '2023-10-17',
    'США расширили ограничения на экспорт чипов',
    'Запрет распространён на урезанные версии ускорителей, которые раньше продавали в Китай. ' +
      'Бренд китайских лабораторий у западных клиентов снижается ещё сильнее.',
  ),

  // 7. Открытие «Арены».
  {
    id: 'arena-open',
    when: { date: ARENA_OPEN_DATE },
    mail: () => ({
      kind: 'news',
      title: 'Открыта «Арена»',
      body:
        'Открыт сайт «Арена»: пользователь задаёт вопрос двум безымянным моделям и выбирает лучший ответ. ' +
        'Подогнать модель под такой тест почти невозможно, поэтому клиенты больше доверяют «Арене», чем таблицам бенчмарков. ' +
        'Влияние шумихи на выбор клиентов снижается.',
    }),
    onFire: (s) => {
      s.flags.arenaOpen = true;
    },
  },

  // 7а. Совет директоров: доля основателя упала ниже половины (один раз за игру).
  {
    id: 'board-control',
    when: { check: (s) => s.founderShare < FOUNDER_BOARD_SHARE },
    defaultChoice: 0, // принять план: шумиха растёт, а скидка к оценке мешает только следующему раунду
    mail: (s) => ({
      kind: 'event',
      title: 'Совет директоров требует контроля',
      body:
        `Доля основателя - ${fmtShare(s.founderShare)} %: большинство в совете директоров теперь у инвесторов. ` +
        'Совет требует принять свой план: громкие анонсы и быстрый рост, пусть и по сниженной оценке в следующем раунде. ' +
        `Выкуп ${Math.round(BOARD_BUYBACK_SHARE * 100)} % компании у инвесторов сейчас стоит ${endSentence(money(buybackCost(s)))}`,
    }),
    choices: [
      {
        label: 'Принять план совета',
        hint: `+${BOARD_PLAN_HYPE} шумихи, оценка в следующем раунде ×${String(BOARD_PLAN_VALUATION_MULT).replace('.', ',')}`,
        apply: (s) => {
          addHype(s, 'player', BOARD_PLAN_HYPE);
          s.flags[BOARD_PLAN_FLAG] = true;
        },
      },
      {
        label: 'Отстоять свой план',
        hint: `−${Math.abs(BOARD_DEFEND_REP)} репутации`,
        apply: (s) => {
          addReputation(s, BOARD_DEFEND_REP);
        },
      },
      {
        label: `Выкупить ${Math.round(BOARD_BUYBACK_SHARE * 100)} % компании`,
        hint:
          `деньги по оценке на день выкупа с надбавкой ${Math.round((BOARD_BUYBACK_PREMIUM - 1) * 100)} %, ` +
          `доля основателя +${Math.round(BOARD_BUYBACK_SHARE * 100)} п.п.`,
        apply: (s) => {
          buyBackShares(s);
        },
      },
    ],
  },

  // 8. Модели, которые «думают» (12.09.2024).
  {
    id: 'reasoning-models',
    when: { date: '2024-09-12' },
    mail: () => ({
      kind: 'news',
      title: 'Модели, которые думают: q1-Previow',
      body:
        'q1-Previow - модель, которая перед ответом долго рассуждает. ' +
        'На GPQE (наука) и SWE-banch (код) она далеко опережает всех соперников.',
    }),
  },

  // 9. Показ q3 (20.12.2024): только атмосфера.
  {
    id: 'q3-arc',
    when: { date: '2024-12-20' },
    mail: () => ({
      kind: 'news',
      title: 'OpenBrain показала q3',
      body:
        'q3 - новая модель OpenBrain с рассуждением. ' +
        'На тесте ARK-AGI, который считался недоступным для нейросетей, она показала рекордный результат. ' +
        'Модель пока закрыта.',
    }),
  },

  // 10. Срыв обучения (повторяемое; запускает training.progressDay через triggerEvent).
  {
    id: 'training-fail',
    repeatable: true,
    choiceDays: FAIL_CHOICE_DAYS,
    when: { check: () => false },
    mail: (s) => {
      // Проект, который ждёт решения: training.progressDay ставит failed до запуска события.
      const name = s.trainings.find((r) => r.failed)?.plan.name;
      return {
        kind: 'training',
        title: 'Срыв обучения: резкий рост потерь',
        body:
          `${name ? `В проекте «${name}»` : 'В проекте обучения'} потери (ошибка модели) резко выросли, обучение остановлено. ` +
          'Возврат к чекпоинту (последнему сохранению) отнимает часть выполненной работы. ' +
          'Если продолжить без возврата, итоговая модель будет слабее.',
      };
    },
    choices: [
      {
        label: 'Вернуться к чекпоинту',
        hint: `откат на ${Math.round(FAIL_ROLLBACK * 100)} % всего объёма`,
        apply: (s) => {
          applyFailChoice(s, 'rollback');
        },
      },
      {
        label: 'Продолжить',
        hint: `модель выйдет на ${FAIL_CONTINUE_PENALTY} ${pointsWord(FAIL_CONTINUE_PENALTY)} слабее`,
        apply: (s) => {
          applyFailChoice(s, 'continue');
        },
      },
    ],
  },

  // Новые поколения GPU (P100 доступна с начала игры).
  ...GPUS.filter((g) => g.id !== 'p100').map(gpuEvent),
];

/**
 * Событие по id: сначала EVENTS, затем письма с выбором соперников (RIVALRY_EVENTS из sim/rivalry.ts).
 * В EVENTS их не вписываем: модули зациклены (sim/events → data/events → sim/rivalry → sim/events), и на верхнем
 * уровне массив соперников ещё не создан. Запускает такие письма сам rivalry.ts; fireDue их не трогает.
 */
export function findEvent(id: string | undefined): EventDef | undefined {
  return EVENTS.find((e) => e.id === id) ?? RIVALRY_EVENTS.find((e) => e.id === id);
}
