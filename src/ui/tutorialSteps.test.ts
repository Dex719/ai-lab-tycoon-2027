// Обучение игре проходится до конца без тупиков: игрок делает то, что написано в шаге, и шаг закрывается сам.
// И каждая цель подсветки есть в интерфейсе (data-tutorial в окнах).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newGame, releaseModel } from '../sim/actions';
import { setRent } from '../sim/compute';
import { applyTender, canApply } from '../sim/contracts';
import { applyChoice, pendingChoice } from '../sim/events';
import { chooseGoals, goalOfferOpen, goalsDay } from '../sim/goals';
import { refPrice } from '../sim/market';
import { setResearch } from '../sim/research';
import { advanceDay } from '../sim/tick';
import { modelScore, startTraining, tierPreset } from '../sim/training';
import type { GameState } from '../sim/types';
import { stepTargets, TUTORIAL, type TutorialCtx } from './tutorialSteps';
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
    for (const step of TUTORIAL) {
      expect(step.text).not.toMatch(/[—–]/);
      expect(step.title).not.toMatch(/[—–]/);
      expect(step.text.length, step.title).toBeLessThanOrEqual(150);
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

      const compute = at('Мощности');
      expect(done(compute)).toBe(false);
      open.add('compute');
      expect(done(compute)).toBe(true);

      const rent = at('Аренда видеокарт');
      expect(done(rent)).toBe(false);
      expect(setRent(s, 'p100', 96).ok).toBe(true);
      expect(done(rent)).toBe(true);

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
      expect(done(time)).toBe(false);
      ctx.speed = 1;
      expect(done(time)).toBe(true);

      const tenders = at('Тендеры');
      expect(done(tenders)).toBe(false);
      open.add('contracts');
      expect(done(tenders)).toBe(true);

      // Модель готова за полтора месяца: задолго до «Механизма внимания».
      const release = at('Выпуск модели');
      expect(stepTargets(TUTORIAL[release], s)).toContain('icon-models');
      for (let i = 0; i < 60 && s.models.length === 0; i++) day(s);
      expect(s.models).toHaveLength(1);
      expect(s.research.done).not.toContain('attention');
      expect(stepTargets(TUTORIAL[release], s)[0]).toBe('release');
      expect(done(release)).toBe(false);
      expect(releaseModel(s, s.models[0].id, refPrice(s.day)).ok).toBe(true);
      expect(done(release)).toBe(true);

      // Тендер 2017 года по силам первой модели: заявка находится не позже чем через месяц.
      const apply = at('Заявка на тендер');
      expect(done(apply)).toBe(false);
      const m = s.models[0];
      let tender = s.tenders.find((t) => canApply(s, t, m) === null && modelScore(m, t.benchmark, true) >= t.requirement);
      for (let i = 0; i < 40 && !tender; i++) {
        day(s);
        tender = s.tenders.find((t) => canApply(s, t, m) === null && modelScore(m, t.benchmark, true) >= t.requirement);
      }
      expect(tender, 'подходящий тендер').toBeDefined();
      expect(applyTender(s, tender!.id, m.id).ok).toBe(true);
      expect(done(apply)).toBe(true);

      expect(TUTORIAL.at(-1)!.done).toBeUndefined();
    });
  }

  it('без модели и проекта шаг выпуска ведёт к новой модели', () => {
    const s = newGame('Тест', 5);
    const release = TUTORIAL.find((t) => t.title === 'Выпуск модели')!;
    expect(stepTargets(release, s)).toContain('train-start');
  });
});
