// Рубежи лаборатории и порядок в почте (плейтест 18.10).
// Рубежи: первые 100 тыс. и миллион подписчиков, выручка месяца $1 млн, $10 млн, $100 млн, доля рынка 10 %, 25 %,
// 50 %. Каждый - один раз за партию, письмо-награда (золотое уведомление) и немного шумихи: в 2022-2024 годах, где
// новых наград почти не было, они приходят по мере роста.
// Почта: к 2022 году набиралось 290 непрочитанных писем. Письма старше NEWS_AUTO_READ_DAYS дней считаются
// прочитанными сами (кроме ждущих решения): счётчик показывает свежее и то, что ждёт ответа.

import { addMail } from './events';
import type { GameState } from './types';

export const NEWS_AUTO_READ_DAYS = 30;
/** Шумиха за рубеж. */
export const MILESTONE_HYPE = 3;

interface Milestone {
  id: string;
  value: (s: GameState) => number;
  at: number;
  title: string;
  body: string;
}

function lastRevenue(s: GameState): number {
  const h = s.finance.history.at(-1);
  return h ? h.income.api + h.income.subs + h.income.contracts : 0;
}

const subs = (s: GameState) => s.market.playerSubs ?? 0;
const share = (s: GameState) => s.market.labShares.player ?? 0;

export const MILESTONES: readonly Milestone[] = [
  { id: 'subs-100k', value: subs, at: 1e5, title: '100 тысяч подписчиков', body: 'Платная подписка на чат лаборатории набрала первые 100 тысяч пользователей.' },
  { id: 'subs-1m', value: subs, at: 1e6, title: 'Миллион подписчиков', body: 'Чат лаборатории оплачивает миллион человек. О нём пишут не только технические издания.' },
  { id: 'subs-10m', value: subs, at: 1e7, title: '10 миллионов подписчиков', body: 'Подписку на чат лаборатории оплачивают 10 миллионов человек.' },
  { id: 'rev-1m', value: lastRevenue, at: 1e6, title: 'Выручка $1 млн за месяц', body: 'Клиенты заплатили лаборатории за месяц больше миллиона долларов.' },
  { id: 'rev-10m', value: lastRevenue, at: 1e7, title: 'Выручка $10 млн за месяц', body: 'Выручка за месяц превысила $10 млн: лаборатория - заметный бизнес.' },
  { id: 'rev-100m', value: lastRevenue, at: 1e8, title: 'Выручка $100 млн за месяц', body: 'Выручка за месяц превысила $100 млн. Такие цифры бывают у немногих лабораторий мира.' },
  { id: 'share-10', value: share, at: 0.1, title: 'Каждый десятый клиент - ваш', body: 'Модели лаборатории выбирают 10 % клиентов рынка.' },
  { id: 'share-25', value: share, at: 0.25, title: 'Четверть рынка', body: 'Модели лаборатории выбирают четверть всех клиентов.' },
  { id: 'share-50', value: share, at: 0.5, title: 'Половина рынка', body: 'Модели лаборатории выбирает каждый второй клиент.' },
];

/** Конец месяца: новые рубежи - письмо-награда и шумиха; старые новости - прочитаны. */
export function milestonesMonth(s: GameState): void {
  for (const m of MILESTONES) {
    const flag = `ms:${m.id}`;
    if (s.flags[flag] || m.value(s) < m.at) continue;
    s.flags[flag] = true;
    s.hype.player = Math.min(100, s.hype.player + MILESTONE_HYPE);
    addMail(s, { kind: 'news', reward: true, title: m.title, body: `${m.body} Шумиха +${MILESTONE_HYPE}.` });
  }
  // Старше месяца - прочитано всё, кроме писем, которые ждут решения: важные и награды уже показали уведомление и паузу,
  // когда пришли (плейтест 18.10: 259 непрочитанных к 2023 году, почти все - оплаты контрактов, цели и готовые модели).
  for (const mail of s.mail) {
    if (mail.read || (mail.choices && mail.chosen === undefined)) continue;
    if (s.day - mail.day >= NEWS_AUTO_READ_DAYS) mail.read = true;
  }
}
