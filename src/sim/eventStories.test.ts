// Письма с выбором как истории: у каждого варианта последствие словами, исход риска словами, реальные даты истории,
// игровые названия вместо настоящих, честные «без изменений» и письма не вплотную.

import { describe, expect, it } from 'vitest';
import { EVENTS, EXTRA_EVENTS, type EventDef } from '../data/events';
import { HISTORY_DATE, HISTORY_EVENTS } from '../data/historyEvents';
import { RANDOM_EVENTS } from '../data/randomEvents';
import { newGame } from './actions';
import { botAct, botChoice } from './bots';
import { applyChoice, deferChoice, mailChoices, openChoices, triggerEvent } from './events';
import { DATED_SPACING_DAYS, randomCandidates, RANDOM_QUIET_DAYS } from './randomEvents';
import { RIVALRY_EVENTS } from './rivalry';
import { advanceDay } from './tick';
import { dateToDay, END_DAY, yearOf } from './time';
import type { GameState, Mail, PlayerModel } from './types';

const D = dateToDay;
const BAD_DASH = /[–—−]/;

function model(over: Partial<PlayerModel> = {}): PlayerModel {
  return {
    id: 'p1',
    name: 'Мозг-1',
    plan: {
      name: 'Мозг-1', paramsB: 1, tokensB: 20, mix: { language: 0.5, code: 0.25, reasoning: 0.25 },
      benchShare: 0, benchTargets: [], rlhf: true, context: 512, tier: 'light',
    },
    arch: 'transformer',
    algoLevel: 0,
    trainedDay: 10,
    releasedDay: 20,
    caps: { language: 30, code: 20, reasoning: 20 },
    overfit: {},
    rlhf: true,
    arenaElo: 900,
    price: 10,
    onApi: true,
    exposed: false,
    earned: 0,
    onSubs: true,
    subsPrice: 10,
    review: 'none',
    reviewEndDay: null,
    earnedSubs: 0,
    ...over,
  };
}

/** Лаборатория в разгаре: модель в продаже и в подписке, идёт обучение, карты арендованы, денег много. */
function busy(day: number): GameState {
  const s = newGame('Тест', 3);
  s.day = day;
  s.cash = 1e9;
  s.reputation = 50;
  for (const k of Object.keys(s.hype) as (keyof GameState['hype'])[]) s.hype[k] = 50;
  s.models = [model()];
  s.compute.rented.p100 = 100;
  s.trainings = [{
    id: 't1', failed: false, plan: { ...model().plan, name: 'Мозг-2' }, arch: 'transformer', algoLevel: 0,
    flopTotal: 1e22, flopDone: 5e21, startedDay: day - 10, failAtFraction: null, failPenalty: 0,
  }];
  return s;
}

/** День, когда письмо события уместно: историческое - в свою дату, остальные - в середине 2024 года. */
function dayFor(def: EventDef): number {
  const hist = HISTORY_DATE[def.id];
  if (hist) return D(hist);
  if (def.id.startsWith('early-') && 'check' in def.when) {
    for (let d = 0; d < END_DAY; d++) if (def.when.check({ day: d } as GameState)) return d;
  }
  return D('2024-06-01');
}

/** Отправить письмо события и вернуть его. */
function send(s: GameState, def: EventDef): Mail {
  triggerEvent(s, def.id);
  return s.mail[s.mail.length - 1];
}

/** Всё, что может изменить выбор в письме. */
function snapshot(s: GameState): string {
  return JSON.stringify({
    cash: Math.round(s.cash),
    rep: s.reputation,
    hype: s.hype,
    mods: s.modifiers,
    flags: s.flags,
    share: s.founderShare,
    flops: s.trainings.map((t) => t.flopDone),
    algo: s.research.algoLevel,
    models: s.models.map((m) => [m.onApi, m.exposed]),
  });
}

const choiceEvents = (): EventDef[] => [...EVENTS.filter((e) => e.choices), ...EXTRA_EVENTS];

