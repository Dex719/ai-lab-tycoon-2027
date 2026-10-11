// Окно «Исследования»: дерево технологий на сером холсте (образец - «Исследования» в Processor Tycoon).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { GPUS } from '../../data/gpus';
import { pool, rentPerDay, totalH100e } from '../../sim/compute';
import { ALGO_MULT, RP_BASE, RP_K } from '../../sim/constants';
import { earlyPenalty, researchBlockReason, rpPerDay, TECHS, techCost, techHistoryDay } from '../../sim/research';
import { dayToDate, formatDateShort } from '../../sim/time';
import type { GameState, TechId } from '../../sim/types';
import { percentsOf, toAllocation, withPercent } from '../alloc';
import { Dialog, ErrorText, Range } from '../components/common';
import { fmtMoney, fmtMult, fmtNum, fmtPct } from '../format';
import { IconCheck, IconLock } from '../icons';
import { actions, store } from '../store';
import './ResearchWindow.css';

type Status = 'done' | 'current' | 'available' | 'blocked';

// Размеры холста, px.
const NW = 264; // ширина узла
const NH = 110; // высота узла
const PAD = 40; // поля слева и справа
const TOP = 12; // верх первой строки
const COL_GAP = 100; // между столбцами дерева
const BRANCH_GAP = 34; // между двумя ветками
const ROW_GAP = 40; // между строками
const CAPTION_H = 18; // строка «Раньше истории» под узлом
const CHIP_W = 60;
const CHIP_H = 36;
const CHIP_GAP = 8;
const CHIP_LINK = 28; // от последнего значка до узла
const MAX_CHIPS = 8;

const CODES: Record<Exclude<TechId, 'algo'>, string> = { attention: 'ATT', scaling: 'SCL', rlhf: 'RLHF' };

function techName(id: TechId): string {
  return TECHS.find((t) => t.id === id)?.name ?? id;
}

function statusOf(s: GameState, id: TechId, reason: string | null): Status {
  if (id !== 'algo' && s.research.done.includes(id)) return 'done';
  if (s.research.current === id) return 'current';
  return reason ? 'blocked' : 'available';
}

/** Дней до конца технологии при текущей скорости очков; null, если очки не копятся. */
function daysLeft(s: GameState, id: TechId, rp: number): number | null {
  if (rp <= 0) return null;
  return Math.ceil(Math.max(0, techCost(s, id) - (s.research.points[id] ?? 0)) / rp);
}

interface Chip {
  label: string;
  title: string;
}

/** Значки изученных уровней. Если их больше MAX_CHIPS, первые сворачиваются в один значок «Ур. 1-N». */
function algoChips(level: number): Chip[] {
  const one = (k: number): Chip => ({ label: `Ур. ${k}`, title: `Уровень ${k}: эффективность обучения ×${fmtMult(ALGO_MULT ** k)}` });
  const all = Array.from({ length: level }, (_, i) => one(i + 1));
  if (level <= MAX_CHIPS) return all;
  const folded = level - (MAX_CHIPS - 1);
  return [{ label: `Ур. 1-${folded}`, title: `Уровни 1-${folded} изучены` }, ...all.slice(folded)];
}

interface NodeProps {
  s: GameState;
  id: TechId;
  rp: number;
  x: number;
  y: number;
  code: string;
  onPick: (id: TechId, status: Status, reason: string | null) => void;
}

