// Личное соперничество: счёт обгонов с каждой лабораторией, её ходы против вас, главный соперник и письма от соперников.
// Ничего не меняет в балансе: не тратит случайные числа, не трогает деньги, доли и Эло - только считает и пишет письма.
// Обгон считается по той же гонке, что баннер смены места (leaderboard.arenaStanding): модель лаборатории ушла
// из «выше вас» в «ниже вас» - вы их обогнали; модель появилась в «выше вас» - они обогнали вас.

import { LABS } from '../data/labs';
import { addMail } from './events';
import { arenaStanding, type ArenaNeighbor, type ArenaStanding, type RaceMetric } from './leaderboard';
import { ruPlural } from './text';
import type { GameState, LabId } from './types';
import { LAB_IDS } from './types';

export interface DuelLab {
  /** Сколько раз лаборатория обгоняла вас в гонке (не больше одного раза в день). */
  passedYou: number;
  /** Сколько раз вы обгоняли лабораторию. */
  youPassed: number;
  /** Ходов против вас (rivalry.history), без ограничения длины истории. */
  moves: number;
  /** День последнего обгона в любую сторону; null - обгонов не было. */
  lastDay: number | null;
}

export interface DuelState {
  labs: Record<LabId, DuelLab>;
  /** Главный соперник: лаборатория, которая чаще всех с вами борется; null - пока никто. */
  main: LabId | null;
  mainSince: number | null;
  /** Гонка и модели соперников выше и ниже вас вчера: `lab:id`. */
  race: string | null;
  ahead: string[];
  behind: string[];
  /** День последнего письма соперника: письма не чаще DUEL_LETTER_GAP дней. */
  letterDay: number | null;
  /** Отпечаток гонки вчера: если не изменился, таблицу не пересчитываем. */
  sig: string;
}

/** Сколько очков борьбы (обгоны в обе стороны + ходы) нужно, чтобы лаборатория стала главным соперником. */
export const MAIN_RIVAL_MIN = 3;
/** Письма соперников - не чаще раза в столько дней. */
export const DUEL_LETTER_GAP = 75;

function emptyLab(): DuelLab {
  return { passedYou: 0, youPassed: 0, moves: 0, lastDay: null };
}

export function emptyDuel(): DuelState {
  return {
    labs: Object.fromEntries(LAB_IDS.map((l) => [l, emptyLab()])) as Record<LabId, DuelLab>,
    main: null,
    mainSince: null,
    race: null,
    ahead: [],
    behind: [],
    letterDay: null,
    sig: '',
  };
}

/** Счёт с лабораторией; в старых сохранениях и до первого дня - нули. */
export function duelOf(s: GameState, lab: LabId): DuelLab {
  return s.duel?.labs[lab] ?? emptyLab();
}

/** Очки борьбы: обгоны в обе стороны и ходы против вас. */
export function fightScore(d: DuelLab): number {
  return d.passedYou + d.youPassed + d.moves;
}

export function mainRival(s: GameState): LabId | null {
  return s.duel?.main ?? null;
}

const LAB_NAME = new Map<LabId, string>(LABS.map((l) => [l.id, l.name]));

function labName(lab: LabId): string {
  return LAB_NAME.get(lab) ?? lab;
}

/** «1 раз», «3 раза», «5 раз». */
export function timesCount(n: number): string {
  return `${n} ${ruPlural(n, 'раз', 'раза', 'раз')}`;
}

function raceKey(m: RaceMetric): string {
  return m.kind === 'arena' ? 'arena' : `bench:${m.bid}`;
}

const key = (n: ArenaNeighbor): string => `${n.lab}:${n.id}`;

function standing(s: GameState): ArenaStanding | null {
  try {
    return arenaStanding(s);
  } catch {
    return null;
  }
}

// ---------- Письма ----------

export type LetterKind = 'passedYou' | 'youPassed' | 'main';

export interface LetterVars {
  their: string; // модель лаборатории
  yours: string; // модель игрока
  race: string; // «Арене» или имя теста
  you: string; // «лаборатория „Имя“»
  You: string; // «Лаборатория „Имя“» - в начале предложения
  of: string; // «лаборатории „Имя“»
}

