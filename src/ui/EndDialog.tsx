// Итог партии: победа, конец 2024 года или банкротство (FR-1.4, FR-1.5).
// Главное место, график Эло против лучшего соперника по месяцам, ваши моменты и то, чего лаборатория добилась.

import { useEffect } from 'react';
import { LABS } from '../data/labs';
import { valuation } from '../sim/investors';
import { leaderboard, rivalsSellByApi } from '../sim/leaderboard';
import { DIFFICULTY } from '../sim/rivalry';
import { subsOpen } from '../sim/market';
import { ARENA_PLACE_TITLE, bestArenaPlace } from './arena';
import { formatDate } from '../sim/time';
import type { GameState, MonthRecord } from '../sim/types';
import { useModalFocus } from './components/common';
import { IconClose, IconTrophy } from './icons';
import { fmtElo, fmtMoney, fmtNum, fmtShare } from './format';
import { fmtRank } from './labels';
import { playSound } from './sound';
import { store } from './store';
import './end.css';

/** Названия моментов для итогового окна (флаги moment:<id>, см. Moments.tsx). */
const MOMENT_TITLES: Record<string, string> = {
  'attention-first': 'Механизм внимания раньше Gogle',
  'first-place-bench': 'Первое место в гонке по тестам',
  'first-place-arena': 'Первое место на «Арене»',
  'first-rlhf': 'Первая чат-модель',
  'chat-moment': 'Свой «момент ChatGTP»',
};

function revenueOf(h: MonthRecord): number {
  return h.income.api + h.income.subs + h.income.contracts;
}

