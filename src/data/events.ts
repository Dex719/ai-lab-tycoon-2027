// Исторические и механические события среза (FR-11). TSK-009.
// Эффекты — функции над состоянием; в сохранение попадают только id события и номер выбора.
// Варианты выбора в письме заданы заранее, поэтому событие с ветками сделано парой:
// из двух событий срабатывает ровно одно (условия не пересекаются, плюс проверка «другое не срабатывало»).

import {
  ALGO_MULT,
  ARENA_OPEN_DATE,
  ATTENTION_PAPER_DISCOUNT,
  CHAT_MOMENT_BRAND,
  EXPORT_CONTROL_BRAND,
  FAIL_CONTINUE_PENALTY,
  FAIL_ROLLBACK,
} from '../sim/constants';
import { availableGpus, rentPerGpuDay } from '../sim/compute';
import { addModifier, FOREVER } from '../sim/events';
import { spend } from '../sim/finance';
import { bestElo } from '../sim/leaderboard';
import { endSentence } from '../sim/text';
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
}

// ---------- Даты и числа событий ----------

const ATTENTION_DATE = '2017-06-12';
const CHAT_DATE = '2022-11-30';
const SHORTAGE_END = '2024-03-31';
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

/** «очко / очка / очков» по числу. */
export function pointsWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'очко';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'очка';
  return 'очков';
}