type LetterText = { title: string; body: (v: LetterVars) => string };

/**
 * Письма в характере лаборатории: коротко, без советов игроку. Подпись - название лаборатории.
 * На обгон по два варианта: они чередуются, чтобы одна лаборатория не повторялась слово в слово.
 */
const LETTERS: Record<LabId, Record<LetterKind, LetterText[]>> = {
  openbrain: {
    passedYou: [
      { title: 'мы снова впереди', body: (v) => `${v.their} теперь выше ${v.yours} на ${v.race}. Спасибо, что держите темп. Мы его тоже держим.` },
      { title: 'ничего личного', body: (v) => `${v.their} снова впереди ${v.yours}. Ничего личного, просто следующий релиз.` },
    ],
    youPassed: [
      { title: 'поздравляем', body: (v) => `${v.yours} обошла ${v.their}. Поздравляем. Ответ уже в работе.` },
      { title: 'ненадолго', body: (v) => `${v.yours} выше ${v.their} на ${v.race}. Ненадолго.` },
    ],
    main: [{ title: 'вы в нашем списке', body: (v) => `Из всех лабораторий больше всего нам мешает ${v.you}. Это комплимент.` }],
  },
  antropik: {
    passedYou: [
      { title: 'о результатах', body: (v) => `${v.their} выше ${v.yours} на ${v.race}. Наши баллы перепроверила независимая группа.` },
      { title: 'без громких заявлений', body: (v) => `${v.their} обошла ${v.yours}. Без громких заявлений: цифры в таблице.` },
    ],
    youPassed: [
      { title: 'поздравляем', body: (v) => `Поздравляем: ${v.yours} обошла ${v.their}. Мы перепроверим результат, у нас так принято.` },
      { title: 'признаём', body: (v) => `${v.yours} выше ${v.their} на ${v.race}. Если баллы подтвердятся, мы признаем это первыми.` },
    ],
    main: [{ title: 'о вашей лаборатории', body: (v) => `${v.You} - главная тема наших внутренних отчётов в этом квартале. Работаем спокойно.` }],
  },
  gogle: {
    passedYou: [
      { title: 'вопрос масштаба', body: (v) => `${v.their} заняла место выше ${v.yours} на ${v.race}. Это вопрос масштаба. Без обид.` },
      { title: 'без выходных', body: (v) => `${v.their} выше ${v.yours}. Наши дата-центры работали без выходных.` },
    ],
    youPassed: [
      { title: 'принято к сведению', body: (v) => `${v.yours} обошла ${v.their}. Отметили. Совещание об ответе назначено на следующий месяц.` },
      { title: 'ответим', body: (v) => `${v.yours} выше ${v.their}. Ответим в следующем квартале. Возможно, в следующем за ним.` },
    ],
    main: [{ title: 'обзор конкурентов', body: (v) => `${v.You} включена в наш квартальный обзор конкурентов. Первым пунктом.` }],
  },
  zhipo: {
    passedYou: [
      { title: 'выше и дешевле', body: (v) => `${v.their} теперь выше ${v.yours} на ${v.race}. И дешевле. Клиенты считают оба числа.` },
      { title: 'цена прежняя', body: (v) => `${v.their} обошла ${v.yours}. Цена у нас прежняя. Низкая.` },
    ],
    youPassed: [
      { title: 'посмотрим', body: (v) => `${v.yours} обошла ${v.their}. Посмотрим, кто первым снизит цену.` },
      { title: 'сколько стоит', body: (v) => `${v.yours} выше ${v.their}. Интересно, во сколько она вам обходится.` },
    ],
    main: [{ title: 'ваш прайс-лист', body: (v) => `Прайс-лист ${v.of} мы открываем чаще своего.` }],
  },
  moonshoot: {
    passedYou: [
      { title: 'мы помним', body: (v) => `${v.their} обошла ${v.yours} на ${v.race}. Она помнит весь этот разговор. И предыдущий тоже.` },
      { title: 'дочитали', body: (v) => `${v.their} выше ${v.yours}. Мы просто дочитали задачу до конца.` },
    ],
    youPassed: [
      { title: 'прочитали', body: (v) => `${v.yours} обошла ${v.their}. Ваш пресс-релиз мы прочитали целиком, вместе с примечаниями.` },
      { title: 'запомнили', body: (v) => `${v.yours} выше ${v.their}. Запомнили. Мы всё запоминаем.` },
    ],
    main: [{ title: 'один запрос', body: (v) => `Все релизы ${v.of} поместились у нас в один запрос. Места хватило.` }],
  },
  deepcent: {
    passedYou: [
      { title: 'дешевле рекламы', body: (v) => `${v.their} выше ${v.yours} на ${v.race}. Обучение обошлось нам дешевле вашей рекламы.` },
      { title: 'бюджет', body: (v) => `${v.their} выше ${v.yours}. Бюджет меньше вашего.` },
    ],
    youPassed: [
      { title: 'принято', body: (v) => `${v.yours} выше ${v.their}. Принято. Считаем бюджет.` },
      { title: 'временно', body: (v) => `${v.yours} впереди ${v.their}. Временно.` },
    ],
    main: [{ title: 'короткий список', body: (v) => `${v.You} в нашем списке. Он короткий.` }],
  },
  alibabo: {
    passedYou: [
      { title: 'веса на сайте', body: (v) => `${v.their} обошла ${v.yours} на ${v.race}. Веса уже на сайте, скачивайте.` },
      { title: 'всё открыто', body: (v) => `${v.their} выше ${v.yours}. Код и веса открыты, проверяйте.` },
    ],
    youPassed: [
      { title: 'хорошая работа', body: (v) => `${v.yours} обошла ${v.their}. Хорошая работа. Сообщество ждёт ваши веса.` },
      { title: 'поздравляем', body: (v) => `${v.yours} выше ${v.their}. Поздравляем от всего сообщества.` },
    ],
    main: [{ title: 'вопрос сообщества', body: (v) => `Сообщество спрашивает, когда ${v.you} откроет веса. Мы тоже.` }],
  },
};

