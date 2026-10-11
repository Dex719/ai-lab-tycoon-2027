import { describe, expect, it } from 'vitest';
import { BENCHMARKS } from '../data/benchmarks';
import { RIVAL_MODELS } from '../data/rivalModels';
import { benchScore } from './benchmarks';
import { HYPE_ARENA_TOP_BONUS, HYPE_RANK_BONUS } from './constants';
import {
  arenaRank,
  benchRank,
  bestElo,
  leaderboard,
  marketArenaRank,
  releaseHypeBonus,
  updateSaturation,
} from './leaderboard';
import { marketRivals, rivalCaps, rivalScore } from './rivals';
import { createInitialState } from './state';
import { modelScore } from './training';
import { dateToDay } from './time';
import { BENCHMARK_IDS } from './types';
import type { BenchmarkId, GameState, ModelRef, PlayerModel } from './types';

// ---------- Помощники ----------

/** Состояние на дату: бенчмарки, чья дата наступила, помечены вышедшими; соперники — как перечислены. */
function makeState(date: string, released: string[] = []): GameState {
  const s = createInitialState('Тест', 1);
  s.day = dateToDay(date);
  for (const b of BENCHMARKS) if (dateToDay(b.introduced) <= s.day) s.benchmarks[b.id].introduced = true;
  s.rivalsReleased = [...released];
  return s;
}

