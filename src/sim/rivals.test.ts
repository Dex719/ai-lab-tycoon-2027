import { afterEach, describe, expect, it, vi } from 'vitest';
import { LABS } from '../data/labs';
import { RIVAL_MODELS } from '../data/catalog';
import { benchDef, benchScore, capFromScore, introduceDue } from './benchmarks';
import { HYPE_ARENA_TOP_BONUS, HYPE_RANK_BONUS, MARKET_MAX_AGE_DAYS, MARKET_MODELS_PER_LAB } from './constants';
import { FOREVER } from './events';
import { marketSnapshot, refPrice } from './market';
import {
  catalogEloFrontier,
  catalogPrice,
  findRivalDef,
  marketRivals,
  releaseDue,
  releaseRival,
  rivalCaps,
  rivalDay,
  rivalDef,
  rivalEloEstimated,
  rivalOnApi,
  rivalOnSubs,
  rivalPrice,
  rivalPriceDecay,
  rivalScore,
  rivalSubsPrice,
  rivalTier,
} from './rivals';
import { addRivalModifier, emptyRivalry, rivalPriceIn } from './rivalry';
import type { RivalryGame } from './rivalry';
import { createInitialState } from './state';
import { byYear, dateToDay, END_DAY, yearOf } from './time';
import { BENCHMARK_IDS, DOMAINS, LAB_IDS } from './types';
import type { BenchmarkId, RivalModelDef } from './types';

// ---------- Помощники ----------

/** Новое состояние с полями соперников: до интеграции createInitialState их не задаёт. */
function newState(): RivalryGame {
  const s = createInitialState('Тест', 1) as RivalryGame;
  if (!s.rivalry) s.rivalry = emptyRivalry();
  if (!s.difficulty) s.difficulty = 'normal';
  return s;
}

/** Состояние на указанную дату: каждый день как в тике - бенчмарки, затем выходы моделей. */
function stateAt(date: string, hook?: (s: RivalryGame, day: number) => void): RivalryGame {
  const s = newState();
  const last = dateToDay(date);
  for (let d = 0; d <= last; d++) {
    s.day = d;
    hook?.(s, d);
    introduceDue(s);
    releaseDue(s);
  }
  return s;
}

const byId = (id: string): RivalModelDef => rivalDef(id);

const stripDetails = (name: string): string => name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const digitsOf = (name: string): string => (stripDetails(name).match(/\d/g) ?? []).join('');

/** Номера 1:1: цифры совпадают; игровое имя может опустить отдельно стоящий размер («GPT-3 175B» → «GTP-3»). */
function sameNumbers(game: string, real: string): boolean {
  if (digitsOf(game) === digitsOf(real)) return true;
  const noSize = stripDetails(real).replace(/(^|\s)\d+(?:\.\d+)?[BMK](?=\s|$)/g, '$1');
  return digitsOf(game) === (noSize.match(/\d/g) ?? []).join('');
}

// ---------- Каталог ----------

describe('каталог моделей соперников', () => {
  it('в нём представлены все лаборатории: семь больших и две промежуточные', () => {
    expect(LAB_IDS).toHaveLength(9);
    for (const lab of LAB_IDS) {
      expect(RIVAL_MODELS.filter((m) => m.lab === lab).length, lab).toBeGreaterThan(0);
      expect(LABS.some((l) => l.id === lab), lab).toBe(true);
    }
    expect(RIVAL_MODELS.length).toBeGreaterThanOrEqual(60);
  });

  it('id и игровые названия уникальны', () => {
    expect(new Set(RIVAL_MODELS.map((m) => m.id)).size).toBe(RIVAL_MODELS.length);
    expect(new Set(RIVAL_MODELS.map((m) => m.gameName)).size).toBe(RIVAL_MODELS.length);
  });

  it('даты в пределах 2016-06-01…2024-12-31 и идут по возрастанию, при равенстве - по лаборатории', () => {
    let prev: RivalModelDef | null = null;
    for (const m of RIVAL_MODELS) {
      expect(m.released >= '2016-06-01' && m.released <= '2024-12-31', m.id).toBe(true);
      expect(dateToDay(m.released), m.id).toBeLessThanOrEqual(END_DAY);
      if (prev) {
        const ok =
          prev.released < m.released ||
          (prev.released === m.released && LAB_IDS.indexOf(prev.lab) <= LAB_IDS.indexOf(m.lab));
        expect(ok, `${prev.id} → ${m.id}`).toBe(true);
      }
      prev = m;
    }
  });

  it('игровое имя отличается от реального, номера версий совпадают 1:1', () => {
    for (const m of RIVAL_MODELS) {
      expect(m.gameName, m.id).not.toBe(m.realName);
      expect(sameNumbers(m.gameName, m.realName), `${m.id}: «${m.gameName}» и «${m.realName}»`).toBe(true);
    }
  });

  it('ключевые модели на месте: GTP-3, GTP-4, Clade 3 Opos, Gemeni 1.5 Pro, DeepSeak-V3, Qwin2.5', () => {
    const expected: [string, string, string][] = [
      ['gtp-3', 'GTP-3', 'GPT-3'],
      ['gtp-4', 'GTP-4', 'GPT-4'],
      ['clade-3-opos', 'Clade 3 Opos', 'Claude 3 Opus'],
      ['gemeni-1-5-pro', 'Gemeni 1.5 Pro', 'Gemini 1.5 Pro'],
      ['deepseak-v3', 'DeepSeak-V3', 'DeepSeek-V3'],
      ['qwin2-5-72b', 'Qwin2.5', 'Qwen2.5'],
    ];
    for (const [id, game, real] of expected) {
      const m = byId(id);
      expect(m.gameName.startsWith(game), id).toBe(true);
      expect(m.realName.startsWith(real), id).toBe(true);
    }
    expect(byId('gtp-3').released).toBe('2020-06-11');
    expect(byId('gtp-4').released).toBe('2023-03-14');
    expect(byId('deepseak-v3').released).toBe('2024-12-26');
  });

  it('поля корректны: баллы 0…100, Эло, цены, размер, короткая заметка', () => {
    for (const m of RIVAL_MODELS) {
      for (const [bid, v] of Object.entries(m.scores)) {
        expect(BENCHMARK_IDS.includes(bid as BenchmarkId), `${m.id}.${bid}`).toBe(true);
        expect(v, `${m.id}.${bid}`).toBeGreaterThanOrEqual(0);
        expect(v, `${m.id}.${bid}`).toBeLessThanOrEqual(100);
      }
      expect(Number.isFinite(m.arenaElo) && m.arenaElo >= 400 && m.arenaElo <= 1500, `${m.id} Эло`).toBe(true);
      for (const p of [m.priceIn, m.priceOut]) if (p !== null) expect(p, `${m.id} цена`).toBeGreaterThanOrEqual(0);
      if (m.paramsB !== null) expect(m.paramsB, `${m.id} размер`).toBeGreaterThan(0);
      expect(m.notes && m.notes.length > 0 && m.notes.length <= 120, `${m.id} заметка`).toBe(true);
      // Цена бывает только у моделей с API.
      if (m.priceIn !== null || m.priceOut !== null) expect(m.api, `${m.id} цена без API`).toBe(true);
    }
  });

  it('метки: оценочное Эло, утечка тестов, чат', () => {
    expect(byId('gtp-3').arenaEstimated).toBe(true);
    expect(byId('gtp-4').arenaEstimated).toBe(false);
    expect(RIVAL_MODELS.filter((m) => m.contaminated).map((m) => m.id)).toEqual(
      expect.arrayContaining(['gtp-4', 'chatgml3-6b']),
    );
    expect(byId('chatgtp').contaminated).toBe(false);

    for (const id of ['bort', 't5x', 'gtp-1', 'gtp-2', 'gtp-3', 'gml-130b', 'meeno', 'lamba', 'paln']) {
      expect(byId(id).chat, id).toBe(false);
    }
    for (const id of [
      'chatgtp', 'gtp-3-5-turbu', 'gtp-4', 'gtp-4o', 'q1', 'q1-previow', 'clade-1', 'clade-3-opos', 'berd',
      'gemeni-1-5-pro', 'chatgml-6b', 'gml-4', 'kimo-chat', 'deepseak-llm-67b', 'deepseak-v2', 'deepseak-v3',
      'deepseak-r1-lito-previow', 'qwin-72b', 'qwin2-72b', 'qwk-32b-previow',
    ]) {
      expect(byId(id).chat, id).toBe(true);
    }
  });
});

