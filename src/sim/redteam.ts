// Ред-тиминг и скрытые уязвимости моделей (идея «Безопасность», 18.10). У каждой модели, обученной из окна игры, есть
// скрытые дыры: способы обойти её запреты. Пока модель в продаже, каждый месяц дыра может всплыть - инцидент в новостях:
// репутация и шумиха ниже, дыра закрывается. Ред-тиминг (быстрый или полный) находит и закрывает часть дыр заранее,
// отчёт говорит, сколько примерно осталось. Безопасность так становится выбором (выпустить сразу или проверить),
// а не налогом. Боты баланса и старые планы (без TrainingPlan.checkpoint) - без дыр.

import { addMail } from './events';
import { spend } from './finance';
import { byYear, formatDateShort, yearOf } from './time';
import type { GameState, PlayerModel, RedTeamMode, Result } from './types';

/** Дыр у новой модели: лёгкая 3, средняя 4, флагман 5; на чужих данных +1, с RLHF -1. */
export function holesAtBirth(m: Pick<PlayerModel, 'plan' | 'rlhf'>): number {
  const base = m.plan.tier === 'flagship' ? 5 : m.plan.tier === 'mid' ? 4 : 3;
  return Math.max(1, base + (m.plan.stolenData ? 1 : 0) - (m.rlhf ? 1 : 0));
}

export const REDTEAM: Record<RedTeamMode, { name: string; days: number; fix: number; costK: number }> = {
  quick: { name: 'Быстрый', days: 7, fix: 0.5, costK: 0.15 },
  full: { name: 'Полный', days: 21, fix: 0.85, costK: 0.5 },
};

/** Денежная единица года для цен проверки (как у писем, data/eventKit). */
const UNIT: Record<number, number> = { 2017: 100_000, 2018: 150_000, 2019: 250_000, 2020: 500_000, 2021: 1_000_000, 2022: 2_000_000, 2023: 5_000_000, 2024: 10_000_000 };

export function redTeamCost(s: GameState, mode: RedTeamMode): number {
  return Math.round((byYear(UNIT, yearOf(s.day)) * REDTEAM[mode].costK) / 1000) * 1000;
}

/** Шанс, что дыра всплывёт за месяц, для модели в продаже: 2,5 % за каждую дыру. */
export const HOLE_MONTHLY = 0.025;
export const INCIDENT_REP = 4;
export const INCIDENT_HYPE = 6;

function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

export function redTeamBlock(s: GameState, m: PlayerModel, mode: RedTeamMode): string | null {
  if (m.holes === undefined) return 'Модель обучена до появления проверок';
  if (m.redTeam) return `Проверка идёт до ${formatDateShort(m.redTeam.endDay)}`;
  if (m.holes === 0 && m.redTeamDone) return 'Проверка уже нашла все уязвимости';
  const cost = redTeamCost(s, mode);
  if (s.cash < cost) return `Не хватает денег: нужно ${fmtMoney(cost)}`;
  return null;
}

/** Действие: начать ред-тиминг модели (до выпуска или в продаже). */
export function startRedTeam(s: GameState, modelId: string, mode: RedTeamMode): Result {
  const m = s.models.find((x) => x.id === modelId);
  if (!m) return { ok: false, error: 'Нет такой модели' };
  const block = redTeamBlock(s, m, mode);
  if (block) return { ok: false, error: block };
  spend(s, 'review', redTeamCost(s, mode));
  m.redTeam = { mode, endDay: s.day + REDTEAM[mode].days };
  return { ok: true };
}

/** Ежедневно: закончить проверки - закрыть часть дыр, письмо-отчёт. */
export function redTeamDay(s: GameState): void {
  for (const m of s.models) {
    if (!m.redTeam || s.day < m.redTeam.endDay || m.holes === undefined) continue;
    const mode = m.redTeam.mode;
    const before = m.holes;
    const fixed = Math.min(before, Math.round(before * REDTEAM[mode].fix));
    m.holes = before - fixed;
    m.redTeam = undefined;
    m.redTeamDone = true;
    const left = m.holes === 0 ? 'уязвимостей не осталось' : m.holes === 1 ? 'осталась примерно одна' : `осталось примерно ${m.holes}`;
    addMail(s, {
      kind: 'training',
      title: `Ред-тиминг «${m.name}»: найдено ${before}, закрыто ${fixed}`,
      body: `${REDTEAM[mode].name} ред-тиминг закончен: найдено уязвимостей ${before}, закрыто ${fixed}, ${left}. Каждая оставшаяся может всплыть, пока модель в продаже.`,
    });
  }
}

function roll(s: GameState, m: PlayerModel): number {
  const n = Number(m.id.slice(1)) || 0;
  const h = Math.imul((s.seed ^ Math.imul(n + 7, 0x27d4eb2f) ^ Math.imul(s.day, 0x165667b1)) >>> 0, 0x85ebca77) >>> 0;
  return (h % 100_000) / 100_000;
}

/** Конец месяца: у моделей в продаже дыра может всплыть - инцидент. Жребий по зерну, общий поток случайности не трогаем. */
export function holesMonth(s: GameState): void {
  for (const m of s.models) {
    if (m.releasedDay === null || !(m.onApi || m.onSubs) || !m.holes) continue;
    if (roll(s, m) >= m.holes * HOLE_MONTHLY) continue;
    m.holes -= 1;
    s.reputation = Math.max(0, s.reputation - INCIDENT_REP);
    s.hype.player = Math.max(0, s.hype.player - INCIDENT_HYPE);
    addMail(s, {
      kind: 'news',
      title: `Пользователи обошли запреты «${m.name}»`,
      body:
        `В сети разошлись примеры, как заставить «${m.name}» отвечать на запрещённые вопросы. Лазейку закрыли, но о ней уже пишут: ` +
        `репутация −${INCIDENT_REP}, шумиха −${INCIDENT_HYPE}. Ред-тиминг до выпуска находит такие лазейки заранее.`,
    });
  }
}
