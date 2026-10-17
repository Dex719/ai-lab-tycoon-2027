// Нагрузка контрактов в интерфейсе (плейтест 17.10): суммарная мощность в окне заявки, тревоги в сводке,
// «Как нужно» не обнуляет идущее обучение, «последний день» тендера.

import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/actions';
import { rentNow } from '../sim/compute';
import type { Contract, GameState, Tender } from '../sim/types';
import { contractsNeedWith } from './forecast';
import { sideAlerts } from './SidePanel';
import { tenderLeftText } from './windows/ContractsWindow';
import { autoPercents } from './windows/ComputeWindow';

function tender(over: Partial<Tender> = {}): Tender {
  return {
    id: 'tx',
    clientId: 'bank-severny',
    type: 'finetune',
    benchmark: 'squad',
    requirement: 1,
    work: 380,
    durationDays: 100,
    payment: 1e6,
    penalty: 3e5,
    appearedDay: 0,
    expiresDay: 20,
    application: null,
    ...over,
  };
}

function contract(s: GameState, t: Tender): Contract {
  return { id: `c-${t.id}`, tender: t, modelId: 'p1', startedDay: s.day, deadlineDay: s.day + t.durationDays, workDone: 0 };
}

describe('нагрузка контрактов', () => {
  it('суммарная нагрузка: взятый контракт плюс новый тендер - самый требовательный × число', () => {
    const s = newGame('Тест', 1);
    expect(contractsNeedWith(s, { work: 380, days: 100 })).toBeCloseTo(3.8, 9);
    s.contracts.push(contract(s, tender()));
    // Два по 3,8 в день: доля делится поровну, нужно 7,6 (плейтест: 4,28 на всё - оба не потянуть).
    expect(contractsNeedWith(s, { work: 380, days: 100 })).toBeCloseTo(7.6, 9);
  });

  it('сводка: контракт не успевает - тревога с цифрами и кнопкой в «Мощности»', () => {
    const s = newGame('Тест', 1);
    rentNow(s, 'p100', 96);
    s.compute.alloc = { training: 0.4, contracts: 0.2, experiments: 0.3, api: 0.1, subs: 0 };
    s.contracts.push(contract(s, tender()));
    const a = sideAlerts(s).find((x) => x.label === 'Контракт не успевает');
    expect(a).toBeDefined();
    expect(a!.open).toBe('compute');
    expect(a!.text).toMatch(/нужно 3,8.*есть/);
  });

  it('сводка: тендер, который можно подать, в последние дни - «Тендер закрывается»', () => {
    const s = newGame('Тест', 1);
    s.tenders = [tender({ expiresDay: s.day })];
    s.models.push({
      id: 'p1',
      name: 'Мой-1',
      plan: { name: 'Мой-1', paramsB: 1, tokensB: 20, mix: { language: 1, code: 0, reasoning: 0 }, benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'mid' },
      arch: 'transformer',
      algoLevel: 0,
      trainedDay: 0,
      releasedDay: 0,
      caps: { language: 90, code: 90, reasoning: 90 },
      overfit: {},
      rlhf: false,
      arenaElo: 1000,
      price: 1,
      onApi: true,
      exposed: false,
      earned: 0,
      onSubs: false,
      subsPrice: 20,
      review: 'none',
      reviewEndDay: null,
      earnedSubs: 0,
    });
    expect(sideAlerts(s).some((x) => x.label === 'Тендер закрывается' && x.text.includes('последний день'))).toBe(true);
    s.tenders[0].expiresDay = s.day + 10;
    expect(sideAlerts(s).some((x) => x.label === 'Тендер закрывается')).toBe(false);
  });

  it('«ещё 0 дней» называется «последний день»', () => {
    expect(tenderLeftText(0)).toBe('последний день');
    expect(tenderLeftText(3)).toBe('ещё 3 дня');
  });

  it('«Как нужно»: контракту не хватает и всей мощности, но идущее обучение и исследование сохраняют долю', () => {
    const s = newGame('Тест', 1);
    rentNow(s, 'p100', 96);
    s.contracts.push(contract(s, tender({ work: 76_400 })));
    s.research.current = 'attention';
    s.trainings.push({ id: 't1', failed: false } as never);
    const p = autoPercents(s, { training: 40, contracts: 20, experiments: 30, api: 10, subs: 0 });
    expect(p.training).toBeGreaterThanOrEqual(30);
    expect(p.experiments).toBeGreaterThanOrEqual(15);
    expect(p.training + p.contracts + p.experiments + p.api + p.subs).toBe(100);
  });
});

describe('ранняя экономика объяснена', () => {
  it('первая выпущенная модель до 2020 года - письмо «Откуда деньги в первые годы»; вторая - без письма', async () => {
    const { releaseModel } = await import('../sim/actions');
    const s = newGame('Тест', 1);
    const base = {
      plan: { name: 'М', paramsB: 0.2, tokensB: 4, mix: { language: 1, code: 0, reasoning: 0 }, benchShare: 0, benchTargets: [], rlhf: false, context: 512, tier: 'mid' as const },
      arch: 'lstm' as const, algoLevel: 0, trainedDay: 0, releasedDay: null, caps: { language: 30, code: 20, reasoning: 20 }, overfit: {}, rlhf: false,
      arenaElo: 600, price: 100, onApi: false, exposed: false, earned: 0, onSubs: false, subsPrice: 20, review: 'none' as const, reviewEndDay: null, earnedSubs: 0,
    };
    s.models.push({ ...base, id: 'p1', name: 'М-1' }, { ...base, id: 'p2', name: 'М-2' });
    expect(releaseModel(s, 'p1', 100).ok).toBe(true);
    expect(s.mail.filter((m) => m.title === 'Откуда деньги в первые годы')).toHaveLength(1);
    expect(releaseModel(s, 'p2', 100).ok).toBe(true);
    expect(s.mail.filter((m) => m.title === 'Откуда деньги в первые годы')).toHaveLength(1);
  });
});
