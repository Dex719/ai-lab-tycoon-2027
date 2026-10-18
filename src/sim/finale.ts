// Финальный квартал (1 октября - 31 декабря 2024): соперники делают последние рывки, игрок видит их заранее
// и может ответить. Раньше последние 90 дней соперники были заморожены, и исход был ясен заранее.
//
// Правила честности:
// - рывок объявляется письмом минимум за FINALE[сложность].notice дней: лаборатория, модель, день и цель по Эло;
// - цель задаётся в день объявления (лучшая модель игрока + margin, но не больше cap над моделью) и потом не меняется;
// - рывки бывают только у лаборатории, которая может обойти игрока, и только если игрок на 1-м месте;
// - позже LAST_PUSH_DAY рывков нет: последние дни года без сюрпризов;
// - модели каталога, которые выходят в финале и могут обойти игрока, тоже объявляются заранее;
// - ответ игрока - доработка модели (UPDATE_*), новая модель или своя цена; доработка всегда сильнее запаса рывка.

import { LABS } from '../data/labs';
import { RIVAL_MODELS } from '../data/catalog';
import { addMail } from './events';
import { spend } from './finance';
import { marketArenaRank, rivalInRace } from './leaderboard';
import { hasTeam, lateOf, TEAM_UPDATE_MULT, type FinalPush } from './lateState';
import { addRivalModifier, findRivalDefIn, rivalDayIn, rivalEloIn, STORY_LOCKED, type Difficulty } from './rivalry';
import { findRivalDef } from './rivals';
import { daysWord, endSentence, ruPlural } from './text';
import { dateToDay, END_DAY, formatDate } from './time';
import type { GameState, LabId, PlayerModel, Result, Tier } from './types';
import { LAB_IDS } from './types';

export const FINALE_START = dateToDay('2024-10-01');
/** После этого дня рывков нет. */
export const LAST_PUSH_DAY = dateToDay('2024-12-20');
/**
 * Первая проверка - в последний день сентября: 1 октября игрок уже видит объявленные рывки (газетная полоса, окно).
 * Дальше проверки 30 октября и 19 ноября (рывок через notice дней - не позже LAST_PUSH_DAY).
 */
const FIRST_CHECK = FINALE_START - 1;
const CHECK_OFFSETS = [0, 30, 50];

interface FinaleDef {
  notice: number; // за сколько дней объявляется рывок и выход модели каталога
  margin: number; // на сколько Эло лаборатория хочет обойти лучшую модель игрока
  cap: number; // насколько рывок может поднять модель
  maxPushes: number; // рывков за финал
  perCheck: number; // новых рывков за одну проверку
}

export const FINALE: Record<Difficulty, FinaleDef> = {
  easy: { notice: 45, margin: 3, cap: 10, maxPushes: 1, perCheck: 1 },
  normal: { notice: 30, margin: 6, cap: 20, maxPushes: 2, perCheck: 1 },
  hard: { notice: 21, margin: 8, cap: 40, maxPushes: 3, perCheck: 2 },
};

/** Объявляются модели каталога не слабее лучшей модели игрока минус столько Эло. */
const ANNOUNCE_RELEVANT = 15;
/** После рывка лаборатория снижает цены до конца года. */
const PUSH_PRICE_MULT = 0.75;
const PUSH_PRICE_FLOOR = 0.3;
/** Между рывками одной проверки - столько дней. */
const PUSH_STAGGER = 6;

// ---------- Доработка модели игрока ----------

/** Доработка идёт столько дней. */
export const UPDATE_DAYS = 28;
/**
 * Прибавка Эло: первая и вторая доработка одной модели (с командой дообучения ×1,5).
 * Обе больше самого большого запаса рывка с округлением цели (margin 8 на Сложной + 0,5): было [10, 6],
 * и вторая доработка не отбивала рывок на Сложной, а на Обычной - примерно в половине случаев.
 */
export const UPDATE_GAIN: readonly number[] = [10, 9];
/** Стоимость первой доработки по уровню модели; вторая дороже в UPDATE_SECOND_MULT раза. */
export const UPDATE_COST: Record<Tier, number> = { flagship: 60e6, mid: 30e6, light: 15e6 };
const UPDATE_SECOND_MULT = 1.5;