/** Сколько вариантов письма у лаборатории (для проверок). */
export function letterVariants(lab: LabId, kind: LetterKind): number {
  return LETTERS[lab][kind].length;
}

/** Текст письма лаборатории; n - номер варианта (по кругу). */
export function letterText(lab: LabId, kind: LetterKind, v: LetterVars, n = 0): { title: string; body: string } {
  const list = LETTERS[lab][kind];
  const l = list[((n % list.length) + list.length) % list.length];
  return { title: `${labName(lab)}: ${l.title}`, body: `${l.body(v)}

${labName(lab)}` };
}

/** Где идёт гонка, в предложном падеже: «„Арене“» или «GLUU». */
function raceWhere(m: RaceMetric): string {
  return m.kind === 'arena' ? '«Арене»' : `тесте ${m.name}`;
}

function sendLetter(s: GameState, d: DuelState, lab: LabId, kind: LetterKind, v: Omit<LetterVars, 'you' | 'You' | 'of'>, n = 0): void {
  const name = s.labName.trim();
  const you = name ? `лаборатория «${name}»` : 'ваша лаборатория';
  const of = name ? `лаборатории «${name}»` : 'вашей лаборатории';
  const t = letterText(lab, kind, { ...v, you, You: you[0].toUpperCase() + you.slice(1), of }, n);
  addMail(s, { kind: 'rival', title: t.title, body: t.body, from: lab });
  d.letterDay = s.day;
}

function letterDue(s: GameState, d: DuelState): boolean {
  return d.letterDay === null || s.day - d.letterDay >= DUEL_LETTER_GAP;
}

// ---------- День ----------

