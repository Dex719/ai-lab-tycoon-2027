// Отзывы о модели (идея «Вовлечение», 18.10): через 7 и 30 дней после выпуска приходит письмо, что о модели говорят
// пользователи. Отзывы берут настоящие баллы, а не показанные: если модель подогнана под тесты, люди это замечают.
// Через неделю - место на «Арене», сильная и слабая сторона, разница между таблицей и работой; хорошие отзывы
// немного поднимают шумиху, подгонка - опускает. Через месяц - итог: место сейчас и неделю назад, выручка, уязвимости.
// Только у моделей, обученных из окна игры (TrainingPlan.checkpoint): боты баланса играют как раньше.

import { benchDef, introducedBenchmarks } from './benchmarks';
import { addMail } from './events';
import { arenaRank, benchRank } from './leaderboard';
import { modelScore } from './training';
import type { GameState, PlayerModel } from './types';

export const REVIEW_WEEK_DAYS = 7;
export const REVIEW_MONTH_DAYS = 30;
/** Разница показанного и настоящего балла, которую пользователи замечают, пунктов. */
export const REVIEW_GAP_NOTICED = 5;
const GOOD_HYPE = 3;
const GAP_HYPE = 3;

const DOMAIN_GEN: Record<string, string> = { language: 'текстах', code: 'коде', reasoning: 'математике и науке' };

function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

/** Наибольшая разница показанного и настоящего балла на целевых тестах модели: тест и пункты. */
export function overfitGap(s: GameState, m: PlayerModel): { name: string; gap: number } | null {
  let best: { name: string; gap: number } | null = null;
  for (const bid of m.plan.benchTargets) {
    if (!s.benchmarks[bid]?.introduced) continue;
    const gap = modelScore(m, bid, false) - modelScore(m, bid, true);
    if (gap > 0 && (!best || gap > best.gap)) best = { name: benchDef(bid).name, gap };
  }
  return best;
}

/** Сильная и слабая область по настоящим местам на тестах. */
function sides(s: GameState, m: PlayerModel): { strong: string; weak: string } | null {
  const ref = { kind: 'player' as const, id: m.id };
  const byDomain = new Map<string, number>();
  for (const bid of introducedBenchmarks(s)) {
    const r = benchRank(s, ref, bid);
    if (r === null) continue;
    const d = benchDef(bid).domain;
    byDomain.set(d, Math.min(byDomain.get(d) ?? Infinity, r));
  }
  if (byDomain.size < 2) return null;
  const list = [...byDomain.entries()].sort((a, b) => a[1] - b[1]);
  return { strong: DOMAIN_GEN[list[0][0]] ?? list[0][0], weak: DOMAIN_GEN[list.at(-1)![0]] ?? list.at(-1)![0] };
}

function verdict(rank: number | null): string {
  if (rank === 1) return 'Пользователи называют модель лучшей на «Арене»';
  if (rank !== null && rank <= 3) return `Модель ставят в число лучших: ${rank}-е место на «Арене»`;
  if (rank !== null && rank <= 8) return `Отзывы спокойные: ${rank}-е место на «Арене», есть модели сильнее`;
  return 'Отзывов немного: модель теряется среди сильных соперников';
}

function weekReview(s: GameState, m: PlayerModel): void {
  const rank = arenaRank(s, { kind: 'player', id: m.id });
  m.weekRank = rank ?? undefined;
  const gap = overfitGap(s, m);
  const noticed = gap !== null && gap.gap >= REVIEW_GAP_NOTICED && !m.exposed;
  const sd = sides(s, m);
  const lines = [`${verdict(rank)}.`];
  if (sd) lines.push(`Сильнее всего она в ${sd.strong}, слабее - в ${sd.weak}.`);
  if (noticed) lines.push(`В работе модель слабее, чем в таблице: на тесте ${gap.name} разница около ${Math.round(gap.gap)} пунктов, и пользователи это заметили. Шумиха -${GAP_HYPE}.`);
  else if (rank !== null && rank <= 3) lines.push(`Хорошие отзывы расходятся по сети: шумиха +${GOOD_HYPE}.`);
  if (noticed) s.hype.player = Math.max(0, s.hype.player - GAP_HYPE);
  else if (rank !== null && rank <= 3) s.hype.player = Math.min(100, s.hype.player + GOOD_HYPE);
  addMail(s, { kind: 'news', title: `Отзывы о «${m.name}»: первая неделя`, body: lines.join(' ') });
}

function monthReview(s: GameState, m: PlayerModel): void {
  const rank = arenaRank(s, { kind: 'player', id: m.id });
  const was = m.weekRank;
  const lines: string[] = [];
  if (rank !== null) {
    const move = was === undefined || was === rank ? '' : rank < was ? `, поднялась с ${was}-го` : `, опустилась с ${was}-го`;
    lines.push(`Сейчас «${m.name}» на ${rank}-м месте «Арены»${move}.`);
  }
  lines.push(`За месяц модель заработала ${fmtMoney(m.earned)}${m.earnedSubs > 0 ? `, из них по подписке ${fmtMoney(m.earnedSubs)}` : ''}.`);
  if (m.holes !== undefined) {
    lines.push(m.holes === 0 ? 'Известных уязвимостей не осталось.' : m.redTeamDone ? 'После проверки уязвимостей осталось немного.' : 'Модель не проверяли: в ней могут быть лазейки.');
  }
  addMail(s, { kind: 'news', read: true, title: `Отзывы о «${m.name}»: месяц в продаже`, body: lines.join(' ') });
}

/** Ежедневно: отзывы через 7 и 30 дней после выпуска. */
export function reviewsDay(s: GameState): void {
  for (const m of s.models) {
    if (m.releasedDay === null || m.plan.checkpoint === undefined) continue;
    const age = s.day - m.releasedDay;
    const sent = m.reviewsSent ?? 0;
    // Старые модели (выпущены до отзывов) писем не получают: окно - до следующего отзыва.
    if (sent === 0 && age >= REVIEW_WEEK_DAYS && age < REVIEW_MONTH_DAYS) {
      m.reviewsSent = 1;
      weekReview(s, m);
    } else if (sent <= 1 && age >= REVIEW_MONTH_DAYS && age < REVIEW_MONTH_DAYS * 2) {
      m.reviewsSent = 2;
      monthReview(s, m);
    }
  }
}
