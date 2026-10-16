// Окно «Новая модель» (FR-4, FR-7): сверху полоса прогноза (Эло и место, срок, стоимость), ниже три шага -
// размер, чему учить, дообучение, внизу название и кнопка старта. Данные по умолчанию подбираются под размер.

import { useEffect, useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { BENCHMARKS } from '../../data/benchmarks';
import { benchDef, DOMAIN_NAMES, introducedBenchmarks } from '../../sim/benchmarks';
import { awaitingEvent } from '../../sim/events';
import { pool, rentPerDay, totalH100e } from '../../sim/compute';
import {
  BENCH_SHARE_MAX,
  CHIN_OPT_RATIO,
  CONTEXT_LEVELS,
  EXPOSE_HYPE_MULT,
  EXPOSE_REP,
  MAX_BENCH_TARGETS,
  MAX_TRAININGS,
  RLHF_FLOP_EXTRA,
  TIER_API_PRICE_MULT,
  TIER_SUBS_PRICE,
  TOKENS_B_MIN,
  TRAIN_FLOP_PER_H100E_DAY,
} from '../../sim/constants';
import { END_DAY, formatDate, formatDateShort, yearOf } from '../../sim/time';
import { arenaStanding, bestElo, rivalsSellByApi } from '../../sim/leaderboard';
import { refContext, refPrice, subsOpen } from '../../sim/market';
import { CONTEXT_MAX_LEVEL, contextLabel, maxContext } from '../../sim/research';
import {
  chinchillaFactor,
  contextFlopMult,
  estimate,
  labelersCost,
  maxTokensB,
  tierAvailable,
  tierOf,
  tierPreset,
  tierRange,
  trainingPoolPerRun,
  trainOverhead,
  ROUGH_ELO_SPREAD,
} from '../../sim/training';
import { DOMAINS, TIER_IDS, TIER_NAMES } from '../../sim/types';
import type { BenchmarkId, DomainId, GameState, Tier, TrainingPlan, TrainingRun } from '../../sim/types';
import { Cards } from '../components/Cards';
import { Alert, ConfirmDialog, DenyNote, ErrorText, GuardButton, ProgressBar, Range, useFlash } from '../components/common';
import { TierBadge } from '../components/TierBadge';
import {
  fmtCards,
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
import { timesWord } from '../../sim/text';
import { IconLock } from '../icons';
import { actions, store } from '../store';
import { playSound } from '../sound';
import { pushNotice } from '../Toasts';
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
/**
 * Что растёт от доли области: только тесты, которые уже вышли (будущие не называем), у языка ещё Эло на «Арене».
 * Пример: «Растут SQuAT и Эло на «Арене»».
 */
export function mixGrowth(s: GameState, k: DomainId): string {
  const items = BENCHMARKS.filter((b) => b.domain === k && s.benchmarks[b.id]?.introduced).map((b) => b.name);
  if (k === 'language') items.push('Эло на «Арене»');
  if (items.length === 0) return 'Тестов по этой области пока нет';
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
  return `${items.length === 1 ? 'Растёт' : 'Растут'} ${list}`;
}
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
  /** Данные подбираются под размер (выгоднее всего по вычислениям); false - игрок задаёт объём сам. Нет поля - true. */
  autoData?: boolean;
  /** RLHF уже был исследован, когда черновик создан: выключенный тумблер - выбор игрока, а не пережиток. */
  rlhfKnown?: boolean;
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
  // Черновик старше исследования RLHF: тумблер включается сам (плейтест 16.10 - оставался выключенным).
  if (s.research.done.includes('rlhf') && !d.rlhfKnown) d = { ...d, rlhf: true, rlhfKnown: true };
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
    // После исследования RLHF включён по умолчанию (плейтест 15.10: игроки не замечали выключенный тумблер); снять можно у каждой модели.
    rlhf: (prev?.rlhf ?? false) || s.research.done.includes('rlhf'),
    rlhfKnown: s.research.done.includes('rlhf'),
    context: null,
    autoData: true,
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


/** Данные под размер: столько токенов, сколько выгоднее всего по вычислениям, но не больше, чем есть в этом году. */
export function autoTokens(s: GameState, paramsB: number): number {
  return clamp(roundSig(paramsB * CHIN_OPT_RATIO), TOKENS_B_MIN, maxTokensB(s));
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

/** Нет мощности на обучение: либо не арендовано ни одной карты, либо доля «Обучение» равна нулю. */
function NoComputeAlert({ s, open }: { s: GameState; open: OpenFn }) {
  const noGpu = totalH100e(s) <= 0;
  return (
    <Alert tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
      Нет мощности на обучение: {noGpu ? 'не арендовано ни одной карты' : 'доля «Обучение» равна 0 %'}.
    </Alert>
  );
}

const TIER_LOCKED = 'Передний край ещё мал для этого уровня.';
const CONTEXT_LOCKED = 'Нужен следующий уровень исследования «Длинный контекст».';

// ---------- Контекст ----------

/** Длина контекста: открытые уровни и следующий закрытый, в одну строку. */
function ContextSeg(props: { s: GameState; value: number; onChange: (v: number) => void }) {
  const { s, value, onChange } = props;
  const level = s.research.contextLevel;
  const shown = CONTEXT_LEVELS.slice(0, Math.min(CONTEXT_MAX_LEVEL, level + 1) + 1);
  const market = refContext(s.day);
  const [note, flash] = useFlash();
  return (
    <div className="nm-ctx-wrap">
      <div className="nm-lbl" title="Модели с контекстом длиннее обычного покупают охотнее, с коротким - реже.">
        Контекст <span className="muted">· обычный на рынке {contextLabel(market)}</span>
      </div>
      <div className="nm-seg" role="radiogroup" aria-label="Длина контекста">
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
              className={`nm-seg-opt${value === tokens ? ' on' : ''}${locked ? ' lock' : ''}`}
              title={locked ? CONTEXT_LOCKED : extra > 0 ? `Обучение дольше на ${extra} %` : 'Без надбавки к обучению'}
              onClick={() => (locked ? flash(CONTEXT_LOCKED) : onChange(tokens))}
            >
              {locked && <IconLock size={11} />}
              {contextLabel(tokens)}
              {!locked && extra > 0 && shown.length <= 3 && <small> +{extra} %</small>}
            </button>
          );
        })}
        <DenyNote text={note} />
      </div>
    </div>
  );
}

