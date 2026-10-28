// Обучение игре проходится до конца без тупиков: игрок делает то, что написано в шаге, и шаг закрывается сам.
// И каждая цель подсветки есть в интерфейсе (data-tutorial в окнах).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newGame, releaseModel } from '../sim/actions';
import { pool, setRent } from '../sim/compute';
import { applyTender } from '../sim/contracts';
import { applyChoice, pendingChoice } from '../sim/events';
import { chooseGoals, goalOfferOpen, goalsDay } from '../sim/goals';
import { refPrice } from '../sim/market';
import { setResearch } from '../sim/research';
import { advanceDay } from '../sim/tick';
import { startTraining, tierPreset } from '../sim/training';
import type { GameState } from '../sim/types';
import { contractsNeedWithApplications } from './forecast';
import { contractPowerEnough, ORDER_STEP_TITLE, stepTargets, stepText, TUTORIAL, tutorialPower, tutorialRentGoal, tutorialTender, type TutorialCtx } from './tutorialSteps';
import type { WindowId } from './windows';

const UI_DIR = join(__dirname);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Все значения data-tutorial из исходников интерфейса (с запасом: все строки в выражении атрибута). */
function knownTargets(): Set<string> {
  const found = new Set<string>();
  for (const file of sources(UI_DIR)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:data-tutorial|tutorial)="([a-z][a-z-]*)"/g)) found.add(m[1]);
    for (const m of text.matchAll(/data-tutorial=\{([^}]*)\}/g)) {
      for (const q of m[1].matchAll(/'([a-z][a-z-]*)'/g)) found.add(q[1]);
    }
  }
  // Значки рабочего стола: data-tutorial={`icon-${def.id}`} у окон, доступных с начала партии (без openedDay).
  const index = readFileSync(join(UI_DIR, 'windows', 'index.ts'), 'utf8');
  for (const line of index.split('\n')) {
    const m = line.match(/\{ id: '([a-zA-Z]+)'.*Component/);
    if (m && !line.includes('openedDay')) found.add(`icon-${m[1]}`);
  }
  return found;
}

/** День без выбора в письмах: первый вариант, как автоигра. */
function day(s: GameState): void {
  for (let guard = 0; guard < 20; guard++) {
    const p = pendingChoice(s);
    if (!p) break;
    applyChoice(s, p.id, 0);
  }
  advanceDay(s);
}

function midPlan(s: GameState) {
  const p = tierPreset(s, 'mid');
  return {
    name: 'Модель 1',
    paramsB: p.paramsB,
    tokensB: p.tokensB,
    mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
    benchShare: 0,
    benchTargets: [],
    rlhf: false,
    context: 512,
    tier: 'mid' as const,
  };
}