// ---------- Доступ к каталогу ----------

describe('rivalDef', () => {
  it('находит модель по id, на неизвестный id выбрасывает ошибку', () => {
    expect(rivalDef('gtp-3').gameName).toBe('GTP-3 Davanci');
    expect(findRivalDef('нет-такой')).toBeUndefined();
    expect(() => rivalDef('нет-такой')).toThrow();
  });

  it('rivalDay совпадает с dateToDay от даты выхода', () => {
    for (const m of RIVAL_MODELS) expect(rivalDay(m)).toBe(dateToDay(m.released));
  });

  it('находит шаблон ответной модели (rivalry.reactiveDefs), каталог - первым', () => {
    const t = findRivalDef('mv-deepcent-1')!;
    expect(t).toBeDefined();
    expect(RIVAL_MODELS.some((m) => m.id === 'mv-deepcent-1')).toBe(false);
    expect(t.lab).toBe('deepcent');
    expect(t.gameName).toBe('DeepSeak LLM Lito');
    expect(t.realName).toBe(byId('deepseak-llm-67b').realName);
    expect(t.arenaEstimated).toBe(true);
    expect(rivalDef('mv-deepcent-1')).toBe(t);
    expect(findRivalDef('mv-deepcent-1')).toBe(t); // один и тот же объект при повторном поиске
    expect(findRivalDef('gtp-4')).toBe(RIVAL_MODELS.find((m) => m.id === 'gtp-4'));
  });

  it('rivalEloEstimated: оценочное Эло каталога или поправка eloAdd', () => {
    const s = newState();
    expect(rivalEloEstimated(s, byId('gtp-4'))).toBe(false);
    expect(rivalEloEstimated(s, byId('gtp-3'))).toBe(true);
    s.rivalry.overrides['gtp-4'] = { eloAdd: 10 };
    expect(rivalEloEstimated(s, byId('gtp-4'))).toBe(true);
    s.rivalry.overrides['gtp-4'] = { dayShift: -10 };
    expect(rivalEloEstimated(s, byId('gtp-4'))).toBe(false);
  });
});

// ---------- Способности и баллы ----------

describe('rivalCaps', () => {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  it('домен - среднее capFromScore по реальным баллам домена', () => {
    // BORT: два языковых балла (SQuAT, GLUU), кода и рассуждений нет.
    const bort = byId('bort');
    const lang = mean([capFromScore('squad', 91.8), capFromScore('glue', 80.5)]);
    const caps = rivalCaps(bort);
    expect(caps.language).toBeCloseTo(lang, 9);
    // Домен без баллов берёт среднее остальных доменов.
    expect(caps.code).toBeCloseTo(lang, 9);
    expect(caps.reasoning).toBeCloseTo(lang, 9);
  });

  it('домен без баллов берёт среднее тех доменов, где баллы есть', () => {
    // GTP-3: язык - MMLO, код - HumanEvol (реальный ноль), рассуждений нет.
    const caps = rivalCaps(byId('gtp-3'));
    expect(caps.language).toBeCloseTo(capFromScore('mmlu', 43.9), 9);
    expect(caps.code).toBeCloseTo(capFromScore('humaneval', 0), 9);
    expect(caps.reasoning).toBeCloseTo((caps.language + caps.code) / 2, 9);

    // GTP-4: баллы во всех трёх доменах, рассуждения - среднее GSM8C и GPQE.
    const g4 = rivalCaps(byId('gtp-4'));
    expect(g4.reasoning).toBeCloseTo(mean([capFromScore('gsm8k', 92), capFromScore('gpqa', 35.7)]), 9);
    expect(g4.code).toBeCloseTo(capFromScore('humaneval', 67), 9);
  });

  it('модель без баллов: (Эло − 374) / 11,7 во всех доменах', () => {
    const meeno = byId('meeno');
    expect(Object.keys(meeno.scores)).toHaveLength(0);
    const caps = rivalCaps(meeno);
    for (const d of DOMAINS) expect(caps[d]).toBeCloseTo((meeno.arenaElo - 374) / 11.7, 9);
  });

  it('кешируется по id; другая модель с тем же id считается заново', () => {
    const def = byId('gtp-4');
    expect(rivalCaps(def)).toBe(rivalCaps(def));
    const clone: RivalModelDef = { ...def, scores: { mmlu: 50 } };
    const caps = rivalCaps(clone);
    expect(caps.language).toBeCloseTo(capFromScore('mmlu', 50), 9);
    expect(rivalCaps(clone)).toBe(caps);
  });

  it('способности конечны у всех моделей каталога', () => {
    for (const m of RIVAL_MODELS) {
      const caps = rivalCaps(m);
      for (const d of DOMAINS) expect(Number.isFinite(caps[d]), `${m.id}.${d}`).toBe(true);
    }
  });
});