function TechNode({ s, id, rp, x, y, code, onPick }: NodeProps) {
  const info = TECHS.find((t) => t.id === id);
  if (!info) return null;

  const reason = researchBlockReason(s, id);
  const status = statusOf(s, id, reason);
  const points = s.research.points[id] ?? 0;
  const cost = techCost(s, id);
  const days = daysLeft(s, id, rp);
  const penalty = earlyPenalty(s, id);
  const year = dayToDate(techHistoryDay(s, id)).year;
  const share = status === 'done' ? 1 : cost > 0 ? Math.min(1, points / cost) : 0;

  const title = status === 'blocked' ? (reason ?? info.name) : info.description;

  return (
    <div className="rs-slot" style={{ left: x, top: y, width: NW, height: NH }}>
      <button
        type="button"
        className={`rs-node ${status}`}
        data-tutorial={id === 'attention' ? 'tech-attention' : undefined}
        title={title}
        aria-disabled={status === 'blocked' || status === 'done'}
        onClick={() => onPick(id, status, reason)}
      >
        <span className="rs-name">{info.name}</span>
        <span className="rs-main">
          <span className="rs-thumb">
            {status === 'blocked' && <IconLock size={16} />}
            <span>{code}</span>
          </span>
          <span className="rs-kv">
            <span>Год</span>
            <span>{year}</span>
            {status === 'done' ? (
              <span className="rs-done">
                <IconCheck size={14} />
                Изучено
              </span>
            ) : (
              <>
                <span>Стоимость</span>
                <span>{fmtNum(cost)} очков</span>
                <span>Срок</span>
                <span>{days === null ? '-' : `${fmtNum(days)} дн.`}</span>
              </>
            )}
          </span>
        </span>
        {status !== 'done' && points > 0 && (
          <span className="rs-prog" title={`${fmtNum(points)} из ${fmtNum(cost)} очков`}>
            <span style={{ width: `${share * 100}%` }} />
          </span>
        )}
      </button>
      {status !== 'done' && penalty > 1 && (
        <span className="rs-caption" title="Цена снижается по мере приближения к году выхода">
          Раньше истории: цена ×{fmtMult(penalty)}
        </span>
      )}
    </div>
  );
}

