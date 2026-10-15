// Окно «Финал» (с 1 октября 2024 года): сколько осталось, место в гонке, объявленные рывки и выходы соперников
// на шкале до 31 декабря и ответ игрока - доработка модели. Симуляция - sim/finale.ts.

import { useState } from 'react';
import { LABS } from '../../data/labs';
import {
  FINALE_START,
  finaleThreats,
  playerBestApi,
  startUpdate,
  updateQuote,
  UPDATE_GAIN,
  type FinaleThreat,
} from '../../sim/finale';
import { arenaStanding, type ArenaStanding } from '../../sim/leaderboard';
import { dayToDate, END_DAY, formatDate, formatDateShort } from '../../sim/time';
import type { GameState, HypeOwner, PlayerModel } from '../../sim/types';
import { ConfirmDialog, GuardButton, ProgressBar } from '../components/common';
import { fmtDays, fmtInt, fmtMoney } from '../format';
import { store } from '../store';
import type { WindowProps } from './index';
import './FinaleWindow.css';

const LAB_COLOR = new Map<HypeOwner, string>(LABS.map((l) => [l.id, l.color]));
const LAB_NAME = new Map<HypeOwner, string>(LABS.map((l) => [l.id, l.name]));

function standingOf(s: GameState): ArenaStanding | null {
  try {
    const st = arenaStanding(s);
    return st && st.metric.kind === 'arena' ? st : null;
  } catch {
    return null;
  }
}

/** «11.12» - день и месяц. */
function shortDay(day: number): string {
  const d = dayToDate(day);
  return `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}`;
}

const KIND_LABEL: Record<FinaleThreat['kind'], string> = {
  'push-update': 'Рывок: обновление',
  'push-release': 'Рывок: новая модель',
  release: 'Анонс',
};

/** Сколько самых сильных моделей предлагать к доработке: старые слабые модели гонку не решают. */
const UPDATE_PICK = 5;

/** Модели, которые можно доработать: обученные и не разоблачённые, сильные сверху. */
function updatable(s: GameState): PlayerModel[] {
  return s.models
    .filter((m) => !m.exposed)
    .sort((a, b) => b.arenaElo - a.arenaElo)
    .slice(0, UPDATE_PICK);
}

// ---------- Шкала до 31 декабря ----------

/**
 * Лучшая модель игрока в продаже по дням финала (ступеньки): выход моделей и готовые доработки. Модели, снятые
 * с продажи, не учитываются - так линия заканчивается на том же значении, по которому сейчас считается место.
 */
function mineSteps(s: GameState): { day: number; elo: number }[] {
  const done = s.late?.finale.done ?? [];
  const at = (day: number): number => {
    let best = 0;
    for (const m of s.models) {
      if (m.releasedDay === null || !m.onApi || m.releasedDay > day) continue;
      const later = done.filter((d) => d.modelId === m.id && d.day > day).reduce((a, d) => a + d.gain, 0);
      best = Math.max(best, m.arenaElo - later);
    }
    return best;
  };
  const days = new Set<number>([FINALE_START]);
  for (const m of s.models) if (m.releasedDay !== null && m.releasedDay > FINALE_START && m.releasedDay <= s.day) days.add(m.releasedDay);
  for (const d of done) if (d.day > FINALE_START && d.day <= s.day) days.add(d.day);
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => ({ day, elo: at(day) }))
    .filter((p) => p.elo > 0);
}

const CW = 860;
const CH = 190;
const PAD = { l: 52, r: 16, t: 20, b: 26 };

