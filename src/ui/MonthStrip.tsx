// Итог месяца: полоска над панелью задач на 3,5 с - выручка, доля рынка, место в гонке и ближайшая цель года.

import { useEffect, useRef, useState } from 'react';
import { goalProgress } from '../sim/goals';
import type { GameState, MonthRecord } from '../sim/types';
import { raceName, standingOf } from './ArenaFeedback';
import { fmtMoney, fmtShare } from './format';
import './month.css';

const SHOW_MS = 3500;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

interface Strip {
  key: number;
  title: string;
  revenue: number;
  revenueDelta: number | null; // доля изменения к прошлому месяцу
  share: number;
  shareDelta: number | null; // в процентных пунктах (0..1)
  race: string | null;
  rankFrom: number | null;
  rankTo: number | null;
  goal: { title: string; pct: number } | null;
}

function revenueOf(h: MonthRecord | undefined): number {
  return h ? h.income.api + h.income.subs + h.income.contracts : 0;
}

/** Цвет изменения: good / bad или пусто, если не изменилось. invert - рост плохо (место: меньше - лучше). */
function tone(v: number | null, invert = false): string {
  if (v === null || Math.abs(v) < 1e-9) return '';
  return (invert ? v < 0 : v > 0) ? ' good' : ' bad';
}

export function MonthStrip({ s }: { s: GameState }) {
  const seen = useRef<{ state: GameState; months: number; rank: number | null } | null>(null);
  const [strip, setStrip] = useState<Strip | null>(null);
  const months = s.finance.history.length;

  useEffect(() => {
    const st = standingOf(s);
    const p = seen.current;
    seen.current = { state: s, months, rank: st?.rank ?? null };
    if (!p || p.state !== s || months <= p.months) return;
    const h = s.finance.history;
    const cur = h[h.length - 1];
    const prev = h[h.length - 2];
    const rev = revenueOf(cur);
    const prevRev = revenueOf(prev);
    let goal: Strip['goal'] = null;
    for (const g of s.yearly.goals) {
      if (g.done) continue;
      const gp = goalProgress(s, g);
      if (!gp || gp.progress.done) continue; // выполнена, но ещё не засчитана (проверка раз в неделю)
      const pct = Math.floor(gp.progress.fraction * 100);
      if (!goal || pct > goal.pct) goal = { title: gp.def.title(s.yearly.year), pct };
    }
    setStrip({
      key: months,
      title: `${MONTHS[cur.month - 1]} ${cur.year}`,
      revenue: rev,
      revenueDelta: prev && prevRev > 0 ? rev / prevRev - 1 : null,
      share: cur.marketShare,
      shareDelta: prev ? cur.marketShare - prev.marketShare : null,
      race: st ? raceName(st.metric) : null,
      rankFrom: p.rank,
      rankTo: st?.rank ?? null,
      goal,
    });
  }, [s, months]);

  useEffect(() => {
    if (!strip) return;
    const id = window.setTimeout(() => setStrip(null), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [strip]);

  if (!strip) return null;
  const rankDelta = strip.rankFrom !== null && strip.rankTo !== null ? strip.rankTo - strip.rankFrom : null;
  return (
    <div key={strip.key} className="month-strip" role="status" onClick={() => setStrip(null)}>
      <span className="ms-title">{strip.title}</span>
      <span className="ms-item">
        <span className="ms-k">Выручка</span>
        <span className="ms-v">
          {fmtMoney(strip.revenue)}
          {strip.revenueDelta !== null && Math.abs(strip.revenueDelta) >= 0.005 && (
            <small className={strip.revenueDelta > 0 ? 'good' : 'bad'}>
              {strip.revenueDelta > 0 ? '+' : '−'}
              {Math.round(Math.abs(strip.revenueDelta) * 100)} %
            </small>
          )}
        </span>
      </span>
      <span className="ms-item">
        <span className="ms-k">Доля рынка</span>
        <span className={`ms-v${tone(strip.shareDelta !== null && Math.abs(strip.shareDelta) >= 0.0005 ? strip.shareDelta : null)}`}>
          {fmtShare(strip.share, 1)}
        </span>
      </span>
      {strip.race && strip.rankTo !== null && (
        <span className="ms-item">
          <span className="ms-k">{strip.race}</span>
          <span className={`ms-v${tone(rankDelta, true)}`}>
            {rankDelta ? (
              <>
                {strip.rankFrom} → {strip.rankTo}-е
              </>
            ) : (
              <>{strip.rankTo}-е</>
            )}
          </span>
        </span>
      )}
      {strip.goal && (
        <span className="ms-item ms-goal">
          <span className="ms-k">Цель: {strip.goal.title}</span>
          <span className="ms-bar">
            <i style={{ width: `${strip.goal.pct}%` }} />
            <em>{strip.goal.pct} %</em>
          </span>
        </span>
      )}
    </div>
  );
}