const LAB_NAME = new Map<LabId, string>(LABS.map((l) => [l.id, l.name]));

function labName(lab: LabId): string {
  return LAB_NAME.get(lab) ?? lab;
}

function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function fmtMoney(n: number): string {
  const dec = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
  if (n >= 1e9 - 5e4) return `$${dec(n / 1e9)} млрд`;
  if (n >= 1e6 - 500) return `$${dec(n / 1e6)} млн`;
  return `$${dec(n / 1e3)} тыс.`;
}

/** Идёт финальный квартал (и партия ещё не окончена). */
export function finaleOn(s: GameState): boolean {
  return s.day >= FINALE_START;
}

/** День открытия окна «Финал» или null, если ещё рано. */
export function finaleOpenedDay(s: GameState): number | null {
  return s.day >= FINALE_START ? FINALE_START : null;
}

// ---------- Игрок ----------

/** Лучшая модель игрока в продаже по API: по ней считается место. */
export function playerBestApi(s: GameState): PlayerModel | null {
  let best: PlayerModel | null = null;
  for (const m of s.models) if (m.releasedDay !== null && m.onApi && (!best || m.arenaElo > best.arenaElo)) best = m;
  return best;
}

function playerRank(s: GameState): number | null {
  let rank: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null || !m.onApi) continue;
    const r = marketArenaRank(s, { kind: 'player', id: m.id });
    if (r !== null && (rank === null || r < rank)) rank = r;
  }
  return rank;
}

// ---------- Рывки соперников ----------

interface Candidate {
  lab: LabId;
  modelId: string;
  name: string;
  kind: FinalPush['kind'];
  base: number;
  fireDay: number;
}

/**
 * Модель, которую лаборатория может поднять: вышедшая модель каталога по API (обновление) или модель каталога,
 * которая выйдет до конца года не раньше чем через notice дней (выйдет раньше и сильнее). Сюжетные модели не трогаем.
 * null - лаборатории нечем ответить или она и так впереди игрока (рывок не нужен).
 */
function candidateOf(s: GameState, lab: LabId, playerElo: number, def: FinaleDef, stagger: number): Candidate | null {
  const released = new Set(s.rivalsReleased);
  const list: Candidate[] = [];
  for (const id of s.rivalsReleased) {
    const m = findRivalDef(id); // только каталог: ответные модели - облегчённые версии
    if (!m || m.lab !== lab || !rivalInRace(m) || m.announcedOnly) continue;
    const base = rivalEloIn(s, m);
    if (base >= playerElo) return null; // лаборатория уже впереди
    if (STORY_LOCKED.has(id)) continue;
    const fireDay = Math.min(LAST_PUSH_DAY, s.day + def.notice + stagger);
    if (fireDay < s.day + def.notice) continue;
    list.push({ lab, modelId: id, name: m.gameName, kind: 'update', base, fireDay });
  }
  for (const m of RIVAL_MODELS) {
    if (m.lab !== lab || released.has(m.id) || !rivalInRace(m) || m.announcedOnly) continue;
    const day = rivalDayIn(s, m);
    if (day > END_DAY) continue;
    const base = rivalEloIn(s, m);
    if (base >= playerElo) return null; // выйдет и так выше игрока: её объявит announceCatalog
    if (STORY_LOCKED.has(m.id)) continue;
    const fireDay = Math.min(day, LAST_PUSH_DAY);
    if (fireDay < s.day + def.notice) continue;
    list.push({ lab, modelId: m.id, name: m.gameName, kind: 'release', base, fireDay });
  }
  let best: Candidate | null = null;
  for (const c of list) if (!best || c.base > best.base) best = c;
  return best;
}

function pushTitle(p: FinalPush): string {
  return `Финальный рывок: ${labName(p.lab)}`;
}

function pushMail(s: GameState, p: FinalPush, name: string, me: PlayerModel): void {
  const what =
    p.kind === 'update'
      ? `обновление ${name} к ${formatDate(p.fireDay)}`
      : `выход ${name} к ${formatDate(p.fireDay)}`;
  addMail(s, {
    kind: 'rival',
    important: true,
    title: pushTitle(p),
    body:
      `${labName(p.lab)} хочет закончить год на первом месте и готовит ${what}. По данным инсайдеров, на «Арене» будет около ${fmtInt(p.target)} Эло ` +
      `(сейчас ${fmtInt(p.base)}). Ваша лучшая модель в продаже «${me.name}» - ${fmtInt(me.arenaElo)} Эло. ` +
      'Цель рывка объявлена и больше не изменится. Рывки, анонсы и доработка моделей - в окне «Финал».',
  });
}

