import { describe, expect, it } from 'vitest';
import { LABS } from '../data/labs';
import { runBot } from './bots';
import { DUEL_LETTER_GAP, duelDay, duelOf, emptyDuel, fightScore, letterText, letterVariants, MAIN_RIVAL_MIN, type LetterKind } from './duel';
import { deserialize, serialize } from './save';
import { newGame } from './actions';
import { LAB_IDS } from './types';

describe('личное соперничество', () => {
  const { state: s } = runBot('reasonable', 7);
  const d = s.duel!;

  it('за партию набирается счёт обгонов и есть главный соперник', () => {
    expect(d).toBeDefined();
    const total = LAB_IDS.reduce((a, l) => a + d.labs[l].passedYou + d.labs[l].youPassed, 0);
    expect(total).toBeGreaterThan(0);
    expect(d.main).not.toBeNull();
    const main = d.main!;
    expect(fightScore(duelOf(s, main))).toBeGreaterThanOrEqual(MAIN_RIVAL_MIN);
    for (const lab of LAB_IDS) expect(fightScore(duelOf(s, lab))).toBeLessThanOrEqual(fightScore(duelOf(s, main)));
  });

  it('письма соперников приходят редко и подписаны лабораторией', () => {
    const names = LABS.map((l) => l.name);
    // Личные письма соперника подписаны (from); новости о ходах соперников («Zhipo: цены ещё ниже») - нет, у них свой ритм.
    const letters = s.mail.filter((m) => m.kind === 'rival' && m.from !== undefined && names.some((n) => m.title.startsWith(`${n}: `)));
    expect(letters.length).toBeGreaterThan(0);
    const days = letters.map((m) => m.day).sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(DUEL_LETTER_GAP);
  });

  it('тексты писем без длинных тире и с подписью', () => {
    for (const l of LABS) {
      for (const kind of ['passedYou', 'youPassed', 'main'] as LetterKind[]) {
        for (let n = 0; n < letterVariants(l.id, kind); n++) {
          const v = { their: 'GTP-4', yours: 'Атлас-2', race: '«Арене»', you: 'лаборатория «Тест»', You: 'Лаборатория «Тест»', of: 'лаборатории «Тест»' };
          const t = letterText(l.id, kind, v, n);
          expect(t.title.startsWith(`${l.name}: `)).toBe(true);
          expect(t.body.endsWith(`\n\n${l.name}`)).toBe(true);
          expect(`${t.title}${t.body}`).not.toMatch(/[—–]|undefined/);
        }
      }
    }
  });

  it('счёт сохраняется и загружается; старое сохранение без счёта загружается', () => {
    const back = deserialize(serialize(s));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.state.duel).toEqual(d);
    const fresh = newGame('Тест', 3);
    delete fresh.duel;
    expect(deserialize(serialize(fresh)).ok).toBe(true);
  });

  it('не трогает случайные числа, деньги и доли', () => {
    const g = newGame('Тест', 11);
    g.duel = emptyDuel();
    const before = JSON.stringify({ rng: g.rng, cash: g.cash, market: g.market, rivalry: g.rivalry });
    duelDay(g);
    expect(JSON.stringify({ rng: g.rng, cash: g.cash, market: g.market, rivalry: g.rivalry })).toBe(before);
  });
});