export default function ResearchWindow({ s, open }: WindowProps) {
  const [note, setNote] = useState<{ text: string } | null>(null);
  const [dialog, setDialog] = useState<TechId | null>(null);
  const rp = rpPerDay(s);
  const power = pool(s, 'experiments');
  const current = s.research.current;
  const level = s.research.algoLevel;

  // Сообщение об отказе гаснет само.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const pick = (id: TechId, status: Status, reason: string | null) => {
    if (status === 'done') return;
    if (status === 'blocked') {
      setNote({ text: reason ?? 'Исследование недоступно' });
      return;
    }
    setNote(null);
    setDialog(id);
  };

  const stop = () => {
    const r = store.dispatch(actions.setResearch, null);
    setNote(r.ok ? null : { text: r.error });
  };

  // Раскладка холста.
  const colX = PAD + NW + COL_GAP;
  const scalingY = TOP;
  const rlhfY = TOP + NH + BRANCH_GAP;
  const attentionY = (scalingY + rlhfY) / 2;
  const algoY = rlhfY + NH + ROW_GAP;
  const chips = algoChips(level);
  const chipsW = chips.length > 0 ? chips.length * CHIP_W + (chips.length - 1) * CHIP_GAP : 0;
  const algoX = PAD + (chips.length > 0 ? chipsW + CHIP_LINK : 0);
  const width = Math.max(colX + NW + PAD, algoX + NW + PAD);
  const height = algoY + NH + CAPTION_H + 12;

  const midX = PAD + NW + COL_GAP / 2;
  const attentionCy = attentionY + NH / 2;
  const algoCy = algoY + NH / 2;
  const attentionDone = s.research.done.includes('attention');
  const branch = (toY: number) => `M${PAD + NW} ${attentionCy} H${midX} V${toY + NH / 2} H${colX}`;

  const currentDays = current ? daysLeft(s, current, rp) : null;

  return (
    <div className="rs">
      <div className="rs-head">
        <h2 className="rs-title">Технологии</h2>
        <div className="rs-state">
          {current ? (
            <>
              <span>
                Изучается: <b>{techName(current)}</b>
                {currentDays !== null && <span className="num"> · {fmtNum(currentDays)} дн.</span>}
              </span>
              <button type="button" className="btn small" onClick={stop}>
                Остановить
              </button>
            </>
          ) : (
            <span>Исследование не выбрано</span>
          )}
        </div>
      </div>

      <div className="rs-canvas">
        <div className="rs-stage" style={{ width, height }}>
          <svg className="rs-lines" width={width} height={height} aria-hidden="true">
            <path className={attentionDone ? 'on' : undefined} d={branch(scalingY)} />
            <path className={attentionDone ? 'on' : undefined} d={branch(rlhfY)} />
            {chips.length > 0 && <path className="on" d={`M${PAD + CHIP_W / 2} ${algoCy} H${algoX}`} />}
          </svg>

          <TechNode s={s} id="attention" rp={rp} x={PAD} y={attentionY} code={CODES.attention} onPick={pick} />
          <TechNode s={s} id="scaling" rp={rp} x={colX} y={scalingY} code={CODES.scaling} onPick={pick} />
          <TechNode s={s} id="rlhf" rp={rp} x={colX} y={rlhfY} code={CODES.rlhf} onPick={pick} />

          {chips.length > 0 && (
            <span className="rs-caption free" style={{ left: PAD, top: algoCy - CHIP_H / 2 - 22 }}>
              Эффективность обучения ×{fmtMult(ALGO_MULT ** level)}
            </span>
          )}
          {chips.map((c, i) => (
            <span
              key={c.label}
              className="rs-chip"
              title={c.title}
              style={{ left: PAD + i * (CHIP_W + CHIP_GAP), top: algoCy - CHIP_H / 2, width: CHIP_W, height: CHIP_H }}
            >
              {c.label}
            </span>
          ))}
          <TechNode s={s} id="algo" rp={rp} x={algoX} y={algoY} code={`ALG ${level + 1}`} onPick={pick} />
        </div>
      </div>

      <div className="rs-bar">
        <span className="rs-stat" title={`${fmtNum(RP_BASE)} + ${fmtNum(RP_K)} × √(H100e на исследования)`}>
          <span className="l">Очки в день</span>
          <b className="num">{fmtNum(rp)}</b>
        </span>
        <span className="rs-stat" title={`Доля мощности на исследования: ${fmtPct(s.compute.alloc.experiments * 100, 0)}`}>
          <span className="l">Мощность</span>
          <b className="num">{fmtNum(power)} H100e</b>
        </span>
        {power <= 0 && <span className="rs-warn">Мощность на исследования не выделена</span>}
        {note && <span className="rs-note">{note.text}</span>}
        <button type="button" className="btn small" onClick={() => open('compute')}>
          Мощности
        </button>
      </div>
      {dialog &&
        createPortal(
          <ResearchDialog
            s={s}
            id={dialog}
            onClose={() => setDialog(null)}
            onRent={() => {
              setDialog(null);
              open('compute');
            }}
          />,
          document.body,
        )}
    </div>
  );
}

// ---------- Диалог исследования ----------

const DAYS_IN_MONTH = 30;

