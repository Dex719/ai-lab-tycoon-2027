// Верхняя панель: дата, деньги, репутация, шумиха, скорость (FR-1, FR-14.1).

import { useEffect } from 'react';
import { formatDate } from '../sim/time';
import type { GameState, Speed } from '../sim/types';
import { fmtMoney } from './format';
import { store, useSpeed } from './store';

const SPEEDS: { speed: Speed; label: string; title: string }[] = [
  { speed: 0, label: '⏸', title: 'Пауза (пробел)' },
  { speed: 1, label: '▶', title: 'Скорость ×1' },
  { speed: 2, label: '▶▶', title: 'Скорость ×2' },
  { speed: 4, label: '▶▶▶', title: 'Скорость ×4' },
];

/** Изменение денег за текущий месяц (доходы − расходы с 1-го числа). */
function monthDelta(s: GameState): number {
  const m = s.finance.month;
  const income = m.income.api + m.income.contracts + m.income.investors;
  const expense = m.expense.rent + m.expense.overhead + m.expense.labelers + m.expense.penalties;
  return income - expense;
}

export function TopBar({ s }: { s: GameState }) {
  const speed = useSpeed();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code !== 'Space' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      store.togglePause();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const delta = monthDelta(s);
  return (
    <div className="topbar">
      <div className="lab">{s.labName}</div>
      <div className="stat">
        <span className="k">Дата</span>
        <span className="v">{formatDate(s.day)}</span>
      </div>
      <div className="stat">
        <span className="k">Деньги</span>
        <span className={`v${s.cash < 0 ? ' bad' : ''}`}>{fmtMoney(s.cash)}</span>
      </div>
      <div className="stat" title="Доходы минус расходы с начала месяца">
        <span className="k">За месяц</span>
        <span className={`v ${delta >= 0 ? 'good' : 'bad'}`}>
          {delta >= 0 ? '+' : ''}
          {fmtMoney(delta)}
        </span>
      </div>
      <div className="stat" title="Доверие клиентов и публики, 0–100">
        <span className="k">Репутация</span>
        <span className="v">{Math.round(s.reputation)}</span>
      </div>
      <div className="stat" title="Шумиха вокруг ваших моделей, 0–100. Растёт от мест в рейтингах, затухает каждый месяц">
        <span className="k">Шумиха</span>
        <span className="v">{Math.round(s.hype.player)}</span>
      </div>
      <div className="spacer" />
      <div className="speed">
        {SPEEDS.map((b) => (
          <button
            key={b.speed}
            className={`btn${speed === b.speed ? ' on' : ''}`}
            title={b.title}
            onClick={() => store.setSpeed(b.speed)}
            disabled={!!s.outcome && b.speed !== 0}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