describe('rivalScore', () => {
  it('реальные баллы возвращаются без изменений и без пометки оценки', () => {
    let seen = 0;
    for (const m of RIVAL_MODELS) {
      for (const [bid, v] of Object.entries(m.scores) as [BenchmarkId, number][]) {
        expect(rivalScore(m, bid), `${m.id}.${bid}`).toEqual({ value: v, estimated: false });
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(150);
    // Реальный ноль - тоже реальный балл, а не пропуск.
    expect(rivalScore(byId('gtp-3'), 'humaneval')).toEqual({ value: 0, estimated: false });
  });

  it('пропуск считается по формуле от способности домена и помечается оценкой', () => {
    const gtp3 = byId('gtp-3');
    const caps = rivalCaps(gtp3);
    // У GTP-3 нет баллов SQuAT, GLUU, GSM8C, GPQE, SWE-banch.
    for (const bid of ['squad', 'glue', 'gsm8k', 'gpqa', 'swebench'] as BenchmarkId[]) {
      const sc = rivalScore(gtp3, bid);
      expect(sc.estimated, bid).toBe(true);
      expect(sc.value, bid).toBeCloseTo(benchScore(bid, caps[benchDef(bid).domain]), 9);
    }
  });

  it('согласовано с capFromScore: оценка возвращает ту же способность домена', () => {
    let checked = 0;
    for (const m of RIVAL_MODELS) {
      const caps = rivalCaps(m);
      for (const bid of BENCHMARK_IDS) {
        const sc = rivalScore(m, bid);
        const d = benchDef(bid);
        // Оценка всегда в пределах от угадывания до 100 %.
        expect(sc.value, `${m.id}.${bid}`).toBeGreaterThanOrEqual(d.guess * 100 - 1e-9);
        expect(sc.value, `${m.id}.${bid}`).toBeLessThanOrEqual(100);
        if (!sc.estimated) continue;
        const cap = caps[d.domain];
        // Далеко от краёв шкалы (и в пределах ±40 от сложности, где обрезает capFromScore) формула обратима.
        if (Math.abs(cap - d.difficulty) > Math.min(40, 3 * d.spread)) continue;
        expect(capFromScore(bid, sc.value), `${m.id}.${bid}`).toBeCloseTo(cap, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('оценки растут вместе со способностью: сильная модель не слабее слабой', () => {
    // GTP-4 сильнее GTP-3 по всем доменам, поэтому и оценка SQuAT у неё не ниже.
    expect(rivalScore(byId('gtp-4'), 'squad').value).toBeGreaterThanOrEqual(rivalScore(byId('gtp-3'), 'squad').value);
    expect(rivalScore(byId('gtp-4'), 'swebench').value).toBeGreaterThanOrEqual(rivalScore(byId('gtp-3'), 'swebench').value);
  });
});

describe('rivalPrice', () => {
  it('в день выхода (и до него) - смешанная цена каталога (3·in + out) / 4', () => {
    expect(catalogPrice(byId('gtp-4'))).toBeCloseTo((3 * 30 + 60) / 4, 9);
    expect(rivalPrice(byId('gtp-4'), rivalDay(byId('gtp-4')))).toBeCloseTo((3 * 30 + 60) / 4, 9);
    expect(rivalPrice(byId('gtp-3'), 0)).toBe(60); // до выхода цена не выше каталожной
    expect(rivalPrice(byId('deepseak-v3'), dateToDay('2024-12-26'))).toBeCloseTo((3 * 0.14 + 0.28) / 4, 9);
  });

  it('после выхода цена падает вместе с рынком: × refPrice(день) / refPrice(день выхода)', () => {
    const gtp4 = byId('gtp-4');
    const born = rivalDay(gtp4);
    const later = dateToDay('2024-06-01');
    const ratio = refPrice(later) / refPrice(born);
    expect(ratio).toBeLessThan(0.5);
    expect(rivalPriceDecay(gtp4, later)).toBeCloseTo(ratio, 12);
    expect(rivalPrice(gtp4, later)).toBeCloseTo(37.5 * ratio, 9);
    // До выхода и в день выхода множитель 1, дальше не растёт.
    expect(rivalPriceDecay(gtp4, born)).toBe(1);
    expect(rivalPriceDecay(gtp4, born - 400)).toBe(1);
    let prev = Infinity;
    for (let d = born; d <= END_DAY; d += 30) {
      const p = rivalPrice(gtp4, d);
      expect(p).toBeLessThanOrEqual(prev);
      expect(p).toBeGreaterThan(0);
      prev = p;
    }
  });

  it('известна только одна цена - берём её', () => {
    const def = byId('gtp-4');
    const born = rivalDay(def);
    expect(rivalPrice({ ...def, priceIn: 7, priceOut: null }, born)).toBe(7);
    expect(rivalPrice({ ...def, priceIn: null, priceOut: 9 }, born)).toBe(9);
    expect(catalogPrice({ ...def, priceIn: null, priceOut: null })).toBeNull();
  });

  it('цен нет - цена лаборатории по умолчанию на год дня', () => {
    const gemma = byId('gemmo-2-27b');
    expect(gemma.priceIn).toBeNull();
    expect(gemma.priceOut).toBeNull();
    const gogle = LABS.find((l) => l.id === 'gogle');
    const day2024 = dateToDay('2024-07-01');
    const day2023 = dateToDay('2023-07-01');
    expect(rivalPrice(gemma, day2024)).toBe(byYear(gogle!.defaultPricePer1M, yearOf(day2024)));
    expect(rivalPrice(gemma, day2024)).toBe(2);
    expect(rivalPrice(gemma, day2023)).toBe(5);
  });
});

// ---------- Выходы по календарю ----------

describe('releaseDue', () => {
  it('модель выходит в свой день, а не раньше', () => {
    const day = dateToDay('2018-06-11');
    const s = stateAt('2018-06-10');
    expect(s.rivalsReleased).toEqual([]);
    expect(s.mail.filter((m) => m.kind === 'rival')).toHaveLength(0);

    s.day = day;
    introduceDue(s);
    releaseDue(s);
    expect(s.rivalsReleased).toEqual(['gtp-1']);
    const mails = s.mail.filter((m) => m.kind === 'rival');
    expect(mails).toHaveLength(1);
    expect(mails[0].title).toBe('OpenBrain выпустила GTP-1');
    expect(mails[0].day).toBe(day);
    expect(mails[0].read).toBe(false);
  });

  it('к концу игры вышли все модели каталога по одному разу, письмо на каждую', () => {
    const s = stateAt('2024-12-31');
    // Модели ушедших с рынка промежуточных лабораторий переходят в rivalsRetired.
    const all = [...s.rivalsReleased, ...(s.rivalsRetired ?? [])];
    expect(all).toHaveLength(RIVAL_MODELS.length);
    expect(new Set(all).size).toBe(RIVAL_MODELS.length);
    const mails = s.mail.filter((m) => m.kind === 'rival');
    expect(mails).toHaveLength(RIVAL_MODELS.length);
    // Письма идут в порядке выхода.
    for (let i = 1; i < mails.length; i++) expect(mails[i].day).toBeGreaterThanOrEqual(mails[i - 1].day);
  });

  it('повторный вызов в тот же день ничего не добавляет', () => {
    const s = stateAt('2023-03-14');
    const released = s.rivalsReleased.length;
    const mails = s.mail.length;
    const hype = { ...s.hype };
    releaseDue(s);
    releaseDue(s);
    expect(s.rivalsReleased).toHaveLength(released);
    expect(s.mail).toHaveLength(mails);
    expect(s.hype).toEqual(hype);
  });

  it('первая модель получает бонус: места №1 по активным бенчмаркам и по Арене', () => {
    const s = stateAt('2018-06-11');
    // 11.06.2018 активны SQuAT и GLUU; GTP-1 единственная - №1 везде.
    expect(s.hype.openbrain).toBe(HYPE_RANK_BONUS[0] * 2 + HYPE_ARENA_TOP_BONUS);
    for (const lab of LAB_IDS) if (lab !== 'openbrain') expect(s.hype[lab]).toBe(0);
    expect(s.hype.player).toBe(0);
  });

  it('шумиха не превышает 100', () => {
    const s = stateAt('2018-06-10');
    s.hype.openbrain = 95;
    s.day = dateToDay('2018-06-11');
    introduceDue(s);
    releaseDue(s);
    expect(s.hype.openbrain).toBe(100);
  });

  it('слабая модель шумихи не приносит', () => {
    // Berd (21.03.2023) без баллов и с Эло ≈960 не попадает в тройку ни по одному бенчмарку и не лидирует на Арене.
    const s = stateAt('2023-03-20');
    const before = s.hype.gogle;
    s.day = dateToDay('2023-03-21');
    introduceDue(s);
    releaseDue(s);
    expect(s.rivalsReleased).toContain('berd');
    expect(s.hype.gogle).toBe(before);
  });

  it('письмо: размер, реальные баллы по вышедшим бенчмаркам, Эло, цена API, открытые веса', () => {
    const s = stateAt('2023-03-14');
    const gtp4 = s.mail.find((m) => m.title === 'OpenBrain выпустила GTP-4')!;
    expect(gtp4.kind).toBe('rival');
    expect(gtp4.body).toContain('1,8 трлн параметров');
    // Вышли SQuAT, GLUU, MMLO, HumanEvol, GSM8C; названия берём игровые, не более двух баллов.
    expect(gtp4.body).toContain('HumanEvol 67,0 %');
    expect(gtp4.body).toContain('GSM8C 92,0 %');
    expect(gtp4.body).not.toContain('GPQE'); // GPQE выйдет только в ноябре 2023
    expect(gtp4.body).toContain('Эло на «Арене» - 1186.');
    expect(gtp4.body).not.toContain('≈1186');
    expect(gtp4.body).toContain('Цена API - $30 за 1 млн входных и $60 за 1 млн выходных токенов.');
    expect(gtp4.body).not.toContain('веса открыты');
  });

  it('письмо: оценочное Эло с «≈», открытые веса, модель без API без цены', () => {
    const s = stateAt('2023-03-14');
    const glm = s.mail.find((m) => m.title === 'Zhipo выпустила ChatGML-6B')!;
    expect(glm.body).toContain('6,2 млрд параметров');
    expect(glm.body).toContain('Эло на «Арене» - 888.');
    expect(glm.body).toContain('Веса открыты.');
    expect(glm.body).not.toContain('Цена API');

    const gtp3 = stateAt('2020-06-11').mail.find((m) => m.title === 'OpenBrain выпустила GTP-3 Davanci')!;
    expect(gtp3.body).toContain('175 млрд параметров');
    expect(gtp3.body).toContain('≈800');
    expect(gtp3.body).toContain('Цена API - $60 за 1 млн токенов.');
    // MMLO и HumanEvol на 11.06.2020 ещё не вышли - баллов в письме нет.
    expect(gtp3.body).not.toContain('MMLO');
    expect(gtp3.body).not.toContain('%');

    const chat = stateAt('2022-11-30').mail.find((m) => m.title.includes('ChatGTP'))!;
    expect(chat.body).not.toContain('Цена API');
    expect(chat.body).not.toContain('Веса открыты');
  });

  it('все письма короткие: до двух баллов и до трёх предложений, без NaN', () => {
    const s = stateAt('2024-12-31');
    for (const m of s.mail.filter((x) => x.kind === 'rival')) {
      expect((m.body.match(/%/g) ?? []).length, m.title).toBeLessThanOrEqual(2);
      expect(m.body.split(/(?<=\.)\s/).length, m.title).toBeLessThanOrEqual(3);
      expect(m.body.length, m.title).toBeLessThan(220);
      expect(m.body, m.title).not.toMatch(/NaN|undefined|null|Infinity/);
      expect(m.title, m.title).toMatch(/ (выпустила|показала) /);
    }
  });

  it('модель, которую только показали: в заголовке «показала», а не «выпустила»', () => {
    const announced = RIVAL_MODELS.filter((m) => m.announcedOnly).map((m) => m.id);
    expect(announced).toEqual(['meeno', 'lamba', 'gopler', 'chinchella', 'paln']);
    for (const id of announced) {
      const def = byId(id);
      expect(def.api || def.openWeights, id).toBe(false);
    }
    const s = stateAt('2022-04-04');
    const titles = s.mail.filter((m) => m.kind === 'rival').map((m) => m.title);
    expect(titles).toContain('Gogle DeepMynd показала PaLN');
    expect(titles).toContain('Gogle DeepMynd показала Chinchella');
    expect(titles).toContain('Gogle DeepMynd показала Gopler');
    expect(titles).toContain('Gogle DeepMynd показала LaMBA');
    expect(titles).toContain('Gogle DeepMynd показала Meeno');
    expect(titles.filter((t) => t.includes('показала'))).toHaveLength(5);
    expect(titles).toContain('Gogle DeepMynd выпустила BORT');
  });

  it('GTP-2 в день выхода без открытых весов: письмо не спорит с событием «не опубликовала целиком»', () => {
    const gtp2 = byId('gtp-2');
    expect(gtp2.openWeights).toBe(false);
    expect(gtp2.api).toBe(false);
    const mail = stateAt('2019-02-14').mail.find((m) => m.title === 'OpenBrain выпустила GTP-2')!;
    expect(mail).toBeDefined();
    expect(mail.body).not.toMatch(/веса открыты/i);
    expect(mail.body).not.toContain('Цена API');
  });

  it('цена в письме: обе цены, если входная и выходная разные; одна - если они равны или одна', () => {
    const s = stateAt('2024-05-13');
    const gpt4o = s.mail.find((m) => m.title === 'OpenBrain выпустила GTP-4o')!;
    expect(gpt4o.body).toContain('Цена API - $5 за 1 млн входных и $15 за 1 млн выходных токенов.');
    const turbo = s.mail.find((m) => m.title === 'OpenBrain выпустила GTP-3.5 Turbu')!;
    expect(turbo.body).toContain('Цена API - $2 за 1 млн токенов.');
    for (const m of s.mail.filter((x) => x.kind === 'rival')) expect(m.body, m.title).not.toContain('1М');
  });

  it('догоняет пропущенные выходы: на поздней дате вышли все прежние модели', () => {
    const s = newState();
    s.day = dateToDay('2021-01-01');
    for (const b of BENCHMARK_IDS) if (dateToDay(benchDef(b).introduced) <= s.day) s.benchmarks[b].introduced = true;
    releaseDue(s);
    const expected = RIVAL_MODELS.filter((m) => dateToDay(m.released) <= s.day).map((m) => m.id);
    expect(s.rivalsReleased.slice().sort()).toEqual(expected.slice().sort());
    expect(s.mail.filter((m) => m.kind === 'rival')).toHaveLength(expected.length);
  });
});

describe('releaseDue и releaseRival: поправки ходов соперников', () => {
  const fmtPrice = (x: number): string => `$${String(Number(x.toFixed(2))).replace('.', ',')}`;

  it('сдвиг дня выхода (dayShift < 0): модель выходит раньше, в письме «на N дней раньше» и «≈» у Эло', () => {
    const gtp4o = byId('gtp-4o');
    const born = rivalDay(gtp4o);
    const shifted = born - 30;
    const hook = (s: RivalryGame): void => {
      s.rivalry.overrides['gtp-4o'] = { dayShift: -30, eloAdd: 15 };
    };
    const before = stateAt('2024-04-12', hook);
    expect(before.day).toBe(shifted - 1);
    expect(before.rivalsReleased).not.toContain('gtp-4o');

    const s = stateAt('2024-04-13', hook);
    expect(s.day).toBe(shifted);
    expect(s.rivalsReleased).toContain('gtp-4o');
    const mail = s.mail.find((m) => m.title === 'OpenBrain выпустила GTP-4o')!;
    expect(mail.day).toBe(shifted);
    expect(mail.body.startsWith('Вышла на 30 дней раньше, чем ожидалось. ')).toBe(true);
    expect(mail.body).toContain(`Эло на «Арене» - ≈${gtp4o.arenaElo + 15}.`);
    expect(mail.body).toContain('Цена API - $5 за 1 млн входных и $15 за 1 млн выходных токенов.');
    expect(mail.body).not.toMatch(/NaN|undefined/);

    // В свой каталожный день повторно не выходит (другие модели этого месяца выходят как обычно).
    s.day = born;
    releaseDue(s);
    expect(s.rivalsReleased.filter((id) => id === 'gtp-4o')).toHaveLength(1);
    expect(s.mail.filter((m) => m.title === 'OpenBrain выпустила GTP-4o')).toHaveLength(1);
  });

  it('склонение: «1 день», «3 дня», «21 день», «45 дней»', () => {
    const gtp4o = byId('gtp-4o');
    const born = rivalDay(gtp4o);
    for (const [shift, word] of [[1, '1 день'], [3, '3 дня'], [21, '21 день'], [45, '45 дней']] as [number, string][]) {
      const s = newState();
      s.day = born - shift;
      s.rivalry.overrides['gtp-4o'] = { dayShift: -shift };
      releaseDue(s);
      const mail = s.mail.find((m) => m.title === 'OpenBrain выпустила GTP-4o')!;
      expect(mail.body, word).toContain(`Вышла на ${word} раньше, чем ожидалось.`);
    }
  });

  it('без сдвига письмо как прежде: нет «раньше», Эло без «≈» у точного каталожного', () => {
    const s = stateAt('2024-05-13');
    const mail = s.mail.find((m) => m.title === 'OpenBrain выпустила GTP-4o')!;
    expect(mail.body).not.toContain('раньше');
    expect(mail.body).toContain('Эло на «Арене» - 1285.');
  });

  it('модификатор rivalPrice лаборатории: в письме одна фактическая цена', () => {
    const s = stateAt('2024-05-12');
    addRivalModifier(s, { id: 'rivalprice-openbrain', kind: 'rivalPrice', target: 'openbrain', mult: 0.5, add: 0.3, untilDay: FOREVER });
    s.day = dateToDay('2024-05-13');
    introduceDue(s);
    releaseDue(s);
    const gtp4o = byId('gtp-4o');
    const price = rivalPriceIn(s, gtp4o);
    expect(price).toBeLessThan(rivalPrice(gtp4o, s.day));
    const mail = s.mail.find((m) => m.title === 'OpenBrain выпустила GTP-4o')!;
    expect(mail.body).toContain(`Цена API - ${fmtPrice(price)} за 1 млн токенов.`);
    expect(mail.body).not.toContain('входных');
  });

  it('releaseRival выпускает ответную модель по шаблону: письмо с Эло и ценой из поправок, без повтора', () => {
    const s = stateAt('2024-01-10');
    const def = findRivalDef('mv-deepcent-1')!;
    s.rivalry.extra[def.id] = s.day;
    s.rivalry.overrides[def.id] = { eloAdd: -40, price: 0.5, context: 32000 };
    const mails = s.mail.length;
    const hype = s.hype.deepcent;

    expect(releaseRival(s, def)).toBe(true);
    expect(s.rivalsReleased).toContain(def.id);
    const mail = s.mail[s.mail.length - 1];
    expect(mail.kind).toBe('rival');
    expect(mail.title).toBe('DeepCent выпустила DeepSeak LLM Lito');
    expect(mail.body).toContain(`Эло на «Арене» - ≈${Math.round(def.arenaElo - 40)}.`);
    expect(mail.body).toContain('Цена API - $0,5 за 1 млн токенов.');
    expect(mail.body).not.toContain('раньше');
    expect(mail.body).not.toMatch(/NaN|undefined|null/);
    expect(s.hype.deepcent).toBeGreaterThanOrEqual(hype);

    expect(releaseRival(s, def)).toBe(false);
    expect(s.mail).toHaveLength(mails + 1);
    expect(s.rivalsReleased.filter((id) => id === def.id)).toHaveLength(1);
    // Шаблоны releaseDue не выпускает: второго экземпляра нет и после него.
    releaseDue(s);
    expect(s.rivalsReleased.filter((id) => id === def.id)).toHaveLength(1);
  });

  it('releaseRival: модель каталога, вышедшая до старта игры, появляется молча', () => {
    const s = newState();
    const def: RivalModelDef = { ...byId('gtp-3'), id: 'old-x', gameName: 'Old-X', released: '2016-12-01' };
    expect(releaseRival(s, def)).toBe(true);
    expect(s.rivalsReleased).toEqual(['old-x']);
    expect(s.mail).toHaveLength(0);
  });
});

describe('releaseDue: модели до старта игры', () => {
  afterEach(() => {
    vi.doUnmock('../data/rivalModels');
    vi.resetModules();
  });

  it('вышедшие до дня 0 появляются молча - без письма и шумихи', async () => {
    const base = RIVAL_MODELS.find((m) => m.id === 'gtp-3')!;
    const old: RivalModelDef = {
      ...base, id: 'old-1', lab: 'gogle', gameName: 'Old-1', realName: 'Olt-1', released: '2016-12-01',
      scores: {}, arenaElo: 600, arenaEstimated: true,
    };
    const fresh: RivalModelDef = {
      ...base, id: 'new-1', lab: 'openbrain', gameName: 'New-1', realName: 'Mew-1', released: '2017-01-01',
      scores: {}, arenaElo: 900, arenaEstimated: true,
    };
    const future: RivalModelDef = { ...fresh, id: 'new-2', gameName: 'New-2', realName: 'Mew-2', released: '2017-01-02' };
    vi.resetModules();
    vi.doMock('../data/rivalModels', () => ({ RIVAL_MODELS: [old, fresh, future] }));
    const rivals = await import('./rivals');

    const s = newState();
    s.day = 0;
    rivals.releaseDue(s);
    expect(s.rivalsReleased).toEqual(['old-1', 'new-1']);
    const mails = s.mail.filter((m) => m.kind === 'rival');
    expect(mails.map((m) => m.title)).toEqual(['OpenBrain выпустила New-1']); // о Old-1 писем нет
    expect(s.hype.gogle).toBe(0); // шумихи от старой модели нет
    expect(s.hype.openbrain).toBe(HYPE_ARENA_TOP_BONUS); // New-1 сильнее Old-1 по Эло, бенчмарков ещё нет

    // Следующим днём выходит третья, и тоже с письмом.
    s.day = 1;
    rivals.releaseDue(s);
    expect(s.rivalsReleased).toEqual(['old-1', 'new-1', 'new-2']);
    expect(s.mail.filter((m) => m.kind === 'rival')).toHaveLength(2);
  });
});

// ---------- Рынок ----------

describe('marketRivals', () => {
  it('на конец игры: не больше трёх на лабораторию, только api/открытые веса, не старше трёх лет', () => {
    const s = stateAt('2024-12-31');
    const list = marketRivals(s);
    expect(list.length).toBeGreaterThan(0);
    const perLab = new Map<string, number>();
    for (const def of list) {
      perLab.set(def.lab, (perLab.get(def.lab) ?? 0) + 1);
      expect(def.api || def.openWeights, def.id).toBe(true);
      expect(s.day - dateToDay(def.released), def.id).toBeLessThanOrEqual(MARKET_MAX_AGE_DAYS);
      expect(s.rivalsReleased, def.id).toContain(def.id);
    }
    for (const [lab, n] of perLab) expect(n, lab).toBeLessThanOrEqual(MARKET_MODELS_PER_LAB);
    // Семь лабораторий, по три модели: OpenBrain и Antropik и DeepCent точно заполнены.
    expect(perLab.get('openbrain')).toBe(3);
    expect(perLab.get('antropik')).toBe(3);
    expect(perLab.get('deepcent')).toBe(3);
    expect(new Set(list.map((d) => d.id)).size).toBe(list.length); // без повторов
  });

  it('это именно новейшие модели лаборатории', () => {
    const s = stateAt('2024-12-31');
    const open = marketRivals(s).filter((d) => d.lab === 'openbrain').map((d) => d.id);
    // q1 (5.12) → q1-Previow и q1-Mino (12.09): при равной дате первой идёт модель с большим Эло.
    expect(open).toEqual(['q1', 'q1-previow', 'q1-mino']);
    const deep = marketRivals(s).filter((d) => d.lab === 'deepcent').map((d) => d.id);
    expect(deep).toEqual(['deepseak-v3', 'deepseak-v2-5', 'deepseak-coder-v2']);
  });

  it('при равной дате побеждает модель с большим Эло, остальное - по давности', () => {
    const s = stateAt('2024-03-04');
    const ant = marketRivals(s).filter((d) => d.lab === 'antropik').map((d) => d.id);
    expect(ant).toEqual(['clade-3-opos', 'clade-3-sonet', 'clade-2-1']);
  });

  it('не берёт модели без API и без открытых весов', () => {
    const s = stateAt('2023-03-31');
    const ids = marketRivals(s).map((d) => d.id);
    expect(s.rivalsReleased).toContain('chatgtp'); // ChatGTP - только чат, не API
    expect(ids).not.toContain('chatgtp');
    expect(s.rivalsReleased).toContain('berd');
    expect(ids).not.toContain('berd');
    expect(s.rivalsReleased).toContain('meeno');
    expect(ids).not.toContain('meeno');
    expect(ids).toContain('gtp-3-5-turbu');
    expect(ids).toContain('gtp-4');
  });

  it('модели, которые только показали, на рынок не выходят', () => {
    const s = stateAt('2022-04-05');
    for (const id of ['meeno', 'lamba', 'gopler', 'chinchella', 'paln']) expect(s.rivalsReleased, id).toContain(id);
    const ids = marketRivals(s).map((d) => d.id);
    for (const id of ['meeno', 'lamba', 'gopler', 'chinchella', 'paln']) expect(ids, id).not.toContain(id);
    for (const def of marketRivals(s)) expect(def.announcedOnly, def.id).toBeFalsy();
  });

  it('граница возраста: ровно три года ещё на рынке, на день больше - уже нет', () => {
    const gtp3 = byId('gtp-3');
    const born = dateToDay(gtp3.released);
    const s = newState();
    s.rivalsReleased = ['gtp-3'];
    s.day = born + MARKET_MAX_AGE_DAYS;
    expect(marketRivals(s).map((d) => d.id)).toEqual(['gtp-3']);
    s.day = born + MARKET_MAX_AGE_DAYS + 1;
    expect(marketRivals(s)).toEqual([]);
  });

  it('невыпущенные модели и неизвестные id не попадают на рынок', () => {
    const s = newState();
    s.day = END_DAY;
    expect(marketRivals(s)).toEqual([]);
    s.rivalsReleased = ['нет-такой', 'deepseak-v3'];
    expect(marketRivals(s).map((d) => d.id)).toEqual(['deepseak-v3']);
  });

  it('список меняется по мере выхода моделей: старые вытесняются новыми', () => {
    const early = stateAt('2024-01-31');
    const late = stateAt('2024-12-31');
    const a = marketRivals(early).filter((d) => d.lab === 'antropik').map((d) => d.id);
    const b = marketRivals(late).filter((d) => d.lab === 'antropik').map((d) => d.id);
    expect(a).toContain('clade-2-1');
    expect(b).not.toContain('clade-2-1');
    expect(b).toContain('clade-3-5-sonet-new');
  });
});

describe('marketRivals по каналам (design market-v2, 5.1)', () => {
  it('rivalOnApi / rivalOnSubs: ChatGTP и Berd - только подписка; ChatGML-6B (только веса) - только API; Qwin-72B - оба', () => {
    expect(rivalOnApi(byId('chatgtp'))).toBe(false);
    expect(rivalOnSubs(byId('chatgtp'))).toBe(true);
    expect(rivalOnSubs(byId('berd'))).toBe(true);
    expect(rivalOnApi(byId('chatgml-6b'))).toBe(true);
    expect(rivalOnSubs(byId('chatgml-6b'))).toBe(false);
    expect(rivalOnApi(byId('qwin-72b'))).toBe(true);
    expect(rivalOnSubs(byId('qwin-72b'))).toBe(true);
    for (const id of ['kimo-chat', 'gemeni-1-0-ultro', 'gemeni-exp-1206']) expect(rivalOnSubs(byId(id)), id).toBe(true);
    for (const id of ['meeno', 'lamba', 'paln']) {
      expect(rivalOnApi(byId(id)), id).toBe(false);
      expect(rivalOnSubs(byId(id)), id).toBe(false);
    }
  });

  it('marketRivals(s, "subs"): ChatGTP на рынке подписок и не на рынке API; тот же отбор по возрасту и числу на лабораторию', () => {
    const s = stateAt('2023-03-31');
    const api = marketRivals(s, 'api').map((d) => d.id);
    const subs = marketRivals(s, 'subs').map((d) => d.id);
    expect(api).not.toContain('chatgtp');
    expect(subs).toContain('chatgtp');
    expect(subs).toContain('berd');
    expect(subs).toContain('gtp-4');
    expect(subs).not.toContain('chatgml-6b');
    expect(marketRivals(s)).toEqual(marketRivals(s, 'api'));
    for (const def of marketRivals(s, 'subs')) expect(def.chat && !def.announcedOnly, def.id).toBe(true);
    const late = stateAt('2024-12-31');
    const perLab = new Map<string, number>();
    for (const def of marketRivals(late, 'subs')) perLab.set(def.lab, (perLab.get(def.lab) ?? 0) + 1);
    for (const [lab, n] of perLab) expect(n, lab).toBeLessThanOrEqual(MARKET_MODELS_PER_LAB);
  });
});

describe('rivalTier (design market-v2, 3.1)', () => {
  it('опоры: GTP-3 Davanci - флагман; Clade 3 Haiko - лёгкая; Clade 3 Sonet - средняя; GTP-4 Turbu, ChatGTP - флагманы; Berd, PaLN 2 - средние; GTP-4o Mino - лёгкая', () => {
    expect(rivalTier(byId('gtp-3'))).toBe('flagship'); // 175 млрд при переднем крае 175
    expect(rivalTier(byId('clade-3-haiko'))).toBe('light'); // по цене: $0,5 при опорной ≈ $2,9
    expect(rivalTier(byId('clade-3-sonet'))).toBe('mid');
    expect(rivalTier(byId('gtp-4-turbu'))).toBe('flagship');
    expect(rivalTier(byId('chatgtp'))).toBe('flagship'); // чат без цен: Эло на переднем крае каталога
    expect(rivalTier(byId('berd'))).toBe('mid');
    expect(rivalTier(byId('paln-2'))).toBe('mid'); // 340 млрд при переднем крае ≈ 1 800
    expect(rivalTier(byId('gtp-4o-mino'))).toBe('light');
    expect(rivalTier(byId('gtp-4'))).toBe('flagship');
  });

  it('явный tier каталога имеет приоритет; кеш по id пересчитывается для другой модели с тем же id', () => {
    const def = byId('clade-3-haiko');
    expect(rivalTier({ ...def, tier: 'flagship' })).toBe('flagship');
    expect(rivalTier(def)).toBe('light');
    expect(rivalTier(def)).toBe('light');
  });

  it('catalogEloFrontier: наибольший каталожный Эло среди вышедших к дню', () => {
    expect(catalogEloFrontier(dateToDay('2018-06-10'))).toBe(0);
    expect(catalogEloFrontier(dateToDay('2018-06-11'))).toBe(byId('gtp-1').arenaElo);
    expect(catalogEloFrontier(dateToDay('2023-03-14'))).toBe(byId('gtp-4').arenaElo);
    expect(catalogEloFrontier(END_DAY)).toBe(Math.max(...RIVAL_MODELS.map((m) => m.arenaElo)));
  });

  it('rivalSubsPrice: по уровню - лёгкая $10, средняя и флагман $20', () => {
    expect(rivalSubsPrice(byId('clade-3-haiko'))).toBe(10);
    expect(rivalSubsPrice(byId('clade-3-sonet'))).toBe(20);
    expect(rivalSubsPrice(byId('gtp-4-turbu'))).toBe(20);
  });

  it('у каждой модели каталога есть уровень', () => {
    for (const m of RIVAL_MODELS) expect(['light', 'mid', 'flagship'], m.id).toContain(rivalTier(m));
  });
});

describe('marketRivals и снимок рынка: поправки ходов и ответные модели', () => {
  it('возраст на рынке считается по сдвинутому дню выхода', () => {
    const gtp3 = byId('gtp-3');
    const born = rivalDay(gtp3);
    const s = newState();
    s.rivalsReleased = ['gtp-3'];
    s.day = born + MARKET_MAX_AGE_DAYS;
    expect(marketRivals(s).map((d) => d.id)).toEqual(['gtp-3']);
    s.rivalry.overrides['gtp-3'] = { dayShift: -1 };
    expect(marketRivals(s)).toEqual([]);
  });

  it('при равной дате порядок по Эло с поправкой eloAdd', () => {
    const s = stateAt('2024-12-31');
    expect(marketRivals(s).filter((d) => d.lab === 'openbrain').map((d) => d.id)).toEqual(['q1', 'q1-previow', 'q1-mino']);
    s.rivalry.overrides['q1-mino'] = { eloAdd: 200 }; // 1305 + 200 > 1335
    expect(marketRivals(s).filter((d) => d.lab === 'openbrain').map((d) => d.id)).toEqual(['q1', 'q1-mino', 'q1-previow']);
  });

  it('ответная модель из rivalsReleased на рынке: новее всех по дню выхода (extra), в пределах лимита лаборатории', () => {
    const s = stateAt('2024-07-01');
    const def = findRivalDef('mv-deepcent-1')!;
    s.rivalry.extra[def.id] = s.day;
    s.rivalry.overrides[def.id] = { eloAdd: -40, price: 0.5 };
    s.rivalsReleased.push(def.id);
    const deep = marketRivals(s).filter((d) => d.lab === 'deepcent').map((d) => d.id);
    expect(deep[0]).toBe(def.id);
    expect(deep).toHaveLength(MARKET_MODELS_PER_LAB);
    // Через три года с лишним её тоже вытесняет возраст.
    s.day = s.rivalry.extra[def.id] + MARKET_MAX_AGE_DAYS + 1;
    expect(marketRivals(s).map((d) => d.id)).not.toContain(def.id);
  });

  it('шаблон из rivalsReleased попадает в marketSnapshot с ценой, Эло и контекстом из поправок', () => {
    const s = stateAt('2024-07-01');
    const def = findRivalDef('mv-deepcent-1')!;
    s.rivalry.extra[def.id] = s.day;
    s.rivalry.overrides[def.id] = { eloAdd: -40, price: 0.5, context: 32000 };
    s.rivalsReleased.push(def.id);
    const e = marketSnapshot(s).segments.developers.entries.find((x) => x.key === `rival:${def.id}`)!;
    expect(e).toBeDefined();
    expect(e.ref).toEqual({ kind: 'rival', id: def.id });
    expect(e.owner).toBe('deepcent');
    expect(e.name).toBe('DeepSeak LLM Lito');
    expect(e.elo).toBe(def.arenaElo - 40);
    expect(e.price).toBeCloseTo(0.5, 9);
    expect(e.context).toBe(32000);
    expect(e.share).toBeGreaterThan(0);
  });

  it('модификатор rivalPrice снижает цену моделей лаборатории в снимке; поправка eloAdd входит в Эло', () => {
    const s = stateAt('2024-06-01');
    const gtp4o = byId('gtp-4o');
    const at = (key: string) => marketSnapshot(s).segments.developers.entries.find((e) => e.key === key)!;
    expect(at('rival:gtp-4o').price).toBeCloseTo(rivalPrice(gtp4o, s.day), 9);
    expect(at('rival:gtp-4o').elo).toBe(gtp4o.arenaElo);

    addRivalModifier(s, { id: 'rivalprice-openbrain', kind: 'rivalPrice', target: 'openbrain', mult: 0.5, add: 0.3, untilDay: FOREVER });
    s.rivalry.overrides['gtp-4o'] = { eloAdd: 20 };
    expect(at('rival:gtp-4o').price).toBeCloseTo(rivalPriceIn(s, gtp4o), 9);
    expect(at('rival:gtp-4o').price).toBeLessThan(rivalPrice(gtp4o, s.day));
    expect(at('rival:gtp-4o').elo).toBe(gtp4o.arenaElo + 20);
    // Другая лаборатория цену не меняет.
    const opus = byId('clade-3-opos');
    expect(at('rival:clade-3-opos').price).toBeCloseTo(rivalPrice(opus, s.day), 9);
  });
});