/** График по месяцам: Эло лучшей модели лаборатории и лучшей модели соперников. */
function EloChart({ history, lab }: { history: MonthRecord[]; lab: string }) {
  const pts = history.filter((h) => h.eloMine !== undefined && h.eloRival !== undefined);
  if (pts.length < 2) return null;
  const W = 520;
  const H = 150;
  const pad = { l: 34, r: 8, t: 10, b: 18 };
  const vals = pts.flatMap((h) => [h.eloMine as number, h.eloRival as number]).filter((v) => v > 0);
  const lo = Math.floor(Math.min(...vals) / 100) * 100;
  const hi = Math.ceil(Math.max(...vals) / 100) * 100;
  const x = (i: number) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (Math.max(v, lo) - lo) / Math.max(1, hi - lo)) * (H - pad.t - pad.b);
  const line = (k: 'eloMine' | 'eloRival') =>
    pts.map((h, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y((h[k] as number) || lo).toFixed(1)}`).join(' ');
  const years = pts.map((h, i) => ({ h, i })).filter(({ h }) => h.month === 1);
  return (
    <div className="end-chart">
      <div className="end-legend">
        <span className="mine">{lab}: лучшая модель в продаже</span>
        <span className="rival">Лучшая модель соперников</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Эло по месяцам: лаборатория и лучшая модель соперников">
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 4} y={y(v) + 3} className="ax" textAnchor="end">
              {Math.round(v)}
            </text>
          </g>
        ))}
        {years.map(({ h, i }) => (
          <text key={h.year} x={x(i)} y={H - 4} className="ax" textAnchor="middle">
            {h.year}
          </text>
        ))}
        <path d={line('eloRival')} className="l-rival" />
        <path d={line('eloMine')} className="l-mine" />
      </svg>
    </div>
  );
}

export function EndDialog({ s, onWatch }: { s: GameState; onWatch: () => void }) {
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(s.outcome ?? '');
  // Пока соперники не продают модели, места нет (как в карточке выпуска и на верхней панели), а не «1-е».
  const rank = rivalsSellByApi(s) ? bestArenaPlace(s) : null;
  const rows = leaderboard(s).filter((r) => r.ref.kind === 'player');
  const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.elo > b.elo ? r : b), null);
  const v = valuation(s);
  const months = Number.isFinite(s.monthsFirst) ? s.monthsFirst : 0;
  const win = s.outcome === 'victory';
  const bankrupt = s.outcome === 'bankrupt';
  const title = win ? 'Победа' : bankrupt ? 'Банкротство' : 'Конец 2024 года';
  const lead = win
    ? `Модель лаборатории «${s.labName}» - первая среди моделей в продаже 31 декабря 2024 года.`
    : bankrupt
      ? `Лаборатория «${s.labName}» закрылась ${formatDate(s.day)}: деньги были в минусе 60 дней подряд.`
      : `Партия закончилась 31 декабря 2024 года. Место на «Арене»: ${fmtRank(rank)}.`;
  const history = s.finance.history;
  const revenue = history.reduce((sum, h) => sum + revenueOf(h), 0);
  const places = history.map((h) => h.placeEnd).filter((p): p is number => typeof p === 'number');
  const bestPlace = places.length > 0 ? Math.min(...places) : null;
  const released = s.models.filter((m) => m.releasedDay !== null).length;
  const moments = Object.keys(MOMENT_TITLES).filter((id) => s.flags[`moment:${id}`]);
  // Финальный квартал (sim/finale.ts): чьи рывки были и сколько раз игрок дорабатывал модели.
  const finale = s.late?.finale;
  const pushLabs = [...new Set((finale?.pushes ?? []).map((p) => LABS.find((l) => l.id === p.lab)?.name ?? p.lab))];
  const updates = finale?.done.length ?? 0;

  useEffect(() => {
    playSound(win ? 'first' : bankrupt ? 'rankDown' : 'goal');
  }, [win, bankrupt]);

  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        tabIndex={-1}
        className={`dialog end ${win ? 'win' : bankrupt ? 'lost' : 'done'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <div className="titlebar">
          <span className="t">{title}</span>
          <button className="wbtn close" onClick={onWatch} aria-label="Закрыть" title="Закрыть">
            <IconClose size={14} />
          </button>
        </div>
        <div className="body end-body">
          <div className="end-head">
            {win && <IconTrophy size={44} className="end-cup" />}
            <div className="end-head-t">
              <span className="end-place" title={ARENA_PLACE_TITLE}>
                {rank !== null ? `${rank}-е место` : 'Без места'}
                <small>на «Арене»</small>
              </span>
              <span className="end-lead">{lead}</span>
            </div>
          </div>

          <dl className="end-stats">
            <dt>Лучшее место за игру</dt>
            <dd>{bestPlace !== null ? `${bestPlace}-е` : 'без места'}</dd>
            <dt>Месяцев на 1-м месте</dt>
            <dd>{fmtNum(months)}</dd>
            <dt>Лучшая модель</dt>
            <dd>{best ? `${best.name}, ${fmtElo(best.elo)} Эло` : 'моделей не было'}</dd>
            <dt>Моделей выпущено</dt>
            <dd>{released}</dd>
            <dt>Оценка компании</dt>
            <dd>{fmtMoney(v.total)}</dd>
            <dt>Ваша доля {fmtShare(s.founderShare)}</dt>
            <dd>{fmtMoney(v.total * s.founderShare)}</dd>
          </dl>

          <EloChart history={history} lab={s.labName} />

          {moments.length > 0 && (
            <div className="end-moments">
              <span className="end-l">Ваши моменты</span>
              <div className="end-chips">
                {moments.map((id) => (
                  <span key={id} className="end-chip">
                    {MOMENT_TITLES[id]}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="end-kv">
            <span title={DIFFICULTY[s.difficulty].description}>Сложность</span>
            <span>{DIFFICULTY[s.difficulty].name}</span>
            <span>Выручка за игру</span>
            <span>{fmtMoney(revenue)}</span>
            {finale && (
              <>
                <span>Финальный квартал</span>
                <span>
                  {`${pushLabs.length === 0 ? 'без рывков соперников' : win ? `рывок отбит: ${pushLabs.join(', ')}` : `рывки: ${pushLabs.join(', ')}`}, доработок: ${updates}`}
                </span>
              </>
            )}
            <span>Деньги</span>
            <span>{fmtMoney(s.cash)}</span>
            {subsOpen(s.day) && (
              <>
                <span title="Пользователи подписки, обслуженные вчера">Подписчиков</span>
                <span>{fmtNum(Math.round(Number.isFinite(s.market.playerSubs) ? s.market.playerSubs : 0))}</span>
              </>
            )}
          </div>
        </div>
        <div className="foot end-foot">
          <button className="btn" onClick={onWatch}>
            Посмотреть игру
          </button>
          <button className="btn primary" onClick={() => store.quit()}>
            Выйти в меню
          </button>
        </div>
      </div>
    </div>
  );
}
