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
  MAX_TRAININGS,
  PARAMS_B_MAX,
  PARAMS_B_MIN,
  RLHF_FLOP_EXTRA,
  TIER_API_PRICE_MULT,
  TIER_SUBS_PRICE,
  TOKENS_B_MIN,
  TOKENS_PER_USER_DAY,
  TRAIN_FLOP_PER_H100E_DAY,
} from '../../sim/constants';
import { END_DAY, formatDateShort, yearOf } from '../../sim/time';
import { rivalsSellByApi } from '../../sim/leaderboard';
import { refContext, refPrice, servingMult, servingTokensPerH100eDay, subsOpen } from '../../sim/market';
import { CONTEXT_MAX_LEVEL, contextLabel, maxContext } from '../../sim/research';
import {
  archFor,
  chinchillaFactor,
  contextFlopMult,
  estimate,
  labelersCost,
  maxTokensB,
  modelTechs,
  tierAvailable,
  tierOf,
  tierPreset,
  tierRange,
  trainingPoolPerRun,
  trainOverhead,
} from '../../sim/training';
import { DOMAINS, TIER_IDS, TIER_NAMES } from '../../sim/types';
import type { BenchmarkId, DomainId, GameState, Tier, TrainingPlan, TrainingRun } from '../../sim/types';
import { Cards } from '../components/Cards';
import { Alert, ConfirmDialog, DenyNote, ErrorText, GuardButton, ProgressBar, Range, useFlash } from '../components/common';
import { TierBadge } from '../components/TierBadge';
import {
  endSentence,
  fmtCardDays,
  fmtElo,
  fmtDays,
  fmtH100e,
  fmtMoney,
  fmtNum,
  fmtParams,
  fmtPct,
  fmtPrice,
  fmtTokens,
} from '../format';
import { timesWord, tokensWord } from '../../sim/text';
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