function player(over: Partial<PlayerModel> & { id: string }): PlayerModel {
  return {
    name: `Мой-${over.id}`,
    plan: {
      name: `Мой-${over.id}`,
      paramsB: 70,
      tokensB: 1400,
      mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0,
      benchTargets: [],
      rlhf: false,
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 0,
    releasedDay: 0,
    caps: { language: 60, code: 60, reasoning: 60 },
    overfit: {},
    rlhf: false,
    arenaElo: 1000,
    price: 3,
    onApi: true,
    exposed: false,
    ...over,
  };
}

const rival = (id: string): ModelRef => ({ kind: 'rival', id });
const mine = (id: string): ModelRef => ({ kind: 'player', id });

function withCaps(id: string, cap: number, elo: number, day: number, over: Partial<PlayerModel> = {}): PlayerModel {
  return player({ id, caps: { language: cap, code: cap, reasoning: cap }, arenaElo: elo, releasedDay: day, ...over });
}

// ---------- Строки таблицы ----------

describe('leaderboard: строки', () => {
  it('в таблице соперники из rivalsReleased и выпущенные модели игрока, новые сверху', () => {
    const s = makeState('2023-06-01', ['gtp-3', 'chatgtp', 'gtp-4']);
    s.models = [
      withCaps('p1', 60, 1100, dateToDay('2023-05-01')),
      withCaps('p2', 70, 1200, 0, { releasedDay: null }), // обучена, но не выпущена
    ];
    const rows = leaderboard(s);
    expect(rows.map((r) => r.name)).toEqual(['Мой-p1', 'GTP-4', 'ChatGTP (GTP-3.5)', 'GTP-3 Davanci']);
    expect(rows.map((r) => r.ref)).toEqual([mine('p1'), rival('gtp-4'), rival('chatgtp'), rival('gtp-3')]);
    expect(rows.map((r) => r.owner)).toEqual(['player', 'openbrain', 'openbrain', 'openbrain']);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].releasedDay).toBeGreaterThanOrEqual(rows[i].releasedDay);
    expect(rows[0].releasedDay).toBe(dateToDay('2023-05-01'));
    expect(rows[1].releasedDay).toBe(dateToDay('2023-03-14'));
  });

  it('пустая игра — пустая таблица; неизвестные id каталога пропускаются', () => {
    const s = makeState('2020-01-01');
    expect(leaderboard(s)).toEqual([]);
    s.rivalsReleased = ['нет-такой', 'gtp-2'];
    expect(leaderboard(s).map((r) => r.name)).toEqual(['GTP-2']);
  });

  it('баллы — только по вышедшим бенчмаркам; настоящие без пометки, пропуски с оценкой', () => {
    const s = makeState('2023-03-20', ['gtp-3', 'gtp-4']);
    const rows = leaderboard(s);
    const gtp4 = rows.find((r) => r.name === 'GTP-4')!;
    // На 20.03.2023 вышли пять бенчмарков; SWE-banch и GPQE — позже.
    expect(Object.keys(gtp4.scores).sort()).toEqual(['glue', 'gsm8k', 'humaneval', 'mmlu', 'squad']);
    expect(gtp4.scores.mmlu).toEqual({ value: 86.4, estimated: false });
    expect(gtp4.scores.humaneval).toEqual({ value: 67, estimated: false });
    expect(gtp4.scores.squad?.estimated).toBe(true);
    expect(gtp4.scores.glue?.estimated).toBe(true);
    expect(gtp4.scores.gpqa).toBeUndefined();
    expect(gtp4.scores.swebench).toBeUndefined();

    // Оценка совпадает с rivalScore.
    const def = RIVAL_MODELS.find((m) => m.id === 'gtp-4')!;
    expect(gtp4.scores.squad).toEqual(rivalScore(def, 'squad'));
    expect(gtp4.scores.squad!.value).toBeCloseTo(benchScore('squad', rivalCaps(def).language), 9);

    // Реальный ноль GTP-3 на HumanEvol — настоящий балл.
    const gtp3 = rows.find((r) => r.name === 'GTP-3 Davanci')!;
    expect(gtp3.scores.humaneval).toEqual({ value: 0, estimated: false });
  });

  it('Эло, пометка оценки, ⚠ за утечку тестов, статус «на рынке»', () => {
    const s = makeState('2023-03-20', ['gtp-3', 'chatgtp', 'gtp-4']);
    const rows = new Map(leaderboard(s).map((r) => [r.ref.id, r]));

    expect(rows.get('gtp-4')).toMatchObject({ elo: 1186, eloEstimated: false, flagged: true, exposed: false, onMarket: true });
    expect(rows.get('chatgtp')).toMatchObject({ elo: 1090, eloEstimated: true, flagged: false, onMarket: false }); // только чат, не API
    expect(rows.get('gtp-3')).toMatchObject({ elo: 800, eloEstimated: true, flagged: false, onMarket: true });

    // Статус «на рынке» совпадает с marketRivals.
    const onMarket = new Set(marketRivals(s).map((d) => d.id));
    for (const [id, row] of rows) expect(row.onMarket, id).toBe(onMarket.has(id));
  });

  it('модель игрока: показанный балл с подгонкой, после разоблачения — честный', () => {
    const s = makeState('2023-03-20');
    const m = withCaps('p1', 55, 1050, s.day - 10, { overfit: { mmlu: 25 } });
    s.models = [m];

    const row = leaderboard(s)[0];
    expect(row.owner).toBe('player');
    expect(row.scores.mmlu).toEqual({ value: modelScore(m, 'mmlu', false), estimated: false });
    expect(row.scores.mmlu!.value).toBeGreaterThan(modelScore(m, 'mmlu', true) + 5);
    expect(row.scores.humaneval!.value).toBeCloseTo(benchScore('humaneval', 55), 9); // без подгонки
    expect(row).toMatchObject({ elo: 1050, eloEstimated: false, flagged: false, exposed: false, onMarket: true });

    m.exposed = true;
    const after = leaderboard(s)[0];
    expect(after.scores.mmlu!.value).toBeCloseTo(modelScore(m, 'mmlu', true), 9);
    expect(after).toMatchObject({ flagged: true, exposed: true });

    m.onApi = false; // снята с продажи
    expect(leaderboard(s)[0].onMarket).toBe(false);
  });

  it('все вышедшие бенчмарки есть в строке, ни одного лишнего', () => {
    const s = makeState('2024-12-31', RIVAL_MODELS.map((m) => m.id));
    const rows = leaderboard(s);
    expect(rows).toHaveLength(RIVAL_MODELS.length);
    for (const row of rows) {
      expect(Object.keys(row.scores).sort(), row.name).toEqual([...BENCHMARK_IDS].sort());
      for (const sc of Object.values(row.scores)) expect(Number.isFinite(sc.value)).toBe(true);
    }
  });

  it('работает быстро: сотня вызовов по полному каталогу', () => {
    const s = makeState('2024-12-31', RIVAL_MODELS.map((m) => m.id));
    s.models = [withCaps('p1', 90, 1300, s.day)];
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      leaderboard(s);
      arenaRank(s, mine('p1'));
      releaseHypeBonus(s, mine('p1'));
    }
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

// ---------- Места ----------

describe('benchRank', () => {
  it('места по показанному баллу, 1 = лучший; модели игрока участвуют наравне', () => {
    const s = makeState('2023-03-20', ['gtp-3', 'chatgtp', 'gtp-4']);
    // MMLO: GTP-4 86,4; ChatGTP 70; GTP-3 43,9.
    expect(benchRank(s, rival('gtp-4'), 'mmlu')).toBe(1);
    expect(benchRank(s, rival('chatgtp'), 'mmlu')).toBe(2);
    expect(benchRank(s, rival('gtp-3'), 'mmlu')).toBe(3);

    s.models = [withCaps('p1', 62, 1000, s.day)]; // MMLO ≈ 62,5 — между GTP-3 и ChatGTP
    expect(modelScore(s.models[0], 'mmlu', false)).toBeGreaterThan(43.9);
    expect(modelScore(s.models[0], 'mmlu', false)).toBeLessThan(70);
    expect(benchRank(s, mine('p1'), 'mmlu')).toBe(3);
    expect(benchRank(s, rival('gtp-3'), 'mmlu')).toBe(4);
  });

  it('равные баллы: выше вышедшая раньше, независимо от порядка в rivalsReleased', () => {
    // ChatGTP (30.11.2022) и GTP-3.5 Turbu (01.03.2023) набрали MMLO 70,0.
    const a = makeState('2023-03-20', ['chatgtp', 'gtp-3-5-turbu']);
    const b = makeState('2023-03-20', ['gtp-3-5-turbu', 'chatgtp']);
    for (const s of [a, b]) {
      expect(benchRank(s, rival('chatgtp'), 'mmlu')).toBe(1);
      expect(benchRank(s, rival('gtp-3-5-turbu'), 'mmlu')).toBe(2);
      expect(benchRank(s, rival('chatgtp'), 'humaneval')).toBe(1);
      expect(benchRank(s, rival('gtp-3-5-turbu'), 'humaneval')).toBe(2);
    }
  });

  it('равные баллы в один день: выше вышедшая раньше в списке', () => {
    // q1-Previow и q1-Mino вышли 12.09.2024 и набрали HumanEvol 92,4.
    const a = makeState('2024-09-20', ['q1-previow', 'q1-mino']);
    const b = makeState('2024-09-20', ['q1-mino', 'q1-previow']);
    expect(benchRank(a, rival('q1-previow'), 'humaneval')).toBe(1);
    expect(benchRank(a, rival('q1-mino'), 'humaneval')).toBe(2);
    expect(benchRank(b, rival('q1-mino'), 'humaneval')).toBe(1);
    expect(benchRank(b, rival('q1-previow'), 'humaneval')).toBe(2);
  });

  it('null: бенчмарк ещё не вышел, модель не выпущена или неизвестна', () => {
    const s = makeState('2023-03-20', ['gtp-4']);
    s.models = [withCaps('p1', 60, 1000, s.day), withCaps('p2', 60, 1000, s.day, { releasedDay: null })];
    expect(benchRank(s, rival('gtp-4'), 'gpqa')).toBeNull(); // GPQE выйдет в ноябре 2023
    expect(benchRank(s, rival('gtp-4'), 'swebench')).toBeNull();
    expect(benchRank(s, rival('gtp-4o'), 'mmlu')).toBeNull(); // ещё не вышла
    expect(benchRank(s, rival('нет-такой'), 'mmlu')).toBeNull();
    expect(benchRank(s, mine('p2'), 'mmlu')).toBeNull(); // обучена, но не выпущена
    expect(benchRank(s, mine('нет'), 'mmlu')).toBeNull();
    expect(benchRank(s, mine('p1'), 'mmlu')).toBe(2);
  });

  it('насыщенный бенчмарк место сохраняет', () => {
    const s = makeState('2023-03-20', ['gtp-3', 'gtp-4']);
    s.benchmarks.mmlu.saturated = true;
    expect(benchRank(s, rival('gtp-4'), 'mmlu')).toBe(1);
  });
});

describe('arenaRank', () => {
  it('места по Эло среди всех выпущенных моделей', () => {
    const s = makeState('2024-06-01', ['gtp-4', 'chatgtp', 'gtp-4o', 'clade-3-opos']);
    expect(arenaRank(s, rival('gtp-4o'))).toBe(1); // 1285
    expect(arenaRank(s, rival('clade-3-opos'))).toBe(2); // 1247
    expect(arenaRank(s, rival('gtp-4'))).toBe(3); // 1186
    expect(arenaRank(s, rival('chatgtp'))).toBe(4); // ≈1090

    s.models = [withCaps('p1', 60, 1260, s.day), withCaps('p2', 60, 1400, s.day, { releasedDay: null })];
    expect(arenaRank(s, mine('p1'))).toBe(2);
    expect(arenaRank(s, rival('clade-3-opos'))).toBe(3);
    expect(arenaRank(s, mine('p2'))).toBeNull();
    expect(arenaRank(s, rival('нет-такой'))).toBeNull();
    expect(arenaRank(s, rival('q1'))).toBeNull(); // не выпущена
  });

  it('равное Эло: выше вышедшая раньше', () => {
    // moonshoot-v1 (06.02.2024) и Kimo Chat 2M (18.03.2024): оба ≈1150.
    const s = makeState('2024-04-01', ['kimo-chat-2m', 'moonshoot-v1']);
    expect(arenaRank(s, rival('moonshoot-v1'))).toBe(1);
    expect(arenaRank(s, rival('kimo-chat-2m'))).toBe(2);
  });

  it('равное Эло с моделью игрока в тот же день: соперник выше', () => {
    const s = makeState('2024-04-01', ['moonshoot-v1']);
    s.models = [withCaps('p1', 60, 1150, dateToDay('2024-02-06'))];
    expect(arenaRank(s, rival('moonshoot-v1'))).toBe(1);
    expect(arenaRank(s, mine('p1'))).toBe(2);
    // А вышедшая раньше — всегда выше.
    s.models[0].releasedDay = dateToDay('2024-02-05');
    expect(arenaRank(s, mine('p1'))).toBe(1);
  });
});

describe('marketArenaRank', () => {
  it('место среди моделей на рынке: модели вне рынка не считаются и сами места не имеют', () => {
    const s = makeState('2024-06-01', ['gtp-4', 'chatgtp', 'gtp-4o', 'clade-3-opos']);
    expect(marketArenaRank(s, rival('gtp-4o'))).toBe(1);
    expect(marketArenaRank(s, rival('clade-3-opos'))).toBe(2);
    expect(marketArenaRank(s, rival('gtp-4'))).toBe(3);
    expect(marketArenaRank(s, rival('chatgtp'))).toBeNull(); // не на рынке

    s.models = [
      withCaps('p1', 60, 1260, s.day), // на API
      withCaps('p2', 60, 1400, s.day, { onApi: false }), // выпущена, но снята с продажи
    ];
    expect(marketArenaRank(s, mine('p1'))).toBe(2);
    expect(marketArenaRank(s, rival('clade-3-opos'))).toBe(3);
    expect(marketArenaRank(s, mine('p2'))).toBeNull();
    // На общей Арене p2 — первая, на рынке её нет.
    expect(arenaRank(s, mine('p2'))).toBe(1);
  });

  it('устаревшие модели соперников (старше трёх лет) с рынка уходят', () => {
    const s = makeState('2023-06-12', ['gtp-3', 'gtp-4']); // GTP-3 вышла 11.06.2020: прошло больше трёх лет
    expect(marketArenaRank(s, rival('gtp-3'))).toBeNull();
    expect(marketArenaRank(s, rival('gtp-4'))).toBe(1);
    expect(arenaRank(s, rival('gtp-3'))).toBe(2); // но на Арене остаётся
  });
});

// ---------- Шумиха выпуска ----------

describe('releaseHypeBonus', () => {
  /** Четыре модели игрока, обгоняющие всех соперников на каждом бенчмарке: места 1, 2, 3, 4. */
  function podium(): GameState {
    const s = makeState('2024-06-01', ['gtp-4o', 'clade-3-opos', 'gtp-4']);
    s.models = [
      withCaps('p1', 150, 2000, s.day),
      withCaps('p2', 130, 1900, s.day),
      withCaps('p3', 120, 1800, s.day),
      withCaps('p4', 110, 1700, s.day),
    ];
    return s;
  }

  it('места 1 / 2 / 3 по активным бенчмаркам дают 12 / 6 / 3, четвёртое — ничего; №1 Арены +10', () => {
    const s = podium();
    const n = BENCHMARK_IDS.length;
    expect(benchRank(s, mine('p1'), 'mmlu')).toBe(1);
    expect(benchRank(s, mine('p4'), 'mmlu')).toBe(4);
    expect(releaseHypeBonus(s, mine('p1'))).toBe(HYPE_RANK_BONUS[0] * n + HYPE_ARENA_TOP_BONUS);
    expect(releaseHypeBonus(s, mine('p2'))).toBe(HYPE_RANK_BONUS[1] * n);
    expect(releaseHypeBonus(s, mine('p3'))).toBe(HYPE_RANK_BONUS[2] * n);
    expect(releaseHypeBonus(s, mine('p4'))).toBe(0);
    expect(HYPE_RANK_BONUS.slice(0, 3)).toEqual([12, 6, 3]);
  });

  it('насыщенные бенчмарки не учитываются', () => {
    const s = podium();
    s.benchmarks.squad.saturated = true;
    s.benchmarks.glue.saturated = true;
    const n = BENCHMARK_IDS.length - 2;
    expect(releaseHypeBonus(s, mine('p1'))).toBe(HYPE_RANK_BONUS[0] * n + HYPE_ARENA_TOP_BONUS);
    expect(releaseHypeBonus(s, mine('p2'))).toBe(HYPE_RANK_BONUS[1] * n);
    // Все насыщены — остаётся только Арена.
    for (const id of BENCHMARK_IDS) s.benchmarks[id].saturated = true;
    expect(releaseHypeBonus(s, mine('p1'))).toBe(HYPE_ARENA_TOP_BONUS);
    expect(releaseHypeBonus(s, mine('p2'))).toBe(0);
  });

  it('не вышедшие бенчмарки не учитываются', () => {
    const s = podium();
    s.day = dateToDay('2021-12-01'); // вышли SQuAT, GLUU, MMLO, HumanEvol, GSM8C
    for (const id of ['gpqa', 'swebench'] as BenchmarkId[]) s.benchmarks[id].introduced = false;
    expect(releaseHypeBonus(s, mine('p1'))).toBe(HYPE_RANK_BONUS[0] * 5 + HYPE_ARENA_TOP_BONUS);
  });

  it('Арена: бонус только за первое место по Эло', () => {
    const s = podium();
    s.models[1].arenaElo = 2100; // p2 теперь №1 на Арене, но по бенчмаркам всё равно второй
    const n = BENCHMARK_IDS.length;
    expect(releaseHypeBonus(s, mine('p2'))).toBe(HYPE_RANK_BONUS[1] * n + HYPE_ARENA_TOP_BONUS);
    expect(releaseHypeBonus(s, mine('p1'))).toBe(HYPE_RANK_BONUS[0] * n);
  });

  it('невыпущенная или неизвестная модель бонуса не получает', () => {
    const s = podium();
    s.models.push(withCaps('p5', 300, 2500, s.day, { releasedDay: null }));
    expect(releaseHypeBonus(s, mine('p5'))).toBe(0);
    expect(releaseHypeBonus(s, mine('нет'))).toBe(0);
    expect(releaseHypeBonus(s, rival('q1'))).toBe(0);
  });

  it('работает и для моделей соперников', () => {
    // Единственная выпущенная модель — №1 везде: SQuAT и GLUU активны.
    const s = makeState('2018-06-11', ['gtp-1']);
    expect(releaseHypeBonus(s, rival('gtp-1'))).toBe(HYPE_RANK_BONUS[0] * 2 + HYPE_ARENA_TOP_BONUS);
    // GTP-3 в 2020 году: первых мест нет, но Арена пока за ней? Эло ≈800 против ≈650 у T5x — да.
    const s2 = makeState('2020-06-11', ['gtp-1', 'bort', 'gtp-2', 't5x', 'meeno', 'gtp-3']);
    expect(arenaRank(s2, rival('gtp-3'))).toBe(1);
    expect(releaseHypeBonus(s2, rival('gtp-3'))).toBeGreaterThanOrEqual(HYPE_ARENA_TOP_BONUS);
  });
});

// ---------- Лучшее Эло ----------

describe('bestElo', () => {
  it('лучшее Эло среди выпущенных моделей владельца; нет моделей — 0', () => {
    const s = makeState('2023-06-01', ['gtp-3', 'gtp-4', 'chatgtp', 'clade-1', 'bort']);
    expect(bestElo(s, 'openbrain')).toBe(1186);
    expect(bestElo(s, 'antropik')).toBeCloseTo(1146, 9);
    expect(bestElo(s, 'gogle')).toBe(500);
    expect(bestElo(s, 'zhipo')).toBe(0);
    expect(bestElo(s, 'deepcent')).toBe(0);
    expect(bestElo(s, 'player')).toBe(0);
  });

  it('модели игрока: только выпущенные', () => {
    const s = makeState('2023-06-01');
    s.models = [withCaps('p1', 60, 1000, s.day), withCaps('p2', 60, 1300, s.day, { releasedDay: null })];
    expect(bestElo(s, 'player')).toBe(1000);
    s.models[1].releasedDay = s.day;
    expect(bestElo(s, 'player')).toBe(1300);
  });

  it('не выпущенные моделей соперников не учитываются', () => {
    const s = makeState('2023-06-01', ['gtp-3']);
    expect(bestElo(s, 'openbrain')).toBe(800); // GTP-4 ещё не в списке выпущенных
    s.rivalsReleased.push('gtp-4');
    expect(bestElo(s, 'openbrain')).toBe(1186);
  });
});

// ---------- Насыщение ----------

describe('updateSaturation', () => {
  const benchMails = (s: GameState) => s.mail.filter((m) => m.kind === 'benchmark');

  it('бенчмарк насыщается, когда лучший балл достигает порога: флаг и письмо один раз', () => {
    const s = makeState('2018-12-01', ['gtp-1']);
    updateSaturation(s);
    expect(s.benchmarks.squad.saturated).toBe(false);
    expect(benchMails(s)).toHaveLength(0);

    s.rivalsReleased.push('bort'); // SQuAT 91,8 ≥ 91
    updateSaturation(s);
    expect(s.benchmarks.squad.saturated).toBe(true);
    expect(s.benchmarks.glue.saturated).toBe(false); // BORT: GLUU 80,5 < 90
    const mails = benchMails(s);
    expect(mails).toHaveLength(1);
    expect(mails[0].title).toBe('Бенчмарк SQuAT насыщен');
    expect(mails[0].body).toContain('BORT');
    expect(mails[0].body).toContain('91,8 %');
    expect(mails[0].body).toContain('шумиху');
    expect(mails[0].body).toContain('тендеры');
    expect(mails[0].read).toBe(false);

    // Повторные проверки письма не плодят.
    updateSaturation(s);
    updateSaturation(s);
    expect(benchMails(s)).toHaveLength(1);
  });

  it('каждый бенчмарк насыщается отдельно и со своим письмом', () => {
    const s = makeState('2019-12-01', ['bort']);
    updateSaturation(s);
    expect(benchMails(s).map((m) => m.title)).toEqual(['Бенчмарк SQuAT насыщен']);
    s.rivalsReleased.push('t5x'); // GLUU 90,3 ≥ 90
    updateSaturation(s);
    expect(s.benchmarks.glue.saturated).toBe(true);
    expect(benchMails(s).map((m) => m.title)).toEqual(['Бенчмарк SQuAT насыщен', 'Бенчмарк GLUU насыщен']);
  });

  it('бенчмарк, который ещё не вышел, не насыщается', () => {
    const s = makeState('2019-12-01', ['gtp-4o']); // у GTP-4o GSM8C 96,1 ≥ 95, но бенчмарка ещё нет
    expect(s.benchmarks.gsm8k.introduced).toBe(false);
    updateSaturation(s);
    expect(s.benchmarks.gsm8k.saturated).toBe(false);
    expect(s.benchmarks.humaneval.saturated).toBe(false);
    expect(s.benchmarks.mmlu.saturated).toBe(false);
  });

  it('оценочные баллы соперников насыщения не вызывают', () => {
    // Gemeni-Exp-1206 без баллов, Эло 1374: оценки ≈100 % везде, но ни одного опубликованного балла.
    const s = makeState('2024-12-10', ['gemeni-exp-1206']);
    updateSaturation(s);
    for (const id of BENCHMARK_IDS) expect(s.benchmarks[id].saturated, id).toBe(false);
    expect(benchMails(s)).toHaveLength(0);
  });

  it('балл ниже порога насыщения не вызывает', () => {
    const s = makeState('2024-12-10', ['q1', 'clade-3-5-sonet-new']); // GPQE 75,7 < 80; SWE-banch 49 < 75
    updateSaturation(s);
    expect(s.benchmarks.gpqa.saturated).toBe(false);
    expect(s.benchmarks.swebench.saturated).toBe(false);
  });

  it('подгонка не насыщает бенчмарк: в счёт идёт честный балл модели игрока', () => {
    const s = makeState('2022-01-01');
    const m = player({ id: 'p1', caps: { language: 10, code: 10, reasoning: 10 }, overfit: { mmlu: 120 }, releasedDay: s.day });
    s.models = [m];
    expect(modelScore(m, 'mmlu', false)).toBeGreaterThanOrEqual(90);
    expect(modelScore(m, 'mmlu', true)).toBeLessThan(90);
    updateSaturation(s);
    expect(s.benchmarks.mmlu.saturated).toBe(false);

    // Честно сильная модель насыщает.
    const strong = player({ id: 'p2', caps: { language: 200, code: 200, reasoning: 200 }, releasedDay: s.day });
    s.models = [m, strong];
    updateSaturation(s);
    expect(s.benchmarks.mmlu.saturated).toBe(true);
    const mmluMails = benchMails(s).filter((x) => x.title.includes('MMLO'));
    expect(mmluMails).toHaveLength(1);
    expect(mmluMails[0].body).toContain(strong.name);
  });

  it('модель игрока, не выпущенная, насыщение не вызывает', () => {
    const s = makeState('2022-01-01');
    s.models = [player({ id: 'p1', caps: { language: 200, code: 200, reasoning: 200 }, releasedDay: null })];
    updateSaturation(s);
    for (const id of BENCHMARK_IDS) expect(s.benchmarks[id].saturated, id).toBe(false);
  });

  it('насыщенный бенчмарк выходит из активных: шумиха выпуска его не учитывает', () => {
    const s = makeState('2018-12-01', ['gtp-1', 'bort']);
    // BORT: №1 по SQuAT (91,8) и GLUU (80,5), но не по Эло (500 против 550 у GTP-1).
    expect(releaseHypeBonus(s, rival('bort'))).toBe(HYPE_RANK_BONUS[0] * 2);
    updateSaturation(s); // SQuAT насыщен
    expect(releaseHypeBonus(s, rival('bort'))).toBe(HYPE_RANK_BONUS[0]);
  });

  it('полный каталог: к концу игры насыщены пять бенчмарков, GPQE и SWE-banch ещё живы', () => {
    const s = makeState('2024-12-31', RIVAL_MODELS.map((m) => m.id));
    updateSaturation(s);
    const done = BENCHMARK_IDS.filter((id) => s.benchmarks[id].saturated);
    expect(done.sort()).toEqual(['glue', 'gsm8k', 'humaneval', 'mmlu', 'squad']);
    expect(benchMails(s)).toHaveLength(5);
    updateSaturation(s);
    expect(benchMails(s)).toHaveLength(5);
  });

  it('пустая таблица ничего не делает', () => {
    const s = makeState('2024-12-31');
    updateSaturation(s);
    expect(s.mail).toHaveLength(0);
    for (const id of BENCHMARK_IDS) expect(s.benchmarks[id].saturated).toBe(false);
  });
});
