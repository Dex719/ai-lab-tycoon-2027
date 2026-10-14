// Карточка выхода модели: Эло растёт отсчётом, место в гонке, кого модель обогнала, баллы тестов по одному.

import { useEffect, useState } from 'react';
import { LABS } from '../data/labs';
import { activeBenchmarks, benchDef } from '../sim/benchmarks';
import { arenaStanding, benchRank, marketArenaRank, raceValue } from '../sim/leaderboard';
import { modelScore } from '../sim/training';
import type { GameState, HypeOwner, PlayerModel } from '../sim/types';
import { fmtGap, fmtValue, raceName } from './ArenaFeedback';
import { useModalFocus } from './components/common';
import { TierBadge } from './components/TierBadge';
import { fmtInt, fmtMoney, fmtNum, fmtPct } from './format';
import { useCountUp } from './Juice';
import './release.css';

const LAB_COLOR = new Map<HypeOwner, string>(LABS.map((l) => [l.id, l.color]));

/** Отсчёт числа от from до to за ms после появления карточки. */
function useRise(from: number, to: number, ms: number): number {
  const [target, setTarget] = useState(from);
  useEffect(() => {
    const id = window.setTimeout(() => setTarget(to), 250);
    return () => window.clearTimeout(id);
  }, [to]);
  return useCountUp(target === from ? from : to, ms);
}

export function ReleaseCard({ s, modelId, onClose }: { s: GameState; modelId: string; onClose: () => void }) {
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(modelId);
  const m = s.models.find((x) => x.id === modelId);
  const st = arenaStanding(s);
  const metric = st?.metric ?? null;

  // Прошлая лучшая модель игрока в той же гонке: с ней сравниваем рост.
  let prev: PlayerModel | null = null;
  if (m) {
    for (const x of s.models) {
      if (x.id === m.id || x.releasedDay === null) continue;
      if (metric?.kind === 'arena' && !x.onApi) continue;
      if (!prev || (metric ? raceValue(metric, x) > raceValue(metric, prev) : x.arenaElo > prev.arenaElo)) prev = x;
    }
  }
  const elo = m?.arenaElo ?? 0;
  const prevElo = prev?.arenaElo ?? Math.round(elo * 0.6);
  const shownElo = useRise(prevElo, elo, 1100);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!m) return null;

  const ref0 = { kind: 'player' as const, id: m.id };
  const place = metric ? (metric.kind === 'arena' ? marketArenaRank(s, ref0) : benchRank(s, ref0, metric.bid)) : null;
  const isBest = !!st && st.modelId === m.id;
  const prevValue = metric && prev ? raceValue(metric, prev) : -Infinity;
  const passed = isBest && metric ? st.behind.filter((n) => n.value > prevValue) : [];
  const first = isBest && st.rank === 1;
  const benches = activeBenchmarks(s);
  const eloDelta = prev ? Math.round(elo - prev.arenaElo) : null;

  return (
    <div className="modal-backdrop rc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`rc ${m.plan.tier}${first ? ' first' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Модель «${m.name}» выпущена`}
        onKeyDown={onKeyDown}
      >
        <div className="rc-head">
          <div className="rc-kicker">Модель выпущена</div>
          <div className="rc-name">{m.name}</div>
          <div className="rc-meta">
            <TierBadge tier={m.plan.tier} />
            <span>
              {fmtNum(m.plan.paramsB * 1e9)} параметров · контекст {fmtInt(m.plan.context)}
            </span>
          </div>
          {first && <div className="rc-crown">1-е место</div>}
        </div>

        <div className="rc-tiles">
          <div className="rc-tile">
            <span className="rc-l">Эло на «Арене»</span>
            <span className="rc-big">{fmtInt(shownElo)}</span>
            <span className={`rc-sub ${eloDelta !== null && eloDelta > 0 ? 'good' : eloDelta !== null && eloDelta < 0 ? 'bad' : ''}`}>
              {eloDelta === null ? 'Первая модель в продаже' : `${eloDelta >= 0 ? '+' : '−'}${fmtInt(Math.abs(eloDelta))} к «${prev?.name}»`}
            </span>
          </div>
          <div className="rc-tile">
            <span className="rc-l">{metric ? `Место: ${raceName(metric)}` : 'Место в гонке'}</span>
            <span className={`rc-big${place === 1 ? ' gold' : ''}`}>{place !== null ? `${place}-е` : '-'}</span>
            <span className="rc-sub">
              {!metric
                ? 'Соперников пока нет'
                : isBest && st.above
                  ? `До ${st.above.name}: ${fmtGap(metric, st.above.gap)}`
                  : isBest
                    ? 'Впереди никого'
                    : `Ваша лучшая модель - «${st?.modelName}»`}
            </span>
          </div>
        </div>

        {passed.length > 0 && metric && (
          <div className="rc-row">
            <span className="rc-l">Обгоняет</span>
            <div className="rc-chips">
              {passed.slice(0, 6).map((n, i) => (
                <span key={n.id} className="rc-chip pass" style={{ animationDelay: `${0.5 + i * 0.12}s` }}>
                  <i className="ar-dot" style={{ background: LAB_COLOR.get(n.lab) ?? '#888' }} />
                  {n.name}
                  <small>{fmtValue(metric, n.value)}</small>
                </span>
              ))}
              {passed.length > 6 && <span className="rc-more">и ещё {passed.length - 6}</span>}
            </div>
          </div>
        )}

        {benches.length > 0 && (
          <div className="rc-row">
            <span className="rc-l">Тесты</span>
            <div className="rc-chips">
              {benches.map((bid, i) => {
                const r = benchRank(s, ref0, bid);
                return (
                  <span key={bid} className={`rc-chip bench${r === 1 ? ' top' : ''}`} style={{ animationDelay: `${0.9 + i * 0.15}s` }}>
                    {benchDef(bid).name}
                    <b>{fmtPct(modelScore(m, bid, false), 1)}</b>
                    {r !== null && <small>{r}-е</small>}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="rc-foot">
          <span className="rc-price">Цена: {fmtMoney(m.price)} за 1 млн токенов</span>
          <button className="btn primary" onClick={onClose} autoFocus>
            Отлично
          </button>
        </div>
      </div>
    </div>
  );
}
