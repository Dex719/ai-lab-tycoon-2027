// Испытания и условия мира (идея «Режимы», 18.10): выбираются в новой игре и меняют знакомую партию.
// Испытание - запрет (без инвесторов, честная лаборатория, только аренда); условие мира - постоянный модификатор
// (дефицит карт, зима ИИ, строгий регулятор, щедрые фонды). Каждое меняет множитель счёта партии (sim/ending.ts):
// трудное повышает, лёгкое снижает. Старые сохранения и боты баланса играют без них.

import { FOREVER } from './constants';
import { addModifier } from './events';
import type { ChallengeId, GameState, WorldModId } from './types';

export interface ChallengeDef {
  id: ChallengeId;
  name: string;
  text: string;
  /** Прибавка к множителю счёта. */
  score: number;
}

export interface WorldModDef {
  id: WorldModId;
  name: string;
  text: string;
  score: number;
}

export const CHALLENGES: readonly ChallengeDef[] = [
  { id: 'no-investors', name: 'Без инвесторов', text: 'Раунды инвестиций закрыты: жить на тендерах, API и подписке', score: 0.3 },
  { id: 'honest', name: 'Честная лаборатория', text: 'Без подгонки под тесты и без чужих данных', score: 0.15 },
  { id: 'rent-only', name: 'Только аренда', text: 'Свои дата-центры строить нельзя', score: 0.15 },
];

export const WORLD_MODS: readonly WorldModDef[] = [
  { id: 'gpu-shortage', name: 'Дефицит карт', text: 'Аренда карт дороже на 30 %', score: 0.15 },
  { id: 'ai-winter', name: 'Зима ИИ', text: 'Спрос на API и подписки ниже на 20 %', score: 0.15 },
  { id: 'strict-regulator', name: 'Строгий регулятор', text: 'Подгонку раскрывают в 1,5 раза чаще', score: 0.1 },
  { id: 'generous-funds', name: 'Щедрые фонды', text: 'Инвесторы оценивают дороже на 25 %', score: -0.15 },
];

export function hasChallenge(s: GameState, id: ChallengeId): boolean {
  return s.challenges?.includes(id) ?? false;
}

export function hasWorldMod(s: GameState, id: WorldModId): boolean {
  return s.worldMods?.includes(id) ?? false;
}

/** Причина запрета испытанием или null (проверки в действиях: раунды, план обучения, стройка дата-центров). */
export function challengeBlock(s: GameState, what: 'raise' | 'overfit' | 'stolen' | 'datacenter'): string | null {
  if (what === 'raise' && hasChallenge(s, 'no-investors')) return 'Испытание «Без инвесторов»: раунды закрыты';
  if ((what === 'overfit' || what === 'stolen') && hasChallenge(s, 'honest')) return 'Испытание «Честная лаборатория»: без подгонки и чужих данных';
  if (what === 'datacenter' && hasChallenge(s, 'rent-only')) return 'Испытание «Только аренда»: свои дата-центры строить нельзя';
  return null;
}

/** Множитель счёта от испытаний и условий: 1 + сумма прибавок, не ниже 0,5. */
export function challengeScoreMult(s: GameState): number {
  let k = 1;
  for (const c of CHALLENGES) if (hasChallenge(s, c.id)) k += c.score;
  for (const m of WORLD_MODS) if (hasWorldMod(s, m.id)) k += m.score;
  return Math.max(0.5, k);
}

/** Оценка компании × 1,25 при «Щедрых фондах». */
export function worldValuationMult(s: GameState): number {
  return hasWorldMod(s, 'generous-funds') ? 1.25 : 1;
}

/** Применить выбранное в новой игре: запомнить и поставить постоянные модификаторы условий мира. */
export function applyChallenges(s: GameState, challenges: readonly ChallengeId[], mods: readonly WorldModId[]): void {
  if (challenges.length) s.challenges = [...challenges];
  if (mods.length) s.worldMods = [...mods];
  if (mods.includes('gpu-shortage')) addModifier(s, { id: 'world-gpu-shortage', kind: 'rentPrice', mult: 1.3, untilDay: FOREVER });
  if (mods.includes('ai-winter')) {
    addModifier(s, { id: 'world-ai-winter', kind: 'demand', mult: 0.8, untilDay: FOREVER });
    addModifier(s, { id: 'world-ai-winter-subs', kind: 'subsDemand', mult: 0.8, untilDay: FOREVER });
  }
  if (mods.includes('strict-regulator')) addModifier(s, { id: 'world-strict', kind: 'exposure', mult: 1.5, untilDay: FOREVER });
}
