// Письма с выбором для 2022-2023 годов (самое пустое место партии в плейтестах 18.10: больше 800 дней без наград,
// деньги лежат) и письма по стране лаборатории (sim/country.ts). Устроены как data/historyEvents.ts: приходят в свою
// дату и не позже чем через 60 дней, не вплотную к другим письмам с выбором; без ответа - последний вариант (отказ),
// поэтому боты баланса играют как раньше. Суммы - в денежных единицах года (eventKit.amount).

import { addModifier, FOREVER } from '../sim/events';
import { bestElo } from '../sim/leaderboard';
import { subsOpen } from '../sim/market';
import { techCost } from '../sim/research';
import type { CountryId, GameState, LabId, SegmentId } from '../sim/types';
import type { EventChoiceDef, EventDef } from './events';
import { addHype, addRep, amount, fixUnit, grant, pay, roll, usd, windowFrom } from './eventKit';
import { LABS } from './labs';

const nothing = (label: string, story: string): EventChoiceDef => ({ label, hint: 'без изменений', story, apply: () => {} });

function trust(s: GameState, id: string, seg: SegmentId, add: number, days: number | null): void {
  addModifier(s, { id, kind: 'segBrand', target: `player:${seg}`, add, untilDay: days === null ? FOREVER : s.day + days });
}

/** Лаборатория-соперник с лучшей моделью сейчас (для писем о её команде). */
function leaderLab(s: GameState): LabId {
  let best: LabId = 'openbrain';
  let elo = -Infinity;
  for (const l of LABS) {
    const e = bestElo(s, l.id);
    if (e > elo) {
      elo = e;
      best = l.id;
    }
  }
  return best;
}

const labName = (id: LabId): string => LABS.find((l) => l.id === id)?.name ?? id;

/** Дата каждого письма: раньше неё письмо не придёт (проверяют тесты). */
export const LATE_DATE: Record<string, string> = {};

function late(date: string, def: Omit<EventDef, 'when'>, also?: (s: GameState) => boolean): EventDef {
  LATE_DATE[def.id] = date;
  const w = windowFrom(date);
  return { ...def, when: { check: (s) => w.check(s) && (also ? also(s) : true) } };
}

function inCountry(c: CountryId): (s: GameState) => boolean {
  return (s) => s.country === c; // без импорта sim/country: модули событий и стран импортируют друг друга
}

