// Короткие задачи (виды и проверки - data/tasks.ts): одна-две сразу, разных групп, срок 1-5 месяцев.
// Каждый день в конце тика: засчитать выигранные тендеры, проверить задачи (выполнена - награда и золотое
// уведомление, срок вышел - письмо с тем, сколько не хватило), выдать новую, когда подошёл её день.
// Случайность - свой поток s.quests.rng: основной поток игры не сдвигается.

import { findTask, TASKS, type TaskDef, type TaskProgress } from '../data/tasks';
import { capitalize, giveReward, rewardShort, rewardText } from '../data/questKit';
import { addMail } from './events';
import { nextRandom, randInt } from './rng';
import { endSentence } from './text';
import { yearOf } from './time';
import type { GameState, TaskState } from './types';

/** Сколько задач идёт сразу. */
export const MAX_TASKS = 2;
/** Закрытые задачи остаются в списке столько дней: интерфейс показывает их итог. */
export const CLOSED_KEEP_DAYS = 30;
/** Пауза перед следующей задачей, дней: после новой задачи и после закрытой. Подобраны так, чтобы награды задач
 *  не сдвигали баланс ботов (balance.test.ts): за год приходит около 8-10 задач. */
const SPAWN_GAP: readonly [number, number] = [8, 16];
const CLOSE_GAP: readonly [number, number] = [12, 24];
/** Невыполненная задача с полоской от этой доли - «почти»: о ней приходит уведомление. */
const NEAR_MISS = 0.7;

/** Новые контракты (выигранные тендеры) засчитываются в s.quests.tendersWon один раз. */
export function syncTenders(s: GameState): void {
  const q = s.quests;
  const known = new Set(q.knownContracts);
  for (const c of s.contracts) {
    if (known.has(c.id)) continue;
    q.tendersWon += 1;
    known.add(c.id);
  }
  // Номера контрактов не повторяются: закрытые можно забыть.
  q.knownContracts = s.contracts.map((c) => c.id).filter((id) => known.has(id));
}

export function taskTitle(s: GameState, t: TaskState): string {
  return findTask(t.kind)?.title(s, t) ?? t.kind;
}

export function taskProgress(s: GameState, t: TaskState): TaskProgress | null {
  return findTask(t.kind)?.progress(s, t) ?? null;
}

/** Награда задачи одной строкой («+$40 тыс.», «+15 шумихи»). */
export function taskRewardText(t: TaskState, year: number): string {
  const def = findTask(t.kind);
  return def ? rewardText(def.reward, year) : '';
}

/** Награда задачи коротко («аренда -8 %») для боковой панели. */
export function taskRewardShort(t: TaskState, year: number): string {
  const def = findTask(t.kind);
  return def ? rewardShort(def.reward, year) : '';
}

/** Сколько дней осталось, включая сегодняшний. */
export function taskDaysLeft(s: GameState, t: TaskState): number {
  return Math.max(0, t.endDay - s.day + 1);
}

export function activeTasks(s: GameState): TaskState[] {
  return s.quests.tasks.filter((t) => t.status === 'active');
}

function close(s: GameState, t: TaskState, def: TaskDef, p: TaskProgress, done: boolean): void {
  const q = s.quests;
  const title = def.title(s, t);
  t.status = done ? 'done' : 'failed';
  t.closedDay = s.day;
  q.nextTaskDay = Math.max(q.nextTaskDay, s.day + randInt(q, CLOSE_GAP[0], CLOSE_GAP[1]));
  if (done) {
    t.result = p.text;
    q.done += 1;
    const year = yearOf(s.day);
    giveReward(s, def.reward, year, t.id);
    addMail(s, {
      kind: 'event',
      title: `Задача выполнена: ${title}`,
      reward: true,
      body: `Награда: ${endSentence(rewardText(def.reward, year))}`,
    });
    return;
  }
  t.result = p.miss ? capitalize(p.miss) : 'Не выполнено';
  q.failed += 1;
  // «Почти получилось» всплывает уведомлением; далёкий промах только ложится в «Почту».
  const near = !p.lost && p.fraction >= NEAR_MISS;
  addMail(s, {
    kind: 'event',
    title: near ? `Почти: ${title}` : `Задача не выполнена: ${title}`,
    body: `${p.lost ? '' : 'Срок задачи вышел. '}${endSentence(capitalize(p.miss || p.text))}`,
    read: !near,
  });
}

/** Выдать новую задачу: группа, которой нет среди идущих, вид не тот, что был последним. */
function spawn(s: GameState): void {
  const q = s.quests;
  const active = activeTasks(s);
  const groups = new Set(active.map((t) => findTask(t.kind)?.group));
  const last = q.tasks[q.tasks.length - 1]?.kind;
  const rnd = () => nextRandom(q);
  const options: { def: TaskDef; plan: NonNullable<ReturnType<TaskDef['make']>> }[] = [];
  for (const def of TASKS) {
    if (groups.has(def.group) || def.kind === last) continue;
    const plan = def.make(s, rnd);
    if (plan && plan.days > 0) options.push({ def, plan });
  }
  if (options.length === 0) {
    q.nextTaskDay = s.day + 7; // нечего предложить: посмотрим через неделю
    return;
  }
  const total = options.reduce((a, o) => a + o.def.weight, 0);
  let x = rnd() * total;
  let pick = options[options.length - 1];
  for (const o of options) {
    x -= o.def.weight;
    if (x < 0) {
      pick = o;
      break;
    }
  }
  const { def, plan } = pick;
  q.tasks.push({
    id: `q${q.nextTaskNum++}`,
    kind: def.kind,
    startDay: s.day,
    endDay: s.day + plan.days,
    need: plan.need,
    base: plan.base,
    subject: plan.subject,
    status: 'active',
    closedDay: null,
    result: '',
  });
  q.nextTaskDay = s.day + randInt(q, SPAWN_GAP[0], SPAWN_GAP[1]);
}

/** Ежедневно в конце тика: тендеры, проверка задач, новая задача. */
export function tasksDay(s: GameState): void {
  const q = s.quests;
  syncTenders(s);
  for (const t of q.tasks) {
    if (t.status !== 'active') continue;
    const def = findTask(t.kind);
    if (!def) {
      t.status = 'failed';
      t.closedDay = s.day;
      continue;
    }
    const p = def.progress(s, t);
    if (p.done) close(s, t, def, p, true);
    else if (p.lost || s.day >= t.endDay) close(s, t, def, p, false);
  }
  q.tasks = q.tasks.filter((t) => t.status === 'active' || (t.closedDay !== null && s.day - t.closedDay <= CLOSED_KEEP_DAYS));
  if (activeTasks(s).length < MAX_TASKS && s.day >= q.nextTaskDay) spawn(s);
}