// ---------- Идущий проект ----------

/** Дней до конца обучения при текущей доле «Обучение» (она делится между проектами); null - мощности нет. */
function runEta(s: GameState, t: TrainingRun): number | null {
  const perDay = trainingPoolPerRun(s) * TRAIN_FLOP_PER_H100E_DAY;
  const left = Math.max(0, t.flopTotal - t.flopDone);
  return perDay > 0 ? Math.max(1, Math.ceil(left / perDay)) : null;
}

function RunningBar({ s, t }: { s: GameState; t: TrainingRun }) {
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const p = t.plan;
  const frac = t.flopTotal > 0 ? Math.min(1, t.flopDone / t.flopTotal) : 0;
  const eta = runEta(s, t);
  const late = eta !== null && s.day + eta > END_DAY;
  const waiting = t.failed || awaitingEvent(s, 'training-fail');
  const labelers = labelersCost(p); // оплачены при старте, при отмене не возвращаются
  const summary = [`${fmtParams(p.paramsB)} параметров`, `${fmtTokens(p.tokensB)} токенов`, p.rlhf ? 'RLHF' : '']
    .filter(Boolean)
    .join(' · ');

  function cancel() {
    const r = store.dispatch(actions.cancelTraining, t.id);
    setConfirm(false);
    setErr(r.ok ? null : r.error);
  }

  return (
    <div className="nm-run">
      <b className="nm-run-name" title={summary}>
        Идёт: «{p.name}»
      </b>
      <TierBadge tier={p.tier} plain />
      <div className="nm-run-bar">
        <ProgressBar value={frac} title={summary} />
      </div>
      <span className="nm-run-meta">
        <b>{fmtPct(frac * 100, 0)}</b>
        {' · '}
        {waiting ? (
          <span className="warn">стоит: ждёт решения в «Почте»</span>
        ) : eta !== null ? (
          <span className={late ? 'warn' : undefined}>
            готово {formatDateShort(s.day + eta)}
            {late && ', позже конца игры'}
          </span>
        ) : (
          <span className="warn">стоит: нет мощности</span>
        )}
      </span>
      <button className="btn danger small" onClick={() => setConfirm(true)}>
        Отменить
      </button>
      <ErrorText error={err} />
      {confirm && (
        <ConfirmDialog title="Отмена обучения" confirmLabel="Отменить проект" danger onConfirm={cancel} onClose={() => setConfirm(false)}>
          <div className="kv">
            <span>Проект</span>
            <span>{p.name}</span>
            <span>Готово</span>
            <span>{fmtPct(frac * 100)}</span>
            <span title="Выполненная работа пропадает: новый проект начнётся с нуля">Работа пропадёт</span>
            <span>{fmtPct(frac * 100, 0)}</span>
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

// ---------- Прогноз ----------

/** Срок, мощность и стоимость нового проекта: одни и те же числа в полосе прогноза и в окне подтверждения. */
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

/** Где окажется новая модель в гонке по прогнозу: место и кого обгонит. null - гонки ещё нет. */
function raceForecast(s: GameState, fc: NonNullable<Est['forecast']>) {
  const st = arenaStanding(s);
  if (!st) return null;
  const m = st.metric;
  const value = m.kind === 'arena' ? fc.elo : (fc.scores[m.bid] ?? 0);
  const rivals = [...st.ahead, ...st.behind];
  const place = 1 + rivals.filter((r) => r.value > value).length + (st.value > value ? 1 : 0);
  const passes = st.ahead.filter((r) => r.value < value);
  return { metric: m, value, place, passes };
}

/** Вилка грубой оценки до «Законов масштабирования»: «≈ 480-560», края округлены до 10. */
function roughRange(elo: number): string {
  const lo = Math.floor((elo * (1 - ROUGH_ELO_SPREAD)) / 10) * 10;
  const hi = Math.ceil((elo * (1 + ROUGH_ELO_SPREAD)) / 10) * 10;
  return `≈ ${fmtElo(lo)}-${fmtElo(hi)}`;
}

function Hero(props: { s: GameState; est: Est | null; open: OpenFn }) {
  const { s, est, open } = props;
  if (!est) {
    return (
      <div className="nm-hero">
        <div className="nm-kpi">Оценка проекта недоступна.</div>
      </div>
    );
  }
  const { days, power, rentDay, cost } = projectNumbers(s, est);
  const late = days !== null && s.day + days > END_DAY;
  const overhead = trainOverhead(s.day);
  const fc = est.forecast;
  const bestMine = bestElo(s, 'player');
  const prevBest = s.models.filter((m) => m.releasedDay !== null).reduce<string | null>((n, m) => (m.arenaElo >= bestMine ? m.name : n), null);
  const race = fc ? raceForecast(s, fc) : null;
  const delta = fc && bestMine > 0 ? Math.round(fc.elo - bestMine) : null;
  const short = cost !== null && cost > s.cash;

  return (
    <div className="nm-hero">
      <div className="nm-kpi nm-kpi-main">
        <div className="nm-kpi-l">Прогноз Эло</div>
        {fc ? (
          <>
            <div className="nm-kpi-v">
              {fmtElo(fc.elo)}
              {delta !== null && prevBest && (
                <span className={`nm-delta ${delta >= 0 ? 'up' : 'down'}`}>
                  {delta >= 0 ? '+' : '−'}
                  {fmtNum(Math.abs(delta))} к «{prevBest}»
                </span>
              )}
            </div>
            <div className="nm-kpi-s">
              {race ? (
                <>
                  {race.metric.kind === 'bench' ? `${race.metric.name} ≈ ${fmtPct(race.value, 1)} - ` : '«Арена»: '}
                  <span className={race.place === 1 ? 'gold' : undefined}>{race.place}-е место</span>
                  {race.passes.length > 0 &&
                    `, обгонит ${race.passes
                      .slice(-2)
                      .map((r) => r.name)
                      .join(' и ')}`}
                </>
              ) : (
                'Соперников в гонке пока нет'
              )}
            </div>
          </>
        ) : (
          <>
            <div className={`nm-kpi-v${est.roughElo === null ? ' dim' : ''}`}>{est.roughElo === null ? '?' : roughRange(est.roughElo)}</div>
            <div className="nm-kpi-s">
              {est.roughElo === null ? 'Прогноз откроется после исследования' : 'Грубо. Точный прогноз и место в гонке откроет исследование'}{' '}
              <button className="nm-link" onClick={() => open('research')}>
                «Законы масштабирования»
              </button>
            </div>
          </>
        )}
      </div>
      <div className="nm-kpi">
        <div className="nm-kpi-l">Срок</div>
        <div className={`nm-kpi-v${days === null ? ' dim' : ''}`}>{days !== null ? `${fmtNum(days)} дн.` : '-'}</div>
        <div className={`nm-kpi-s${late ? ' warn' : ''}`}>
          {days !== null ? `Готово ${formatDateShort(s.day + days)}${late ? ', позже конца игры' : ''} · ${fmtCards(s, power)}` : 'Нет мощности на обучение'}
        </div>
        {overhead >= 1.05 && (
          <span className="nm-chip warn" title="Фреймворки и сети ранних лет медленные; множитель падает каждый месяц, к середине 2020 года - обычная скорость.">
            Обучение {timesWord(overhead >= 10 ? Math.round(overhead) : overhead)} медленнее: ранние фреймворки, с каждым месяцем быстрее
          </span>
        )}
      </div>
      <div className="nm-kpi">
        <div className="nm-kpi-l">Стоимость</div>
        <div className={`nm-kpi-v${short ? ' bad' : ''}`}>{cost !== null ? fmtMoney(cost) : '-'}</div>
        <div className="nm-kpi-s">
          {cost !== null ? `${fmtMoney(rentDay * DAYS_IN_MONTH)} в месяц аренды · на счёте ${fmtMoney(s.cash)}` : 'Срок неизвестен'}
        </div>
        {est.labelers > 0 && <span className="nm-chip">Из них разметчики RLHF {fmtMoney(est.labelers)}</span>}
      </div>
    </div>
  );
}

// ---------- Уровень ----------

/** Один вариант уровня: название и размеры; цены по умолчанию - в подсказке. */
function TierOption(props: { s: GameState; tier: Tier; selected: boolean; onPick: () => void }) {
  const { s, tier, selected } = props;
  const avail = tierAvailable(s.day, tier);
  const [, hi] = tierSpan(s.day, tier);
  const apiPrice = TIER_API_PRICE_MULT[tier] * refPrice(s.day);
  const market = rivalsSellByApi(s);
  const [note, flash] = useFlash();
  const title = !avail
    ? TIER_LOCKED
    : market
      ? `Цена при выпуске по умолчанию: API ≈ ${fmtPrice(apiPrice)} за 1 млн токенов${subsOpen(s.day) ? `, подписка ${fmtPrice(TIER_SUBS_PRICE[tier])} в месяц` : ''}.`
      : undefined;
  return (
    <div className="nm-tier-wrap" title={title}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={!avail || undefined}
        className={`nm-tier ${tier}${selected ? ' on' : ''}`}
        onClick={avail ? props.onPick : () => flash(TIER_LOCKED)}
      >
        <b>{TIER_NAMES[tier]}</b>
        <span>{avail ? `до ${fmtParams(hi)}` : 'пока закрыта'}</span>
      </button>
      <DenyNote text={note} />
    </div>
  );
}

// ---------- Подтверждение ----------

/** Окно перед стартом: стоимость, срок и мощность проекта, кнопка-глагол. */
function StartConfirm(props: { s: GameState; plan: TrainingPlan; est: Est; onConfirm: () => void; onClose: () => void }) {
  const { s, plan, est } = props;
  const { days, power, cost, rent } = projectNumbers(s, est);
  return (
    <ConfirmDialog title="Начать обучение" confirmLabel="Начать обучение" tutorial="train-confirm" onConfirm={props.onConfirm} onClose={props.onClose}>
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

export default function TrainingWindow({ s, open, close }: WindowProps) {
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
  const autoData = d.autoData !== false;
  const tokens = autoData ? autoTokens(s, paramsB) : Math.min(d.tokensB, maxTokens);
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
  const nums = est ? projectNumbers(s, est) : null;

  // Насколько данные подходят к размеру: при автоподборе отстаём, только если данных в этом году мало.
  const eff = chinchillaFactor(plan.paramsB, plan.tokensB);
  const wantTokens = paramsB * CHIN_OPT_RATIO;
  const dataShort = tokens < wantTokens * 0.95;
  const dataLine = autoData
    ? dataShort
      ? `Данных в ${year} году мало: ${fmtTokens(tokens)} из ${fmtTokens(wantTokens)} токенов. Модель недоучится.`
      : `Данные подобраны под размер: ${fmtTokens(tokens)} токенов`
    : eff >= EFF_GOOD
      ? `${fmtTokens(tokens)} токенов: хорошо подходит к размеру`
      : tokens > wantTokens
        ? `${fmtTokens(tokens)} токенов: больше, чем выгодно. Качество выше, обучение дороже.`
        : `${fmtTokens(tokens)} токенов: мало для такого размера. Часть вычислений пропадёт.`;
  const dataTone = (autoData && !dataShort) || (!autoData && eff >= EFF_GOOD) ? 'good' : eff >= EFF_BAD ? 'warn' : 'bad';

  const rlhfCost = labelersCost({ ...plan, rlhf: true });
  const rlhfShort = plan.rlhf && rlhfCost > s.cash;

  function toggleTarget(b: BenchmarkId) {
    const has = d.targets.includes(b);
    if (!has && d.targets.length >= MAX_BENCH_TARGETS) return;
    patch({ targets: has ? d.targets.filter((x) => x !== b) : [...d.targets, b] });
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
      // Ответ на действие: окно закрывается, звук и уведомление со сроком; ход обучения - в «Моделях» и на рабочем столе.
      const run = s.trainings[s.trainings.length - 1];
      const eta = run ? runEta(s, run) : null;
      playSound('rack');
      pushNotice({
        kind: 'training',
        label: 'Обучение началось',
        title: eta !== null ? `«${plan.name}»: готово ${formatDate(s.day + eta)}` : `«${plan.name}»: ждёт мощности в доле «Обучение»`,
        win: 'models',
        tone: 'good',
      });
      close?.();
    } else {
      setErr(r.error);
    }
  }

  const fitLine =
    d.share > 0 && d.targets.length === 0
      ? 'Тесты не выбраны: доля данных потратится впустую.'
      : `Каждый месяц подгонку могут раскрыть: репутация −${fmtNum(Math.abs(EXPOSE_REP))}, шумиха −${fmtPct((1 - EXPOSE_HYPE_MULT) * 100, 0)}.`;

  const footInfo = slotsFull
    ? 'Идут два проекта обучения: новый можно начать после завершения одного из них.'
    : s.trainings.length === 1
      ? `Доля «Обучение» разделится с «${s.trainings[0].plan.name}»: он закончит позже.`
      : null;

  return (
    <div className="nm">
      {s.trainings.map((t) => (
        <RunningBar key={t.id} s={s} t={t} />
      ))}

      <Hero s={s} est={est} open={open} />

      <div className="nm-body">
        {noCompute && <NoComputeAlert s={s} open={open} />}
        {/* Два проекта уже идут: форма заблокирована целиком (disabled у fieldset отключает все поля внутри). */}
        <fieldset className="nm-steps" disabled={slotsFull}>
          <section className="nm-card">
            <h2 className="nm-h">
              <span className="nm-n">1</span>Размер
            </h2>
            <div className="nm-tiers" role="radiogroup" aria-label="Уровень модели">
              {TIER_IDS.map((t) => (
                <TierOption key={t} s={s} tier={t} selected={tier === t} onPick={() => chooseTier(t)} />
              ))}
            </div>
            <Slider
              label="Параметры"
              text={fmtParams(paramsB)}
              value={toPos(paramsB, sizeMin, sizeMax)}
              min={0}
              max={POS_MAX}
              onChange={(v) => patch({ paramsB: fromPos(v, sizeMin, sizeMax) })}
              ends={[fmtParams(sizeMin), fmtParams(sizeMax)]}
              title={`Размер ограничен уровнем «${TIER_NAMES[tier]}». Больше параметров - модель сильнее, но обучение дольше и каждый запрос клиента дороже.`}
              ariaLabel="Параметры"
            />
            {!autoData && (
              <Slider
                label="Данные, токены"
                text={fmtTokens(tokens)}
                value={toPos(tokens, TOKENS_B_MIN, maxTokens)}
                min={0}
                max={POS_MAX}
                onChange={(v) => patch({ tokensB: fromPos(v, TOKENS_B_MIN, maxTokens) })}
                ends={[fmtTokens(TOKENS_B_MIN), fmtTokens(maxTokens)]}
                title={`Максимум данных в ${year} году: ${fmtTokens(maxTokens)} токенов.`}
                ariaLabel="Данные, токены"
              />
            )}
            <div className={`nm-data ${dataTone}`}>
              <span>{dataLine}</span>
              <button type="button" className="nm-link" onClick={() => patch(autoData ? { autoData: false, tokensB: tokens } : { autoData: true })}>
                {autoData ? 'Настроить вручную' : 'Подбирать под размер'}
              </button>
            </div>
            <ContextSeg s={s} value={plan.context} onChange={(context) => patch({ context })} />
          </section>

          <section className="nm-card">
            <h2 className="nm-h" title="Доли в сумме дают 100 %: при движении одного ползунка остальные подстраиваются.">
              <span className="nm-n">2</span>Чему учить
            </h2>
            <div className="nm-mixbar" aria-hidden="true">
              {DOMAINS.map((k) => (
                <div key={k} style={{ width: `${d.mix[k]}%`, background: DOMAIN_COLOR[k] }} />
              ))}
            </div>
            {DOMAINS.map((k) => (
              <div key={k} className="nm-mix-row" title={DOMAIN_WHAT[k]}>
                <div className="nm-mix-top">
                  <span className="nm-mix-name">
                    <span className="nm-dot" style={{ background: DOMAIN_COLOR[k] }} />
                    {DOMAIN_RU[k]}
                  </span>
                  <span className="nm-mix-pct num">{fmtPct(d.mix[k], 0)}</span>
                </div>
                <Range
                  value={d.mix[k]}
                  min={0}
                  max={100}
                  color={DOMAIN_COLOR[k]}
                  label={DOMAIN_RU[k]}
                  valueText={fmtPct(d.mix[k], 0)}
                  onChange={(v) => patch({ mix: rescaleMix(d.mix, k, v) })}
                />
                <span className="nm-mix-what">{mixGrowth(s, k)}</span>
              </div>
            ))}
          </section>

          <section className="nm-card">
            <h2 className="nm-h">
              <span className="nm-n">3</span>Дообучение
            </h2>
            <label
              className={`nm-opt${rlhfDone ? '' : ' off'}${plan.rlhf ? ' on' : ''}`}
              title={rlhfDone ? `Вычислений нужно на ${fmtPct(RLHF_FLOP_EXTRA * 100, 0)} больше. Разметчикам платят при старте.` : undefined}
            >
              <span className="nm-opt-top">
                <span>Отзывы людей (RLHF)</span>
                <input type="checkbox" className="nm-switch" checked={plan.rlhf} disabled={!rlhfDone} onChange={(e) => patch({ rlhf: e.target.checked })} />
              </span>
              <span className="nm-opt-d">
                Модель отвечает как собеседник: Эло выше.{' '}
                {rlhfDone ? (
                  <span className={rlhfShort ? 'bad' : undefined}>
                    Разметчики {fmtMoney(rlhfCost)}, обучение дольше на {fmtPct(RLHF_FLOP_EXTRA * 100, 0)}.
                  </span>
                ) : (
                  <>
                    Нужно исследование.{' '}
                    <button type="button" className="nm-link" onClick={() => open('research')}>
                      Открыть «Исследования»
                    </button>
                  </>
                )}
              </span>
            </label>

            <div className={`nm-opt risk${d.share > 0 ? ' on' : ''}`}>
              <Slider
                label="Подгонка под тесты"
                text={fmtPct(d.share, 0)}
                value={d.share}
                min={0}
                max={Math.round(BENCH_SHARE_MAX * 100)}
                onChange={(v) => patch({ share: v })}
                color="var(--c-red)"
                ariaLabel="Подгонка под тесты"
              />
              {d.share > 0 && benches.length > 0 && (
                <div className="nm-tags">
                  {benches.map((b) => {
                    const def = benchDef(b);
                    const checked = d.targets.includes(b);
                    const full = !checked && d.targets.length >= MAX_BENCH_TARGETS;
                    return (
                      <label
                        key={b}
                        className={`nm-tag${checked ? ' on' : ''}${full ? ' off' : ''}`}
                        title={full ? `Выбрано максимум тестов: ${MAX_BENCH_TARGETS}.` : `${def.description} Область: ${DOMAIN_RU[def.domain]}.`}
                      >
                        <input type="checkbox" checked={checked} disabled={full} onChange={() => toggleTarget(b)} />
                        {def.name}
                      </label>
                    );
                  })}
                </div>
              )}
              <span className="nm-opt-d">Баллы выше, настоящее качество и Эло ниже. {d.share > 0 ? fitLine : 'Подгонку могут раскрыть.'}</span>
            </div>
          </section>
        </fieldset>
      </div>

      <div className="nm-foot">
        <label className="nm-name-wrap">
          <span className="nm-lbl">Название</span>
          <input type="text" className="nm-name" maxLength={NAME_MAX} value={nameValue} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <div className="nm-foot-info">
          {footInfo && <span>{footInfo}</span>}
          {reason && !slotsFull && <ErrorText error={reason} />}
          <ErrorText error={err} />
        </div>
        <GuardButton
          className="btn primary nm-start"
          data-tutorial="train-start"
          reason={canStart ? null : (reason ?? 'Обучение сейчас начать нельзя.')}
          onClick={() => setConfirmStart(true)}
        >
          Начать обучение
          {nums && nums.cost !== null && nums.days !== null && (
            <small>
              {fmtMoney(nums.cost)} · {fmtNum(nums.days)} дн.
            </small>
          )}
        </GuardButton>
      </div>
      {confirmStart && est && <StartConfirm s={s} plan={plan} est={est} onConfirm={start} onClose={() => setConfirmStart(false)} />}
    </div>
  );
}