describe('обучение игре', () => {
  it('каждая цель подсветки есть в интерфейсе', () => {
    const known = knownTargets();
    const s = newGame('Тест', 1);
    const states: GameState[] = [s];
    const withModel = structuredClone(s);
    withModel.models.push({ ...({} as GameState['models'][number]), id: 'm1', releasedDay: null } as GameState['models'][number]);
    states.push(withModel);
    const withRun = structuredClone(s);
    withRun.trainings.push({} as GameState['trainings'][number]);
    states.push(withRun);
    for (const step of TUTORIAL) {
      for (const st of states) {
        for (const t of stepTargets(step, st)) expect(known, `«${step.title}»: ${t}`).toContain(t);
      }
    }
  });

  it('тексты: простой дефис, без длинных простыней', () => {
    const st = newGame('Тест', 1, 'normal');
    for (const step of TUTORIAL) {
      const text = stepText(step, st);
      expect(text).not.toMatch(/[—–]/);
      expect(step.title).not.toMatch(/[—–]/);
      expect(text.length, step.title).toBeLessThanOrEqual(150);
    }
  });

  for (const seed of [1, 2, 3, 7, 42, 2017]) {
    it(`проходится до конца без тупиков, зерно ${seed}`, () => {
      const s = newGame('Тест', seed);
      s.tutorial = { step: 0, active: true };
      const open = new Set<WindowId>();
      const ctx: TutorialCtx = { open, speed: 0 };
      const done = (i: number) => TUTORIAL[i].done?.(s, ctx) ?? false;
      const titles = TUTORIAL.map((t) => t.title);
      expect(titles).toHaveLength(8);
      const at = (title: string) => {
        const i = titles.indexOf(title);
        expect(i, title).toBeGreaterThanOrEqual(0);
        return i;
      };

      // Первый шаг - окно выбора целей: интерфейс открывает его сразу (store.newGame вызывает goalsDay).
      goalsDay(s);
      expect(goalOfferOpen(s)).toBe(true);
      const goals = at('Цели года');
      expect(done(goals)).toBe(false);
      expect(chooseGoals(s, s.quests.offer!.goals.slice(0, 3).map((g) => g.id)).ok).toBe(true);
      expect(done(goals)).toBe(true);

      // Карты 2017 года работают сразу: мощность есть в тот же день.
      const rent = at('Видеокарты');
      expect(done(rent)).toBe(false);
      expect(setRent(s, 'p100', 96).ok).toBe(true);
      expect(done(rent)).toBe(true);
      expect(pool(s, 'training')).toBeGreaterThan(0);

      const research = at('Исследование');
      expect(done(research)).toBe(false);
      expect(setResearch(s, 'attention').ok).toBe(true);
      expect(done(research)).toBe(true);

      // Первая модель - сразу, на LSTM, не дожидаясь «Механизма внимания».
      const first = at('Первая модель');
      expect(done(first)).toBe(false);
      expect(startTraining(s, midPlan(s)).ok).toBe(true);
      expect(s.trainings[0].arch).toBe('lstm');
      expect(done(first)).toBe(true);

      const time = at('Время');
      expect(stepText(TUTORIAL[time], s)).toMatch(/будет готова \d\d\.\d\d\.2017/);
      expect(done(time)).toBe(false);
      ctx.speed = 4;
      expect(done(time)).toBe(true);

      // Модель готова за полтора месяца: задолго до «Механизма внимания».
      const release = at('Выпуск модели');
      expect(stepTargets(TUTORIAL[release], s)).toContain('icon-models');
      for (let i = 0; i < 60 && s.models.length === 0; i++) day(s);
      expect(s.models).toHaveLength(1);
      expect(s.research.done).not.toContain('attention');
      expect(stepTargets(TUTORIAL[release], s)[0]).toBe('release-confirm');
      expect(done(release)).toBe(false);
      expect(releaseModel(s, s.models[0].id, refPrice(s.day)).ok).toBe(true);
      expect(done(release)).toBe(true);

      // Первый заказ: посильный тендер находится не позже чем через месяц, подсвечена его строка.
      const order = at(ORDER_STEP_TITLE);
      expect(done(order)).toBe(false);
      let fit = tutorialTender(s).fit;
      for (let i = 0; i < 40 && !fit && tutorialTender(s).minNeed === null; i++) {
        day(s);
        fit = tutorialTender(s).fit;
      }
      // Подходящий тендер есть, но 96 картам он не по силам: шаг просит арендовать ещё, сколько назвал, - и тендер посилен.
      const short = tutorialTender(s);
      if (!short.fit) {
        expect(short.minNeed, 'подходящий тендер').not.toBeNull();
        expect(stepTargets(TUTORIAL[order], s)[0]).toBe('rent-confirm');
        // Окно аренды подставляет число карт из tutorialRentGoal: игрок жмёт «Арендовать» с ним.
        s.tutorial.step = order;
        const goal = tutorialRentGoal(s)!;
        expect(goal.count).toBeGreaterThan(s.compute.rented.p100);
        expect(stepText(TUTORIAL[order], s)).toContain(`ещё ${goal.count - s.compute.rented.p100} `);
        expect(setRent(s, goal.id, goal.count).ok).toBe(true);
        fit = tutorialTender(s).fit;
      }
      expect(fit, 'посильный тендер').not.toBeNull();
      // Тест обучения: в шаге заказа первая цель - подтверждение заявки (кнопка в диалоге), затем строка тендера.
      expect(stepTargets(TUTORIAL[order], s)[0]).toBe('apply-confirm');
      expect(stepTargets(TUTORIAL[order], s)).toContain('tender-fit');
      expect(stepText(TUTORIAL[order], s)).toContain(fit!.client);
      expect(applyTender(s, fit!.id, s.models[0].id).ok).toBe(true);
      expect(done(order)).toBe(true);

      // Мощность под заявку выделяет игра (Tutorial.tsx - tutorialPower): двигать доли игроку не нужно, и обучению
      // остаётся не меньше 10 % - следующая модель после обучения игре не стоит.
      expect(contractPowerEnough(s)).toBe(false);
      tutorialPower(s);
      expect(contractPowerEnough(s), `нужно ${contractsNeedWithApplications(s)}, есть ${pool(s, 'contracts')}`).toBe(true);
      expect(s.compute.alloc.training).toBeGreaterThanOrEqual(0.1 - 1e-9);

      // Последний шаг - итог с кнопкой «Завершить».
      expect(TUTORIAL.at(-1)!.done).toBeUndefined();
      expect(stepTargets(TUTORIAL.at(-1)!, s)).toEqual([]);
    });
  }

  it('без модели и проекта шаг выпуска ведёт к новой модели', () => {
    const s = newGame('Тест', 5);
    const release = TUTORIAL.find((t) => t.title === 'Выпуск модели')!;
    expect(stepTargets(release, s)).toContain('train-start');
  });

  it('шаг «Первый заказ»: если посильного тендера нет из-за карт - просит арендовать ещё, без тендеров - ждать', () => {
    const s = newGame('Тест', 9);
    const order = TUTORIAL.find((t) => t.title === ORDER_STEP_TITLE)!;
    s.tenders = [];
    expect(stepTargets(order, s)).toEqual(['speed-play', 'icon-contracts']);
    expect(stepText(order, s)).toMatch(/появится/);
  });
});
