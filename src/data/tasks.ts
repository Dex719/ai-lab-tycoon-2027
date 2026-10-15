// Короткие задачи: одна-две сразу, срок 1-5 месяцев, у каждой своя награда. Задача появляется, только когда её можно
// выполнить сейчас: есть тендер, на который модель проходит; идёт обучение; соперник впереди на небольшой разрыв;
// есть выручка. Задачи называют только то, что уже есть в игре: будущее не раскрывают.

import { CLIENTS } from './clients';
import { unitForYear, usd } from './eventKit';
import { beatProgress, shareProgress, trainingProgress } from './goals';
import {
  clamp01,
  closeGapOf,
  countText,
  cumIncome,
  cumRevenue,
  nearestTrainingDays,
  niceCount,
  niceMoney,
  niceShare,
  raceKeyOf,
  raceWhere,
  rivalLabel,
  safeStanding,
  shareText,
  splitRace,
  type Reward,
} from './questKit';
import { pool } from '../sim/compute';
import { canApply } from '../sim/contracts';
import { subsOpen } from '../sim/market';
import { researchDaysLeft, rpPerDay, TECHS, techCost } from '../sim/research';
import { ruPlural } from '../sim/text';
import { yearOf } from '../sim/time';
import type { GameState, TaskState, TechId } from '../sim/types';
import { playerShare, releasedCount } from '../sim/yearStats';

export type TaskKind = 'tender' | 'deliver' | 'release' | 'beat' | 'earn' | 'research' | 'share' | 'subs';

/** Две задачи сразу - всегда разных групп. */
export type TaskGroup = 'contracts' | 'models' | 'race' | 'money' | 'research' | 'market';

export interface TaskProgress {
  done: boolean;
  fraction: number;
  /** «Выиграно: 0 из 1, заявок на рассмотрении: 1». */
  text: string;
  /** «не хватило $80 тыс.». */
  miss: string;
  /** «Почти»: в гонке - тот же порог, что на верхней панели; иначе полоска от 80 %. */
  almost: boolean;
  /** Задачу уже не выполнить (контракт провален): закрывается сразу. */
  lost?: boolean;
}

export interface TaskPlan {
  need: number;
  base: number;
  subject: string;
  days: number;
}

export interface TaskDef {
  kind: TaskKind;
  group: TaskGroup;
  weight: number;
  reward: Reward;
  /** Задача на сегодня или null: выполнить сейчас нечем. */
  make: (s: GameState, rnd: () => number) => TaskPlan | null;
  title: (s: GameState, t: TaskState) => string;
  progress: (s: GameState, t: TaskState) => TaskProgress;
}

const ALMOST = 0.8;

function withAlmost(p: { done: boolean; fraction: number; text: string; miss?: string; almost?: boolean }, lost = false): TaskProgress {
  return { done: p.done, fraction: p.fraction, text: p.text, miss: p.miss ?? '', almost: !p.done && (p.almost ?? p.fraction >= ALMOST), lost };
}

const tendersWord = (n: number): string => ruPlural(n, 'тендер', 'тендера', 'тендеров');

function clientName(id: string): string {
  return CLIENTS.find((c) => c.id === id)?.name ?? 'Клиент';
}

function techName(id: string): string {
  return TECHS.find((t) => t.id === id)?.name ?? id;
}

/** Уровень цепочки исследований (algo, context) или 0 у обычной технологии. */
function chainLevel(s: GameState, tech: string): number {
  return tech === 'algo' ? s.research.algoLevel : tech === 'context' ? s.research.contextLevel : 0;
}

const hasOnSale = (s: GameState): boolean => s.models.some((m) => m.releasedDay !== null && (m.onApi || m.onSubs));

