// Случайные события с выбором (2-3 варианта, честные подсказки). Письмо приходит само раз в 2-3 месяца
// (sim/randomEvents.ts): жребий идёт по весам, которые зависят от года и положения лаборатории.
// Суммы считаются в «единицах» года (data/eventKit.ts): в 2017-м это $100 тыс., в 2024-м - $10 млн.
// Первый вариант в каждом письме - основной (его выбирает бот), последний - вариант по умолчанию, если не ответить.

import { addModifier } from '../sim/events';
import { yearOf } from '../sim/time';
import type { GameState } from '../sim/types';
import type { EventChoiceDef, EventDef } from './events';
import {
  addHype,
  addRep,
  amount,
  fixUnit,
  grant,
  hasOnSale,
  hasReleased,
  pay,
  rentedCount,
  roll,
  usd,
} from './eventKit';

const year = (s: GameState): number => yearOf(s.day);
const ge = (y: number) => (s: GameState): boolean => year(s) >= y;
/** Вес: 0 вне условия, иначе base (умножается на bonus, когда подходит ещё и ситуация). */
const w = (cond: (s: GameState) => boolean, base = 1, bonus?: (s: GameState) => boolean, mult = 2) =>
  (s: GameState): number => (cond(s) ? base * (bonus && bonus(s) ? mult : 1) : 0);

const cost = (k: number) => (s: GameState): string => `-${usd(amount(s, k))}`;

const NO: EventChoiceDef = { label: 'Отказаться', hint: 'без изменений', apply: () => {} };

/** Скидка или наценка на исследования или аренду на время. */
function timed(s: GameState, id: string, kind: 'researchCost' | 'rentPrice' | 'exposure', mult: number, days: number): void {
  addModifier(s, { id: `rnd-${id}`, kind, mult, untilDay: s.day + days });
}

function ev(def: Omit<EventDef, 'when' | 'repeatable' | 'onFire'> & { random: NonNullable<EventDef['random']> }): EventDef {
  return { ...def, repeatable: true, when: { check: () => false }, onFire: fixUnit };
}