const clamp100 = (x: number): number => Math.max(0, Math.min(100, x));

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
          ? ` На таких картах вычисления в ${String(Math.round((best / now) * 10) / 10).replace('.', ',')} раза дешевле, чем на лучших прежних.`
          : '';
      return {
        kind: 'news',
        title: `Fermi Systems: ${gpu.name} в облаке`,
        body:
          `В облаке можно арендовать ${gpu.name}: одна карта — это ${String(Math.round(gpu.h100e * 100) / 100).replace('.', ',')} H100e.${gain} ` +
          'Старые карты не дешевеют так быстро: загляните в окно «Мощности» и подумайте о переезде.',
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
      title: 'Вы опередили историю',
      body:
        'Сегодня Gogle собиралась выпустить статью «Внимание — всё, что нужно», но ваша команда уже закончила такую же работу. ' +
        'Можно опубликовать её первыми и заработать имя в науке. ' +
        'Или оставить метод в тайне и учить модели лучше конкурентов.',
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
        label: 'Держать в секрете',
        hint: `+1 уровень алгоритмов (обучение эффективнее в ${String(ALGO_MULT).replace('.', ',')} раза)`,
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
      title: 'Gogle опубликовала статью «Внимание — всё, что нужно»',
      body:
        'Исследователи Gogle показали архитектуру, которой не нужны рекуррентные сети: она учится быстрее и лучше. ' +
        'Идея мгновенно разошлась по всем лабораториям, и вы тоже можете ею воспользоваться. ' +
        `Изучить механизм внимания теперь дешевле на ${Math.round((1 - ATTENTION_PAPER_DISCOUNT) * 100)} %.`,
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
      title: 'GTP-2: «слишком опасно»',
      body:
        'OpenBrain показала языковую модель GTP-2, но не стала публиковать её целиком. ' +
        'По словам компании, такую модель слишком легко использовать для фальшивых новостей и спама. ' +
        'Одни хвалят осторожность, другие видят в этом рекламный ход. Чью сторону займёте вы?',
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
        label: 'Назвать это пиаром',
        hint: '+10 шумихи, −3 репутации',
        apply: (s) => {
          addHype(s, 'player', 10);
          addReputation(s, -3);
        },
      },
    ],
  },

  // 3. API большой модели (11.06.2020).
  {
    id: 'gpt3-api',
    when: { date: '2020-06-11' },
    mail: () => ({
      kind: 'event',
      title: 'OpenBrain открыла платный API для GTP-3',
      body:
        'Теперь любой разработчик может подключить GTP-3 за пару минут и платить за каждый запрос. ' +
        'Рынок языковых моделей вырос в разы, клиенты начали сравнивать цены и качество. ' +
        `Самое время напомнить о себе: реклама вашего API обойдётся в ${endSentence(money(AD_COST))}`,
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
        label: 'Не тратиться',
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
      const who = best ? `ваш чат — «${best.name}»` : 'ваш чат';
      return {
        kind: 'news',
        title: 'Ваш момент',
        body:
          `Мир открыл для себя чат-ботов, и лучшим из них стал ${who}. ` +
          'Люди делятся его ответами в соцсетях, к вашему сайту выстроилась очередь, журналисты звонят каждый час. ' +
          'Шумиха и репутация лаборатории взлетели: +40 шумихи, +10 репутации.',
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
      title: 'ChatGTP: чат-бот, которым пользуются все',
      body:
        'OpenBrain открыла для всех ChatGTP — чат-бота, с которым можно просто разговаривать. ' +
        'За пять дней в него зашёл миллион человек, и о нейросетях заговорили даже далёкие от техники люди. ' +
        'Бренд OpenBrain стал нарицательным, а клиенты теперь ждут чат и от остальных.',
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
        label: 'Срочно выпустить свой чат',
        hint: '+15 шумихи, если у вас уже выпущена модель с RLHF; иначе ничего',
        apply: (s) => {
          if (bestChatModel(s) !== null) addHype(s, 'player', 15);
        },
      },
      {
        label: 'Ждать',
        hint: 'ничего не изменится',
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
      title: 'Дефицит GPU',
      body:
        'Спрос на нейросети вырос так быстро, что видеокарт на всех не хватает. ' +
        'Облака режут выдачу: лимит аренды упал вдвое, а цены выросли на 20 % — и так будет до конца марта 2024 года. ' +
        'Посредники готовы достать карты вне очереди, но за большие деньги.',
    }),
    onFire: (s) => {
      const untilDay = dateToDay(SHORTAGE_END);
      addModifier(s, { id: 'gpu-shortage-cap', kind: 'rentCap', mult: 0.5, untilDay });
      addModifier(s, { id: 'gpu-shortage-price', kind: 'rentPrice', mult: 1.2, untilDay });
    },
    choices: [
      {
        label: 'Переплатить посредникам',
        hint: 'лимит аренды вернётся к норме, цена аренды ×1,6 вместо ×1,2 до 31.03.2024',
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
    'Власти США запретили поставлять в Китай самые мощные ускорители для нейросетей. ' +
      `Лабораториям ${CHINESE_NAMES} труднее строить большие кластеры, а клиенты за рубежом смотрят на них с опаской. ` +
      'Остальных лабораторий запрет почти не касается.',
  ),
  exportControls(
    'export-controls-2023',
    '2023-10-17',
    'Новые ограничения на экспорт чипов',
    'США ужесточили правила: под запрет попали и урезанные версии ускорителей, которые раньше продавали в Китай. ' +
      'Доверие к китайским лабораториям снижается ещё сильнее. ' +
      'Западным клиентам всё труднее объяснить, почему они должны выбрать модель из Китая.',
  ),

  // 7. Открытие «Арены».
  {
    id: 'arena-open',
    when: { date: ARENA_OPEN_DATE },
    mail: () => ({
      kind: 'news',
      title: 'Открылась «Арена»',
      body:
        'Появился сайт «Арена»: человек задаёт вопрос двум безымянным моделям и выбирает, чей ответ лучше. ' +
        'Подогнать модель под такой тест почти невозможно, поэтому клиенты теперь верят «Арене» больше, чем таблицам бенчмарков. ' +
        'Громкие обещания работают хуже, честное качество — лучше.',
    }),
    onFire: (s) => {
      s.flags.arenaOpen = true;
    },
  },

  // 8. Модели, которые «думают» (12.09.2024).
  {
    id: 'reasoning-models',
    when: { date: '2024-09-12' },
    mail: () => ({
      kind: 'news',
      title: 'Модели, которые думают',
      body:
        'OpenBrain выпустила q1-Previow — модель, которая перед ответом долго «размышляет». ' +
        'На GPQE и в математике (GSM8C) она обгоняет всех соперников. ' +
        'Теперь важно не только знать много, но и уметь рассуждать, и именно за этими баллами следят в первую очередь.',
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
        'Перед праздниками OpenBrain показала q3 — новую модель-рассуждатель. ' +
        'На тесте ARK-AGI, который считали неприступным для нейросетей, она набрала рекордный результат. ' +
        'Пока модель закрыта, но планка для всех остальных поднялась.',
    }),
  },

  // 10. Срыв обучения (повторяемое; запускает training.progressDay через triggerEvent).
  {
    id: 'training-fail',
    repeatable: true,
    when: { check: () => false },
    mail: (s) => {
      const name = s.training?.plan.name;
      return {
        kind: 'training',
        title: 'Срыв обучения: потери взлетели',
        body:
          `${name ? `В проекте «${name}»` : 'В проекте обучения'} потери (ошибка модели) резко выросли, обучение сорвалось. ` +
          'Можно вернуться к последнему сохранению — чекпоинту — и потерять часть уже сделанной работы. ' +
          'Или продолжить как есть и смириться с тем, что итоговая модель будет слабее.',
      };
    },
    choices: [
      {
        label: 'Откатиться к чекпоинту',
        hint: `−${Math.round(FAIL_ROLLBACK * 100)} % прогресса`,
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