/** Проверка финала: если игрок первый, до perCheck лабораторий, которые могут его обойти, объявляют рывок. */
function planPushes(s: GameState): void {
  const def = FINALE[s.difficulty] ?? FINALE.normal;
  const f = lateOf(s).finale;
  if (f.pushes.length >= def.maxPushes) return;
  const me = playerBestApi(s);
  if (!me || playerRank(s) !== 1) return;
  const used = new Set(f.pushes.map((p) => p.lab));
  const list: { c: Candidate; target: number }[] = [];
  for (const lab of LAB_IDS) {
    if (used.has(lab)) continue;
    const c = candidateOf(s, lab, me.arenaElo, def, 0);
    if (!c) continue;
    const target = Math.round(Math.min(me.arenaElo + def.margin, c.base + def.cap));
    if (target <= me.arenaElo) continue; // не обойдёт - рывок не нужен
    list.push({ c, target });
  }
  list.sort((a, b) => b.target - a.target || LAB_IDS.indexOf(a.c.lab) - LAB_IDS.indexOf(b.c.lab));
  const n = Math.min(def.perCheck, def.maxPushes - f.pushes.length);
  list.slice(0, n).forEach(({ c, target }, i) => {
    const fireDay = c.kind === 'update' ? Math.min(LAST_PUSH_DAY, c.fireDay + i * PUSH_STAGGER) : c.fireDay;
    const p: FinalPush = {
      lab: c.lab,
      modelId: c.modelId,
      kind: c.kind,
      announceDay: s.day,
      fireDay,
      base: Math.round(c.base),
      target,
      playerElo: Math.round(me.arenaElo),
      fired: false,
    };
    f.pushes.push(p);
    if (c.kind === 'release') {
      // Модель каталога выйдет к fireDay и сразу с целью по Эло: поправка ставится сейчас, выход - по расписанию соперников.
      const m = findRivalDefIn(c.modelId);
      if (m) {
        const o = { ...(s.rivalry.overrides[c.modelId] ?? {}) };
        o.eloAdd = (o.eloAdd ?? 0) + (target - c.base);
        const shift = fireDay - rivalDayIn(s, m);
        if (shift < 0) o.dayShift = (o.dayShift ?? 0) + shift;
        s.rivalry.overrides[c.modelId] = o;
      }
      if (!f.announced.includes(c.modelId)) f.announced.push(c.modelId);
    }
    pushMail(s, p, c.name, me);
  });
}

/** Модели каталога, которые выйдут в финале и могут обойти игрока: объявление за notice дней (или с начала финала). */
function announceCatalog(s: GameState): void {
  const def = FINALE[s.difficulty] ?? FINALE.normal;
  const f = lateOf(s).finale;
  const me = playerBestApi(s);
  const released = new Set(s.rivalsReleased);
  for (const m of RIVAL_MODELS) {
    if (released.has(m.id) || f.announced.includes(m.id) || !rivalInRace(m) || m.announcedOnly) continue;
    const day = rivalDayIn(s, m);
    if (day < FIRST_CHECK || day > END_DAY || day - s.day > def.notice) continue;
    const elo = rivalEloIn(s, m);
    if (me && elo < me.arenaElo - ANNOUNCE_RELEVANT) continue;
    f.announced.push(m.id);
    const near = Math.round(elo / 5) * 5;
    const cmp = me
      ? elo > me.arenaElo
        ? ` - выше вашей «${me.name}» (${fmtInt(me.arenaElo)})`
        : ` - чуть ниже вашей «${me.name}» (${fmtInt(me.arenaElo)})`
      : '';
    addMail(s, {
      kind: 'rival',
      title: `${labName(m.lab)} объявила ${m.gameName}`,
      body: `Выход - около ${formatDate(day)}. По словам лаборатории, на «Арене» у модели около ${fmtInt(near)} Эло${cmp}.`,
    });
  }
}