/** Всё, от чего зависит таблица гонки: модели соперников и их поправки, ваши модели, вышедшие тесты. */
function raceSignature(s: GameState): string {
  let ov = 0;
  for (const o of Object.values(s.rivalry.overrides)) ov += (o.eloAdd ?? 0) * 7 + (o.dayShift ?? 0);
  let mine = '';
  for (const m of s.models) if (m.releasedDay !== null) mine += `${m.id}:${m.onApi ? 1 : 0}:${m.exposed ? 1 : 0}:${Math.round(m.arenaElo)},`;
  let bench = 0;
  for (const b of Object.values(s.benchmarks)) if (b.introduced) bench++;
  const pushes = s.late?.finale.pushes.filter((p) => p.fired).length ?? 0;
  return `${s.rivalsReleased.length}|${ov}|${bench}|${pushes}|${mine}`;
}

/**
 * Ежедневно, после ходов соперников и рынка: обгоны в гонке, новые ходы против вас, главный соперник, письма.
 * Ни случайных чисел, ни денег, ни долей - на баланс не влияет.
 */
export function duelDay(s: GameState): void {
  const d = (s.duel ??= emptyDuel());

  // Ходы против вас за сегодня (история ходов в rivalry.ts обрезается до 20 строк, поэтому считаем сами).
  for (const h of s.rivalry.history) if (h.day === s.day) d.labs[h.lab].moves += 1;

  // Гонка меняется только с выходом моделей, поправками ходов и тестами: в остальные дни таблицу не пересчитываем
  // (раз в неделю - на всякий случай). Так партия ботом не замедляется.
  const sig = raceSignature(s);
  const st = sig !== d.sig || s.day % 7 === 0 ? standing(s) : null;
  d.sig = sig;
  // Лаборатория → её модель, ближайшая к вам среди обогнанных сегодня (в обе стороны).
  const passed = new Map<LabId, ArenaNeighbor>();
  const lost = new Map<LabId, ArenaNeighbor>();
  if (st) {
    const rk = raceKey(st.metric);
    const ahead = st.ahead.map(key);
    const behind = st.behind.map(key);
    if (d.race === rk) {
      const wasAhead = new Set(d.ahead);
      // behind - ближние к вам первыми, ahead - ближние в конце.
      for (const n of st.behind) {
        const lab = n.lab as LabId; // в списках соседей только модели соперников
        if (wasAhead.has(key(n)) && !passed.has(lab)) passed.set(lab, n);
      }
      for (const n of [...st.ahead].reverse()) {
        const lab = n.lab as LabId;
        if (!wasAhead.has(key(n)) && !lost.has(lab)) lost.set(lab, n);
      }
    }
    d.race = rk;
    d.ahead = ahead;
    d.behind = behind;
    for (const lab of passed.keys()) {
      d.labs[lab].youPassed += 1;
      d.labs[lab].lastDay = s.day;
    }
    for (const lab of lost.keys()) {
      d.labs[lab].passedYou += 1;
      d.labs[lab].lastDay = s.day;
    }
  }

  // Главный соперник: больше всех очков борьбы; при равенстве остаётся прежний.
  let best: LabId | null = d.main;
  let bestScore = best ? fightScore(d.labs[best]) : 0;
  for (const lab of LAB_IDS) {
    const sc = fightScore(d.labs[lab]);
    if (sc > bestScore) {
      best = lab;
      bestScore = sc;
    }
  }
  if (bestScore >= MAIN_RIVAL_MIN && best !== d.main) {
    d.main = best;
    d.mainSince = s.day;
    if (best && letterDue(s, d)) sendLetter(s, d, best, 'main', { their: '', yours: '', race: '' });
    return;
  }

  // Письмо главного соперника после обгона в его сторону или в вашу.
  const main = d.main;
  if (!main || !st || !letterDue(s, d)) return;
  const v = { yours: st.modelName, race: raceWhere(st.metric) };
  const their = lost.get(main);
  const mine = passed.get(main);
  if (their) sendLetter(s, d, main, 'passedYou', { ...v, their: their.name }, d.labs[main].passedYou - 1);
  else if (mine) sendLetter(s, d, main, 'youPassed', { ...v, their: mine.name }, d.labs[main].youPassed - 1);
}
