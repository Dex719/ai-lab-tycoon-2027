// Окно «Исследования» (FR-3): очки исследований и четыре технологии.

import { useState } from 'react';
import type { WindowProps } from '.';
import { ALGO_COST_GROWTH, ALGO_MULT, TECH_REQUIRES } from '../../sim/constants';
import { pool } from '../../sim/compute';
import { earlyPenalty, researchBlockReason, rpPerDay, TECHS, techCost, yearsEarly } from '../../sim/research';
import type { GameState, TechId } from '../../sim/types';
import { ErrorText, ProgressBar, Stat } from '../components/common';
import { fmtNum, fmtPct } from '../format';
import { actions, store } from '../store';

type Status = 'done' | 'current' | 'available' | 'blocked';

function techName(id: TechId): string {
  return TECHS.find((t) => t.id === id)?.name ?? id;
}

function statusOf(s: GameState, id: TechId, blockReason: string | null): Status {
  if (id !== 'algo' && s.research.done.includes(id)) return 'done';
  if (s.research.current === id) return 'current';
  return blockReason ? 'blocked' : 'available';
}

function TechCard({ s, id, rp }: { s: GameState; id: TechId; rp: number }) {
  const [error, setError] = useState<string | null>(null);
  const info = TECHS.find((t) => t.id === id);
  if (!info) return null;

  const reason = researchBlockReason(s, id);
  const status = statusOf(s, id, reason);
  const points = s.research.points[id] ?? 0;
  const cost = techCost(s, id);
  const left = Math.max(0, cost - points);
  const days = rp > 0 ? Math.ceil(left / rp) : Infinity;
  const missing = TECH_REQUIRES[id].filter((t) => !s.research.done.includes(t));

  const act = (tech: TechId | null) => {
    const r = store.dispatch(actions.setResearch, tech);
    setError(r.ok ? null : r.error);
  };

  const statusText =
    status === 'done' ? (
      <span className="good">Изучено ✓</span>
    ) : status === 'current' ? (
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Идёт исследование</span>
    ) : status === 'blocked' ? (
      <span className="warn">
        {missing.length > 0 ? `Нужно сначала: ${missing.map(techName).join(', ')}` : reason}
      </span>
    ) : (
      <span className="muted">Доступно</span>
    );

  return (
    <div className="card" style={status === 'current' ? { borderColor: 'var(--accent)' } : undefined}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700 }}>{info.name}</div>
        <div className="small">{statusText}</div>
      </div>
      <div className="muted small" style={{ margin: '2px 0 6px' }}>{info.description}</div>

      {id === 'algo' && (
        <div className="small" style={{ marginBottom: 6 }}>
          <b>Уровень {s.research.algoLevel}</b>. Сейчас обучение эффективнее в{' '}
          <b className="num">{fmtNum(ALGO_MULT ** s.research.algoLevel)}</b> раза (1,25
          <sup>{s.research.algoLevel}</sup>).{' '}
          <span className="muted">
            Исследование повторяется: после каждого уровня следующий стоит в {fmtNum(ALGO_COST_GROWTH)} раза дороже.
          </span>
        </div>
      )}

      {status === 'done' ? (
        <ProgressBar value={1} />
      ) : (
        <>
          <ProgressBar value={cost > 0 ? points / cost : 0} title={`${fmtNum(points)} из ${fmtNum(cost)} очков`} />
          <div className="row small" style={{ marginTop: 4, justifyContent: 'space-between' }}>
            <span className="num">
              {fmtNum(points)} / {fmtNum(cost)} очков
            </span>
            <span className="muted">
              {Number.isFinite(days) ? `осталось ≈ ${fmtNum(days)} дн.` : 'очки не копятся'}
              {status === 'blocked' && ' (после начала)'}
            </span>
          </div>
          {yearsEarly(s, id) > 0 && (
            <div className="warn small" style={{ marginTop: 2 }}>
              Вы опережаете историю на ≈ {fmtNum(Math.ceil(yearsEarly(s, id) * 12))} мес.: цена ×{fmtNum(earlyPenalty(s, id))}.
              С каждым днём она падает.
            </div>
          )}
        </>
      )}

      {status !== 'done' && (
        <div className="row" style={{ marginTop: 6 }}>
          {status === 'current' ? (
            <button className="btn" onClick={() => act(null)} title="Прогресс сохранится, можно вернуться позже">
              Остановить
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={status === 'blocked'}
              title={reason ?? 'Сделать текущим исследованием'}
              onClick={() => act(id)}
            >
              Исследовать
            </button>
          )}
          {status === 'blocked' && reason && <span className="muted small">{reason}</span>}
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export default function ResearchWindow({ s, open }: WindowProps) {
  const rp = rpPerDay(s);
  const current = s.research.current;
  const expShare = s.compute.alloc.experiments;

  return (
    <div className="col">
      <div className="row">
        <Stat label="Очки исследований в день" value={fmtNum(rp)} hint={`Эксперименты: ${fmtPct(expShare * 100, 0)} мощности`} />
        <Stat label="Сейчас изучается" value={current ? techName(current) : 'ничего'} />
      </div>

      {current === null && (
        <div className="warn small">Сейчас ничего не исследуется, очки не копятся. Выберите технологию ниже.</div>
      )}

      <div className="card row">
        <div className="grow muted small">
          Очки идут от доли «Эксперименты» в окне «Мощности». Чем больше мощности вы отдадите, тем больше очков в день,
          но отдача убывает: вдвое больше мощности даёт заметно меньше, чем вдвое больше очков. Сейчас
          экспериментам выделено {fmtNum(pool(s, 'experiments'))} H100e. Прогресс по каждой технологии сохраняется,
          если переключиться на другую.
        </div>
        <button className="btn" onClick={() => open('compute')}>
          Открыть «Мощности»
        </button>
      </div>

      {TECHS.map((t) => (
        <TechCard key={t.id} s={s} id={t.id} rp={rp} />
      ))}
    </div>
  );
}
