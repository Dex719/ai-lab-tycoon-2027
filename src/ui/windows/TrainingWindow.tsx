// Окно «Новая модель» (FR-4, FR-7): слева сводка проекта, справа настройки размера, данных и дообучения.
// Раскладка по образцу «Создание процессора» в Processor Tycoon.

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { BENCHMARKS } from '../../data/benchmarks';
import { benchDef, benchScore, DOMAIN_NAMES, introducedBenchmarks } from '../../sim/benchmarks';
import { awaitingEvent } from '../../sim/events';
import { pool, rentPerDay, totalH100e } from '../../sim/compute';
import {
  ARCH_MULT,
  BENCH_SHARE_MAX,
  CHIN_OPT_RATIO,
  CONTEXT_LEVELS,
  EXPOSE_HYPE_MULT,
  EXPOSE_REP,
  MAX_BENCH_TARGETS,
  MAX_TOKENS_B,
  PARAMS_B_MAX,
  PARAMS_B_MIN,
  RLHF_FLOP_EXTRA,
  TOKENS_B_MIN,
  TRAIN_FLOP_PER_H100E_DAY,
} from '../../sim/constants';
import { byYear, END_DAY, formatDateShort, yearOf } from '../../sim/time';
import { refContext } from '../../sim/market';
import { CONTEXT_MAX_LEVEL, contextLabel, maxContext } from '../../sim/research';
import { archFor, chinchillaFactor, contextFlopMult, estimate, labelersCost, tierOf, trainingPoolPerRun } from '../../sim/training';
import { DOMAINS } from '../../sim/types';
import type { BenchmarkId, DomainId, GameState, TrainingPlan, TrainingRun } from '../../sim/types';
import { Alert, ConfirmDialog, ErrorText, ProgressBar, Range } from '../components/common';
import { endSentence, fmtCardDays, fmtElo, fmtMoney, fmtNum, fmtParams, fmtPct, fmtTokens } from '../format';
import { IconLock } from '../icons';
import { actions, store } from '../store';
import './TrainingWindow.css';

type Est = ReturnType<typeof estimate>;
type OpenFn = WindowProps['open'];

const DOMAIN_RU = DOMAIN_NAMES;
/** Что входит в данные области: одна строка под названием. */
const DOMAIN_WHAT: Record<DomainId, string> = {
  language: 'Статьи, книги, сайты, диалоги',
  code: 'Программы и задачи по программированию',
  reasoning: 'Задачи с решениями: математика, физика, химия',
};
const DOMAIN_COLOR: Record<DomainId, string> = {
  language: 'var(--nm-language)',
  code: 'var(--nm-code)',
  reasoning: 'var(--nm-reasoning)',
};

const NAME_MAX = 40;
const POS_MAX = 1000;
const DAYS_IN_MONTH = 30.4;
// Доля полезных вычислений (множитель Шиншиллы): от 80 % баланс считаем хорошим, ниже 40 % - плохим.
const EFF_GOOD = 0.8;
const EFF_BAD = 0.4;

// ---------- Черновик ----------

interface Draft {
  game: string; // партия, которой принадлежит черновик
  name: string | null; // null - название по умолчанию «Модель N»
  paramsB: number;
  tokensB: number;
  mix: Record<DomainId, number>; // целые проценты, сумма 100
  share: number; // целые проценты
  targets: BenchmarkId[];
  rlhf: boolean;
  context: number | null; // null - наибольший открытый
}

/** Черновик живёт вне компонента: свёрнутое окно закрывается полностью, а настройки должны остаться. */
let saved: Draft | null = null;

function initialDraft(s: GameState): Draft {
  const game = `${s.seed}:${s.labName}`;
  if (saved && saved.game === game) return saved;
  // Новый проект начинается с прошлого (или идущего): обычно следующую модель делают чуть больше.
  const prev = s.trainings.at(-1)?.plan ?? s.models.at(-1)?.plan;
  return {
    game,
    name: null,
    paramsB: prev?.paramsB ?? 0.1,
    tokensB: prev?.tokensB ?? 2,
    mix: prev
      ? { language: Math.round(prev.mix.language * 100), code: Math.round(prev.mix.code * 100), reasoning: Math.round(prev.mix.reasoning * 100) }
      : { language: 50, code: 25, reasoning: 25 },
    share: 0,
    targets: [],
    rlhf: prev?.rlhf ?? false,
    context: null,
  };
}

