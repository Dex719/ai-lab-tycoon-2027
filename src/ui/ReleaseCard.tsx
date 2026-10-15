// Карточка выпуска модели (как model card лаборатории): Эло растёт отсчётом, место в гонке, кого модель обогнала, таблица тестов.

import { useEffect, useState } from 'react';
import { LABS } from '../data/labs';
import { activeBenchmarks, benchDef } from '../sim/benchmarks';
import { arenaStanding, benchRank, marketArenaRank, raceValue } from '../sim/leaderboard';
import { modelScore } from '../sim/training';
import type { GameState, HypeOwner, PlayerModel } from '../sim/types';
import { fmtGap, fmtValue, raceName } from './ArenaFeedback';
import { useModalFocus } from './components/common';
import { IconClose, IconTrophy } from './icons';
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

  const placeSub = !metric
    ? 'Соперников пока нет'
    : isBest && st.above
      ? `До ${st.above.name}: ${fmtGap(metric, st.above.gap)}`
      : isBest
        ? 'Впереди никого'
        : `Ваша лучшая модель - «${st?.modelName}»`;

  return (
    <div className="modal-backdrop rc-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        className={`dialog rc ${m.plan.tier}${first ? ' first' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Модель «${m.name}» выпущена`}
        onKeyDown={onKeyDown}
      >
        <div className="titlebar">
          <span className="t">Модель выпущена</span>
          <button className="wbtn close" onClick={onClose} aria-label="Закрыть" title="Закрыть">
            <IconClose size={14} />
          </button>
        </div>
        <div className="body rc-body">
          <div className="rc-id">
            <h2 className="rc-name">{m.name}</h2>
            <TierBadge tier={m.plan.tier} />
          </div>
          <div className="rc-meta">
            {fmtNum(m.plan.paramsB * 1e9)} параметров · контекст {fmtInt(m.plan.context)} · {fmtMoney(m.price)} за 1 млн токенов
          </div>

          <div className="rc-main">
            <div className="rc-elo">
              <span className="rc-big">{fmtInt(shownElo)}</span>
              <span className="rc-l">Эло на «Арене»</span>
              <span className={`rc-sub ${eloDelta !== null && eloDelta > 0 ? 'good' : eloDelta !== null && eloDelta < 0 ? 'bad' : ''}`}>
                {eloDelta === null ? 'Первая модель в продаже' : `${eloDelta >= 0 ? '+' : '−'}${fmtInt(Math.abs(eloDelta))} к «${prev?.name}»`}
              </span>
            </div>
            <div className="rc-place">
              <span className={`rc-mid${place === 1 ? ' gold' : place === null ? ' dim' : ''}`}>
                {place === 1 && <IconTrophy size={20} />}
                {place !== null ? `${place}-е место` : 'Без места'}
              </span>
              <span className="rc-l">{metric ? raceName(metric) : 'Место в гонке'}</span>
              <span className="rc-sub">{placeSub}</span>
            </div>
          </div>

          {passed.length > 0 && metric && (
            <p className="rc-pass">
              <span className="rc-l">Обогнала:</span>
              {passed.slice(0, 6).map((n, i) => (
                <span key={n.id} className="rc-rival">
                  <i className="ar-dot" style={{ background: LAB_COLOR.get(n.lab) ?? '#888' }} />
                  {n.name} <small>{fmtValue(metric, n.value)}</small>
                  {i < Math.min(passed.length, 6) - 1 ? ',' : ''}
                </span>
              ))}
              {passed.length > 6 && <span className="rc-l">и ещё {passed.length - 6}</span>}
            </p>
          )}

          {benches.length > 0 && (
            <table className="grid rc-bench">
              <thead>
                <tr>
                  <th>Тест</th>
                  <th className="num">Балл</th>
                  <th className="num">Место</th>
                </tr>
              </thead>
              <tbody>
                {benches.map((bid) => {
                  const r = benchRank(s, ref0, bid);
                  return (
                    <tr key={bid} className={r === 1 ? 'top' : undefined}>
                      <td>{benchDef(bid).name}</td>
                      <td className="num">{fmtPct(modelScore(m, bid, false), 1)}</td>
                      <td className="num">{r !== null ? `${r}-е` : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="foot">
          <button className="btn primary" onClick={onClose} autoFocus>
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