function Timeline({ s, threats, mine, planned }: { s: GameState; threats: FinaleThreat[]; mine: PlayerModel | null; planned: { day: number; elo: number } | null }) {
  const x0 = FINALE_START;
  const x1 = END_DAY;
  const steps = mineSteps(s);
  const values = threats.map((t) => t.elo);
  for (const p of steps) values.push(p.elo);
  if (mine) values.push(mine.arenaElo);
  if (planned) values.push(planned.elo);
  if (values.length === 0) values.push(1300);
  const lo = Math.floor((Math.min(...values) - 8) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 8) / 10) * 10;
  const X = (d: number) => PAD.l + ((Math.min(x1, Math.max(x0, d)) - x0) / (x1 - x0)) * (CW - PAD.l - PAD.r);
  const Y = (e: number) => PAD.t + (1 - (e - lo) / Math.max(1, hi - lo)) * (CH - PAD.t - PAD.b);
  const ticks: number[] = [];
  const step = hi - lo > 60 ? 20 : 10;
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  const months = [
    { day: x0, label: 'Октябрь' },
    { day: x0 + 31, label: 'Ноябрь' },
    { day: x0 + 61, label: 'Декабрь' },
  ];
  const today = Math.min(x1, s.day);
  return (
    <svg className="fn-chart" viewBox={`0 0 ${CW} ${CH}`} role="img" aria-label="Шкала финала: объявленные рывки и выходы соперников и ваша лучшая модель">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={CW - PAD.r} y1={Y(v)} y2={Y(v)} className="fn-grid" />
          <text x={PAD.l - 6} y={Y(v) + 4} className="fn-axis" textAnchor="end">
            {fmtInt(v)}
          </text>
        </g>
      ))}
      {months.map((m) => (
        <g key={m.label}>
          <line x1={X(m.day)} x2={X(m.day)} y1={PAD.t} y2={CH - PAD.b} className="fn-grid" />
          <text x={X(m.day) + 4} y={CH - 8} className="fn-axis">
            {m.label}
          </text>
        </g>
      ))}
      <rect x={X(x1 - 10)} y={PAD.t} width={X(x1) - X(x1 - 10)} height={CH - PAD.t - PAD.b} className="fn-calm" />
      {mine && (
        <g>
          {steps.length > 0 && (
            <polyline
              className="fn-mine"
              fill="none"
              points={steps
                .flatMap((p, i) => {
                  const end = i + 1 < steps.length ? steps[i + 1].day : today;
                  return [`${X(p.day)},${Y(p.elo)}`, `${X(end)},${Y(p.elo)}`];
                })
                .join(' ')}
            />
          )}
          <line x1={X(today)} x2={X(planned ? planned.day : x1)} y1={Y(mine.arenaElo)} y2={Y(mine.arenaElo)} className="fn-mine ahead" />
          {planned && (
            <>
              <line x1={X(planned.day)} x2={X(planned.day)} y1={Y(mine.arenaElo)} y2={Y(planned.elo)} className="fn-mine dash" />
              <line x1={X(planned.day)} x2={X(x1)} y1={Y(planned.elo)} y2={Y(planned.elo)} className="fn-mine dash" />
            </>
          )}
          <text x={X(x1) - 2} y={Y(planned ? planned.elo : mine.arenaElo) - 6} className="fn-mine-label" textAnchor="end">
            вы: {fmtInt(planned ? planned.elo : mine.arenaElo)}
          </text>
        </g>
      )}
      <line x1={X(today)} x2={X(today)} y1={PAD.t - 6} y2={CH - PAD.b} className="fn-today" />
      <text x={X(today) + 5} y={PAD.t - 4} className="fn-today-label" textAnchor={X(today) > CW - 80 ? 'end' : 'start'} dx={X(today) > CW - 80 ? -10 : 0}>
        сегодня
      </text>
      {threats.map((t) => {
        const color = LAB_COLOR.get(t.lab) ?? '#999';
        const above = mine ? t.elo > mine.arenaElo : true;
        const cx = X(t.day);
        const cy = Y(t.elo);
        const right = cx < CW - 190;
        return (
          <g key={t.modelId}>
            <circle cx={cx} cy={cy} r={6} fill={t.done ? color : '#1b1e24'} stroke={color} strokeWidth={2.5} />
            <text x={right ? cx + 10 : cx - 10} y={cy + 4} textAnchor={right ? 'start' : 'end'} className={`fn-pt${above ? ' above' : ''}`}>
              {t.name} · {t.done ? '' : '≈'}
              {fmtInt(t.elo)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------- Окно ----------

export default function FinaleWindow({ s }: WindowProps) {
  const threats = finaleThreats(s);
  const st = standingOf(s);
  const mine = playerBestApi(s);
  const late = s.late?.finale;
  const running = late?.update ?? null;
  const runningModel = running ? s.models.find((m) => m.id === running.modelId) : undefined;
  const models = updatable(s);
  const [pick, setPick] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const chosen = models.find((m) => m.id === pick) ?? models.find((m) => m.id === mine?.id) ?? models[0] ?? null;
  const quote = chosen ? updateQuote(s, chosen.id) : null;
  const daysLeft = Math.max(0, END_DAY - s.day);
  const coming = threats.filter((t) => !t.done);
  const next = coming[0] ?? null;
  const topComing = coming.reduce<FinaleThreat | null>((b, t) => (!b || t.elo > b.elo ? t : b), null);
  const planned = running && runningModel && mine && runningModel.id === mine.id ? { day: running.endDay, elo: mine.arenaElo + running.gain } : null;
  const after = chosen && quote ? chosen.arenaElo + quote.gain : 0;

  function doStart() {
    if (!chosen) return;
    setConfirm(false);
    store.dispatch(startUpdate, chosen.id);
  }

  return (
    <div className="fn">
      <div className="fn-hero">
        <div className="fn-kpi">
          <div className="fn-l">До финала</div>
          <div className={`fn-v${daysLeft <= 30 && !s.outcome ? ' hot' : ''}`}>{s.outcome ? 'Итоги' : fmtDays(daysLeft)}</div>
          <div className="fn-s">Итоги гонки - 31 декабря 2024 года</div>
        </div>
        <div className="fn-kpi">
          <div className="fn-l">Место на «Арене»</div>
          <div className={`fn-v${st?.rank === 1 ? ' gold' : ''}`}>{st ? `${st.rank}-е` : '-'}</div>
          <div className="fn-s">
            {!st
              ? 'Нет модели в продаже'
              : st.rank === 1
                ? st.below
                  ? `Отрыв ${fmtInt(st.below.gap)} Эло от ${st.below.name}`
                  : 'Соперников ниже нет'
                : st.above
                  ? `До ${st.rank - 1}-го места ${fmtInt(st.above.gap)} Эло: ${st.above.name}`
                  : ''}
          </div>
        </div>
        <div className="fn-kpi">
          <div className="fn-l">Следующая угроза</div>
          <div className="fn-v">{next ? shortDay(next.day) : '-'}</div>
          <div className="fn-s">
            {next ? `${next.name}, ≈ ${fmtInt(next.elo)} Эло` : threats.length > 0 ? 'Все объявленные угрозы уже вышли' : 'Объявленных угроз нет'}
          </div>
        </div>
      </div>

      <div className="fn-plot">
        <Timeline s={s} threats={threats} mine={mine} planned={planned} />
        <div className="fn-legend">
          <span>
            <i className="dot done" /> вышла
          </span>
          <span>
            <i className="dot" /> объявлена
          </span>
          <span>
            <i className="line" /> ваша лучшая модель в продаже
          </span>
          <span>
            <i className="calm" /> последние дни без рывков
          </span>
        </div>
      </div>

      <div className="fn-body">
        <section className="fn-threats">
          <h3 className="fn-h">Рывки и анонсы соперников</h3>
          {threats.length === 0 ? (
            <div className="fn-empty">Объявленных рывков и выходов пока нет</div>
          ) : (
            <table className="fn-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Лаборатория</th>
                  <th>Что</th>
                  <th className="num">Эло</th>
                  <th className="num">Против вас</th>
                </tr>
              </thead>
              <tbody>
                {threats.map((t) => {
                  const diff = mine ? Math.round(t.elo - mine.arenaElo) : null;
                  return (
                    <tr key={t.modelId} className={t.done ? 'done' : undefined}>
                      <td>
                        {formatDateShort(t.day)}
                        <div className="fn-when">{t.done ? 'прошло' : `через ${fmtDays(Math.max(0, t.day - s.day))}`}</div>
                      </td>
                      <td>
                        <i className="fn-dot" style={{ background: LAB_COLOR.get(t.lab) }} />
                        {LAB_NAME.get(t.lab)}
                      </td>
                      <td>
                        <b>{t.name}</b>
                        <div className="fn-when">{KIND_LABEL[t.kind]}</div>
                      </td>
                      <td className="num">
                        {t.done ? '' : '≈ '}
                        {fmtInt(t.elo)}
                      </td>
                      <td className={`num ${diff === null ? '' : diff > 0 ? 'bad' : 'good'}`}>
                        {diff === null ? '-' : diff > 0 ? `выше на ${diff}` : diff === 0 ? 'вровень' : `ниже на ${-diff}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section className="fn-answer">
          <h3 className="fn-h">Доработка модели</h3>
          {running && runningModel ? (
            <div className="fn-run">
              <div className="fn-run-top">
                <b>«{runningModel.name}»</b>
                <span className="good">+{running.gain} Эло</span>
              </div>
              <ProgressBar value={(s.day - running.startDay) / Math.max(1, running.endDay - running.startDay)} />
              <div className="fn-when">Готово {formatDate(running.endDay)}</div>
            </div>
          ) : null}
          {chosen && quote ? (
            <>
              <label className="fn-pick">
                <span>Модель</span>
                <select value={chosen.id} onChange={(e) => setPick(e.target.value)}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} - {fmtInt(m.arenaElo)} Эло{m.releasedDay === null ? ' (не выпущена)' : m.onApi ? '' : ' (не в продаже)'}
                    </option>
                  ))}
                </select>
              </label>
              <div className="kv fn-kv">
                <span>Эло</span>
                <span>
                  {fmtInt(chosen.arenaElo)} → <b className="good">{fmtInt(after)}</b> (+{quote.gain})
                </span>
                <span>Стоимость</span>
                <span>{fmtMoney(quote.cost)}</span>
                <span>Срок</span>
                <span className={quote.endDay > END_DAY ? 'bad' : undefined}>
                  {fmtDays(quote.days)}, {quote.endDay > END_DAY ? 'не успеет до 31.12.2024' : `до ${formatDateShort(quote.endDay)}`}
                </span>
                <span>Доработок модели</span>
                <span>
                  {quote.nth} из {UPDATE_GAIN.length}
                </span>
              </div>
              <div className={`fn-verdict${topComing ? (after > topComing.elo ? ' good' : ' warn') : ''}`}>
                {topComing
                  ? after > topComing.elo
                    ? `Выше всех объявленных угроз (до ${fmtInt(topComing.elo)})`
                    : `Ниже угрозы: ${topComing.name}, ≈ ${fmtInt(topComing.elo)}`
                  : ''}
              </div>
              <GuardButton className="btn primary wide" reason={quote.error} onClick={() => setConfirm(true)}>
                Доработать за {fmtMoney(quote.cost)}
              </GuardButton>
            </>
          ) : (
            <div className="fn-empty">Обученных моделей нет</div>
          )}
          {late && late.done.length > 0 && (
            <ul className="fn-done">
              {late.done.map((d, i) => {
                const m = s.models.find((x) => x.id === d.modelId);
                return (
                  <li key={i}>
                    {formatDateShort(d.day)} · «{m?.name ?? 'модель'}» <span className="good">+{d.gain} Эло</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {confirm && chosen && quote && (
        <ConfirmDialog title="Доработка модели" confirmLabel="Доработать" onConfirm={doStart} onClose={() => setConfirm(false)}>
          <div className="kv">
            <span>Модель</span>
            <span>«{chosen.name}»</span>
            <span>Эло на «Арене»</span>
            <span>
              {fmtInt(chosen.arenaElo)} → {fmtInt(after)}
            </span>
            <span>Стоимость</span>
            <span className="bad">−{fmtMoney(quote.cost)}</span>
            <span>Срок</span>
            <span>{fmtDays(quote.days)}</span>
            <span>Готово</span>
            <span>{formatDate(quote.endDay)}</span>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