// ---------- Помощники ----------

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Округление до значащих цифр, чтобы ползунок давал «круглые» числа. */
function roundSig(x: number, digits = 3): number {
  if (!(x > 0) || !Number.isFinite(x)) return x;
  const p = 10 ** (digits - 1 - Math.floor(Math.log10(x)));
  return Number((Math.round(x * p) / p).toPrecision(12));
}

function toPos(v: number, min: number, max: number): number {
  if (!(max > min) || !(v > 0)) return 0;
  const t = (Math.log(clamp(v, min, max)) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return Math.round(t * POS_MAX);
}

function fromPos(pos: number, min: number, max: number): number {
  const t = pos / POS_MAX;
  const v = Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
  return clamp(roundSig(v), min, max);
}

/** Срок: «95 дн.» и приближение в месяцах или годах для длинных проектов. */
function daysText(d: number): { main: string; approx: string | null } {
  const main = `${fmtNum(d)} дн.`;
  if (d < 60) return { main, approx: null };
  if (d < 730) return { main, approx: `≈ ${fmtNum(Math.round(d / DAYS_IN_MONTH))} мес.` };
  return { main, approx: `≈ ${fmtNum(Math.round((d / 365.25) * 10) / 10)} г.` };
}

/** Двигаем одну долю, остальные масштабируем так, чтобы сумма осталась 100 (целые проценты). */
function rescaleMix(mix: Record<DomainId, number>, id: DomainId, v: number): Record<DomainId, number> {
  const value = clamp(Math.round(v), 0, 100);
  const others = DOMAINS.filter((d) => d !== id);
  const rest = 100 - value;
  const sumOthers = others.reduce((a, d) => a + mix[d], 0);
  const out: Record<DomainId, number> = { ...mix };
  out[id] = value;
  const first = sumOthers > 0 ? Math.round((rest * mix[others[0]]) / sumOthers) : Math.floor(rest / 2);
  out[others[0]] = first;
  out[others[1]] = rest - first;
  return out;
}

function archName(arch: 'lstm' | 'transformer'): string {
  return arch === 'transformer' ? 'Трансформер' : 'LSTM';
}

// ---------- Элементы ----------

interface SliderProps {
  label: ReactNode;
  text: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  ends?: [string, string];
  color?: string;
  title?: string;
  ariaLabel: string;
}

function Slider({ label, text, value, min, max, onChange, ends, color, title, ariaLabel }: SliderProps) {
  return (
    <div className="nm-sl" title={title}>
      <div className="nm-sl-top">
        <span className="nm-sl-l">{label}</span>
        <span className="nm-sl-v num">{text}</span>
      </div>
      <Range value={value} min={min} max={max} onChange={onChange} color={color} label={ariaLabel} valueText={text} />
      {ends && (
        <div className="nm-sl-ends">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}

function Item(props: { label: ReactNode; children: ReactNode; sub?: ReactNode; title?: string; tone?: string }) {
  return (
    <div className="nm-item" title={props.title}>
      <div className="nm-item-l">{props.label}</div>
      <div className={`nm-item-v${props.tone ? ` ${props.tone}` : ''}`}>{props.children}</div>
      {props.sub && <div className="nm-item-s">{props.sub}</div>}
    </div>
  );
}

/** Кристалл модели, как чип в Processor Tycoon: размер квадрата растёт с числом параметров. */
function ModelChip({ name, paramsB, arch }: { name: string; paramsB: number; arch: string }) {
  const t = toPos(paramsB, PARAMS_B_MIN, PARAMS_B_MAX) / POS_MAX;
  return (
    <div className="nm-chip">
      <div className="nm-die" style={{ width: `${46 + 38 * t}%` }}>
        <div className="nm-die-name">{name.trim() || 'Без названия'}</div>
        <div className="nm-die-sub">{fmtParams(paramsB)}</div>
        <div className="nm-die-sub">{arch}</div>
      </div>
    </div>
  );
}

/** Нет мощности на обучение: либо не арендовано ни одной карты, либо доля «Обучение» равна нулю. */
function NoComputeAlert({ s, open }: { s: GameState; open: OpenFn }) {
  const noGpu = totalH100e(s) <= 0;
  return (
    <Alert tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
      Нет мощности на обучение: {noGpu ? 'не арендовано ни одной карты' : 'доля «Обучение» равна 0 %'}.
    </Alert>
  );
}

// ---------- Контекст ----------

/** Выбор длины контекста: открытые уровни и следующий закрытый. */
function ContextBlock(props: { s: GameState; value: number; onChange: (v: number) => void; open: OpenFn }) {
  const { s, value, onChange, open } = props;
  const level = s.research.contextLevel;
  const shown = CONTEXT_LEVELS.slice(0, Math.min(CONTEXT_MAX_LEVEL, level + 1) + 1);
  const market = refContext(s.day);
  return (
    <section className="nm-block">
      <h2 className="nm-h">Контекст</h2>
      <div className="nm-ctx" role="radiogroup" aria-label="Длина контекста">
        {shown.map(([tokens], i) => {
          const locked = i > level;
          const extra = Math.round((contextFlopMult(tokens) - 1) * 100);
          return (
            <button
              key={tokens}
              type="button"
              role="radio"
              aria-checked={value === tokens}
              disabled={locked}
              className={`nm-ctx-opt${value === tokens ? ' on' : ''}`}
              title={locked ? 'Нужен следующий уровень исследования «Длинный контекст».' : undefined}
              onClick={() => onChange(tokens)}
            >
              <b>
                {locked && <IconLock size={12} />}
                {contextLabel(tokens)}
              </b>
              <span>{extra > 0 ? `+${extra} % вычислений` : 'без надбавки'}</span>
            </button>
          );
        })}
      </div>
      <div className="nm-ctx-foot">
        <span title="Модели с контекстом длиннее обычного покупают охотнее, с коротким - реже.">
          Обычный контекст на рынке: <b>{contextLabel(market)}</b> токенов
        </span>
        {level < CONTEXT_MAX_LEVEL && (
          <button className="nm-link" onClick={() => open('research')}>
            Открыть «Исследования»
          </button>
        )}
      </div>
    </section>
  );
}

// ---------- Идущий проект ----------

function RunningBar({ s, t }: { s: GameState; t: TrainingRun }) {
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const p = t.plan;
  const frac = t.flopTotal > 0 ? Math.min(1, t.flopDone / t.flopTotal) : 0;
  const perDay = trainingPoolPerRun(s) * TRAIN_FLOP_PER_H100E_DAY; // доля «Обучение» делится между проектами
  const left = Math.max(0, t.flopTotal - t.flopDone);
  const eta = perDay > 0 ? Math.max(1, Math.ceil(left / perDay)) : null;
  const late = eta !== null && s.day + eta > END_DAY;
  const waiting = t.failed || awaitingEvent(s, 'training-fail');
  const labelers = labelersCost(p); // оплачены при старте, при отмене не возвращаются
  const targets = p.benchShare > 0 ? p.benchTargets.map((b) => benchDef(b).name).join(', ') : '';
  const summary = [
    archName(t.arch),
    `${fmtParams(p.paramsB)} параметров`,
    `${fmtTokens(p.tokensB)} токенов`,
    p.rlhf ? 'RLHF' : '',
    targets ? `подгонка ${fmtPct(p.benchShare * 100, 0)}: ${targets}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  function cancel() {
    const r = store.dispatch(actions.cancelTraining, t.id);
    setConfirm(false);
    setErr(r.ok ? null : r.error);
  }

  return (
    <div className="nm-run">
      <div style={{ minWidth: 0 }}>
        <div className="nm-run-l">Идёт обучение</div>
        <div className="nm-run-t" title={p.name}>«{p.name}»</div>
        <div className="nm-run-s" title={summary}>{summary}</div>
      </div>
      <div className="nm-run-bar">
        <ProgressBar
          value={frac}
          title={`${fmtCardDays(t.flopDone / TRAIN_FLOP_PER_H100E_DAY)} из ${fmtCardDays(t.flopTotal / TRAIN_FLOP_PER_H100E_DAY)} H100e-дн.`}
        />
        <div className="nm-run-meta">
          <span className="num">{fmtPct(frac * 100)}</span>
          {waiting ? (
            <span className="warn">Проект стоит: ждёт решения в «Почте»</span>
          ) : eta !== null ? (
            <>
              <span>Осталось {fmtNum(eta)} дн.</span>
              <span className={late ? 'warn' : 'muted'}>
                Готово {formatDateShort(s.day + eta)}
                {late && ', позже конца игры'}
              </span>
            </>
          ) : (
            <span className="warn">Проект стоит: нет мощности на обучение</span>
          )}
        </div>
      </div>
      <div className="nm-run-act">
        <button className="btn danger small" onClick={() => setConfirm(true)}>
          Отменить
        </button>
        <ErrorText error={err} />
      </div>
      {confirm && (
        <ConfirmDialog title="Отмена обучения" confirmLabel="Отменить проект" danger onConfirm={cancel} onClose={() => setConfirm(false)}>
          <div className="kv">
            <span>Проект</span>
            <span>{p.name}</span>
            <span>Готово</span>
            <span>{fmtPct(frac * 100)}</span>
            <span title="Выполненные вычисления пропадают: новый проект начнётся с нуля">Теряется вычислений</span>
            <span>{fmtCardDays(t.flopDone / TRAIN_FLOP_PER_H100E_DAY)} H100e-дн.</span>
            {labelers > 0 && (
              <>
                <span title="Разметчикам заплатили при старте: деньги не возвращаются">Разметчики, не возвращаются</span>
                <span>{fmtMoney(labelers)}</span>
              </>
            )}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---------- Левая колонка ----------

function Summary(props: { s: GameState; plan: TrainingPlan; est: Est | null; open: OpenFn }) {
  const { s, plan, est, open } = props;
  if (!est) return <div className="error">Оценка проекта недоступна.</div>;

  const days = est.days;
  const share = s.compute.alloc.training;
  const rentDay = rentPerDay(s) * share;
  const rent = days !== null ? days * rentDay : null;
  const cost = rent !== null ? rent + est.labelers : null;
  const late = days !== null && s.day + days > END_DAY;
  const dayText = days !== null ? daysText(days) : null;
  const fc = est.forecast;
  const hasFit = plan.benchShare > 0 && plan.benchTargets.length > 0;
  const scoreIds = fc ? introducedBenchmarks(s).filter((b) => fc.scores[b] !== undefined) : [];

  const costTitle =
    rent !== null
      ? `Аренда доли «Обучение» за весь срок: ${endSentence(fmtMoney(rent))}${est.labelers > 0 ? ` Разметчики: ${endSentence(fmtMoney(est.labelers))}` : ''} Оценка по сегодняшним ценам.`
      : undefined;

  return (
    <>
      <Item label="Стоимость проекта" title={costTitle}>
        {cost !== null ? (
          <>
            ≈ {fmtMoney(cost)} <small>({fmtMoney(rentDay * DAYS_IN_MONTH)}/мес.)</small>
          </>
        ) : (
          '-'
        )}
      </Item>
      <Item label="Срок" sub={late ? 'Позже конца игры' : undefined} tone={late ? 'warn' : undefined}>
        {dayText ? (
          <>
            {dayText.main} {dayText.approx && <small>{dayText.approx}</small>}
          </>
        ) : (
          '-'
        )}
      </Item>
      <Item label="Дата готовности" tone={late ? 'warn' : undefined}>
        {days !== null ? formatDateShort(s.day + days) : '-'}
      </Item>
      <Item
        label="Архитектура"
        title={est.arch === 'lstm' ? 'Трансформер откроется после исследования «Механизм внимания».' : undefined}
        sub={
          est.arch === 'lstm' ? (
            <>
              В {Math.round(1 / ARCH_MULT.lstm)} раз менее эффективна.{' '}
              <button className="nm-link" onClick={() => open('research')}>Открыть «Исследования»</button>
            </>
          ) : undefined
        }
      >
        {archName(est.arch)}
      </Item>
      <Item
        label="Объём вычислений"
        title="Сколько дней одна карта H100 считала бы это обучение. Срок зависит от мощности на обучение."
      >
        {fmtCardDays(est.flop / TRAIN_FLOP_PER_H100E_DAY)} H100e-дн.
      </Item>
      <Item
        label="Прогноз Эло на «Арене»"
        sub={
          fc ? undefined : (
            <button className="nm-link" onClick={() => open('research')}>Изучить «Законы масштабирования»</button>
          )
        }
      >
        {fc ? fmtElo(fc.elo) : <span className="muted">нет прогноза</span>}
      </Item>
      {fc && scoreIds.length > 0 && (
        <div className="nm-scores">
          <div className="nm-item-l">Прогноз баллов</div>
          <div className="kv">
            {scoreIds.map((b) => {
              const def = benchDef(b);
              const target = hasFit && plan.benchTargets.includes(b);
              const title = target ? `Без подгонки: ${fmtPct(benchScore(b, fc.caps[def.domain], 0))}` : undefined;
              return (
                <Fragment key={b}>
                  <span title={title}>
                    {def.name}
                    {target && <span className="muted"> · цель</span>}
                  </span>
                  <span title={title}>{fmtPct(fc.scores[b] ?? 0)}</span>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ---------- Окно ----------

export default function TrainingWindow({ s, open }: WindowProps) {
  const [d, setD] = useState<Draft>(() => initialDraft(s));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    saved = d;
  }, [d]);
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const running = s.trainings.length > 0;
  const year = yearOf(s.day);
  const maxTokens = byYear(MAX_TOKENS_B, year);
  const tokens = Math.min(d.tokensB, maxTokens);
  const benches = introducedBenchmarks(s);
  const rlhfDone = s.research.done.includes('rlhf');
  const nameValue = d.name ?? `Модель ${s.nextModelNum}`;
  const ctxMax = maxContext(s);

  const plan: TrainingPlan = {
    name: nameValue,
    paramsB: d.paramsB,
    tokensB: tokens,
    mix: { language: d.mix.language / 100, code: d.mix.code / 100, reasoning: d.mix.reasoning / 100 },
    benchShare: d.share / 100,
    benchTargets: d.share > 0 ? d.targets : [],
    rlhf: d.rlhf && rlhfDone,
    context: d.context !== null && d.context <= ctxMax ? d.context : ctxMax,
    // Уровень пока выводится из размера; выбор уровня в форме - в следующем срезе интерфейса.
    tier: tierOf(d.paramsB, s.day),
  };

  let est: Est | null = null;
  try {
    est = estimate(s, plan);
  } catch {
    est = null;
  }

  const trainPool = pool(s, 'training');
  const noCompute = trainPool <= 0;
  // RLHF платит разметчикам сразу, а без мощности на обучение проект не движется: такой запуск закрываем.
  const rlhfNoCompute = plan.rlhf && noCompute;
  const canStart = est !== null && est.error === null && !rlhfNoCompute;
  const reason =
    est === null
      ? 'Оценка проекта недоступна.'
      : (est.error ?? (rlhfNoCompute ? 'Выделите мощность на обучение: разметчикам платят при старте.' : null));

  const ratio = plan.tokensB / plan.paramsB;
  const eff = chinchillaFactor(plan.paramsB, plan.tokensB);
  const effTone = eff >= EFF_GOOD ? 'good' : eff >= EFF_BAD ? 'warn' : 'bad';
  const opt = est?.optimal ?? null;
  const optParams = opt ? clamp(roundSig(opt.paramsB), PARAMS_B_MIN, PARAMS_B_MAX) : 0;
  const optTokens = opt ? clamp(roundSig(opt.tokensB), TOKENS_B_MIN, maxTokens) : 0;
  const atOptimum = opt !== null && Math.abs(optParams / d.paramsB - 1) < 0.01 && Math.abs(optTokens / tokens - 1) < 0.01;

  const rlhfCost = labelersCost({ ...plan, rlhf: true });
  const rlhfShort = plan.rlhf && rlhfCost > s.cash;

  function toggleTarget(b: BenchmarkId) {
    const has = d.targets.includes(b);
    if (!has && d.targets.length >= MAX_BENCH_TARGETS) return;
    patch({ targets: has ? d.targets.filter((x) => x !== b) : [...d.targets, b] });
  }

  function applyOptimal() {
    if (!opt) return;
    patch({ paramsB: optParams, tokensB: optTokens });
  }

  function start() {
    const r = store.dispatch(actions.startTraining, plan);
    if (r.ok) {
      setErr(null);
      patch({ name: null });
    } else {
      setErr(r.error);
    }
  }

  const fitLine =
    d.share > 0 && d.targets.length === 0
      ? 'Бенчмарки не выбраны: доля данных потратится впустую.'
      : `Подгонка снижает Эло на «Арене». После выпуска её могут раскрыть: репутация −${fmtNum(Math.abs(EXPOSE_REP))}, шумиха −${fmtPct((1 - EXPOSE_HYPE_MULT) * 100, 0)}.`;

  return (
    <div className="nm">
      {s.trainings.map((t) => (
        <RunningBar key={t.id} s={s} t={t} />
      ))}

      <div className="nm-main">
        <aside className="nm-side">
          <div className="nm-side-head">
            <label>
              <span className="nm-name-l">Название</span>
              <input
                type="text"
                className="nm-name"
                maxLength={NAME_MAX}
                value={nameValue}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <div className="nm-count num">
              {nameValue.length}/{NAME_MAX}
            </div>
          </div>

          <div className="nm-side-scroll">
            <Summary s={s} plan={plan} est={est} open={open} />
          </div>

          <div className="nm-side-foot">
            {reason && <div className={`nm-reason ${running ? 'warn' : 'error'}`}>{reason}</div>}
            <ErrorText error={err} />
            <button
              className="btn primary wide nm-start"
              data-tutorial="train-start"
              disabled={!canStart}
              title={canStart ? undefined : (reason ?? undefined)}
              onClick={start}
            >
              Начать обучение
            </button>
          </div>
        </aside>

        <div className="nm-area">
          {noCompute && <NoComputeAlert s={s} open={open} />}

          <section className="nm-block">
            <h2 className="nm-h">Размер</h2>
            <div className="nm-size">
              <div>
                <ModelChip name={nameValue} paramsB={d.paramsB} arch={archName(archFor(s))} />
                <div
                  className="nm-eff"
                  title="Доля вычислений, которая идёт в качество модели при таком соотношении данных и параметров."
                >
                  <span>Полезные вычисления</span>
                  <span className={`num ${effTone}`}>{fmtPct(eff * 100, 0)}</span>
                </div>
              </div>

              <div className="nm-sliders">
                <Slider
                  label="Параметры"
                  text={fmtParams(d.paramsB)}
                  value={toPos(d.paramsB, PARAMS_B_MIN, PARAMS_B_MAX)}
                  min={0}
                  max={POS_MAX}
                  onChange={(v) => patch({ paramsB: fromPos(v, PARAMS_B_MIN, PARAMS_B_MAX) })}
                  ends={[fmtParams(PARAMS_B_MIN), fmtParams(PARAMS_B_MAX)]}
                  title="Больше параметров - больше вычислений на обучение и на каждый запрос клиента."
                  ariaLabel="Параметры"
                />
                <Slider
                  label="Данные, токены"
                  text={fmtTokens(tokens)}
                  value={toPos(tokens, TOKENS_B_MIN, maxTokens)}
                  min={0}
                  max={POS_MAX}
                  onChange={(v) => patch({ tokensB: fromPos(v, TOKENS_B_MIN, maxTokens) })}
                  ends={[fmtTokens(TOKENS_B_MIN), fmtTokens(maxTokens)]}
                  title={`Максимум объёма данных в ${year} году: ${fmtTokens(maxTokens)} токенов.`}
                  ariaLabel="Данные, токены"
                />
                <div className="nm-ratio">
                  <span>
                    Токенов на параметр: <b className={`num ${effTone}`}>{fmtNum(ratio)}</b>
                  </span>
                  <span className="muted">оптимум ≈ {CHIN_OPT_RATIO}</span>
                  {opt && (
                    <button
                      className="btn small"
                      disabled={atOptimum}
                      title={
                        atOptimum
                          ? 'Значения уже оптимальны.'
                          : `Тот же объём вычислений: ${fmtParams(optParams)} параметров, ${fmtTokens(optTokens)} токенов.`
                      }
                      onClick={applyOptimal}
                    >
                      Подставить оптимум
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <ContextBlock s={s} value={plan.context} onChange={(context) => patch({ context })} open={open} />

          <section className="nm-block">
            <h2 className="nm-h" title="Доли в сумме дают 100 %: при движении одного ползунка остальные подстраиваются.">
              На каких данных учить
            </h2>
            <div className="nm-mixbar" aria-hidden="true">
              {DOMAINS.map((k) => (
                <div key={k} style={{ width: `${d.mix[k]}%`, background: DOMAIN_COLOR[k] }} />
              ))}
            </div>
            <div className="nm-mix">
              {DOMAINS.map((k) => (
                <div key={k} className="nm-mix-row">
                  <span className="nm-mix-name">
                    <span className="nm-dot" style={{ background: DOMAIN_COLOR[k] }} />
                    {DOMAIN_RU[k]}
                  </span>
                  <Range
                    value={d.mix[k]}
                    min={0}
                    max={100}
                    color={DOMAIN_COLOR[k]}
                    label={DOMAIN_RU[k]}
                    valueText={fmtPct(d.mix[k], 0)}
                    onChange={(v) => patch({ mix: rescaleMix(d.mix, k, v) })}
                  />
                  <span className="nm-mix-pct num">{fmtPct(d.mix[k], 0)}</span>
                  <span className="nm-mix-what">
                    {DOMAIN_WHAT[k]}. Баллы: {BENCHMARKS.filter((b) => b.domain === k).map((b) => b.name).join(', ')}
                    {k === 'language' && '. Важнее всего для «Арены»'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="nm-block">
            <h2 className="nm-h">Дообучение</h2>
            <div className="nm-ft">
              <div className="nm-ft-col">
                <label
                  className={`nm-check${rlhfDone ? '' : ' off'}`}
                  title={
                    rlhfDone
                      ? `Повышает Эло на «Арене» и баллы по текстам. Вычислений нужно на ${fmtPct(RLHF_FLOP_EXTRA * 100, 0)} больше. Разметчикам платят при старте.`
                      : 'Нужно исследование «Обучение на отзывах людей (RLHF)».'
                  }
                >
                  <input
                    type="checkbox"
                    checked={plan.rlhf}
                    disabled={!rlhfDone}
                    onChange={(e) => patch({ rlhf: e.target.checked })}
                  />
                  <span>RLHF</span>
                </label>
                {rlhfDone ? (
                  <div className="kv">
                    <span>Разметчики</span>
                    <span className={rlhfShort ? 'bad' : undefined}>{fmtMoney(rlhfCost)}</span>
                    <span>Вычисления</span>
                    <span>+{fmtPct(RLHF_FLOP_EXTRA * 100, 0)}</span>
                  </div>
                ) : (
                  <div className="nm-note muted">
                    Нужно исследование RLHF.{' '}
                    <button className="nm-link" onClick={() => open('research')}>Открыть «Исследования»</button>
                  </div>
                )}
              </div>

              <div className="nm-ft-col">
                <Slider
                  label="Подгонка под бенчмарки"
                  text={fmtPct(d.share, 0)}
                  value={d.share}
                  min={0}
                  max={Math.round(BENCH_SHARE_MAX * 100)}
                  onChange={(v) => patch({ share: v })}
                  ends={[fmtPct(0, 0), fmtPct(BENCH_SHARE_MAX * 100, 0)]}
                  ariaLabel="Подгонка под бенчмарки"
                />
                <div className="nm-sub-head">
                  <span>Целевые бенчмарки</span>
                  <span className="num muted">{d.targets.length} из {MAX_BENCH_TARGETS}</span>
                </div>
                {benches.length === 0 ? (
                  <div className="nm-note muted">Бенчмарков пока нет.</div>
                ) : (
                  <div className="nm-tags">
                    {benches.map((b) => {
                      const def = benchDef(b);
                      const checked = d.targets.includes(b);
                      const full = !checked && d.targets.length >= MAX_BENCH_TARGETS;
                      const off = d.share <= 0 || full;
                      const title =
                        d.share <= 0
                          ? 'Сначала задайте долю подгонки.'
                          : full
                            ? `Выбрано максимум бенчмарков: ${MAX_BENCH_TARGETS}. Снимите отметку с другого.`
                            : `${def.description} Область: ${DOMAIN_RU[def.domain]}.`;
                      return (
                        <label key={b} className={`nm-check${off ? ' off' : ''}`} title={title}>
                          <input type="checkbox" checked={checked} disabled={off && !checked} onChange={() => toggleTarget(b)} />
                          <span>{def.name}</span>
                          <span className="nm-tag-d">{DOMAIN_RU[def.domain]}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {d.share > 0 && <div className="nm-note warn">{fitLine}</div>}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
