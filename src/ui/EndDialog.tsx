// Итог партии: победа, конец 2024 года или банкротство (FR-1.4, FR-1.5).

import { valuation } from '../sim/investors';
import { leaderboard } from '../sim/leaderboard';
import { playerBestArenaRank } from '../sim/tick';
import { formatDate } from '../sim/time';
import type { GameState } from '../sim/types';
import { useModalFocus } from './components/common';
import { fmtElo, fmtMoney, fmtShare } from './format';
import { store } from './store';

export function EndDialog({ s, onWatch }: { s: GameState; onWatch: () => void }) {
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(s.outcome ?? '');
  const rank = playerBestArenaRank(s);
  const rows = leaderboard(s).filter((r) => r.ref.kind === 'player');
  const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.elo > b.elo ? r : b), null);
  const v = valuation(s);
  const title = s.outcome === 'victory' ? 'Победа' : s.outcome === 'bankrupt' ? 'Банкротство' : 'Конец 2024 года';
  const lead =
    s.outcome === 'victory'
      ? `Модель лаборатории «${s.labName}» - первая на «Арене» 31 декабря 2024 года.`
      : s.outcome === 'bankrupt'
        ? `Лаборатория «${s.labName}» закрылась ${formatDate(s.day)}: деньги были в минусе 60 дней подряд.`
        : `Партия закончилась 31 декабря 2024 года. Место на «Арене»: ${rank ?? '-'}.`;
  return (
    <div className="modal-backdrop">
      <div ref={ref} tabIndex={-1} className="dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">{title}</span>
        </div>
        <div className="body">
          <p style={{ marginTop: 0 }}>{lead}</p>
          <div className="kv">
            <span>Место на «Арене»</span>
            <span>{rank ?? '-'}</span>
            <span>Лучшая модель</span>
            <span>{best ? `${best.name}, Эло ${fmtElo(best.elo)}` : '-'}</span>
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
            В главное меню
          </button>
        </div>
      </div>
    </div>
  );
}