function ResearchDialog({ s, id, onClose, onRent }: { s: GameState; id: TechId; onClose: () => void; onRent: () => void }) {
  const info = TECHS.find((t) => t.id === id)!;
  const current = percentsOf(s.compute.alloc);
  const isCurrent = s.research.current === id;
  const other = s.research.current && !isCurrent ? techName(s.research.current) : null;
  // Пока на исследования ничего не выделено, предлагаем половину мощности.
  const [pct, setPct] = useState(() => (current.experiments > 0 || isCurrent ? current.experiments : 50));
  const [error, setError] = useState<string | null>(null);

  const total = totalH100e(s);
  const cards = GPUS.reduce((sum, g) => sum + s.compute.rented[g.id], 0);
  const power = (total * pct) / 100;
  const rp = RP_BASE + RP_K * Math.sqrt(power);
  const cost = techCost(s, id);
  const points = s.research.points[id] ?? 0;
  const days = Math.max(1, Math.ceil(Math.max(0, cost - points) / rp));
  const penalty = earlyPenalty(s, id);
  const rentMonth = rentPerDay(s) * (pct / 100) * DAYS_IN_MONTH;
  const changed = pct !== current.experiments;
  const noCards = total <= 0;

  function applyShare(): boolean {
    if (!changed || noCards) return true;
    const r = store.dispatch(actions.setAllocation, toAllocation(withPercent(current, 'experiments', pct)));
    if (!r.ok) setError(r.error);
    return r.ok;
  }

  function start() {
    if (!applyShare()) return;
    const r = store.dispatch(actions.setResearch, id);
    if (r.ok) onClose();
    else setError(r.error);
  }

  function save() {
    if (applyShare()) onClose();
  }

  function stop() {
    const r = store.dispatch(actions.setResearch, null);
    if (r.ok) onClose();
    else setError(r.error);
  }

  const footer = isCurrent ? (
    <>
      <button className="btn danger rs-d-left" onClick={stop}>
        Остановить
      </button>
      <button className="btn" onClick={onClose}>
        Закрыть
      </button>
      <button className="btn primary" disabled={!changed || noCards} onClick={save}>
        Применить
      </button>
    </>
  ) : (
    <>
      <button className="btn" onClick={onClose}>
        Отмена
      </button>
      <button className="btn primary" data-tutorial="research-start" onClick={start}>
        Начать исследование
      </button>
    </>
  );

  return (
    <Dialog title="Исследование" onClose={onClose} footer={footer}>
      <div className="rs-d">
        <div>
          <h2 className="rs-d-title">{info.name}</h2>
          <p className="rs-d-desc">{info.description}</p>
        </div>

        <dl className="rs-d-kv">
          <dt>Стоимость</dt>
          <dd>
            {fmtNum(cost)} очков
            {penalty > 1 && (
              <small title="Исследование раньше исторической даты стоит дороже. Цена снижается по мере приближения к этой дате.">
                раньше истории, цена ×{fmtMult(penalty)}
              </small>
            )}
          </dd>
          {points > 0 && (
            <>
              <dt>Накоплено</dt>
              <dd>
                {fmtNum(points)} очков ({fmtPct((points / cost) * 100, 0)})
              </dd>
            </>
          )}
        </dl>

        <section className="rs-d-power">
          <div className="rs-d-h">
            <span>Мощность на исследование</span>
            <b className="num">{fmtPct(pct, 0)}</b>
          </div>
          {noCards ? (
            <div className="rs-d-empty">
              <span>Карты не арендованы. Исследование идёт медленно.</span>
              <button className="btn small" onClick={onRent}>
                Арендовать карты
              </button>
            </div>
          ) : (
            <>
              <Range value={pct} min={0} max={100} color="#7b5cd6" label="Мощность на исследование" valueText={fmtPct(pct, 0)} onChange={setPct} />
              <div className="rs-d-ends">
                <span>Медленнее</span>
                <span>Быстрее</span>
              </div>
              <dl className="rs-d-kv">
                <dt>Карт</dt>
                <dd>
                  {fmtNum(Math.round((cards * pct) / 100))} из {fmtNum(cards)}
                </dd>
                <dt>Мощность</dt>
                <dd>{fmtNum(power)} H100e</dd>
                <dt>Аренда этих карт</dt>
                <dd>{fmtMoney(rentMonth)} в месяц</dd>
              </dl>
            </>
          )}
        </section>

        <div className="rs-d-result">
          <div>
            <span className="l">Срок</span>
            <b className="num">{fmtNum(days)} дн.</b>
          </div>
          <div>
            <span className="l">Готово</span>
            <b className="num">{formatDateShort(s.day + days)}</b>
          </div>
        </div>

        {!noCards && changed && <div className="rs-d-note">Остальным задачам останется {fmtPct(100 - pct, 0)} мощности.</div>}
        {other && <div className="rs-d-note">Сейчас изучается «{other}». Его очки сохранятся.</div>}
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}