export const RANDOM_EVENTS: EventDef[] = [
  ev({
    id: 'rnd-data-leak',
    random: { weight: w(ge(2018), 1, hasOnSale) },
    mail: () => ({
      kind: 'event',
      title: 'Утечка части обучающих данных',
      body:
        'Бывший подрядчик выложил в сеть часть данных, на которых учатся модели лаборатории. Журналисты уже пишут запросы. ' +
        'Можно признать утечку и извиниться или промолчать в расчёте, что шум стихнет.',
    }),
    choices: [
      {
        label: 'Признать утечку и извиниться',
        hint: '', hintFn: (s) => `${cost(0.5)(s)}, +3 репутации`,
        apply: (s) => {
          pay(s, amount(s, 0.5));
          addRep(s, 3);
        },
      },
      {
        label: 'Промолчать',
        hint: '-8 репутации и -15 шумихи с шансом 40 %',
        apply: (s) => {
          if (roll(s, 0.4, false)) {
            addRep(s, -8);
            addHype(s, 'player', -15);
          }
        },
      },
    ],
  }),
  ev({
    id: 'rnd-researcher-offer',
    random: { weight: w(ge(2017), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Ведущему исследователю предложили работу в Gogle',
      body:
        'Лучший исследователь лаборатории получил приглашение от Gogle с большой зарплатой. Он готов остаться, ' +
        'если условия станут лучше. Если он уйдёт, часть наработок придётся восстанавливать.',
    }),
    choices: [
      {
        label: 'Поднять зарплату',
        hint: '', hintFn: (s) => `${cost(1)(s)}, +2 репутации`,
        apply: (s) => {
          pay(s, amount(s, 1));
          addRep(s, 2);
        },
      },
      {
        label: 'Предложить долю в компании',
        hint: '-1 п.п. доли основателя, исследования дешевле на 10 % на 90 дней',
        apply: (s) => {
          s.founderShare = Math.max(0, s.founderShare - 0.01);
          timed(s, 'researcher-stays', 'researchCost', 0.9, 90);
        },
      },
      {
        label: 'Отпустить',
        hint: '-3 репутации, исследования дороже на 10 % на 60 дней',
        apply: (s) => {
          addRep(s, -3);
          timed(s, 'researcher-leaves', 'researchCost', 1.1, 60);
        },
      },
    ],
  }),
  ev({
    id: 'rnd-gpu-discount',
    random: { weight: w(ge(2017), 1, (s) => rentedCount(s) > 0, 1.5) },
    mail: () => ({
      kind: 'event',
      title: 'Облако распродаёт простаивающие карты',
      body:
        'Один из облачных провайдеров не загрузил часть своих серверов и предлагает скидку тем, кто подпишет договор на два месяца. ' +
        'Вносить нужно небольшую плату за оформление.',
    }),
    choices: [
      {
        label: 'Взять карты по скидке',
        hint: '', hintFn: (s) => `${cost(0.3)(s)}, аренда дешевле на 15 % на 60 дней`,
        apply: (s) => {
          pay(s, amount(s, 0.3));
          timed(s, 'gpu-discount', 'rentPrice', 0.85, 60);
        },
      },
      NO,
    ],
  }),
  ev({
    id: 'rnd-journalist',
    random: { weight: w(ge(2017), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Журналист просит интервью',
      body:
        'Известный журналист пишет статью об искусственном интеллекте и просит рассказать о лаборатории. ' +
        'Подробный разговор принесёт известность, но в нём легко сказать лишнее.',
    }),
    choices: [
      {
        label: 'Дать подробное интервью',
        hint: '+10 шумихи, -5 репутации с шансом 30 %',
        apply: (s) => {
          addHype(s, 'player', 10);
          if (roll(s, 0.3, false)) addRep(s, -5);
        },
      },
      { label: 'Ограничиться коротким комментарием', hint: '+4 шумихи', apply: (s) => addHype(s, 'player', 4) },
      NO,
    ],
  }),
  ev({
    id: 'rnd-data-lawsuit',
    random: { weight: w((s) => ge(2020)(s) && hasReleased(s) && !s.flags.dataLicensed, 1, hasOnSale), once: true },
    mail: () => ({
      kind: 'event',
      title: 'Иск из-за данных для обучения',
      body:
        'Издатель считает, что его тексты попали в обучающую выборку без разрешения, и требует деньги. ' +
        'Можно договориться, идти в суд или убрать спорные материалы из будущих проектов.',
    }),
    choices: [
      {
        label: 'Заплатить по мировому соглашению',
        hint: '', hintFn: cost(2),
        apply: (s) => pay(s, amount(s, 2)),
      },
      {
        label: 'Идти в суд',
        hint: '', hintFn: (s) => `+5 репутации с шансом 50 %, -${usd(amount(s, 4))} и -6 репутации с шансом 50 %`,
        apply: (s) => {
          if (roll(s, 0.5, true)) addRep(s, 5);
          else {
            pay(s, amount(s, 4));
            addRep(s, -6);
          }
        },
      },
      {
        label: 'Убрать спорные данные',
        hint: '', hintFn: (s) => `${cost(1)(s)}, +1 репутации`,
        apply: (s) => {
          pay(s, amount(s, 1));
          addRep(s, 1);
        },
      },
    ],
  }),
  ev({
    id: 'rnd-conference',
    random: { weight: w(ge(2017), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Приглашение на научную конференцию',
      body:
        'Организаторы крупной конференции по машинному обучению приглашают лабораторию выступить с докладом. ' +
        'Поездка стоит денег, зато коллеги и журналисты увидят вашу работу.',
    }),
    choices: [
      {
        label: 'Выступить с докладом',
        hint: '', hintFn: (s) => `${cost(0.2)(s)}, +6 репутации, +5 шумихи`,
        apply: (s) => {
          pay(s, amount(s, 0.2));
          addRep(s, 6);
          addHype(s, 'player', 5);
        },
      },
      { label: 'Прислать постер', hint: '+2 репутации', apply: (s) => addRep(s, 2) },
      { label: 'Не ехать', hint: 'без изменений', apply: () => {} },
    ],
  }),
  ev({
    id: 'rnd-gov-grant',
    random: { weight: w(ge(2017), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Государственный конкурс грантов',
      body:
        'Министерство объявило конкурс на поддержку лабораторий, которые работают с искусственным интеллектом. ' +
        'Заявка отнимает время, а победитель получает деньги без обязательств по результатам.',
    }),
    choices: [
      {
        label: 'Подать заявку на грант',
        hint: '', hintFn: (s) => `+${usd(amount(s, 2))} с шансом 60 %, иначе -${usd(amount(s, 0.1))}`,
        apply: (s) => {
          if (roll(s, 0.6, true)) grant(s, amount(s, 2));
          else pay(s, amount(s, 0.1));
        },
      },
      NO,
    ],
  }),
  ev({
    id: 'rnd-power-outage',
    random: { weight: w((s) => ge(2017)(s) && s.trainings.length > 0 && rentedCount(s) > 0, 1) },
    mail: () => ({
      kind: 'event',
      title: 'Отключение электричества в дата-центре',
      body:
        'В дата-центре, где работают ваши карты, пропало электричество. Серверы остановились, а часть расчётов не сохранилась. ' +
        'Провайдер предлагает за доплату срочно перенести проект на другую площадку.',
    }),
    choices: [
      {
        label: 'Оплатить срочный перенос',
        hint: '', hintFn: cost(0.5),
        apply: (s) => pay(s, amount(s, 0.5)),
      },
      {
        label: 'Ждать восстановления',
        hint: 'проекты обучения откатятся на 3 %',
        apply: (s) => {
          for (const run of s.trainings) run.flopDone *= 0.97;
        },
      },
    ],
  }),
  ev({
    id: 'rnd-viral-demo',
    random: { weight: w((s) => ge(2018)(s) && hasReleased(s), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Демонстрация модели разошлась по сети',
      body:
        'Пользователь выложил короткий ролик, где ваша модель отвечает на сложные вопросы. Ролик смотрят сотни тысяч человек. ' +
        'Можно подогреть интерес рекламой или просто наблюдать.',
    }),
    choices: [
      {
        label: 'Поддержать волну рекламой',
        hint: '', hintFn: (s) => `${cost(0.5)(s)}, +15 шумихи`,
        apply: (s) => {
          pay(s, amount(s, 0.5));
          addHype(s, 'player', 15);
        },
      },
      { label: 'Не вмешиваться', hint: '+6 шумихи', apply: (s) => addHype(s, 'player', 6) },
    ],
  }),
  ev({
    id: 'rnd-jailbreak',
    random: { weight: w((s) => ge(2021)(s) && hasOnSale(s), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Пользователи обошли запреты модели',
      body:
        'В сети появилась инструкция, как заставить вашу модель отвечать на то, что она должна отклонять. ' +
        'Исправление можно выпустить срочно или включить в плановое обновление.',
    }),
    choices: [
      {
        label: 'Выпустить исправление срочно',
        hint: '', hintFn: (s) => `${cost(0.3)(s)}, +2 репутации`,
        apply: (s) => {
          pay(s, amount(s, 0.3));
          addRep(s, 2);
        },
      },
      {
        label: 'Исправить в плановом обновлении',
        hint: '-6 репутации с шансом 40 %',
        apply: (s) => {
          if (roll(s, 0.4, false)) addRep(s, -6);
        },
      },
    ],
  }),
  ev({
    id: 'rnd-license-offer',
    random: { weight: w((s) => ge(2019)(s) && hasReleased(s), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Gogle предлагает купить лицензию на старую модель',
      body:
        'Gogle хочет получить право использовать архивную версию вашей модели в своих сервисах. Деньги придут сразу, ' +
        'но у Gogle станет больше поводов для рассказов о собственных успехах.',
    }),
    choices: [
      {
        label: 'Продать лицензию',
        hint: '', hintFn: (s) => `+${usd(amount(s, 2))}, шумиха Gogle +5`,
        apply: (s) => {
          grant(s, amount(s, 2));
          addHype(s, 'gogle', 5);
        },
      },
      { label: 'Отказаться', hint: '+2 репутации', apply: (s) => addRep(s, 2) },
    ],
  }),
  ev({
    id: 'rnd-cloud-outage',
    random: { weight: w((s) => ge(2019)(s) && hasOnSale(s), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Сбой в облаке: клиенты остались без ответов',
      body:
        'У облачного провайдера случился сбой, и сервис лаборатории несколько часов не отвечал. Клиенты пишут жалобы. ' +
        'Можно выплатить компенсации или сослаться на провайдера.',
    }),
    choices: [
      {
        label: 'Выплатить клиентам компенсации',
        hint: '', hintFn: (s) => `${cost(1)(s)}, +3 репутации`,
        apply: (s) => {
          pay(s, amount(s, 1));
          addRep(s, 3);
        },
      },
      { label: 'Сослаться на провайдера', hint: '-4 репутации', apply: (s) => addRep(s, -4) },
    ],
  }),
  ev({
    id: 'rnd-intern-idea',
    random: { weight: w(ge(2018), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Стажёр нашёл способ ускорить расчёты',
      body:
        'Студент на практике заметил лишние шаги в ваших вычислениях. Улучшение можно внедрить сразу или оформить как статью.',
    }),
    choices: [
      {
        label: 'Внедрить улучшение',
        hint: 'исследования дешевле на 10 % на 90 дней',
        apply: (s) => timed(s, 'intern-idea', 'researchCost', 0.9, 90),
      },
      { label: 'Опубликовать как статью', hint: '+4 репутации', apply: (s) => addRep(s, 4) },
    ],
  }),
  ev({
    id: 'rnd-text-licence',
    random: { weight: w((s) => ge(2019)(s) && !s.flags.dataLicensed, 1), once: true },
    mail: () => ({
      kind: 'event',
      title: 'Издательство предлагает лицензию на книги и статьи',
      body:
        'Крупное издательство готово дать лаборатории законное право обучать модели на своих текстах. ' +
        'Это дорого, но после такого соглашения претензий по данным от издателей не будет.',
    }),
    choices: [
      {
        label: 'Купить лицензию',
        hint: '', hintFn: (s) => `${cost(1.5)(s)}, +3 репутации, иски за данные вам не придут`,
        apply: (s) => {
          pay(s, amount(s, 1.5));
          addRep(s, 3);
          s.flags.dataLicensed = true;
        },
      },
      NO,
    ],
  }),
  ev({
    id: 'rnd-hackathon',
    random: { weight: w(ge(2018), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Студенты предлагают провести хакатон',
      body:
        'Университет хочет устроить соревнование на ваших моделях. Нужно оплатить площадку и призы, ' +
        'зато вас узнают будущие исследователи.',
    }),
    choices: [
      {
        label: 'Провести хакатон',
        hint: '', hintFn: (s) => `${cost(0.3)(s)}, +4 репутации, +4 шумихи`,
        apply: (s) => {
          pay(s, amount(s, 0.3));
          addRep(s, 4);
          addHype(s, 'player', 4);
        },
      },
      NO,
    ],
  }),
  ev({
    id: 'rnd-poaching',
    random: { weight: w(ge(2019), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Соперник переманивает инженеров',
      body:
        'Лаборатория-соперник звонит вашим инженерам и обещает вдвое больше. Двое уже задумались. ' +
        'Можно поднять зарплаты или смириться с уходом.',
    }),
    choices: [
      {
        label: 'Поднять зарплаты инженерам',
        hint: '', hintFn: cost(1),
        apply: (s) => pay(s, amount(s, 1)),
      },
      {
        label: 'Не реагировать',
        hint: 'исследования дороже на 8 % на 60 дней',
        apply: (s) => timed(s, 'poaching', 'researchCost', 1.08, 60),
      },
    ],
  }),
  ev({
    id: 'rnd-regulator',
    random: { weight: w((s) => ge(2021)(s) && hasReleased(s), 1, hasOnSale) },
    mail: () => ({
      kind: 'event',
      title: 'Регулятор запросил сведения о моделях',
      body:
        'Государственный орган просит рассказать, на чём обучены модели и как проверялась их безопасность. ' +
        'Полный ответ займёт у юристов много времени.',
    }),
    choices: [
      {
        label: 'Ответить полностью',
        hint: '', hintFn: (s) => `${cost(0.5)(s)}, +3 репутации`,
        apply: (s) => {
          pay(s, amount(s, 0.5));
          addRep(s, 3);
        },
      },
      {
        label: 'Ответить формально',
        hint: '-6 репутации с шансом 50 %',
        apply: (s) => {
          if (roll(s, 0.5, false)) addRep(s, -6);
        },
      },
    ],
  }),
  ev({
    id: 'rnd-customer-praise',
    random: { weight: w((s) => ge(2018)(s) && s.finance.history.some((h) => h.income.contracts > 0), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Клиент хвалит лабораторию публично',
      body:
        'Заказчик, которому вы сдали работу, написал в соцсетях, что результат превзошёл ожидания. ' +
        'Можно попросить его оформить отзыв для вашего сайта.',
    }),
    choices: [
      {
        label: 'Опубликовать отзыв на сайте',
        hint: '+5 шумихи, +2 репутации',
        apply: (s) => {
          addHype(s, 'player', 5);
          addRep(s, 2);
        },
      },
      { label: 'Не публиковать', hint: 'без изменений', apply: () => {} },
    ],
  }),
  ev({
    id: 'rnd-test-leak',
    random: { weight: w((s) => ge(2019)(s) && hasReleased(s), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Вопросы бенчмарка попали в открытый доступ',
      body:
        'Ответы на популярный тест оказались в сети, и они могли попасть в ваши данные. Можно проверить обучающие данные заранее ' +
        'или надеяться, что никто не заметит.',
    }),
    choices: [
      {
        label: 'Проверить свои данные',
        hint: '', hintFn: (s) => `${cost(0.2)(s)}, +2 репутации`,
        apply: (s) => {
          pay(s, amount(s, 0.2));
          addRep(s, 2);
        },
      },
      {
        label: 'Не проверять',
        hint: 'шанс разоблачения подгонки выше на 20 % на 90 дней',
        apply: (s) => timed(s, 'test-leak', 'exposure', 1.2, 90),
      },
    ],
  }),
  ev({
    id: 'rnd-energy-price',
    random: { weight: w((s) => ge(2020)(s) && rentedCount(s) > 0, 1) },
    mail: () => ({
      kind: 'event',
      title: 'Электричество дорожает',
      body:
        'Провайдеры предупреждают о повышении цен на электроэнергию. Можно заранее заключить договор с фиксированной ценой ' +
        'или платить по текущему тарифу.',
    }),
    choices: [
      {
        label: 'Заключить фиксированный тариф',
        hint: '', hintFn: cost(0.5),
        apply: (s) => pay(s, amount(s, 0.5)),
      },
      {
        label: 'Платить как есть',
        hint: 'аренда дороже на 10 % на 90 дней',
        apply: (s) => timed(s, 'energy-price', 'rentPrice', 1.1, 90),
      },
    ],
  }),
  ev({
    id: 'rnd-safety-blogger',
    random: { weight: w((s) => ge(2022)(s) && hasReleased(s), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Блогер критикует безопасность моделей',
      body:
        'Известный блогер разобрал ответы вашей модели и показал несколько опасных примеров. Видео смотрят тысячи людей. ' +
        'Можно ответить подробным отчётом или промолчать.',
    }),
    choices: [
      {
        label: 'Опубликовать отчёт о безопасности',
        hint: '', hintFn: (s) => `${cost(0.3)(s)}, +4 репутации`,
        apply: (s) => {
          pay(s, amount(s, 0.3));
          addRep(s, 4);
        },
      },
      { label: 'Игнорировать', hint: '-3 шумихи', apply: (s) => addHype(s, 'player', -3) },
    ],
  }),
  ev({
    id: 'rnd-open-letter',
    random: { weight: w(ge(2022), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Сотрудник написал открытое письмо о рисках',
      body:
        'Один из инженеров опубликовал письмо: по его мнению, лаборатория торопится и недооценивает риски. ' +
        'Письмо читают журналисты и коллеги из других компаний.',
    }),
    choices: [
      {
        label: 'Создать комиссию по безопасности',
        hint: '', hintFn: (s) => `${cost(0.4)(s)}, +3 репутации`,
        apply: (s) => {
          pay(s, amount(s, 0.4));
          addRep(s, 3);
        },
      },
      {
        label: 'Ответить публично, что всё в порядке',
        hint: '-2 репутации с шансом 50 %',
        apply: (s) => {
          if (roll(s, 0.5, false)) addRep(s, -2);
        },
      },
    ],
  }),
  ev({
    id: 'rnd-documentary',
    random: { weight: w((s) => ge(2019)(s) && hasReleased(s), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Документалисты просят разрешения снимать в лаборатории',
      body:
        'Съёмочная группа хочет несколько недель снимать работу команды для фильма об искусственном интеллекте. ' +
        'Фильм принесёт известность, но в кадр может попасть неудачный момент.',
    }),
    choices: [
      {
        label: 'Разрешить съёмки',
        hint: '+8 шумихи, -3 репутации с шансом 30 %',
        apply: (s) => {
          addHype(s, 'player', 8);
          if (roll(s, 0.3, false)) addRep(s, -3);
        },
      },
      NO,
    ],
  }),
  ev({
    id: 'rnd-startup-team',
    random: { weight: w(ge(2020), 1) },
    mail: () => ({
      kind: 'event',
      title: 'Небольшой стартап ищет покупателя',
      body:
        'Команда из шести человек, которая делала похожие модели, готова перейти к вам целиком. Они знают приёмы, ' +
        'которых нет в лаборатории, но покупка стоит немало.',
    }),
    choices: [
      {
        label: 'Купить команду стартапа',
        hint: '', hintFn: (s) => `${cost(3)(s)}, +2 репутации, исследования дешевле на 10 % на 120 дней`,
        apply: (s) => {
          pay(s, amount(s, 3));
          addRep(s, 2);
          timed(s, 'startup-team', 'researchCost', 0.9, 120);
        },
      },
      NO,
    ],
  }),
];