export interface Draft {
  game: string; // партия, которой принадлежит черновик
  name: string | null; // null - название по умолчанию «Модель N»
  tier: Tier;
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

/** Уровень по умолчанию: уровень прошлого проекта или «Средняя»; если он ещё недоступен - первый доступный. */
export function pickTier(s: GameState, want: Tier): Tier {
  return tierAvailable(s.day, want) ? want : (TIER_IDS.find((t) => tierAvailable(s.day, t)) ?? want);
}

/**
 * Размеры, которые относятся к уровню: границы tierRange, подвинутые внутрь там, где граница не входит в уровень
 * (верх у «Лёгкой» и «Средней») или теряет точность. Размер из этих границ всегда проходит проверку уровня в симуляции.
 */
export function tierSpan(day: number, tier: Tier): [number, number] {
  const [lo, hi] = tierRange(day, tier);
  const a = tierOf(lo, day) === tier ? lo : lo * (1 + 1e-9);
  const b = tierOf(hi, day) === tier ? hi : hi * (1 - 1e-9);
  return [a, Math.max(a, b)];
}

export function fitTier(paramsB: number, day: number, tier: Tier): number {
  const [a, b] = tierSpan(day, tier);
  return clamp(paramsB, a, b);
}

/** Пресет уровня внутри его границ: размер и данные по Шиншилле. */
export function presetOf(s: GameState, tier: Tier): { paramsB: number; tokensB: number } {
  const p = tierPreset(s, tier);
  return { paramsB: fitTier(p.paramsB, s.day, tier), tokensB: p.tokensB };
}

/** Сохранённый черновик мог пережить смену года: уровень или размер больше не подходят - берём пресет уровня. */
export function normalizeDraft(s: GameState, d: Draft): Draft {
  const tier = pickTier(s, d.tier);
  const [a, b] = tierSpan(s.day, tier);
  if (tier === d.tier && d.paramsB >= a && d.paramsB <= b) return d;
  return { ...d, tier, ...presetOf(s, tier) };
}

function initialDraft(s: GameState): Draft {
  const game = `${s.seed}:${s.labName}`;
  if (saved && saved.game === game) return normalizeDraft(s, saved);
  // Новый проект начинается с прошлого (или идущего): обычно следующую модель делают чуть больше.
  const prev = s.trainings.at(-1)?.plan ?? s.models.at(-1)?.plan;
  const tier = pickTier(s, prev?.tier ?? 'mid');
  const keep = prev !== undefined && prev.tier === tier && tierOf(prev.paramsB, s.day) === tier;
  const preset = presetOf(s, tier);
  return {
    game,
    name: null,
    tier,
    paramsB: keep ? prev.paramsB : preset.paramsB,
    tokensB: keep ? prev.tokensB : preset.tokensB,
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
  const [note, flash] = useFlash();
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
              aria-disabled={locked || undefined}
              className={`nm-ctx-opt${value === tokens ? ' on' : ''}`}
              title={locked ? CONTEXT_LOCKED : undefined}
              onClick={() => (locked ? flash(CONTEXT_LOCKED) : onChange(tokens))}
            >
              <b>
                {locked && <IconLock size={12} />}
                {contextLabel(tokens)}
              </b>
              <span>{extra > 0 ? `+${extra} % вычислений` : 'без надбавки'}</span>
            </button>
          );
        })}
        <DenyNote text={note} />
      </div>
      <div className="nm-ctx-foot">
        <span title="Модели с контекстом длиннее обычного покупают охотнее, с коротким - реже.">
          Обычный контекст на рынке: <b>{contextLabel(market)}</b> {tokensWord(market)}
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
  const power = trainingPoolPerRun(s); // доля «Обучение» делится между проектами
  const perDay = power * TRAIN_FLOP_PER_H100E_DAY;
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
        <div className="nm-run-t" title={p.name}>
          <span className="nm-run-name">«{p.name}»</span>
          <TierBadge tier={p.tier} />
        </div>
        <div className="nm-run-s" title={summary}>{summary}</div>
      </div>
      <div className="nm-run-bar">
        <ProgressBar
          value={frac}
          title={`${fmtCardDays(t.flopDone / TRAIN_FLOP_PER_H100E_DAY)} из ${fmtCardDays(t.flopTotal / TRAIN_FLOP_PER_H100E_DAY)} H100e-дн.`}
        />
        <div className="nm-run-meta">
          <span className="num nm-run-pct">{fmtPct(frac * 100)}</span>
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
          <span className="muted" title="Доля «Обучение» делится между идущими проектами поровну">
            Мощность: {fmtH100e(power)} H100e
            <Cards s={s} h100e={power} />
          </span>
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

/** Срок в месяцах с одним знаком после запятой: «9,6», не меньше «0,1». */
function monthsText(days: number): string {
  return String(Math.max(0.1, Math.round((days / DAYS_IN_MONTH) * 10) / 10)).replace('.', ',');
}

/** Срок, мощность и стоимость нового проекта: одни и те же числа в левой колонке и в окне подтверждения. */
function projectNumbers(s: GameState, est: Est) {
  const days = est.days;
  const share = s.compute.alloc.training;
  // Новый проект делит долю «Обучение» с идущими: его аренда - соответствующая часть аренды доли.
  const power = trainingPoolPerRun(s, 1);
  const rentDay = (rentPerDay(s) * share) / (s.trainings.length + 1);
  const rent = days !== null ? days * rentDay : null;
  const cost = rent !== null ? rent + est.labelers : null;
  return { days, power, rentDay, rent, cost };
}

