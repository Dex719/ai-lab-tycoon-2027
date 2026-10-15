// Газетные «моменты» новых систем: финальный рывок отбит, главный соперник обойдён, первая покупка стартапа.
// Только тексты и условия (без React): Moments.tsx показывает полосу один раз за партию по флагу moment:<id>.

import { startupDef } from '../data/deals';
import { LABS } from '../data/labs';
import { dealMoney } from '../sim/deals';
import { FINALE_START, finaleThreats, pushesText } from '../sim/finale';
import type { ArenaStanding } from '../sim/leaderboard';
import { END_DAY } from '../sim/time';
import type { GameState, LabId } from '../sim/types';
import { fmtDays, fmtInt } from './format';

export interface LateMoment {
  id: 'push-held' | 'main-rival' | 'startup';
  kicker: string;
  headline: string;
  sub: string;
  body: string;
  art: 'push' | 'swap' | 'deal';
}

const labName = (id: LabId | string): string => LABS.find((l) => l.id === id)?.name ?? id;

/** Рывок отбит: рывок соперника в финале состоялся за последние 2 недели, а лаборатория по-прежнему первая на «Арене». */
function pushHeld(s: GameState, st: ArenaStanding | null): LateMoment | null {
  if (s.day < FINALE_START || s.outcome || !st || st.rank !== 1 || st.metric.kind !== 'arena') return null;
  const threats = finaleThreats(s);
  const t = threats.find((x) => x.kind !== 'release' && x.done && s.day - x.day <= 14 && x.elo < st.value);
  if (!t) return null;
  const pending = threats.filter((x) => x.kind !== 'release' && !x.done).length;
  const lab = labName(t.lab);
  return {
    id: 'push-held',
    kicker: 'Финал',
    headline: `«${s.labName}» удержала первое место`,
    sub:
      `${lab} ${t.kind === 'push-update' ? 'обновила' : 'выпустила'} ${t.name}: ${fmtInt(t.elo)} Эло. ` +
      `Модель «${st.modelName}» выше: ${fmtInt(st.value)} Эло.`,
    body:
      (pending > 0 ? `Объявлен ещё ${pushesText(pending)}. ` : 'Других объявленных рывков нет. ') +
      `До итогов гонки ${fmtDays(Math.max(0, END_DAY - s.day))}.`,
    art: 'push',
  };
}

/** Главный соперник обойдён: обгон за последнюю неделю, после того как лаборатория стала главным соперником. */
function mainRivalPassed(s: GameState, st: ArenaStanding | null): LateMoment | null {
  const d = s.duel;
  const main = d?.main;
  if (!d || !main || d.mainSince === null || !st || s.outcome) return null;
  const score = d.labs[main];
  if (!score || score.youPassed < 1 || score.lastDay === null || score.lastDay < d.mainSince || s.day - score.lastDay > 7) return null;
  if (st.ahead.some((n) => n.lab === main)) return null; // их модель всё ещё выше
  const theirs = st.behind.find((n) => n.lab === main);
  if (!theirs) return null;
  const lab = labName(main);
  const where = st.metric.kind === 'arena' ? 'на «Арене»' : `в тесте ${st.metric.name}`;
  return {
    id: 'main-rival',
    kicker: 'Соперники',
    headline: `«${s.labName}» обошла ${lab}`,
    sub: `Модель «${st.modelName}» выше ${theirs.name} ${where}.`,
    body: `${lab} - главный соперник лаборатории. Счёт обгонов: «${s.labName}» - ${score.youPassed}, ${lab} - ${score.passedYou}.`,
    art: 'swap',
  };
}

/** Крупная сделка: первый купленный стартап. */
function startupBought(s: GameState): LateMoment | null {
  const deal = s.late?.startups.find((x) => x.status === 'bought');
  if (!deal || s.outcome) return null;
  const def = startupDef(deal.id);
  return {
    id: 'startup',
    kicker: 'Сделки',
    headline: `«${s.labName}» купила ${def.name}`,
    sub: `Сделка на ${dealMoney(def.price)}: ${def.what}.`,
    body: `${def.effect}. Без этой сделки стартап достался бы ${labName(def.rival)}.`,
    art: 'deal',
  };
}

/** Моменты новых систем, которые сейчас выполнены (показан или нет - решает флаг). */
export function lateMoments(s: GameState, st: ArenaStanding | null): LateMoment[] {
  return [pushHeld(s, st), mainRivalPassed(s, st), startupBought(s)].filter((m): m is LateMoment => m !== null);
}