/** Рывок состоялся: обновление поднимает Эло модели; у вышедшей модели цель уже стоит. Цены лаборатории ниже до конца года. */
function firePush(s: GameState, p: FinalPush): void {
  const m = findRivalDefIn(p.modelId);
  if (!m) {
    p.fired = true;
    return;
  }
  if (p.kind === 'update') {
    if (s.day < p.fireDay) return;
    const o = { ...(s.rivalry.overrides[p.modelId] ?? {}) };
    o.eloAdd = (o.eloAdd ?? 0) + Math.max(0, p.target - rivalEloIn(s, m));
    s.rivalry.overrides[p.modelId] = o;
  } else if (!s.rivalsReleased.includes(p.modelId)) {
    return;
  }
  p.fired = true;
  addRivalModifier(s, {
    id: `finale-price-${p.lab}`,
    kind: 'rivalPrice',
    target: p.lab,
    mult: PUSH_PRICE_MULT,
    add: PUSH_PRICE_FLOOR,
    untilDay: END_DAY,
  });
  const pct = Math.round((1 - PUSH_PRICE_MULT) * 100);
  const me = playerBestApi(s);
  const vs = me
    ? rivalEloIn(s, m) > me.arenaElo
      ? ` Это выше вашей «${me.name}» (${fmtInt(me.arenaElo)}).`
      : ` Ваша «${me.name}» (${fmtInt(me.arenaElo)}) по-прежнему впереди.`
    : '';
  addMail(s, {
    kind: 'rival',
    title: p.kind === 'update' ? `${labName(p.lab)} обновила ${m.gameName}` : `${labName(p.lab)}: рывок состоялся`,
    body:
      `${m.gameName}: на «Арене» около ${fmtInt(rivalEloIn(s, m))} Эло (было ${fmtInt(p.base)}).${vs} ` +
      `Цены ${labName(p.lab)} ниже на ${pct} % до конца года.`,
  });
}

// ---------- Доработка ----------

export interface UpdateQuote {
  nth: number; // какая это доработка модели: 0 - первая
  gain: number;
  cost: number;
  days: number;
  endDay: number;
  error: string | null;
}

function updatesOf(s: GameState, modelId: string): number {
  return s.late?.finale.done.filter((d) => d.modelId === modelId).length ?? 0;
}

/** Условия доработки модели сегодня и причина, если начать нельзя. */
export function updateQuote(s: GameState, modelId: string): UpdateQuote {
  const m = s.models.find((x) => x.id === modelId);
  const nth = updatesOf(s, modelId);
  const mult = hasTeam(s, 'posttrain') ? TEAM_UPDATE_MULT : 1;
  const gain = Math.round((UPDATE_GAIN[Math.min(nth, UPDATE_GAIN.length - 1)] ?? 0) * mult);
  const tier: Tier = m?.plan.tier ?? 'mid';
  const cost = UPDATE_COST[tier] * (nth >= 1 ? UPDATE_SECOND_MULT : 1);
  const endDay = s.day + UPDATE_DAYS;
  const q: UpdateQuote = { nth, gain, cost, days: UPDATE_DAYS, endDay, error: null };
  const running = s.late?.finale.update;
  if (s.outcome) q.error = 'Партия окончена.';
  else if (!finaleOn(s)) q.error = 'Доработка откроется в финальном квартале.';
  else if (!m) q.error = 'Нет такой модели.';
  else if (running) {
    const r = s.models.find((x) => x.id === running.modelId);
    q.error = `Идёт доработка «${r?.name ?? 'модели'}» до ${formatDate(running.endDay)}.`;
  } else if (m.exposed) q.error = 'Подгонка этой модели раскрыта: дорабатывать её нет смысла.';
  else if (nth >= UPDATE_GAIN.length) q.error = 'Модель уже доработана дважды.';
  else if (endDay > END_DAY) q.error = `Не успеет до 31 декабря 2024: доработка идёт ${daysWord(UPDATE_DAYS)}.`;
  else if (s.cash < cost) q.error = `Не хватает денег: нужно ${fmtMoney(cost)}, на счету ${endSentence(fmtMoney(Math.max(0, s.cash)))}`;
  return q;
}