function Summary(props: { s: GameState; plan: TrainingPlan; est: Est | null; open: OpenFn }) {
  const { s, plan, est, open } = props;
  if (!est) return <div className="error">Оценка проекта недоступна.</div>;

  const overhead = trainOverhead(s.day);
  const { days, power, rentDay, rent, cost } = projectNumbers(s, est);
  const late = days !== null && s.day + days > END_DAY;
  const dayText = days !== null ? daysText(days) : null;
  const fc = est.forecast;
  const hasFit = plan.benchShare > 0 && plan.benchTargets.length > 0;
  const scoreIds = fc ? introducedBenchmarks(s).filter((b) => fc.scores[b] !== undefined) : [];
  const [rangeLo, rangeHi] = tierSpan(s.day, plan.tier);

  const costTitle =
    rent !== null
      ? `Аренда доли «Обучение» за весь срок: ${endSentence(fmtMoney(rent))}${est.labelers > 0 ? ` Разметчики: ${endSentence(fmtMoney(est.labelers))}` : ''} Оценка по сегодняшним ценам.`
      : undefined;

  return (
    <>
      <Item label="Уровень" sub={`Размер от ${fmtParams(rangeLo)} до ${fmtParams(rangeHi)}`}>
        <TierBadge tier={plan.tier} />
      </Item>
      <div className={`nm-eta${late ? ' late' : ''}${days === null ? ' none' : ''}`}>
        <div className="nm-item-l">Срок обучения</div>
        <div className="nm-eta-v">
          {dayText ? (
            <>
              {dayText.main} {dayText.approx && <small>{dayText.approx}</small>}
            </>
          ) : (
            '-'
          )}
        </div>
        <div className="nm-eta-s">
          {days !== null ? `Готово ${formatDateShort(s.day + days)}${late ? ', позже конца игры' : ''}` : 'Нет мощности на обучение'}
        </div>
        <div
          className="nm-eta-s"
          title={
            s.trainings.length > 0
              ? 'Доля «Обучение» делится поровну между идущими проектами и этим'
              : 'Вся доля «Обучение» работает на этот проект'
          }
        >
          Мощность: {fmtH100e(power)} H100e
          <Cards s={s} h100e={power} block />
        </div>
      </div>
      <Item label="Стоимость проекта" title={costTitle} tone="cost">
        {cost !== null ? (
          <>
            ≈ {fmtMoney(cost)}{' '}
            {/* Срок в месяцах меняется вместе с планом, поэтому скобка обновляется вместе с суммой. */}
            <small>
              ({monthsText(days ?? 0)} мес. по {fmtMoney(rentDay * DAYS_IN_MONTH)})
            </small>
          </>
        ) : (
          '-'
        )}
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
        sub={overhead >= 1.05 ? `Ранние фреймворки и сети: обучение дольше ${timesWord(overhead >= 10 ? Math.round(overhead) : overhead)}, к середине 2020 года - как на зрелом стеке.` : undefined}
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

// ---------- Уровень ----------

const TIER_LOCKED = 'Передний край ещё мал для этого уровня.';
const CONTEXT_LOCKED = 'Нужен следующий уровень исследования «Длинный контекст».';

/** Один вариант уровня: название, размеры, цены по умолчанию и сколько пользователей обслужит карта H100e. */
function TierOption(props: { s: GameState; tier: Tier; selected: boolean; onPick: () => void }) {
  const { s, tier, selected } = props;
  const avail = tierAvailable(s.day, tier);
  const [lo, hi] = tierSpan(s.day, tier);
  const preset = tierPreset(s, tier);
  const apiPrice = TIER_API_PRICE_MULT[tier] * refPrice(s.day);
  const users = (servingTokensPerH100eDay(preset.paramsB) * servingMult(s, { techs: modelTechs(s) })) / TOKENS_PER_USER_DAY;
  const market = rivalsSellByApi(s);
  const [note, flash] = useFlash();
  return (
    <div className="nm-tier-wrap" title={avail ? undefined : TIER_LOCKED}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={!avail || undefined}
        className={`nm-tier ${tier}${selected ? ' on' : ''}`}
        onClick={avail ? props.onPick : () => flash(TIER_LOCKED)}
      >
        <span className="nm-tier-name">{TIER_NAMES[tier]}</span>
        <span className="nm-tier-range">
          {avail ? `от ${fmtParams(lo)} до ${fmtParams(hi)} параметров` : 'Пока недоступна'}
        </span>
        {/* Пока рынка API нет (соперники не продают), цен и числа пользователей показывать нечему. */}
        {market && (
          <>
            <span className="nm-tier-price" title="Цены при выпуске по умолчанию: их можно изменить в окне «Модели».">
              API ≈ {fmtPrice(apiPrice)} за 1 млн
              {subsOpen(s.day) && `, подписка ${fmtPrice(TIER_SUBS_PRICE[tier])} в месяц`}
            </span>
            <span
              className="nm-tier-users"
              title={`Сколько пользователей (по ${fmtNum(TOKENS_PER_USER_DAY)} токенов в день) обслужит одна карта H100e на модели такого размера.`}
            >
              ≈ {fmtNum(Math.round(users))} пользователей на H100e
            </span>
          </>
        )}
      </button>
      <DenyNote text={note} />
    </div>
  );
}

function TierBlock(props: { s: GameState; value: Tier; onChange: (t: Tier) => void }) {
  return (
    <section className="nm-block">
      <h2 className="nm-h">Уровень</h2>
      <div className="nm-tiers" role="radiogroup" aria-label="Уровень модели">
        {TIER_IDS.map((t) => (
          <TierOption key={t} s={props.s} tier={t} selected={props.value === t} onPick={() => props.onChange(t)} />
        ))}
      </div>
    </section>
  );
}

// ---------- Подтверждение ----------

/** Окно перед стартом: стоимость, срок и мощность проекта, кнопка-глагол. */
function StartConfirm(props: { s: GameState; plan: TrainingPlan; est: Est; onConfirm: () => void; onClose: () => void }) {
  const { s, plan, est } = props;
  const { days, power, cost, rent } = projectNumbers(s, est);
  return (
    <ConfirmDialog title="Начать обучение" confirmLabel="Начать обучение" onConfirm={props.onConfirm} onClose={props.onClose}>
      <p className="nm-confirm-name">
        «{plan.name}», {fmtParams(plan.paramsB)} параметров, уровень «{TIER_NAMES[plan.tier]}»
      </p>
      <dl className="nm-confirm">
        <dt>Стоимость</dt>
        <dd className="cost">{cost !== null ? `≈ ${fmtMoney(cost)}` : '-'}</dd>
        {est.labelers > 0 && (
          <>
            <dt>Из них разметчики</dt>
            <dd>{fmtMoney(est.labelers)}</dd>
          </>
        )}
        {rent !== null && (
          <>
            <dt>Аренда за весь срок</dt>
            <dd>{fmtMoney(rent)}</dd>
          </>
        )}
        <dt>Срок</dt>
        <dd>{days !== null ? `${fmtDays(Math.ceil(days))}, готово ${formatDateShort(s.day + days)}` : 'нет мощности на обучение'}</dd>
        <dt>Мощность</dt>
        <dd>
          {fmtH100e(power)} H100e <Cards s={s} h100e={power} />
        </dd>
      </dl>
      {s.trainings.length > 0 && <p className="nm-confirm-note">Доля «Обучение» разделится поровну между проектами: идущий станет медленнее.</p>}
    </ConfirmDialog>
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

  // Уровень и размер приводим к сегодняшним границам: черновик мог пережить смену года.
  const tier = pickTier(s, d.tier);
  const paramsB = fitTier(d.paramsB, s.day, tier);
  const [sizeMin, sizeMax] = tierSpan(s.day, tier);
  const slotsFull = s.trainings.length >= MAX_TRAININGS;
  const year = yearOf(s.day);
  const maxTokens = maxTokensB(s);
  const tokens = Math.min(d.tokensB, maxTokens);
  const benches = introducedBenchmarks(s);
  const rlhfDone = s.research.done.includes('rlhf');
  // Названия по умолчанию идут подряд, с учётом проектов, которые ещё обучаются.
  const nameValue = d.name ?? `Модель ${s.nextModelNum + s.trainings.length}`;
  const ctxMax = maxContext(s);

  const plan: TrainingPlan = {
    name: nameValue,
    paramsB,
    tokensB: tokens,
    mix: { language: d.mix.language / 100, code: d.mix.code / 100, reasoning: d.mix.reasoning / 100 },
    benchShare: d.share / 100,
    benchTargets: d.share > 0 ? d.targets : [],
    rlhf: d.rlhf && rlhfDone,
    context: d.context !== null && d.context <= ctxMax ? d.context : ctxMax,
    tier,
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
  const atOptimum = opt !== null && Math.abs(optParams / paramsB - 1) < 0.01 && Math.abs(optTokens / tokens - 1) < 0.01;
  // Оптимум для того же объёма вычислений может не помещаться в границы выбранного уровня.
  const optOutside = opt !== null && (optParams < sizeMin || optParams > sizeMax);

  const rlhfCost = labelersCost({ ...plan, rlhf: true });
  const rlhfShort = plan.rlhf && rlhfCost > s.cash;

  function toggleTarget(b: BenchmarkId) {
    const has = d.targets.includes(b);
    if (!has && d.targets.length >= MAX_BENCH_TARGETS) return;
    patch({ targets: has ? d.targets.filter((x) => x !== b) : [...d.targets, b] });
  }

  function applyOptimal() {
    if (!opt || optOutside) return;
    patch({ paramsB: optParams, tokensB: optTokens });
  }

  // Выбор уровня подставляет пресет: размер и данные. Повторный щелчок по выбранному уровню ничего не меняет.
  function chooseTier(next: Tier) {
    if (next === tier) return;
    patch({ tier: next, ...presetOf(s, next) });
  }

  const [confirmStart, setConfirmStart] = useState(false);

  function start() {
    setConfirmStart(false);
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
            {reason && (slotsFull ? <div className="nm-reason warn">{reason}</div> : <ErrorText error={reason} />)}
            <ErrorText error={err} />
            <GuardButton
              className="btn primary wide nm-start"
              data-tutorial="train-start"
              reason={canStart ? null : (reason ?? 'Обучение сейчас начать нельзя.')}
              onClick={() => setConfirmStart(true)}
            >
              Начать обучение
            </GuardButton>
          </div>
        </aside>

        <div className="nm-area">
          {noCompute && <NoComputeAlert s={s} open={open} />}
          {s.trainings.length === 1 && (
            <Alert tone="info">Второй проект разделит долю «Обучение» пополам: срок текущего проекта вырастет вдвое.</Alert>
          )}
          {slotsFull && <Alert tone="info">Идут два проекта обучения: новый можно начать после завершения одного из них.</Alert>}

          {/* Два проекта уже идут: форма заблокирована целиком (disabled у fieldset отключает все поля внутри). */}
          <fieldset className="nm-fields" disabled={slotsFull}>
            <TierBlock s={s} value={tier} onChange={chooseTier} />

            <section className="nm-block">
              <h2 className="nm-h">Размер</h2>
              <div className="nm-size">
                <div>
                  <ModelChip name={nameValue} paramsB={paramsB} arch={archName(archFor(s))} />
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
                    text={fmtParams(paramsB)}
                    value={toPos(paramsB, sizeMin, sizeMax)}
                    min={0}
                    max={POS_MAX}
                    onChange={(v) => patch({ paramsB: fromPos(v, sizeMin, sizeMax) })}
                    ends={[fmtParams(sizeMin), fmtParams(sizeMax)]}
                    title={`Размер ограничен уровнем «${TIER_NAMES[tier]}»: сейчас от ${fmtParams(sizeMin)} до ${fmtParams(sizeMax)}. Больше параметров - больше вычислений на обучение и на каждый запрос клиента.`}
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
                        disabled={atOptimum || optOutside}
                        title={
                          atOptimum
                            ? 'Значения уже оптимальны.'
                            : optOutside
                              ? `Оптимум для этого объёма вычислений - ${fmtParams(optParams)} параметров: он вне размеров уровня «${TIER_NAMES[tier]}».`
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
          </fieldset>
        </div>
      </div>
      {confirmStart && est && <StartConfirm s={s} plan={plan} est={est} onConfirm={start} onClose={() => setConfirmStart(false)} />}
    </div>
  );
}
