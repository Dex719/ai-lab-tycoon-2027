// Итог партии: победа, конец 2024 года или банкротство (FR-1.4, FR-1.5).

import { valuation } from '../sim/investors';
import { leaderboard } from '../sim/leaderboard';
import { DIFFICULTY } from '../sim/rivalry';
import { subsOpen } from '../sim/market';
import { ARENA_PLACE_TITLE, bestArenaPlace } from './arena';
import { formatDate } from '../sim/time';
import type { GameState } from '../sim/types';
import { useModalFocus } from './components/common';
import { fmtElo, fmtMoney, fmtNum, fmtShare } from './format';
import { fmtRank } from './labels';
import { store } from './store';

export function EndDialog({ s, onWatch }: { s: GameState; onWatch: () => void }) {
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(s.outcome ?? '');
  const rank = bestArenaPlace(s);
  const rows = leaderboard(s).filter((r) => r.ref.kind === 'player');
  const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.elo > b.elo ? r : b), null);
  const v = valuation(s);
  const months = Number.isFinite(s.monthsFirst) ? s.monthsFirst : 0;
  const title = s.outcome === 'victory' ? 'Победа' : s.outcome === 'bankrupt' ? 'Банкротство' : 'Конец 2024 года';
  const lead =
    s.outcome === 'victory'
      ? `Модель лаборатории «${s.labName}» - первая среди моделей в продаже 31 декабря 2024 года.`
      : s.outcome === 'bankrupt'
        ? `Лаборатория «${s.labName}» закрылась ${formatDate(s.day)}: деньги были в минусе 60 дней подряд.`
        : `Партия закончилась 31 декабря 2024 года. Место на «Арене»: ${fmtRank(rank)}.`;
  return (
    <div className="modal-backdrop">
      <div ref={ref} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">{title}</span>
        </div>
        <div className="body">
          <p style={{ marginTop: 0 }}>{lead}</p>
          <div className="kv">
            <span title={DIFFICULTY[s.difficulty].description}>Сложность</span>
            <span>{DIFFICULTY[s.difficulty].name}</span>
            <span title={ARENA_PLACE_TITLE}>Место на «Арене»</span>
            <span>{fmtRank(rank)}</span>
            <span>Лучшая модель</span>
            <span>{best ? `${best.name}, Эло ${fmtElo(best.elo)}` : '-'}</span>
            <span>Месяцев на 1-м месте</span>
            <span>{fmtNum(months)}</span>
            {subsOpen(s.day) && (
              <>
                <span title="Пользователи подписки, обслуженные вчера">Подписчиков</span>
                <span>{fmtNum(Math.round(Number.isFinite(s.market.playerSubs) ? s.market.playerSubs : 0))}</span>
              </>
            )}
            <span>Деньги</span>
            <span>{fmtMoney(s.cash)}</span>
            <span>Оценка компании</span>
            <span>{fmtMoney(v.total)}</span>
            <span>Доля основателя</span>
            <span>
              {fmtShare(s.founderShare)} ({fmtMoney(v.total * s.founderShare)})
            </span>
          </div>
        </div>
        <div className="foot">
          <button className="btn" onClick={onWatch}>
            Остаться в игре
          </button>
          <button className="btn primary" onClick={() => store.quit()}>
            Выйти в меню
          </button>
        </div>
      </div>
    </div>
  );
}