export const LATE_EVENTS: EventDef[] = [
  late('2022-07-15', {
    id: 'late-rival-team',
    mail: (s) => ({
      kind: 'event',
      title: `Исследователи ${labName(leaderLab(s))} ищут новое место`,
      body:
        `Группа ведущих исследователей ${labName(leaderLab(s))} поссорилась с руководством и готова перейти целиком. ` +
        'Они знают, как устроены лучшие модели соперника. Команда просит большой бонус за переход.',
    }),
    onFire: fixUnit,
    choices: [
      {
        label: 'Нанять всю группу',
        story: (s) => `Исследования пойдут быстрее, а ${labName(leaderLab(s))} потеряет темп`,
        hint: '',
        hintFn: (s) => `-${usd(amount(s, 3))}, текущее исследование +50 %, +5 шумихи`,
        apply: (s) => {
          pay(s, amount(s, 3));
          const cur = s.research.current;
          if (cur) s.research.points[cur] = (s.research.points[cur] ?? 0) + techCost(s, cur) * 0.5;
          else addModifier(s, { id: 'late-rival-team', kind: 'researchCost', mult: 0.75, untilDay: s.day + 365 });
          addHype(s, 'player', 5);
          addHype(s, leaderLab(s), -5);
        },
      },
      nothing('Отказаться', 'Группа уйдёт к кому-то другому'),
    ],
  }),
  late('2022-11-07', {
    id: 'late-corp-partner',
    mail: () => ({
      kind: 'event',
      title: 'Корпорация предлагает партнёрство',
      body:
        'Крупная технологическая корпорация готова вложить в лабораторию большие деньги и дать своё облако со скидкой. ' +
        'Взамен - доля в компании и место в совете. Независимые исследователи считают такие сделки потерей свободы.',
    }),
    onFire: fixUnit,
    choices: [
      {
        label: 'Принять деньги и облако',
        story: 'Денег и мощности станет больше, но часть решений будет у корпорации',
        hint: '',
        hintFn: (s) => `+${usd(amount(s, 20))}, аренда карт на 15 % дешевле на 2 года, -10 % вашей доли, -3 репутации`,
        apply: (s) => {
          grant(s, amount(s, 20));
          s.founderShare *= 0.9;
          addModifier(s, { id: 'late-corp-cloud', kind: 'rentPrice', mult: 0.85, untilDay: s.day + 730 });
          addRep(s, -3);
        },
      },
      {
        label: 'Остаться независимыми',
        story: 'Лаборатория сохранит свободу решений',
        hint: '+3 репутации',
        apply: (s) => addRep(s, 3),
      },
    ],
  }),
  late(
    '2023-02-20',
    {
      id: 'late-viral-chat',
      mail: (s) => {
        const m = s.models.filter((x) => x.releasedDay !== null && x.onSubs).sort((a, b) => b.arenaElo - a.arenaElo)[0];
        return {
          kind: 'event',
          title: `Ответы «${m?.name ?? 'вашего чата'}» разошлись мемами`,
          body:
            'Смешные и неожиданные ответы вашего чата разлетелись по соцсетям, о нём пишут блогеры. ' +
            'Волна пройдёт через пару месяцев: на ней можно заработать или переждать её.',
        };
      },
      onFire: fixUnit,
      choices: [
        {
          label: 'Подхватить волну рекламой',
          story: 'Новые пользователи придут, пока о чате говорят',
          hint: '',
          hintFn: (s) => `-${usd(amount(s, 1))}, +15 шумихи, спрос на подписки +20 % на 90 дней`,
          apply: (s) => {
            pay(s, amount(s, 1));
            addHype(s, 'player', 15);
            addModifier(s, { id: 'late-viral-subs', kind: 'subsDemand', mult: 1.2, untilDay: s.day + 90 });
          },
        },
        {
          label: 'Не вмешиваться',
          story: 'Волна пройдёт сама',
          hint: '+5 шумихи',
          apply: (s) => addHype(s, 'player', 5),
        },
      ],
    },
    (s) => subsOpen(s.day) && s.models.some((m) => m.releasedDay !== null && m.onSubs),
  ),
  late('2023-03-25', {
    id: 'late-h100-queue',
    mail: () => ({
      kind: 'event',
      title: 'Очередь за H100 расписана на год вперёд',
      body:
        'Облака продают новые карты Fermi H100 только по предоплате: кто заплатил, получает карты раньше и дешевле. ' +
        'Остальные ждут в общей очереди с маленьким лимитом.',
    }),
    onFire: fixUnit,
    choices: [
      {
        label: 'Заплатить за место в очереди',
        story: 'Новые карты придут раньше, чем у соседей по рынку',
        hint: '',
        hintFn: (s) => `-${usd(amount(s, 4))}, лимит аренды H100 ×2 и аренда H100 на 10 % дешевле на год`,
        apply: (s) => {
          pay(s, amount(s, 4));
          addModifier(s, { id: 'late-h100-cap', kind: 'rentCap', target: 'h100', mult: 2, untilDay: s.day + 365 });
          addModifier(s, { id: 'late-h100-price', kind: 'rentPrice', target: 'h100', mult: 0.9, untilDay: s.day + 365 });
        },
      },
      nothing('Ждать общей очереди', 'Лаборатория будет ждать общей очереди'),
    ],
  }),
  late('2024-03-12', {
    id: 'late-agents',
    mail: () => ({
      kind: 'event',
      title: 'Все говорят об агентах',
      body:
        'ИИ-программист, который сам пишет и проверяет код, стал главной темой месяца: такие агенты разбивают задачу на шаги и вызывают модель снова и снова. ' +
        'Работают они пока ненадёжно, но компании спрашивают, когда такое будет у них.',
    }),
    onFire: fixUnit,
    choices: [
      {
        label: 'Показать демо агента',
        story: 'Удачное демо запомнят, неудачное - тоже',
        hint: '+12 шумихи с шансом 50 %, иначе -4 репутации',
        luck: { good: 'агент справился с задачей на сцене', bad: 'агент запутался прямо на показе' },
        apply: (s) => {
          if (roll(s, 0.5, true)) addHype(s, 'player', 12);
          else addRep(s, -4);
        },
      },
      {
        label: 'Сделать агента для компаний',
        story: 'Компании получат осторожного, но полезного помощника',
        hint: '',
        hintFn: (s) => `-${usd(amount(s, 1))}, компании доверяют больше на год`,
        apply: (s) => {
          pay(s, amount(s, 1));
          trust(s, 'late-agents-trust', 'enterprise', 0.1, 365);
        },
      },
      nothing('Подождать', 'Лаборатория подождёт, пока агенты станут надёжнее'),
    ],
  }),
  late('2024-04-18', {
    id: 'late-open-wave',
    mail: () => ({
      kind: 'event',
      title: 'Открытые модели догоняют закрытые',
      body:
        'Мета выложила веса LLaMo 3, и открытые модели почти догнали платные. Разработчики массово пробуют ' +
        'бесплатные модели вместо платных API.',
    }),
    onFire: fixUnit,
    choices: [
      {
        label: 'Открыть веса прошлой модели',
        story: 'Разработчики будут строить на вашей модели, а не на чужой',
        hint: '+10 шумихи, разработчики доверяют больше на год',
        apply: (s) => {
          addHype(s, 'player', 10);
          trust(s, 'late-open-dev', 'developers', 0.15, 365);
        },
      },
      nothing('Оставить модели закрытыми', 'Лаборатория останется при закрытых моделях'),
    ],
  }),
];

