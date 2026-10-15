// «Следующий шаг» на рабочем столе: ведёт новичка без обучения игре через первые месяцы партии.

import { describe, expect, it } from 'vitest';
import { newGame, releaseModel } from '../sim/actions';
import { setRent } from '../sim/compute';
import { applyTender } from '../sim/contracts';
import { applyChoice, pendingChoice } from '../sim/events';
import { refPrice } from '../sim/market';
import { setResearch } from '../sim/research';
import { advanceDay } from '../sim/tick';
import { startTraining, tierPreset } from '../sim/training';
import type { GameState } from '../sim/types';
import { contractsNeed, researchDaysAt, trainingDaysAt } from './forecast';
import { bestOpenTender, NEXT_STEP_DAYS, nextStep } from './nextStep';

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

describe('следующий шаг', () => {
  it('ведёт по первым месяцам: карты, исследование, модель на LSTM, выпуск, тендер', () => {
    const s = newGame('Тест', 11);
    expect(nextStep(s)?.id).toBe('rent');
    expect(nextStep(s)?.open).toBe('compute');

    setRent(s, 'p100', 96);
    expect(nextStep(s)?.id).toBe('research');

    setResearch(s, 'attention');
    const first = nextStep(s)!;
    expect(first.id).toBe('first-model');
    expect(first.detail).toContain('LSTM');
    expect(first.open).toBe('newModel');

    expect(startTraining(s, midPlan(s)).ok).toBe(true);
    // Время ещё ни разу не шло: подсказка - запустить его.
    expect(nextStep(s, 0)?.id).toBe('time');
    expect(nextStep(s, 0)?.open).toBe('play');
    expect(nextStep(s, 1)?.id).toBe('waiting');
    for (let i = 0; i < 3; i++) day(s);
    expect(nextStep(s, 0)?.id).toBe('waiting');
    const waiting = nextStep(s)!;
    expect(waiting.id).toBe('waiting');
    expect(waiting.title).toMatch(/^«Модель 1» обучается, готово \d\d\.\d\d\.2017$/);

    for (let i = 0; i < 60 && s.models.length === 0; i++) day(s);
    expect(nextStep(s)?.id).toBe('release');
    expect(releaseModel(s, s.models[0].id, refPrice(s.day)).ok).toBe(true);

    for (let i = 0; i < 40 && !bestOpenTender(s); i++) day(s);
    const fit = bestOpenTender(s)!;
    expect(fit).not.toBeNull();
    const tender = nextStep(s)!;
    expect(tender.id).toBe('tender');
    expect(tender.open).toBe('contracts');
    expect(applyTender(s, fit.tender.id, fit.model.id).ok).toBe(true);
    // Пока идёт «Механизм внимания», доля «Обучение» свободна: подсказка - срок исследования и доли.
    const wait = nextStep(s)!;
    expect(wait.id).toBe('research-wait');
    expect(wait.title).toMatch(/^«Механизм внимания»: готово \d\d\.\d\d\.2017$/);
    expect(wait.open).toBe('compute');
    s.compute.alloc = { ...s.compute.alloc, training: 0, experiments: s.compute.alloc.experiments + s.compute.alloc.training };
    expect(nextStep(s)).toBeNull();
  });

  it('после «Механизма внимания» предлагает модель на «Трансформере»', () => {
    const s = newGame('Тест', 12);
    setRent(s, 'p100', 96);
    s.research.done.push('attention');
    expect(nextStep(s)?.id).toBe('first-model');
    expect(nextStep(s)?.detail).not.toContain('LSTM');
    expect(startTraining(s, midPlan(s)).ok).toBe(true);
    expect(s.trainings[0].arch).toBe('transformer');
    expect(nextStep(s)?.id).not.toBe('transformer');

    const old = newGame('Тест', 12);
    setRent(old, 'p100', 96);
    setResearch(old, 'attention');
    startTraining(old, midPlan(old));
    old.research.done.push('attention');
    old.research.current = null;
    expect(nextStep(old)?.id).toBe('transformer');
  });

  it('предупреждает, когда контракту не хватает мощности', () => {
    const s = newGame('Тест', 13);
    setRent(s, 'p100', 96);
    setResearch(s, 'attention');
    startTraining(s, midPlan(s));
    for (let i = 0; i < 3; i++) day(s);
    const t = s.tenders[0];
    expect(t).toBeDefined();
    s.contracts.push({ id: 'c1', tender: { ...t, work: 500 }, modelId: 'm1', startedDay: s.day, deadlineDay: s.day + 50, workDone: 0 });
    expect(contractsNeed(s)).toBeCloseTo(10, 5);
    const step = nextStep(s)!;
    expect(step.id).toBe('contract-power');
    expect(step.open).toBe('compute');
  });

  it('молчит во время обучения игре, после первого года и в конце партии', () => {
    const s = newGame('Тест', 14);
    s.tutorial.active = true;
    expect(nextStep(s)).toBeNull();
    s.tutorial.active = false;
    expect(nextStep(s)).not.toBeNull();
    s.day = NEXT_STEP_DAYS;
    expect(nextStep(s)).toBeNull();
  });
});

describe('прогнозы сроков', () => {
  it('ползунок исследований: со всей мощностью раньше, без карт - позже, но команда работает', () => {
    const s = newGame('Тест', 21);
    setRent(s, 'p100', 96);
    const none = researchDaysAt(s, 'attention', 0);
    const part = researchDaysAt(s, 'attention', 0.4);
    const all = researchDaysAt(s, 'attention', 1);
    expect(Number.isFinite(none)).toBe(true);
    expect(all).toBeLessThan(part);
    expect(part).toBeLessThan(none);
  });

  it('срок обучения совпадает с тем, что случится в игре', () => {
    const s = newGame('Тест', 22);
    setRent(s, 'p100', 96);
    startTraining(s, midPlan(s));
    const days = trainingDaysAt(s, s.trainings[0], s.compute.alloc.training)!;
    const start = s.day;
    for (let i = 0; i < 200 && s.models.length === 0; i++) day(s);
    expect(s.models[0].trainedDay - start).toBeGreaterThanOrEqual(days - 1);
    expect(s.models[0].trainedDay - start).toBeLessThanOrEqual(days);
    expect(trainingDaysAt(s, { ...s.models[0], failed: false, flopTotal: 1, flopDone: 0 } as never, 0)).toBeNull();
  });
});
