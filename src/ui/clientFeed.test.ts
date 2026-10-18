// «Кого выбирают клиенты» (ClientFeed) и подсказки для подростка-плейтестера 18.10: «Как нужно» с моделью в продаже,
// «Следующий шаг» при деньгах в минусе.

import { describe, expect, it } from 'vitest';
import { newGame } from '../sim/actions';
import { rentNow } from '../sim/compute';
import type { GameState, PlayerModel } from '../sim/types';
import { clientNews, sharesOf } from './ClientFeed';
import { nextStep } from './nextStep';
import { autoPercents } from './windows/ComputeWindow';

function onApi(s: GameState): void {
  const m = {
    id: 'p1', name: 'Скибиди GPT', releasedDay: 0, onApi: true, onSubs: false, arenaElo: 600,
    plan: { tier: 'mid' },
  } as unknown as PlayerModel;
  s.models.push(m);
}

function withShares(s: GameState, total: Record<string, number>, enterprise: Record<string, number>): GameState {
  s.market.labShares = { ...s.market.labShares, ...total };
  s.market.segments.enterprise.labShares = { ...s.market.segments.enterprise.labShares, ...enterprise };
  return s;
}

describe('кого выбирают клиенты', () => {
  it('стали лидером по клиентам - золотая новость', () => {
    const s = newGame('Т', 1);
    onApi(s);
    const prev = sharesOf(withShares(s, { player: 0.2, openbrain: 0.3 }, {}));
    const cur = sharesOf(withShares(s, { player: 0.35, openbrain: 0.25 }, {}));
    const n = clientNews(s, prev, cur, 5);
    expect(n?.tone).toBe('reward');
    expect(n?.title).toBe('Вас выбирают чаще всех: 35 % клиентов');
  });

  it('компания переходит от соперника на вашу модель; уход - с эмблемой соперника', () => {
    const s = newGame('Т', 1);
    onApi(s);
    const prev = sharesOf(withShares(s, { player: 0.1, openbrain: 0.5 }, { player: 0.1, openbrain: 0.5 }));
    const cur = sharesOf(withShares(s, { player: 0.15, openbrain: 0.45 }, { player: 0.2, openbrain: 0.4 }));
    const gain = clientNews(s, prev, cur, 5);
    expect(gain?.tone).toBe('good');
    expect(gain?.title).toMatch(/переходит с OpenBrain на «Скибиди GPT»$/);
    const loss = clientNews(s, cur, prev, 6);
    expect(loss?.tone).toBe('bad');
    expect(loss?.from).toBe('openbrain');
    expect(loss?.title).toMatch(/уходит к OpenBrain$/);
  });

  it('мелкие сдвиги и лаборатория без модели в продаже - без новостей', () => {
    const s = newGame('Т', 1);
    const prev = sharesOf(withShares(s, { player: 0.1 }, { player: 0.1 }));
    const cur = sharesOf(withShares(s, { player: 0.4 }, { player: 0.4 }));
    expect(clientNews(s, prev, cur, 1)).toBeNull();
    onApi(s);
    const a = sharesOf(withShares(s, { player: 0.1, openbrain: 0.5 }, { player: 0.1 }));
    const b = sharesOf(withShares(s, { player: 0.11, openbrain: 0.5 }, { player: 0.11 }));
    expect(clientNews(s, a, b, 1)).toBeNull();
  });
});

describe('подсказки плейтеста 18.10', () => {
  it('«Как нужно» не оставляет модель в продаже без мощности, даже когда клиентов ещё нет', () => {
    const s = newGame('Т', 1);
    rentNow(s, 'p100', 96);
    onApi(s);
    const p = autoPercents(s, { training: 40, contracts: 20, experiments: 30, api: 10, subs: 0 });
    expect(p.api).toBeGreaterThanOrEqual(5);
    expect(p.training + p.contracts + p.experiments + p.api + p.subs).toBe(100);
  });

  it('деньги в минусе - «Следующий шаг» в любой год говорит, сколько дней до банкротства и что делать', () => {
    const s = newGame('Т', 1);
    s.day = 2000;
    s.cash = -1000;
    s.finance.negativeDays = 20;
    const step = nextStep(s, 1);
    expect(step?.id).toBe('broke');
    expect(step?.title).toBe('Деньги в минусе: до банкротства 40 дн.');
    expect(step?.open).toBe('compute');
  });
});