export const TASKS: TaskDef[] = [
  {
    kind: 'tender',
    group: 'contracts',
    weight: 3,
    reward: { reputation: 2 },
    make: (s, rnd) => {
      const usable = s.tenders.filter((t) => t.application === null && t.expiresDay > s.day + 3 && s.models.some((m) => canApply(s, t, m) === null));
      const pending = s.autoApply && s.tenders.some((t) => t.application !== null);
      if (usable.length === 0 && !pending) return null;
      const need = usable.length >= 2 && yearOf(s.day) >= 2020 && rnd() < 0.4 ? 2 : 1;
      return { need, base: s.quests.tendersWon, subject: '', days: need === 1 ? 40 : 70 };
    },
    title: (_s, t) => (t.need === 1 ? 'Выиграть тендер' : `Выиграть ${t.need} ${tendersWord(t.need)}`),
    progress: (s, t) => {
      const won = Math.max(0, s.quests.tendersWon - t.base);
      const pending = s.tenders.filter((x) => x.application !== null).length;
      const tail = won < t.need && pending > 0 ? `, заявок на рассмотрении: ${pending}` : '';
      return withAlmost({ done: won >= t.need, fraction: clamp01(won / t.need), text: `Выиграно: ${won} из ${t.need}${tail}`, miss: `выиграно ${won} из ${t.need}` });
    },
  },
  {
    kind: 'deliver',
    group: 'contracts',
    weight: 2,
    reward: { moneyK: 0.2 },
    make: (s, rnd) => {
      if (s.contracts.length === 0) return null;
      const per = pool(s, 'contracts') / s.contracts.length;
      if (!(per > 0)) return null;
      const list = s.contracts
        .map((c) => ({ c, left: (c.tender.work - c.workDone) / per }))
        .filter((x) => x.left >= 10 && x.left <= 100 && s.day + x.left + 5 < x.c.deadlineDay);
      if (list.length === 0) return null;
      const { c, left } = list[Math.floor(rnd() * list.length)];
      const days = Math.min(Math.ceil(left * 0.85) + 2, c.deadlineDay - s.day - 1);
      // Клиент в предмете задачи: после сдачи контракта его уже нет в списке, а название нужно письму.
      return { need: c.tender.payment, base: cumIncome(s, ['contracts']), subject: `${c.id}:${c.tender.clientId}`, days };
    },
    title: (_s, t) => {
      const client = t.subject.split(':')[1];
      return `Сдать контракт досрочно${client ? `: ${clientName(client)}` : ''}`;
    },
    progress: (s, t) => {
      const id = t.subject.split(':')[0];
      const c = s.contracts.find((x) => x.id === id);
      if (c) {
        const f = clamp01(c.workDone / c.tender.work);
        return withAlmost({ done: false, fraction: f, text: `Работа: ${Math.floor(f * 100)} %`, miss: `работа сделана на ${Math.floor(f * 100)} %` });
      }
      const paid = cumIncome(s, ['contracts']) - t.base >= t.need * 0.99;
      return withAlmost({ done: paid, fraction: paid ? 1 : 0, text: paid ? 'Контракт сдан' : 'Контракт не сдан', miss: 'контракт не сдан' }, !paid);
    },
  },
  {
    kind: 'release',
    group: 'models',
    weight: 3,
    reward: { hype: 5 },
    make: (s) => {
      // Свежая обученная модель ждёт выпуска; давно отложенная - не повод для задачи.
      if (s.models.some((m) => m.releasedDay === null && s.day - m.trainedDay <= 30)) return { need: 1, base: releasedCount(s), subject: '', days: 14 };
      const left = nearestTrainingDays(s);
      if (left === null || left < 7 || left > 110) return null;
      return { need: 1, base: releasedCount(s), subject: '', days: Math.ceil(left) + 15 };
    },
    title: () => 'Выпустить новую модель',
    progress: (s, t) => {
      if (releasedCount(s) > t.base) return withAlmost({ done: true, fraction: 1, text: 'Модель выпущена' });
      const p = trainingProgress(s, 'Обучения нет');
      return withAlmost({ ...p, miss: p.fraction >= 0.95 ? 'модель обучена, но не выпущена' : 'модель не готова' });
    },
  },
  {
    kind: 'beat',
    group: 'race',
    weight: 3,
    reward: { hype: 8 },
    make: (s) => {
      const st = safeStanding(s);
      if (!st || !st.above) return null;
      const key = raceKeyOf(st.metric);
      if (st.above.gap > (key === 'arena' ? 40 : 4)) return null;
      const subject = `${key}:${st.above.id}`;
      if (s.yearly.goals.some((g) => g.id === 'g-beat' && g.param === subject && !g.done)) return null; // не дублируем цель года
      const ready = s.models.some((m) => m.releasedDay === null);
      const left = nearestTrainingDays(s);
      if (!ready && left === null) return null;
      const days = Math.max(45, Math.min(150, Math.ceil((left ?? 0) + 30)));
      return { need: 0, base: st.above.gap, subject, days };
    },
    title: (_s, t) => {
      const { key, rivalId } = splitRace(t.subject);
      return `Обогнать ${rivalLabel(rivalId)} ${raceWhere(key)}`;
    },
    progress: (s, t) => {
      const p = beatProgress(s, t.subject, t.base);
      return withAlmost({ ...p, almost: p.almost ?? false });
    },
  },
  {
    kind: 'earn',
    group: 'money',
    weight: 3,
    reward: { moneyK: 0.2 },
    make: (s, rnd) => {
      if (!hasOnSale(s)) return null;
      const r = s.finance.revenueDaily;
      const sum = r.reduce((a, b) => a + b, 0);
      if (!(sum > 0) || r.length < 30) return null;
      const need = niceMoney((sum / r.length) * 60 * (1.1 + 0.2 * rnd()));
      // Мелкая сумма (меньше половины денежной единицы года) - не задача: награда была бы больше цели.
      return need >= unitForYear(yearOf(s.day)) / 2 ? { need, base: cumRevenue(s), subject: '', days: 60 } : null;
    },
    title: (_s, t) => `Заработать ${usd(t.need)}`,
    progress: (s, t) => {
      const got = Math.max(0, cumRevenue(s) - t.base);
      return withAlmost({
        done: got >= t.need,
        fraction: clamp01(got / t.need),
        text: `Заработано: ${usd(got)} из ${usd(t.need)}`,
        miss: `не хватило ${usd(Math.max(0, t.need - got))}`,
      });
    },
  },
  {
    kind: 'research',
    group: 'research',
    weight: 3,
    reward: { reputation: 2 },
    make: (s) => {
      const cur = s.research.current;
      if (!cur) return null;
      const left = researchDaysLeft(s, cur, rpPerDay(s));
      if (!(left >= 15 && left <= 150)) return null;
      return { need: 0, base: chainLevel(s, cur), subject: cur, days: Math.ceil(left * 0.9) + 2 };
    },
    title: (_s, t) => (t.subject === 'algo' || t.subject === 'context' ? `Завершить «${techName(t.subject)}», уровень ${t.base + 1}` : `Завершить «${techName(t.subject)}»`),
    progress: (s, t) => {
      const tech = t.subject as TechId;
      const chain = tech === 'algo' || tech === 'context';
      const done = chain ? chainLevel(s, tech) > t.base : s.research.done.includes(tech);
      if (done) return withAlmost({ done: true, fraction: 1, text: 'Изучено' });
      const f = clamp01((s.research.points[tech] ?? 0) / techCost(s, tech));
      const idle = s.research.current === tech ? '' : ', исследование стоит';
      return withAlmost({ done: false, fraction: f, text: `Изучено на ${Math.floor(f * 100)} %${idle}`, miss: `изучено на ${Math.floor(f * 100)} %` });
    },
  },
  {
    kind: 'share',
    group: 'market',
    weight: 2,
    reward: { hype: 5 },
    make: (s) => {
      const cur = playerShare(s);
      if (!hasOnSale(s) || cur < 0.01 || cur >= 0.6) return null;
      const need = niceShare(cur + Math.max(0.02, cur * 0.15));
      return need > cur ? { need, base: 0, subject: '', days: 75 } : null;
    },
    title: (_s, t) => `Доля рынка ${shareText(t.need)}`,
    progress: (s, t) => withAlmost(shareProgress(s, t.need)),
  },
  {
    kind: 'subs',
    group: 'market',
    weight: 2,
    reward: { moneyK: 0.2 },
    make: (s, rnd) => {
      const cur = s.market.playerSubs;
      if (!subsOpen(s.day) || !s.models.some((m) => m.releasedDay !== null && m.onSubs) || !(cur >= 1000)) return null;
      return { need: niceCount(cur * (1.2 + 0.15 * rnd())), base: 0, subject: '', days: 75 };
    },
    title: (_s, t) => `${countText(t.need)} подписчиков`,
    progress: (s, t) => {
      const v = Math.round(Number.isFinite(s.market.playerSubs) ? s.market.playerSubs : 0);
      return withAlmost({
        done: v >= t.need,
        fraction: clamp01(v / t.need),
        text: `Подписчиков: ${countText(v)} из ${countText(t.need)}`,
        miss: `не хватило ${countText(Math.max(0, t.need - v))}`,
      });
    },
  },
];

export function findTask(kind: string): TaskDef | undefined {
  return TASKS.find((t) => t.kind === kind);
}

/** Порог «почти» в гонке для задачи «обогнать» (для тестов и интерфейса). */
export function taskCloseGap(t: TaskState): number {
  return closeGapOf(splitRace(t.subject).key);
}