export const COUNTRY_EVENTS: EventDef[] = [
  // ---------- США ----------
  late(
    '2022-08-09',
    {
      id: 'us-chips-act',
      mail: () => ({
        kind: 'event',
        title: 'Закон о чипах: субсидии для лабораторий в США',
        body: 'Конгресс принял закон о поддержке производства чипов и исследований. Лаборатории в США могут подать заявку на грант.',
      }),
      onFire: fixUnit,
      choices: [
        {
          label: 'Подать заявку на грант',
          story: 'Комиссия рассмотрит заявку за несколько недель',
          hint: '',
          hintFn: (s) => `+${usd(amount(s, 2))} с шансом 60 %, иначе -${usd(amount(s, 0.2))} на юристов`,
          luck: { good: 'грант одобрен', bad: 'заявку отклонили' },
          apply: (s) => {
            if (roll(s, 0.6, true)) grant(s, amount(s, 2));
            else pay(s, amount(s, 0.2));
          },
        },
        nothing('Не подавать заявку', 'Лаборатория обойдётся без денег государства'),
      ],
    },
    inCountry('us'),
  ),
  late(
    '2023-05-16',
    {
      id: 'us-senate',
      mail: () => ({
        kind: 'event',
        title: 'Сенат зовёт на слушания об ИИ',
        body: 'Сенаторы приглашают руководителей лабораторий объяснить, как они делают модели безопасными. Слушания покажут по телевизору.',
      }),
      choices: [
        {
          label: 'Выступить лично',
          story: 'Лабораторию увидит вся страна',
          hint: '+5 репутации и +10 шумихи с шансом 70 %, иначе -5 репутации',
          luck: { good: 'выступление назвали лучшим на слушаниях', bad: 'сенаторы поймали на неточности' },
          apply: (s) => {
            if (roll(s, 0.7, true)) {
              addRep(s, 5);
              addHype(s, 'player', 10);
            } else addRep(s, -5);
          },
        },
        nothing('Отправить юристов', 'На слушания пойдут юристы'),
      ],
    },
    inCountry('us'),
  ),
  // ---------- Китай ----------
  late(
    '2023-01-10',
    {
      id: 'cn-smuggle',
      mail: () => ({
        kind: 'event',
        title: 'Посредники предлагают H100 в обход запрета',
        body: 'Компания из соседней страны берётся поставить карты Fermi H100, несмотря на запрет США. Дорого и рискованно: о таких сделках пишут журналисты.',
      }),
      onFire: fixUnit,
      choices: [
        {
          label: 'Купить через посредников',
          story: 'Карт станет больше, если сделку не раскроют',
          hint: '',
          hintFn: (s) => `-${usd(amount(s, 2))}, лимит аренды H100 ×3 на год; с шансом 30 % сделку раскроют: -8 репутации`,
          luck: { good: 'сделку никто не заметил', bad: 'журналисты раскрыли сделку' },
          apply: (s) => {
            pay(s, amount(s, 2));
            addModifier(s, { id: 'cn-smuggle-cap', kind: 'rentCap', target: 'h100', mult: 3, untilDay: s.day + 365 });
            if (roll(s, 0.3, false)) addRep(s, -8);
          },
        },
        nothing('Отказаться', 'Лаборатория обойдётся разрешёнными картами'),
      ],
    },
    inCountry('cn'),
  ),
  late(
    '2023-08-15',
    {
      id: 'cn-register',
      mail: () => ({
        kind: 'event',
        title: 'Новые правила: модели нужно зарегистрировать',
        body: 'Регулятор требует регистрировать чат-ботов до выхода к пользователям. Проверка занимает время и стоит денег, зато зарегистрированным моделям больше доверяют.',
      }),
      onFire: fixUnit,
      choices: [
        {
          label: 'Зарегистрировать модели',
          story: 'Пользователи увидят отметку о регистрации',
          hint: '',
          hintFn: (s) => `-${usd(amount(s, 0.5))}, обычные пользователи доверяют больше`,
          apply: (s) => {
            pay(s, amount(s, 0.5));
            trust(s, 'cn-register-trust', 'consumers', 0.1, null);
          },
        },
        {
          label: 'Не спешить с регистрацией',
          story: 'Проверки могут прийти без предупреждения',
          hint: '',
          hintFn: (s) => `с шансом 40 % штраф ${usd(amount(s, 1))} и -5 репутации`,
          luck: { good: 'проверка обошла лабораторию стороной', bad: 'регулятор оштрафовал лабораторию' },
          apply: (s) => {
            if (roll(s, 0.4, false)) {
              pay(s, amount(s, 1));
              addRep(s, -5);
            }
          },
        },
      ],
    },
    inCountry('cn'),
  ),
  late(
    '2024-05-24',
    {
      id: 'cn-state-fund',
      mail: () => ({
        kind: 'event',
        title: 'Государственный фонд предлагает деньги',
        body: 'Новый государственный фонд вкладывает в лаборатории ИИ. Деньги большие, но зарубежные клиенты будут считать лабораторию государственной.',
      }),
      onFire: fixUnit,
      choices: [
        {
          label: 'Взять деньги фонда',
          story: 'Денег станет больше, доверие за рубежом - меньше',
          hint: '',
          hintFn: (s) => `+${usd(amount(s, 5))}, зарубежные клиенты доверяют меньше`,
          apply: (s) => {
            grant(s, amount(s, 5));
            addModifier(s, { id: 'cn-state-fund-brand', kind: 'labBrand', target: 'player', add: -0.05, untilDay: FOREVER });
          },
        },
        nothing('Отказаться', 'Лаборатория останется частной'),
      ],
    },
    inCountry('cn'),
  ),
  // ---------- Европа ----------
  late(
    '2023-06-15',
    {
      id: 'eu-horizon',
      mail: () => ({
        kind: 'event',
        title: 'Грант Еврокомиссии на открытые исследования',
        body: 'Еврокомиссия даёт гранты лабораториям, которые публикуют результаты. Деньги идут на исследования, статьи - в открытый доступ.',
      }),
      choices: [
        {
          label: 'Получить грант',
          story: 'Исследования станут дешевле, статьи увидят все',
          hint: 'исследования на 20 % дешевле на год, +4 репутации, соперники получат ваши статьи: +3 шумихи каждому',
          apply: (s) => {
            addModifier(s, { id: 'eu-horizon', kind: 'researchCost', mult: 0.8, untilDay: s.day + 365 });
            addRep(s, 4);
            for (const l of LABS) addHype(s, l.id, 3);
          },
        },
        nothing('Отказаться от гранта', 'Лаборатория оставит результаты при себе'),
      ],
    },
    inCountry('eu'),
  ),
  late(
    '2024-08-01',
    {
      id: 'eu-ai-act',
      mail: () => ({
        kind: 'event',
        title: 'AI Act вступил в силу',
        body: 'Закон Евросоюза требует от создателей больших моделей отчётов о данных и проверок безопасности. Без них продавать модели в ЕС нельзя.',
      }),
      onFire: fixUnit,
      choices: [
        {
          label: 'Пройти проверку',
          story: 'Компании в ЕС увидят, что модели проверены',
          hint: '',
          hintFn: (s) => `-${usd(amount(s, 1))}, +5 репутации, компании доверяют больше`,
          apply: (s) => {
            pay(s, amount(s, 1));
            addRep(s, 5);
            trust(s, 'eu-ai-act-trust', 'enterprise', 0.1, null);
          },
        },
        {
          label: 'Ограничить продажи в ЕС',
          story: 'Часть клиентов в Европе останется без ваших моделей',
          hint: 'спрос на API -10 % на год',
          apply: (s) => addModifier(s, { id: 'eu-ai-act-demand', kind: 'demand', mult: 0.9, untilDay: s.day + 365 }),
        },
      ],
    },
    inCountry('eu'),
  ),
];
