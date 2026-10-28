// «Кого выбирают клиенты»: раз в месяц сравнивает доли рынка по сегментам с прошлым месяцем и показывает одно
// уведомление - компания перешла на вашу модель, разработчики ушли к сопернику, вы стали лабораторией, которую
// выбирают чаще всех. Симуляцию не трогает: только читает состояние рынка.

import { useEffect, useRef } from 'react';
import { CLIENTS } from '../data/clients';
import { LABS } from '../data/labs';
import type { GameState, LabId, SegmentId } from '../sim/types';
import { SEGMENT_IDS } from '../sim/types';
import { playSound } from './sound';
import { pushNotice, type Notice } from './Toasts';

/** Сдвиг доли в сегменте за месяц, при котором о нём стоит сказать: 3 процентных пункта. */
export const FEED_STEP = 0.03;

type Shares = Record<SegmentId, Record<string, number>> & { total: Record<string, number> };

export function sharesOf(s: GameState): Shares {
  const seg = (id: SegmentId) => ({ ...(s.market.segments[id]?.labShares ?? {}) });
  return { total: { ...s.market.labShares }, consumers: seg('consumers'), enterprise: seg('enterprise'), developers: seg('developers') };
}

const LAB_NAME = new Map<string, string>(LABS.map((l) => [l.id, l.name]));

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

/** Лучшая модель игрока в продаже по API (её называют в новости), или null. */
function bestOnApi(s: GameState): string | null {
  let best: { name: string; elo: number } | null = null;
  for (const m of s.models) if (m.releasedDay !== null && m.onApi && (!best || m.arenaElo > best.elo)) best = { name: m.name, elo: m.arenaElo };
  return best?.name ?? null;
}

/** Соперник, у которого доля изменилась сильнее всего в нужную сторону (sign = -1 - потерял, +1 - получил). */
function topMover(prev: Record<string, number>, cur: Record<string, number>, sign: 1 | -1): { lab: LabId; delta: number } | null {
  let best: { lab: LabId; delta: number } | null = null;
  for (const l of LABS) {
    const d = ((cur[l.id] ?? 0) - (prev[l.id] ?? 0)) * sign;
    if (d > 0 && (!best || d > best.delta)) best = { lab: l.id, delta: d };
  }
  return best;
}

/** Самая большая доля среди соперников: [лаборатория, доля]. */
function rivalLeader(shares: Record<string, number>): [LabId, number] | null {
  let best: [LabId, number] | null = null;
  for (const l of LABS) {
    const v = shares[l.id] ?? 0;
    if (!best || v > best[1]) best = [l.id, v];
  }
  return best;
}

/**
 * Новость месяца о клиентах или null. Порядок: смена лидера по клиентам, затем самый большой приход или уход в одном
 * сегменте. month - номер месяца (для выбора компании из списка клиентов без случайности).
 */
export function clientNews(s: GameState, prev: Shares, cur: Shares, month: number): Notice | null {
  const model = bestOnApi(s);
  if (!model) return null;
  const meNow = cur.total.player ?? 0;
  const mePrev = prev.total.player ?? 0;
  const rivNow = rivalLeader(cur.total);
  const rivPrev = rivalLeader(prev.total);
  const leadNow = meNow > 0.005 && (!rivNow || meNow > rivNow[1]);
  const leadPrev = mePrev > 0.005 && (!rivPrev || mePrev > rivPrev[1]);
  if (leadNow && !leadPrev) {
    return { kind: 'contract', label: 'Клиенты', title: `Вас выбирают чаще всех: ${pct(meNow)} клиентов`, tone: 'reward', win: 'market' };
  }
  if (!leadNow && leadPrev && rivNow) {
    return {
      kind: 'rival',
      label: 'Клиенты',
      title: `${LAB_NAME.get(rivNow[0])} обогнала вас по клиентам: ${pct(rivNow[1])} против ${pct(meNow)}`,
      tone: 'bad',
      win: 'market',
      from: rivNow[0],
    };
  }
  // Самый заметный сдвиг доли игрока в одном сегменте.
  let pick: { seg: SegmentId; delta: number } | null = null;
  for (const seg of SEGMENT_IDS) {
    const d = (cur[seg].player ?? 0) - (prev[seg].player ?? 0);
    if (Math.abs(d) >= FEED_STEP && (!pick || Math.abs(d) > Math.abs(pick.delta))) pick = { seg, delta: d };
  }
  if (!pick) return null;
  const gain = pick.delta > 0;
  const rival = topMover(prev[pick.seg], cur[pick.seg], gain ? -1 : 1);
  const rivalName = rival ? LAB_NAME.get(rival.lab) : null;
  const client = CLIENTS[(month * 7 + SEGMENT_IDS.indexOf(pick.seg)) % CLIENTS.length].name;
  const pp = `${Math.round(Math.abs(pick.delta) * 100)} %`;
  let title: string;
  if (pick.seg === 'enterprise') {
    title = gain
      ? `${client} ${rivalName ? `переходит с ${rivalName} ` : 'переходит '}на «${model}»`
      : `${client} уходит${rivalName ? ` к ${rivalName}` : ' от вас'}`;
  } else if (pick.seg === 'developers') {
    title = gain
      ? `Разработчики выбирают «${model}»${rivalName ? ` вместо ${rivalName}` : ''}: +${pp} доли`
      : `Разработчики уходят${rivalName ? ` к ${rivalName}` : ''}: -${pp} доли`;
  } else {
    title = gain
      ? `Пользователи чатов выбирают «${model}»: +${pp} доли`
      : `Пользователи чатов уходят${rivalName ? ` к ${rivalName}` : ''}: -${pp} доли`;
  }
  return { kind: gain ? 'contract' : 'rival', label: 'Клиенты', title, tone: gain ? 'good' : 'bad', win: 'market', from: gain ? undefined : rival?.lab };
}

/** Невидимый компонент партии: на закрытии месяца сравнивает доли и показывает новость о клиентах. */
export function ClientFeed({ s }: { s: GameState }) {
  const prev = useRef<{ state: GameState; months: number; shares: Shares } | null>(null);
  useEffect(() => {
    const months = s.finance.history.length;
    const p = prev.current;
    if (!p || p.state !== s || months < p.months) {
      prev.current = { state: s, months, shares: sharesOf(s) };
      return;
    }
    if (months === p.months) return;
    const cur = sharesOf(s);
    const n = clientNews(s, p.shares, cur, months);
    prev.current = { state: s, months, shares: cur };
    if (!n) return;
    pushNotice(n);
    playSound(n.tone === 'reward' ? 'first' : n.tone === 'good' ? 'coin' : 'rankDown');
  });
  return null;
}
