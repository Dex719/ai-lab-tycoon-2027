// Общие помощники целей года и коротких задач: круглые пороги, гонка с соперником, награды и их текст.
// Отдельный файл без зависимостей от sim/goals.ts и sim/tasks.ts, чтобы data/goals.ts и data/tasks.ts не ходили по кругу.

import { LABS } from './labs';
import { benchDef } from '../sim/benchmarks';
import { addModifier } from '../sim/events';
import { earn } from '../sim/finance';
import { arenaStanding, type ArenaStanding, type RaceMetric } from '../sim/leaderboard';
import { findRivalDef, rivalScore } from '../sim/rivals';
import { rivalEloIn } from '../sim/rivalry';
import { ruPlural } from '../sim/text';
import { formatDateShort } from '../sim/time';
import { modelScore, trainingPoolPerRun } from '../sim/training';
import { TRAIN_FLOP_PER_H100E_DAY } from '../sim/constants';
import type { BenchmarkId, GameState, IncomeKind, MonthLedger } from '../sim/types';
import { amountForYear, usd } from './eventKit';

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const clamp100 = (x: number): number => Math.max(0, Math.min(100, x));

// ---------- Круглые числа ----------

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10];

/** Круглая сумма: две значащие цифры из ряда 1; 1,2; 1,5; 2; 2,5; 3; 4; 5… ($3,4 млн → $3 млн, $4,6 млн → $5 млн). */
export function niceMoney(x: number): number {
  if (!(x > 0)) return 0;
  const k = 10 ** Math.floor(Math.log10(x));
  const m = x / k;
  let best = NICE[0];
  for (const n of NICE) if (Math.abs(n - m) < Math.abs(best - m)) best = n;
  return best * k;
}

/** Круглая доля: от 5 % - целые проценты, меньше - с шагом 0,5 %. */
export function niceShare(x: number): number {
  if (x >= 0.05) return Math.round(x * 100) / 100;
  return Math.max(0.005, Math.round(x * 200) / 200);
}

/** Круглое число людей: 1 234 567 → 1 200 000. */
export function niceCount(x: number): number {
  if (!(x > 0)) return 0;
  const k = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / k) * k;
}

/** «12,5 %», «8 %»; знак процента не отрывается от числа при переносе строки. */
export function shareText(x: number): string {
  const v = Math.round(x * 1000) / 10;
  return `${String(v).replace('.', ',')} %`;
}

/** «1,3», «12»: разница в процентных пунктах без лишних нулей. */
export function pointsText(x: number): string {
  const v = Math.round(x * 10) / 10;
  return String(v).replace('.', ',');
}

/** «1 200 000» → «1,2 млн», «350 000» → «350 тыс.». */
export function countText(n: number): string {
  if (n >= 1e6) return `${String(Math.round(n / 1e5) / 10).replace('.', ',')} млн`;
  if (n >= 1e4) return `${Math.round(n / 1e3)} тыс.`;
  return Math.round(n).toLocaleString('ru-RU');
}

// ---------- Деньги ----------

const ledgerSum = (l: MonthLedger, kinds: readonly IncomeKind[]): number => kinds.reduce((a, k) => a + l.income[k], 0);

/** Сколько всего пришло за партию по статьям kinds (закрытые месяцы и текущий). */
export function cumIncome(s: GameState, kinds: readonly IncomeKind[]): number {
  let total = ledgerSum(s.finance.month, kinds);
  for (const h of s.finance.history) total += ledgerSum(h, kinds);
  return total;
}

export const REVENUE_KINDS: readonly IncomeKind[] = ['api', 'subs', 'contracts'];

/** Выручка (API, подписки, контракты) за партию: от неё считаются задачи «заработать». */
export function cumRevenue(s: GameState): number {
  return cumIncome(s, REVENUE_KINDS);
}

// ---------- Гонка ----------

/** Порог «почти» в гонке - тот же, что на верхней панели (ui/ArenaFeedback.tsx, closeGap): 15 Эло или 1,5 балла теста. */
export const RACE_CLOSE_ELO = 15;
export const RACE_CLOSE_POINTS = 1.5;

/** Ключ гонки: 'arena' или id теста. */
export type RaceKey = 'arena' | BenchmarkId;

export function raceKeyOf(m: RaceMetric): RaceKey {
  return m.kind === 'arena' ? 'arena' : m.bid;
}

