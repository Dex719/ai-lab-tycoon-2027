import { describe, expect, it } from 'vitest';
import { runBot } from './bots';
import { setAllocation } from './compute';
import { dayStep, LOST_DEMAND_FLAG } from './market';

describe('письмо «клиентам не хватает мощности»', () => {
  it('доля API обнулена при моделях в продаже: одно важное письмо, повторно не приходит; при достатке мощности флаг снимается', () => {
    const { state: s } = runBot('reasonable', 2, 1200);
    expect(s.models.some((m) => m.releasedDay !== null && m.onApi)).toBe(true);
    delete s.flags[LOST_DEMAND_FLAG];
    setAllocation(s, { training: 0.5, contracts: 0.25, experiments: 0.25, api: 0, subs: 0 });
    const before = s.mail.length;
    dayStep(s);
    const fresh = s.mail.slice(before).filter((m) => m.title.startsWith('Клиентам не хватает мощности'));
    expect(fresh).toHaveLength(1);
    expect(fresh[0].important).toBe(true);
    expect(fresh[0].body).toMatch(/H100e/);
    dayStep(s);
    expect(s.mail.slice(before).filter((m) => m.title.startsWith('Клиентам не хватает мощности'))).toHaveLength(1);
    setAllocation(s, { training: 0.1, contracts: 0.1, experiments: 0.1, api: 0.35, subs: 0.35 });
    dayStep(s);
    expect(s.flags[LOST_DEMAND_FLAG]).toBeUndefined();
  });
});
