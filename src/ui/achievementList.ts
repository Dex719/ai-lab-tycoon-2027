// Достижения: значки за всю историю игры в этом браузере (не в сохранении партии).
// Условия смотрят на состояние партии; полученное остаётся навсегда.

import { findGoal } from '../data/goals';
import { dcReady, gpuKwAt } from '../sim/datacenters';
import { valuation } from '../sim/investors';
import { CONTEXT_MAX_LEVEL } from '../sim/research';
import { dateToDay } from '../sim/time';
import type { Datacenter, GameState, MonthRecord } from '../sim/types';
import { GPU_IDS } from '../sim/types';

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

// ---------- Новые системы: задачи, цели с риском, соперники, сделки, финал, дата-центры ----------

/** Выполнено рискованных целей года за партию: прошлые годы - по итогам, текущий - по целям в работе. */
function riskGoalsDone(s: GameState): number {
  let n = 0;
  for (const r of s.yearly.reviews) {
    if (r.year === s.yearly.year) continue; // текущий год посчитаем по целям в работе
    n += (r.results ?? []).filter((g) => g.done && g.style === 'risk').length;
  }
  n += s.yearly.goals.filter((g) => g.done && findGoal(g.id)?.style === 'risk').length;
  return n;
}

/** Обгонов главного соперника (по счёту обгонов из досье). */
function mainRivalPassed(s: GameState): number {
  const main = s.duel?.main;
  return main ? (s.duel?.labs[main]?.youPassed ?? 0) : 0;
}

/** Три исхода «повезло» подряд в письмах с риском (по порядку писем). */
function luckyStreak(s: GameState, need: number): boolean {
  let run = 0;
  for (const m of s.mail) {
    if (!m.outcome) continue;
    run = m.outcome.lucky ? run + 1 : 0;
    if (run >= need) return true;
  }
  return false;
}

/** Готовый дата-центр заполнен картами: стоящие карты занимают от 98 % мощности. */
function dcFull(dc: Datacenter): boolean {
  if (!dcReady(dc) || dc.mw <= 0) return false;
  let kw = 0;
  for (const id of GPU_IDS) kw += (dc.gpus[id] ?? 0) * gpuKwAt(dc.site, id);
  return kw >= dc.mw * 1000 * 0.98;
}

const startupsBought = (s: GameState) => s.late?.startups.filter((d) => d.status === 'bought').length ?? 0;
const pushFired = (s: GameState) => s.late?.finale.pushes.some((p) => p.fired) ?? false;

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
  // Задачи и цели года
  { id: 'tasks-10', title: 'Десять задач', how: 'Выполнить 10 задач за партию', check: (s) => s.quests.done >= 10 },
  { id: 'tasks-30', title: 'Тридцать задач', how: 'Выполнить 30 задач за партию', check: (s) => s.quests.done >= 30 },
  { id: 'risk-goals', title: 'Три риска', how: 'Выполнить 3 рискованные цели года за партию', check: (s) => riskGoalsDone(s) >= 3 },
  { id: 'lucky-streak', title: 'Везение', how: 'Три раза подряд повезло в письмах с риском', check: (s) => luckyStreak(s, 3) },
  // Соперники
  { id: 'main-rival', title: 'Личный счёт', how: 'Обойти главного соперника 3 раза', check: (s) => mainRivalPassed(s) >= 3 },
  // Сделки
  { id: 'star-team', title: 'Звёздная команда', how: 'Нанять звёздную команду', check: (s) => (s.late?.teams.length ?? 0) > 0 },
  {
    id: 'team-kept',
    title: 'Своих не отдаём',
    how: 'Удержать звёздную команду, которую переманивает соперник',
    check: (s) => s.mail.some((m) => m.eventId === 'rival-poach-team' && m.chosen === 0),
  },
  { id: 'startup', title: 'Покупка', how: 'Купить стартап', check: (s) => startupsBought(s) >= 1 },
  { id: 'startups-3', title: 'Холдинг', how: 'Купить 3 стартапа за партию', check: (s) => startupsBought(s) >= 3 },
  { id: 'cloud-deal', title: 'Облачный партнёр', how: 'Подписать облачную сделку', check: (s) => !!s.late?.cloud || (s.late?.cloudPast.length ?? 0) > 0 },
  // Финальный квартал
  { id: 'final-update', title: 'Доработка', how: 'Доработать модель в финальном квартале', check: (s) => (s.late?.finale.done.length ?? 0) > 0 },
  {
    id: 'push-held',
    title: 'Рывок отбит',
    how: 'Остаться на 1-м месте после финального рывка соперника',
    check: (s) => moment(s, 'push-held') || (s.outcome === 'victory' && pushFired(s)),
  },
  // Дата-центры
  { id: 'dc-50', title: 'Большая стройка', how: 'Достроить дата-центр на 50 МВт или больше', check: (s) => s.datacenters.list.some((d) => dcReady(d) && d.mw >= 50) },
  { id: 'dc-full', title: 'Полный зал', how: 'Заполнить свой дата-центр картами', check: (s) => s.datacenters.list.some(dcFull) },
];

/** Разделы окна «Достижения»: каждое достижение ровно в одном разделе (проверяет тест). */
export const ACH_GROUPS: readonly { title: string; ids: readonly string[] }[] = [
  {
    title: 'Модели и гонка',
    ids: ['first-model', 'quick-start', 'attention-first', 'first-rlhf', 'chat-moment', 'ten-models', 'long-context', 'first-place-bench', 'first-place-arena', 'year-on-top', 'comeback', 'main-rival', 'exposed'],
  },
  { title: 'Деньги и рынок', ids: ['million-month', 'hundred-million', 'unicorn', 'half-market', 'million-subs'] },
  { title: 'Цели и задачи', ids: ['perfect-year', 'risk-goals', 'tasks-10', 'tasks-30', 'lucky-streak'] },
  { title: 'Сделки и дата-центры', ids: ['star-team', 'team-kept', 'startup', 'startups-3', 'cloud-deal', 'datacenter', 'dc-50', 'dc-full'] },
  { title: 'Финал партии', ids: ['final-update', 'push-held', 'victory', 'victory-hard', 'honest', 'founder-control', 'bankrupt'] },
];

const KEY = 'ailab.achievements';

// Полученные за этот запуск: если хранилище не пишет (переполнено сохранениями, запрещено), без этой памяти
// одни и те же достижения находились заново каждый игровой день - тост и звук раз в день.
const session: Record<string, string> = {};

/** Полученные достижения: id → дата получения (ISO). */
export function loadUnlocked(): Record<string, string> {
  let stored: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Record<string, string>;
  } catch {
    // ниже - только полученные за этот запуск
  }
  return { ...session, ...stored };
}

function saveUnlocked(u: Record<string, string>): void {
  Object.assign(session, u);
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {
    // без хранилища достижения проживут до перезагрузки (session)
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