export function closeGapOf(key: RaceKey): number {
  return key === 'arena' ? RACE_CLOSE_ELO : RACE_CLOSE_POINTS;
}

/** «на «Арене»» или «по GLUU». */
export function raceWhere(key: RaceKey): string {
  return key === 'arena' ? 'на «Арене»' : `по ${benchDef(key).name}`;
}

/** «24 Эло» или «1,3 балла»; genitive - после «не хватило»: «3 баллов», «1 балла». */
export function gapText(key: RaceKey, gap: number, genitive = false): string {
  if (key === 'arena') return `${Math.max(1, Math.round(gap))} Эло`;
  const v = Math.max(0.1, Math.round(gap * 10) / 10);
  const word = !Number.isInteger(v) ? 'балла' : genitive ? ruPlural(v, 'балла', 'баллов', 'баллов') : ruPlural(v, 'балл', 'балла', 'баллов');
  return `${String(v).replace('.', ',')} ${word}`;
}

/** «1 234 Эло» или «88,4 %». */
export function raceValueText(key: RaceKey, v: number): string {
  return key === 'arena' ? `${Math.round(v)} Эло` : `${String(Math.round(v * 10) / 10).replace('.', ',')} %`;
}

export function safeStanding(s: GameState): ArenaStanding | null {
  try {
    return arenaStanding(s);
  } catch {
    return null;
  }
}

/** Лучшая модель игрока в гонке key: на «Арене» - среди моделей в продаже по API, в тесте - среди выпущенных. */
export function myRaceValue(s: GameState, key: RaceKey): number | null {
  let best: number | null = null;
  for (const m of s.models) {
    if (m.releasedDay === null) continue;
    if (key === 'arena' && !m.onApi) continue;
    const v = key === 'arena' ? m.arenaElo : modelScore(m, key, false);
    if (best === null || v > best) best = v;
  }
  return best;
}

/** Значение модели соперника в гонке key (Эло с поправками ходов или показанный балл теста). */
export function rivalRaceValue(s: GameState, key: RaceKey, rivalId: string): number | null {
  const def = findRivalDef(rivalId);
  if (!def) return null;
  return key === 'arena' ? rivalEloIn(s, def) : rivalScore(def, key).value;
}

/** «GTP-3 Davanci (OpenBrain)». */
export function rivalLabel(rivalId: string): string {
  const def = findRivalDef(rivalId);
  if (!def) return rivalId;
  const lab = LABS.find((l) => l.id === def.lab)?.name;
  return lab ? `${def.gameName} (${lab})` : def.gameName;
}

/** «arena:gtp-4» → ['arena', 'gtp-4']. */
export function splitRace(subject: string): { key: RaceKey; rivalId: string } {
  const i = subject.indexOf(':');
  return { key: subject.slice(0, i) as RaceKey, rivalId: subject.slice(i + 1) };
}

/** Разрыв до соперника: > 0 - он впереди, ≤ 0 - обогнали. null - моделей игрока в этой гонке нет. */
export function raceGap(s: GameState, key: RaceKey, rivalId: string): number | null {
  const mine = myRaceValue(s, key);
  const theirs = rivalRaceValue(s, key, rivalId);
  if (mine === null || theirs === null) return null;
  return theirs - mine;
}

// ---------- Обучение ----------

/** Сколько дней осталось самому близкому к концу проекту обучения; null - проектов нет или мощности нет. */
export function nearestTrainingDays(s: GameState): number | null {
  const speed = trainingPoolPerRun(s) * TRAIN_FLOP_PER_H100E_DAY;
  if (!(speed > 0)) return null;
  let best: number | null = null;
  for (const r of s.trainings) {
    if (r.failed) continue;
    const d = (r.flopTotal - r.flopDone) / speed;
    if (Number.isFinite(d) && (best === null || d < best)) best = d;
  }
  return best;
}

// ---------- Награды ----------

export interface Reward {
  /** Деньги в единицах года (data/eventKit.ts): 2017 - $100 тыс., 2024 - $10 млн. */
  moneyK?: number;
  reputation?: number;
  hype?: number;
  /** Аренда дешевле: множитель цены аренды на days дней. */
  rentMult?: number;
  /** Исследования дешевле: множитель цены исследований на days дней. */
  researchMult?: number;
  days?: number;
}

