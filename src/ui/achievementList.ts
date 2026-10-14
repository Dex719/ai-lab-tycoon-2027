// Достижения: значки за всю историю игры в этом браузере (не в сохранении партии).
// Условия смотрят на состояние партии; полученное остаётся навсегда.

import { dcReady } from '../sim/datacenters';
import { valuation } from '../sim/investors';
import { CONTEXT_MAX_LEVEL } from '../sim/research';
import { dateToDay } from '../sim/time';
import type { GameState, MonthRecord } from '../sim/types';

export interface AchievementDef {
  id: string;
  title: string;
  /** Что нужно сделать: одна строка, видна и до получения. */
  how: string;
  check: (s: GameState) => boolean;
}

const released = (s: GameState) => s.models.filter((m) => m.releasedDay !== null);
const revenueOf = (h: MonthRecord) => h.income.api + h.income.subs + h.income.contracts;
const moment = (s: GameState, id: string) => !!s.flags[`moment:${id}`];
const ended = (s: GameState) => s.outcome === 'victory' || s.outcome === 'finished';

function safe(f: () => boolean): boolean {
  try {
    return f();
  } catch {
    return false;
  }
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-model', title: 'Первая модель', how: 'Выпустить первую модель', check: (s) => released(s).length >= 1 },
  {
    id: 'quick-start',
    title: 'Быстрый старт',
    how: 'Выпустить модель до 1 апреля 2017 года',
    check: (s) => released(s).some((m) => (m.releasedDay ?? Infinity) < dateToDay('2017-04-01')),
  },
  { id: 'attention-first', title: 'Раньше Gogle', how: 'Изучить механизм внимания до статьи Gogle', check: (s) => moment(s, 'attention-first') },
  { id: 'first-place-bench', title: 'Лучшие по тестам', how: 'Занять 1-е место в гонке по тестам', check: (s) => moment(s, 'first-place-bench') },
  { id: 'first-place-arena', title: 'Вершина «Арены»', how: 'Занять 1-е место на «Арене»', check: (s) => moment(s, 'first-place-arena') },
  { id: 'year-on-top', title: 'Год на вершине', how: '12 месяцев на 1-м месте', check: (s) => s.monthsFirst >= 12 },
  { id: 'first-rlhf', title: 'Собеседник', how: 'Выпустить модель с RLHF', check: (s) => moment(s, 'first-rlhf') },
  { id: 'chat-moment', title: 'Наш момент', how: 'Чат лаборатории не уступает ChatGTP', check: (s) => moment(s, 'chat-moment') },
  { id: 'ten-models', title: 'Конвейер', how: 'Выпустить 10 моделей за партию', check: (s) => released(s).length >= 10 },
  {
    id: 'million-month',
    title: 'Миллион в месяц',
    how: 'Выручка $1 млн за один месяц',
    check: (s) => s.finance.history.some((h) => revenueOf(h) >= 1e6),
  },
  {
    id: 'hundred-million',
    title: 'Сто миллионов',
    how: 'Выручка $100 млн за партию',
    check: (s) => s.finance.history.reduce((sum, h) => sum + revenueOf(h), 0) >= 1e8,
  },
  { id: 'unicorn', title: 'Единорог', how: 'Оценка компании $1 млрд', check: (s) => safe(() => valuation(s).total >= 1e9) },
  { id: 'half-market', title: 'Полрынка', how: 'Доля рынка 50 %', check: (s) => (s.market.labShares.player ?? 0) >= 0.5 },
  { id: 'million-subs', title: 'Миллион подписчиков', how: '1 млн подписчиков', check: (s) => (s.market.playerSubs ?? 0) >= 1e6 },
  { id: 'datacenter', title: 'Свои стены', how: 'Достроить свой дата-центр', check: (s) => s.datacenters.list.some(dcReady) },
  { id: 'long-context', title: 'Длинная память', how: 'Изучить «Длинный контекст» до конца', check: (s) => s.research.contextLevel >= CONTEXT_MAX_LEVEL },
  {
    id: 'perfect-year',
    title: 'Три звезды',
    how: 'Выполнить все цели года',
    check: (s) => s.yearly.reviews.some((r) => r.goalsTotal > 0 && r.goalsDone === r.goalsTotal),
  },
  {
    id: 'comeback',
    title: 'Возвращение',
    how: 'Вернуться на 1-е место после 5-го или ниже',
    check: (s) => {
      let low = false;
      for (const h of s.finance.history) {
        if (typeof h.placeEnd !== 'number') continue;
        if (h.placeEnd >= 5) low = true;
        else if (low && h.placeEnd === 1) return true;
      }
      return false;
    },
  },
  { id: 'exposed', title: 'Пойманы', how: 'Подгонку под тесты раскрыли', check: (s) => s.models.some((m) => m.exposed) },
  { id: 'victory', title: 'Победа', how: 'Выиграть партию', check: (s) => s.outcome === 'victory' },
  { id: 'victory-hard', title: 'Против сильных', how: 'Выиграть на «Сложной»', check: (s) => s.outcome === 'victory' && s.difficulty === 'hard' },
  {
    id: 'honest',
    title: 'Честная игра',
    how: 'Дойти до конца 2024 года без подгонки под тесты',
    check: (s) => ended(s) && released(s).length > 0 && s.models.every((m) => !(m.plan.benchShare > 0)),
  },
  { id: 'founder-control', title: 'Контроль', how: 'Дойти до конца 2024 года с долей основателя от 50 %', check: (s) => ended(s) && s.founderShare >= 0.5 },
  { id: 'bankrupt', title: 'Горький опыт', how: 'Обанкротиться', check: (s) => s.outcome === 'bankrupt' },
];

const KEY = 'ailab.achievements';

/** Полученные достижения: id → дата получения (ISO). */
export function loadUnlocked(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveUnlocked(u: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    // без хранилища достижения проживут до перезагрузки
  }
}

/** Проверить партию; вернуть только что полученные достижения (и записать их). */
export function checkAchievements(s: GameState): AchievementDef[] {
  const u = loadUnlocked();
  const fresh = ACHIEVEMENTS.filter((a) => !u[a.id] && safe(() => a.check(s)));
  if (fresh.length === 0) return [];
  const now = new Date().toISOString();
  for (const a of fresh) u[a.id] = now;
  saveUnlocked(u);
  return fresh;
}