/** Действие: начать доработку модели. Деньги сразу, Эло - через UPDATE_DAYS дней. */
export function startUpdate(s: GameState, modelId: string): Result {
  const q = updateQuote(s, modelId);
  if (q.error) return { ok: false, error: q.error };
  spend(s, 'capex', q.cost);
  lateOf(s).finale.update = { modelId, startDay: s.day, endDay: q.endDay, gain: q.gain, cost: q.cost };
  return { ok: true };
}

function finishUpdate(s: GameState): void {
  const f = lateOf(s).finale;
  const u = f.update;
  if (!u || s.day < u.endDay) return;
  f.update = null;
  const m = s.models.find((x) => x.id === u.modelId);
  if (!m) return;
  m.arenaElo += u.gain;
  f.done.push({ modelId: m.id, day: s.day, gain: u.gain });
  addMail(s, {
    kind: 'training',
    title: `Доработка «${m.name}» завершена`,
    reward: true,
    body: `На «Арене» модель сильнее на ${u.gain} Эло: теперь около ${fmtInt(m.arenaElo)}.`,
  });
}

// ---------- Тик ----------

/** Ежедневно с 30 сентября 2024 года (после ходов соперников): проверки, анонсы, рывки, доработка. */
export function finaleDay(s: GameState): void {
  if (s.day < FIRST_CHECK) return;
  const f = lateOf(s).finale;
  while (f.checks < CHECK_OFFSETS.length && s.day >= FIRST_CHECK + CHECK_OFFSETS[f.checks]) {
    planPushes(s);
    f.checks += 1;
  }
  announceCatalog(s);
  for (const p of f.pushes) if (!p.fired) firePush(s, p);
  finishUpdate(s);
}

// ---------- Для окна «Финал» и ботов ----------

export interface FinaleThreat {
  lab: LabId;
  modelId: string;
  name: string;
  /** push - объявленный рывок, release - объявленный выход модели каталога. */
  kind: 'push-update' | 'push-release' | 'release';
  day: number; // когда сработает или сработал
  elo: number; // ожидаемое (или уже фактическое) Эло
  done: boolean;
}

/** Рывки и объявленные выходы финала по дням. */
export function finaleThreats(s: GameState): FinaleThreat[] {
  const f = s.late?.finale;
  if (!f) return [];
  const out: FinaleThreat[] = [];
  const pushed = new Set<string>();
  for (const p of f.pushes) {
    const m = findRivalDefIn(p.modelId);
    pushed.add(p.modelId);
    const day = p.kind === 'release' && m ? rivalDayIn(s, m) : p.fireDay;
    out.push({
      lab: p.lab,
      modelId: p.modelId,
      name: m?.gameName ?? p.modelId,
      kind: p.kind === 'update' ? 'push-update' : 'push-release',
      day,
      elo: p.fired && m ? rivalEloIn(s, m) : p.target,
      done: p.fired,
    });
  }
  for (const id of f.announced) {
    if (pushed.has(id)) continue;
    const m = findRivalDefIn(id);
    if (!m) continue;
    out.push({
      lab: m.lab,
      modelId: id,
      name: m.gameName,
      kind: 'release',
      day: rivalDayIn(s, m),
      elo: rivalEloIn(s, m),
      done: s.rivalsReleased.includes(id),
    });
  }
  out.sort((a, b) => a.day - b.day || b.elo - a.elo);
  return out;
}

/** «2 рывка», «1 рывок». */
export function pushesText(n: number): string {
  return `${n} ${ruPlural(n, 'рывок', 'рывка', 'рывков')}`;
}

/**
 * Ответ бота на угрозу в финале: если объявленная угроза выше его лучшей модели и денег втрое больше цены -
 * доработка лучшей модели в продаже.
 */
export function botFinale(s: GameState): void {
  if (!finaleOn(s) || s.late?.finale.update) return;
  const best = playerBestApi(s);
  if (!best) return;
  const threat = finaleThreats(s).some((t) => !t.done && t.elo >= best.arenaElo);
  if (!threat) return;
  const q = updateQuote(s, best.id);
  if (q.error || s.cash < 3 * q.cost) return;
  startUpdate(s, best.id);
}