export interface Penalty {
  reputation?: number;
  hype?: number;
}

export function rewardMoney(r: Reward, year: number): number {
  return r.moneyK ? amountForYear(year, r.moneyK) : 0;
}

const pctOff = (mult: number): number => Math.round((1 - mult) * 100);

/** «+$150 тыс.», «+15 шумихи, +2 репутации», «аренда дешевле на 10 % на 90 дней». */
export function rewardText(r: Reward, year: number): string {
  const parts: string[] = [];
  const money = rewardMoney(r, year);
  if (money > 0) parts.push(`+${usd(money)}`);
  if (r.reputation) parts.push(`+${r.reputation} репутации`);
  if (r.hype) parts.push(`+${r.hype} шумихи`);
  const days = r.days ?? 0;
  const span = `${days} ${ruPlural(days, 'день', 'дня', 'дней')}`;
  if (r.rentMult) parts.push(`аренда дешевле на ${pctOff(r.rentMult)} % на ${span}`);
  if (r.researchMult) parts.push(`исследования дешевле на ${pctOff(r.researchMult)} % на ${span}`);
  return parts.join(', ');
}

/** Короткая запись награды для боковой панели: «+$150 тыс.», «+10 шумихи», «аренда -8 %». */
export function rewardShort(r: Reward, year: number): string {
  const parts: string[] = [];
  const money = rewardMoney(r, year);
  if (money > 0) parts.push(`+${usd(money)}`);
  if (r.reputation) parts.push(`+${r.reputation} репутации`);
  if (r.hype) parts.push(`+${r.hype} шумихи`);
  if (r.rentMult) parts.push(`аренда -${pctOff(r.rentMult)} %`);
  if (r.researchMult) parts.push(`исследования -${pctOff(r.researchMult)} %`);
  return parts.join(', ');
}

/** Первая буква строки - заглавная: «аренда дешевле…» в начале строки. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «-5 репутации, -10 шумихи». */
export function penaltyText(p: Penalty | undefined): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.reputation) parts.push(`-${p.reputation} репутации`);
  if (p.hype) parts.push(`-${p.hype} шумихи`);
  return parts.join(', ');
}

/** Префикс модификаторов-наград: интерфейс показывает их «бонусами» в боковой панели. */
export const BONUS_PREFIX = 'bonus-';

/** Выдать награду. tag - подпись летящей суммы в интерфейсе. Деньги - не выручка: на итог без инвесторов не влияют. */
export function giveReward(s: GameState, r: Reward, year: number, source: string): void {
  const money = rewardMoney(r, year);
  if (money > 0) earn(s, 'investors', money, 'Награда');
  if (r.reputation) s.reputation = clamp100(s.reputation + r.reputation);
  if (r.hype) s.hype.player = clamp100(s.hype.player + r.hype);
  const until = s.day + (r.days ?? 0);
  if (r.rentMult) addModifier(s, { id: `${BONUS_PREFIX}rent-${source}`, kind: 'rentPrice', mult: r.rentMult, untilDay: until });
  if (r.researchMult) addModifier(s, { id: `${BONUS_PREFIX}research-${source}`, kind: 'researchCost', mult: r.researchMult, untilDay: until });
}

export function applyPenalty(s: GameState, p: Penalty | undefined): void {
  if (!p) return;
  if (p.reputation) s.reputation = clamp100(s.reputation - p.reputation);
  if (p.hype) s.hype.player = clamp100(s.hype.player - p.hype);
}

/** Действующий бонус для интерфейса: «Аренда дешевле на 10 %», до какого дня. */
export interface ActiveBonus {
  id: string;
  text: string;
  untilDay: number;
}

export function activeBonuses(s: GameState): ActiveBonus[] {
  const out: ActiveBonus[] = [];
  for (const m of s.modifiers) {
    if (!m.id.startsWith(BONUS_PREFIX) || m.untilDay < s.day || m.mult === undefined) continue;
    const what = m.kind === 'rentPrice' ? 'Аренда' : m.kind === 'researchCost' ? 'Исследования' : null;
    if (!what) continue;
    out.push({ id: m.id, text: `${what} дешевле на ${pctOff(m.mult)} %`, untilDay: m.untilDay });
  }
  return out;
}

/** «до 12.04.2019». */
export function untilText(day: number): string {
  return `до ${formatDateShort(day)}`;
}