describe('последствие словами', () => {
  it('у каждого варианта каждого письма с выбором есть короткая фраза без чисел, советов и длинных тире', () => {
    const all: { id: string; label: string; story?: string; hint: string }[] = [];
    for (const def of choiceEvents()) {
      const s = busy(dayFor(def));
      const mail = send(s, def);
      for (const c of mail.choices!) all.push({ id: def.id, ...c });
    }
    for (const def of RIVALRY_EVENTS) {
      const s = busy(D('2023-06-01'));
      for (const c of mailChoices(s, def)!) all.push({ id: def.id, ...c });
    }
    expect(all.length).toBeGreaterThan(200);
    for (const c of all) {
      const tag = `${c.id}: ${c.label}`;
      expect(c.story, tag).toBeTruthy();
      const story = c.story!;
      expect(story.length, tag).toBeGreaterThanOrEqual(12);
      expect(story.length, tag).toBeLessThanOrEqual(95);
      expect(story, tag).toMatch(/^[А-ЯЁA-Z«]/);
      expect(story.replace(/«[^»]*»/g, ''), tag).not.toMatch(/\d/); // числа - в подсказке (кроме названий моделей)
      expect(story, tag).not.toMatch(/\.$/);
      expect(story, tag).not.toMatch(BAD_DASH);
      // Без советов игроку: последствие, а не рекомендация.
      expect(story, tag).not.toMatch(/(^|\s)(советуем|рекомендуем|следует|лучше всего|стоит ли|вам нужно|вы должны|не забудьте)/i);
      expect(story, tag).not.toBe(c.label);
      expect(c.hint, tag).not.toMatch(BAD_DASH);
      expect(c.label, tag).not.toMatch(BAD_DASH);
    }
  });

  it('варианты с жребием пишут исход словами, а у вариантов без жребия исхода нет', () => {
    let rolls = 0;
    for (const def of EXTRA_EVENTS) {
      def.choices!.forEach((c, i) => {
        const s = busy(dayFor(def));
        const mail = send(s, def);
        expect(applyChoice(s, mail.id, i).ok).toBe(true);
        const tag = `${def.id}/${i}`;
        if (c.luck) {
          rolls++;
          expect(mail.outcome, tag).toBeDefined();
          const words = mail.outcome!.lucky ? c.luck.good : c.luck.bad;
          expect(mail.outcome!.text.startsWith(words), tag).toBe(true);
          expect(c.luck.good + c.luck.bad, tag).not.toMatch(BAD_DASH);
          expect(c.luck.good, tag).toMatch(/^[а-яё]/); // идёт после «Повезло: »
          expect(c.luck.bad, tag).toMatch(/^[а-яё]/);
        } else {
          expect(mail.outcome, tag).toBeUndefined();
        }
      });
    }
    expect(rolls).toBeGreaterThanOrEqual(25);
  });

  it('исход словами и числами: «журналисты раскопали утечку (-8 репутации, -15 шумихи)»', () => {
    const def = RANDOM_EVENTS.find((e) => e.id === 'rnd-data-leak')!;
    const texts = new Set<string>();
    for (let seed = 1; seed < 60 && texts.size < 2; seed++) {
      const s = busy(D('2021-06-01'));
      s.yearly.rng = seed * 7919;
      const mail = send(s, def);
      applyChoice(s, mail.id, 1);
      texts.add(mail.outcome!.text);
    }
    expect([...texts].sort()).toEqual(['журналисты переключились на другие новости', 'журналисты раскопали утечку (-8 репутации, -15 шумихи)']);
  });

  it('«без изменений» ничего не меняет, а вариант с последствиями без шанса что-то меняет', () => {
    let checked = 0;
    for (const def of EXTRA_EVENTS) {
      def.choices!.forEach((_, i) => {
        const s = busy(dayFor(def));
        const mail = send(s, def);
        const hint = mail.choices![i].hint;
        const before = snapshot(s);
        applyChoice(s, mail.id, i);
        const tag = `${def.id}/${i}: ${hint}`;
        if (hint === 'без изменений') expect(snapshot(s), tag).toBe(before);
        else if (!/шанс/.test(hint)) expect(snapshot(s), tag).not.toBe(before);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(150);
  });
});

describe('реальная история 2017-2024', () => {
  /** Настоящие даты событий: письмо не раньше и не позже чем через 10 дней. */
  const REAL: Record<string, string> = {
    'hist-alphago-zero': '2017-10-19',
    'hist-duplex': '2018-05-08',
    'hist-gdpr': '2018-05-25',
    'hist-bort': '2018-10-11',
    'hist-mskft-billion': '2019-07-22',
    'hist-pandemic': '2020-03-11',
    'hist-alphafold': '2020-11-30',
    'hist-gpu-mining': '2021-02-18',
    'hist-antropik': '2021-05-28',
    'hist-code-assistant': '2021-06-29',
    'hist-dalle2': '2022-04-06',
    'hist-lamba-sentient': '2022-06-11',
    'hist-open-images': '2022-08-22',
    'hist-mining-end': '2022-09-15',
    'hist-berd-error': '2023-02-08',
    'hist-llamo-leak': '2023-03-03',
    'hist-pause-letter': '2023-03-22',
    'hist-italy-ban': '2023-03-31',
    'hist-corporate-ban': '2023-05-02',
    'hist-safety-order': '2023-11-02', // указ 30.10, встреча в Блетчли 1-2.11: письмо после обоих
    'hist-openbrain-board': '2023-11-17',
    'hist-news-lawsuit': '2023-12-27',
    'hist-chatbot-liable': '2024-02-14',
    'hist-video-model': '2024-02-15',
    'hist-eu-law': '2024-03-13',
    'hist-nuclear-deal': '2024-09-20',
    'hist-nobel': '2024-10-09',
  };

  it('каждое событие из списка есть, с выбором, и приходит не раньше настоящей даты', () => {
    expect(HISTORY_EVENTS.map((e) => e.id).sort()).toEqual(Object.keys(REAL).sort());
    for (const def of HISTORY_EVENTS) {
      const date = HISTORY_DATE[def.id];
      const real = D(REAL[def.id]);
      expect(D(date), def.id).toBeGreaterThanOrEqual(real);
      expect(D(date) - real, def.id).toBeLessThanOrEqual(10);
      const check = (def.when as { check: (s: GameState) => boolean }).check;
      expect(check({ day: D(date) - 1 } as GameState), def.id).toBe(false);
      expect(check({ day: D(date) } as GameState), def.id).toBe(true);
      expect(def.choices!.length, def.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('письмо не называет годы позже своей даты', () => {
    for (const def of HISTORY_EVENTS) {
      const s = busy(D(HISTORY_DATE[def.id]));
      const mail = send(s, def);
      const text = [mail.title, mail.body, ...mail.choices!.flatMap((c) => [c.label, c.hint, c.story ?? ''])].join(' ');
      for (const y of text.match(/\b20\d\d\b/g) ?? []) expect(Number(y), def.id).toBeLessThanOrEqual(yearOf(s.day));
    }
  });

  it('выбор меняет шумиху, цены, правила или спрос: у каждого события есть вариант не только про деньги и репутацию', () => {
    for (const def of HISTORY_EVENTS) {
      const s = busy(D(HISTORY_DATE[def.id]));
      const mail = send(s, def);
      const hints = mail.choices!.map((c) => c.hint).join(' | ');
      expect(hints, def.id).toMatch(/шумих|аренд|исследован|спрос|доверие|иски|доли|запросы регулятора|проекты обучения|подписчик/);
    }
  });
});

describe('игровые названия', () => {
  const REAL_NAMES = /OpenAI|Google|Anthropic|DeepMind|Microsoft|NVIDIA|Nvidia|ChatGPT|GPT-\d|Claude|Gemini|LLaMA|DALL-E|\bBard\b|LaMDA|AlphaGo|AlphaFold|Stable Diffusion|\bSora\b|Samsung|Air Canada|Ethereum|Copilot|BERT/;

  it('в письмах нет настоящих названий лабораторий, моделей и компаний', () => {
    for (const def of choiceEvents()) {
      const s = busy(dayFor(def));
      const mail = send(s, def);
      const text = [mail.title, mail.body, ...mail.choices!.flatMap((c) => [c.label, c.hint, c.story ?? ''])].join(' ');
      expect(text, def.id).not.toMatch(REAL_NAMES);
    }
  });
});

describe('новые случайные события', () => {
  it('разные по смыслу: люди, безопасность, рынок, курьёзы, возможности; у трети риск с исходом', () => {
    const ids = RANDOM_EVENTS.map((e) => e.id);
    for (const id of [
      'rnd-star-researcher', 'rnd-team-burnout', 'rnd-leaked-screenshot',
      'rnd-weights-leak', 'rnd-ransomware', 'rnd-api-spam', 'rnd-reward-hack',
      'rnd-big-client', 'rnd-military-contract', 'rnd-price-typo', 'rnd-school-ban', 'rnd-voice-claim', 'rnd-influencer',
      'rnd-viral-blunder',
      'rnd-small-lab', 'rnd-gpu-broker', 'rnd-university-lab', 'rnd-dataset-offer', 'rnd-best-paper',
    ]) expect(ids, id).toContain(id);
    const risky = RANDOM_EVENTS.filter((e) => e.choices!.some((c) => c.luck));
    expect(risky.length).toBeGreaterThanOrEqual(RANDOM_EVENTS.length / 3);
  });

  it('приходят по положению лаборатории', () => {
    const ids = (s: GameState) => randomCandidates(s).map((c) => c.id);
    const empty = newGame('Тест', 1);
    empty.day = D('2024-06-01');
    for (const id of ['rnd-voice-claim', 'rnd-ransomware', 'rnd-big-client', 'rnd-weights-leak', 'rnd-gpu-broker', 'rnd-leaked-screenshot']) {
      expect(ids(empty), id).not.toContain(id);
    }
    const full = busy(D('2024-06-01'));
    for (const id of ['rnd-voice-claim', 'rnd-ransomware', 'rnd-big-client', 'rnd-weights-leak', 'rnd-gpu-broker', 'rnd-leaked-screenshot']) {
      expect(ids(full), id).toContain(id);
    }
    // До ChatGTP школы чат-ботов не запрещают, голосовой режим - только в 2024 году.
    const early = busy(D('2022-06-01'));
    expect(ids(early)).not.toContain('rnd-school-ban');
    expect(ids(early)).not.toContain('rnd-voice-claim');
  });

  it('регулятор реже приходит к лаборатории, которая проверила данные по европейскому регламенту', () => {
    const s = busy(D('2022-06-01'));
    const w0 = randomCandidates(s).find((c) => c.id === 'rnd-regulator')!.weight;
    const gdpr = HISTORY_EVENTS.find((e) => e.id === 'hist-gdpr')!;
    const mail = send(s, gdpr);
    applyChoice(s, mail.id, 0);
    expect(randomCandidates(s).find((c) => c.id === 'rnd-regulator')!.weight).toBe(w0 / 2);
  });
});

describe('письма не вплотную', () => {
  /** Партия разумным ботом; письма с выбором откладываются и решаются через answerAfter дней. */
  function play(seed: number, answerAfter: number) {
    const s = newGame('Бот', seed);
    const letters: { id: string; day: number }[] = [];
    const seen = new Set<string>();
    const born = new Map<string, number>();
    while (!s.outcome && s.day < END_DAY) {
      for (const m of openChoices(s)) {
        if (!born.has(m.id)) born.set(m.id, s.day);
        if (s.day - born.get(m.id)! >= answerAfter) applyChoice(s, m.id, botChoice(s, m.eventId));
        else if (!m.deferred) deferChoice(s, m.id);
      }
      if (s.day % 7 === 0) botAct(s, 'reasonable');
      advanceDay(s);
      for (const m of s.mail) {
        if (seen.has(m.id) || !m.choices) continue;
        seen.add(m.id);
        letters.push({ id: m.eventId ?? '', day: m.day });
      }
    }
    return { s, letters };
  }

  it('история и ранние заказы - через неделю после другого решения, случайные - через 10 дней; в год не больше 16 решений', () => {
    const { letters } = play(2, 0);
    for (let i = 1; i < letters.length; i++) {
      const gap = letters[i].day - letters[i - 1].day;
      const id = letters[i].id;
      if (id.startsWith('hist-') || id.startsWith('early-')) expect(gap, `${letters[i - 1].id} -> ${id}`).toBeGreaterThanOrEqual(DATED_SPACING_DAYS);
      if (id.startsWith('rnd-')) expect(gap, `${letters[i - 1].id} -> ${id}`).toBeGreaterThanOrEqual(RANDOM_QUIET_DAYS);
    }
    const perYear = new Map<number, number>();
    for (const l of letters) perYear.set(yearOf(l.day), (perYear.get(yearOf(l.day)) ?? 0) + 1);
    for (const [y, n] of perYear) expect(n, String(y)).toBeLessThanOrEqual(16);
    // За партию - в среднем не больше 12 решений в год (было «не больше 95»: слепок одного прогона, число менялось
    // от любой правки денег, QA 19.10). Смысловые пределы - 16 в год и промежутки - выше.
    expect(letters.length).toBeLessThanOrEqual(8 * 12);
  }, 60_000);

  it('все исторические письма доходят, даже если игрок решает не сразу', () => {
    for (const answerAfter of [0, 20]) {
      const { s } = play(4, answerAfter);
      const missed = HISTORY_EVENTS.map((e) => e.id).filter((id) => !s.firedEvents.includes(id));
      expect(missed, `ответ через ${answerAfter} дн.`).toEqual([]);
    }
  }, 60_000);
});
