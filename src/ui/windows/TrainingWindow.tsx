// Окно «Обучение» (FR-4, FR-7): идущий проект и форма нового проекта с оценкой и прогнозом.

import { useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { benchDef, benchScore, introducedBenchmarks } from '../../sim/benchmarks';
import { pool, rentPerDay, totalH100e } from '../../sim/compute';
import {
  ARCH_MULT,
  BENCH_SHARE_MAX,
  CHIN_OPT_RATIO,
  MAX_BENCH_TARGETS,
  MAX_TOKENS_B,
  PARAMS_B_MAX,
  PARAMS_B_MIN,
  RLHF_FLOP_EXTRA,
  TOKENS_B_MIN,
  TRAIN_FLOP_PER_H100E_DAY,
} from '../../sim/constants';
import { byYear, END_DAY, formatDateShort, yearOf } from '../../sim/time';
import { endSentence } from '../../sim/text';
import { chinchillaFactor, estimate } from '../../sim/training';
import { DOMAINS } from '../../sim/types';
import type { BenchmarkId, DomainId, GameState, TrainingPlan, TrainingRun } from '../../sim/types';
import { ErrorText, ProgressBar } from '../components/common';
import { fmtElo, fmtMoney, fmtNum, fmtParams, fmtPct, fmtSci, fmtTokens } from '../format';
import { actions, store } from '../store';

type Est = ReturnType<typeof estimate>;
type OpenFn = WindowProps['open'];

const DOMAIN_RU: Record<DomainId, string> = { language: 'Язык', code: 'Код', reasoning: 'Рассуждения' };
const POS_MAX = 1000;
// Доля полезных вычислений (множитель Шиншиллы): от 80 % баланс считаем хорошим, ниже 40 % — плохим.
const RATIO_GOOD_EFF = 0.8;
const RATIO_BAD_EFF = 0.4;

// ---------- Мелкие помощники ----------

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

/** Срок в днях с подсказкой в месяцах или годах. */
function fmtDays(d: number): string {
  const days = `${fmtNum(d)} дн.`;
  if (d < 60) return days;
  if (d < 730) return `${days} (≈ ${fmtNum(Math.round(d / 30.4))} мес.)`;
  return `${days} (≈ ${fmtNum(Math.round((d / 365.25) * 10) / 10)} г.)`;
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

function Hint({ children }: { children: ReactNode }) {
  return <div className="muted small">{children}</div>;
}

function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div>
        {children}
        {hint && <Hint>{hint}</Hint>}
      </div>
    </div>
  );
}

function LogSlider(props: { value: number; min: number; max: number; onChange: (v: number) => void; format: (v: number) => string }) {
  const { value, min, max, onChange, format } = props;
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input
        type="range"
        className="grow"
        style={{ minWidth: 0 }}
        min={0}
        max={POS_MAX}
        step={1}
        value={toPos(value, min, max)}
        onChange={(e) => onChange(fromPos(Number(e.target.value), min, max))}
      />
      <span className="num" style={{ minWidth: 84 }}>{format(value)}</span>
    </div>
  );
}

function PctSlider({ value, max = 100, onChange }: { value: number; max?: number; onChange: (v: number) => void }) {
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input
        type="range"
        className="grow"
        style={{ minWidth: 0 }}
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="num" style={{ minWidth: 84 }}>{fmtPct(value, 0)}</span>
    </div>
  );
}

/** Нет мощности на обучение: либо не арендовано ни одной карты, либо доля «Обучение» равна нулю. */
function NoComputeNote({ s, open, lead }: { s: GameState; open: OpenFn; lead: string }) {
  const noGpu = totalH100e(s) <= 0;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row">
        <span className="warn">
          {lead}: {noGpu ? 'не арендовано ни одного GPU' : 'доля «Обучение» равна нулю'}.
        </span>
        <button className="btn small" onClick={() => open('compute')}>Открыть «Мощности»</button>
      </div>
      <div className="muted small">
        {noGpu
          ? 'Арендуйте видеокарты в окне «Мощности»: без них ни один проект не продвигается.'
          : 'Поднимите ползунок «Обучение» в окне «Мощности»: сейчас вся арендованная мощность отдана другим задачам.'}
      </div>
    </div>
  );
}

/**
 * Соотношение данных и размера: ориентир около 20 токенов на параметр (CHIN_OPT_RATIO).
 * Показываем всегда; точный оптимум для бюджета и прогноз открывают «Законы масштабирования».
 */
function RatioField({ s, plan, maxTokens }: { s: GameState; plan: TrainingPlan; maxTokens: number }) {
  const ratio = plan.tokensB / plan.paramsB;
  const eff = chinchillaFactor(plan.paramsB, plan.tokensB);
  const good = eff >= RATIO_GOOD_EFF;
  const tone = good ? 'good' : eff >= RATIO_BAD_EFF ? 'warn' : 'bad';
  const tooFewData = ratio < CHIN_OPT_RATIO;
  const dataCapped = plan.tokensB >= maxTokens * 0.999;
  const advice = tooFewData
    ? dataCapped
      ? `Больше данных в ${yearOf(s.day)} году в мире нет, поэтому лучше уменьшить размер модели.`
      : 'Добавьте данных или уменьшите размер модели.'
    : 'Увеличьте размер модели или уменьшите объём данных.';

  return (
    <Field
      label="Токенов на параметр"
      hint={
        <>
          Правило: на каждый параметр нужно около {CHIN_OPT_RATIO} токенов данных. Если размер и данные сильно расходятся,
          часть вычислений пропадает впустую.
          {!s.research.done.includes('scaling') && ' Точный оптимум для вашего бюджета и прогноз качества покажут «Законы масштабирования».'}
        </>
      }
    >
      <span className={tone}>
        <b className="num">{fmtNum(ratio)}</b>
        {good ? ' — баланс хороший' : ' — баланс нарушен'}
      </span>
      {!good && (
        <div className={`small ${tone}`}>
          В дело идёт только около {fmtPct(eff * 100, 0)} потраченных вычислений. {advice}
        </div>
      )}
    </Field>
  );
}

// ---------- Идущий проект ----------

function RunningCard({ s, t, open }: { s: GameState; t: TrainingRun; open: OpenFn }) {
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const frac = t.flopTotal > 0 ? Math.min(1, t.flopDone / t.flopTotal) : 0;
  const perDay = pool(s, 'training') * TRAIN_FLOP_PER_H100E_DAY;
  const left = Math.max(0, t.flopTotal - t.flopDone);
  const eta = perDay > 0 ? Math.max(1, Math.ceil(left / perDay)) : null;
  const p = t.plan;
  const targets = p.benchShare > 0 ? p.benchTargets.map((b) => benchDef(b).name).join(', ') : '';

  function cancel() {
    const r = store.dispatch(actions.cancelTraining);
    setConfirm(false);
    setErr(r.ok ? null : r.error);
  }

  return (
    <div className="card col">
      <div className="row">
        <b className="grow">Идёт обучение: «{p.name}»</b>
        <span className="num">{fmtPct(frac * 100)}</span>
      </div>
      <ProgressBar value={frac} title={`${fmtSci(t.flopDone)} из ${fmtSci(t.flopTotal)} FLOP`} />
      <div className="muted small">
        Вычислений сделано: {fmtSci(t.flopDone)} из {fmtSci(t.flopTotal)} FLOP
      </div>
      {eta !== null ? (
        <div>
          Осталось ≈ {fmtDays(eta)}, готово около {formatDateShort(s.day + eta)}
          {s.day + eta > END_DAY && <span className="warn"> — это позже конца игры</span>}
        </div>
      ) : (
        <NoComputeNote s={s} open={open} lead="Обучение стоит" />
      )}
      <div className="muted small">
        {t.arch === 'transformer' ? 'Трансформер' : 'LSTM'} · {fmtParams(p.paramsB)} параметров · {fmtTokens(p.tokensB)} токенов
        {p.rlhf && ' · с RLHF'}
        {targets && ` · подгонка ${fmtPct(p.benchShare * 100, 0)} под: ${targets}`}
      </div>
      {confirm ? (
        <div className="row">
          <span className="warn">Отменить проект? Затраченные вычисления и деньги разметчикам не вернутся.</span>
          <button className="btn danger small" onClick={cancel}>Да, отменить</button>
          <button className="btn small" onClick={() => setConfirm(false)}>Нет</button>
        </div>
      ) : (
        <div className="row">
          <button className="btn danger small" onClick={() => setConfirm(true)}>Отменить</button>
        </div>
      )}
      <ErrorText error={err} />
    </div>
  );
}

// ---------- Оценка проекта ----------

function ForecastTable({ s, plan, fc }: { s: GameState; plan: TrainingPlan; fc: NonNullable<Est['forecast']> }) {
  const ids = introducedBenchmarks(s).filter((b) => fc.scores[b] !== undefined);
  const hasOverfit = plan.benchShare > 0 && plan.benchTargets.length > 0;
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Тест</th>
          <th>Область</th>
          <th className="num">Балл</th>
          {hasOverfit && <th className="num" title="Балл без подгонки: так модель покажет себя на новых вопросах">Без подгонки</th>}
        </tr>
      </thead>
      <tbody>
        {ids.map((b) => {
          const def = benchDef(b);
          const target = hasOverfit && plan.benchTargets.includes(b);
          return (
            <tr key={b}>
              <td>
                {def.name}
                {target && <span className="muted small"> · цель</span>}
              </td>
              <td className="muted">{DOMAIN_RU[def.domain]}</td>
              <td className="num">{fmtPct(fc.scores[b] ?? 0)}</td>
              {hasOverfit && <td className="num muted">{fmtPct(benchScore(b, fc.caps[def.domain], 0))}</td>}
            </tr>
          );
        })}
        <tr>
          <td>Арена (Эло)</td>
          <td className="muted">настоящее качество</td>
          <td className="num" colSpan={hasOverfit ? 2 : 1}>{fmtElo(fc.elo)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function EstimateCard(props: {
  s: GameState;
  plan: TrainingPlan;
  est: Est | null;
  maxTokens: number;
  open: OpenFn;
  onApplyOptimal: () => void;
}) {
  const { s, plan, est, maxTokens, open, onApplyOptimal } = props;
  if (!est) {
    return (
      <div className="card">
        <div className="section-title">Оценка проекта</div>
        <div className="error">Не удалось посчитать оценку. Попробуйте изменить параметры проекта.</div>
      </div>
    );
  }

  const trainPool = pool(s, 'training');
  const total = totalH100e(s);
  const opt = est.optimal;
  const limited = opt !== null && (opt.tokensB > maxTokens || opt.tokensB < TOKENS_B_MIN || opt.paramsB > PARAMS_B_MAX || opt.paramsB < PARAMS_B_MIN);
  const lateFinish = est.days !== null && s.day + est.days > END_DAY;
  // Деньги проекта: часть аренды парка, занятая обучением, за весь срок (приблизительно: по сегодняшней аренде) плюс разметчики.
  const rentShare = est.days !== null && total > 0 ? est.days * rentPerDay(s) * (trainPool / total) : null;

  return (
    <div className="card col">
      <div className="section-title">Оценка проекта</div>
      <Field label="Нужно вычислений">{fmtSci(est.flop)} FLOP</Field>
      <Field
        label="Архитектура"
        hint={
          est.arch === 'lstm' ? (
            <>
              LSTM примерно в {Math.round(1 / ARCH_MULT.lstm)} раз менее эффективна, чем трансформер. Трансформер откроется после
              исследования «Механизм внимания».{' '}
              <button className="btn small" onClick={() => open('research')}>Исследования</button>
            </>
          ) : undefined
        }
      >
        {est.arch === 'transformer' ? 'Трансформер' : 'LSTM (устаревшая)'}
      </Field>
      <Field label="Срок обучения" hint={`При текущей мощности «Обучение»: ${fmtNum(trainPool)} H100e.`}>
        {est.days !== null ? (
          <>
            {fmtDays(est.days)}
            {lateFinish && <span className="warn"> — не успеет до конца игры</span>}
          </>
        ) : (
          <NoComputeNote s={s} open={open} lead="Обучение не пойдёт" />
        )}
      </Field>
      {rentShare !== null && (
        <Field
          label="Стоимость проекта"
          hint={
            [
              plan.rlhf
                ? `Аренда доли «Обучение» за весь срок — ${fmtMoney(rentShare)}`
                : 'Это аренда доли «Обучение» за весь срок',
              ...(plan.rlhf ? [`Разметчики — ${fmtMoney(est.labelers)}`] : []),
              'Оценка по сегодняшним ценам: аренду вы платите и без проекта, проект лишь занимает часть парка',
            ]
              .map(endSentence)
              .join(' ')
          }
        >
          ≈ {fmtMoney(rentShare + est.labelers)}
        </Field>
      )}
      {plan.rlhf && (
        <Field
          label="Разметчики (RLHF)"
          hint={
            <>
              {endSentence(`На счету: ${fmtMoney(s.cash)}`)} Вычислений станет больше на {fmtPct(RLHF_FLOP_EXTRA * 100, 0)}.
              {trainPool <= 0 && (
                <div className="warn">
                  Запуск закрыт: разметчикам платят сразу, а без мощности на обучение проект стоит. Сначала выделите мощность на обучение.
                </div>
              )}
            </>
          }
        >
          <span className={est.labelers > s.cash ? 'bad' : undefined}>{fmtMoney(est.labelers)}</span> при старте
        </Field>
      )}

      <div className="section-title">Прогноз качества</div>
      {est.forecast ? (
        <ForecastTable s={s} plan={plan} fc={est.forecast} />
      ) : (
        <div className="row">
          <span className="muted">Прогноз: ??? — изучите «Законы масштабирования».</span>
          <button className="btn small" onClick={() => open('research')}>Исследования</button>
        </div>
      )}

      {opt && (
        <div className="col" style={{ gap: 4 }}>
          <div className="row">
            <span>
              Оптимум для этого бюджета: <b>{fmtParams(opt.paramsB)}</b> параметров, <b>{fmtTokens(opt.tokensB)}</b> токенов.
            </span>
            <button className="btn small" onClick={onApplyOptimal}>Подставить</button>
          </div>
          <Hint>
            Тот же объём вычислений с оптимальным балансом: около {CHIN_OPT_RATIO} токенов на параметр.
            {limited && ` Оптимум выходит за допустимые границы (данных в мире в ${yearOf(s.day)} году не больше ${fmtTokens(maxTokens)}): подставится ближайшее допустимое.`}
          </Hint>
        </div>
      )}

      <ErrorText error={est.error} />
    </div>
  );
}

// ---------- Окно ----------

export default function TrainingWindow({ s, open }: WindowProps) {
  // Новый проект начинается с прошлого (или идущего): обычно следующую модель делают чуть больше.
  const prev = s.training?.plan ?? s.models.at(-1)?.plan;
  const [name, setName] = useState<string | null>(null); // null — название по умолчанию «Модель N»
  const [paramsB, setParamsB] = useState(prev?.paramsB ?? 0.1);
  const [tokensB, setTokensB] = useState(prev?.tokensB ?? 1);
  const [mix, setMix] = useState<Record<DomainId, number>>(
    prev
      ? { language: Math.round(prev.mix.language * 100), code: Math.round(prev.mix.code * 100), reasoning: Math.round(prev.mix.reasoning * 100) }
      : { language: 50, code: 25, reasoning: 25 },
  );
  const [share, setShare] = useState(0);
  const [targets, setTargets] = useState<BenchmarkId[]>([]);
  const [rlhf, setRlhf] = useState(prev?.rlhf ?? false);
  const [err, setErr] = useState<string | null>(null);

  const maxTokens = byYear(MAX_TOKENS_B, yearOf(s.day));
  const tokens = Math.min(tokensB, maxTokens);
  const benches = introducedBenchmarks(s);
  const rlhfDone = s.research.done.includes('rlhf');
  const nameValue = name ?? `Модель ${s.nextModelNum}`;

  const plan: TrainingPlan = {
    name: nameValue,
    paramsB,
    tokensB: tokens,
    mix: { language: mix.language / 100, code: mix.code / 100, reasoning: mix.reasoning / 100 },
    benchShare: share / 100,
    benchTargets: share > 0 ? targets : [],
    rlhf: rlhf && rlhfDone,
  };

  let est: Est | null = null;
  try {
    est = estimate(s, plan);
  } catch {
    est = null;
  }
  // RLHF платит разметчикам сразу, а без мощности на обучение проект не движется: такой запуск закрываем.
  const rlhfNoCompute = plan.rlhf && pool(s, 'training') <= 0;
  const canStart = est !== null && est.error === null && !rlhfNoCompute;
  const startBlock = est?.error ?? (rlhfNoCompute ? 'Сначала выделите мощность на обучение: разметчикам платят при старте, а без мощности проект стоит.' : null);

  function toggleTarget(b: BenchmarkId) {
    setTargets((t) => (t.includes(b) ? t.filter((x) => x !== b) : t.length >= MAX_BENCH_TARGETS ? t : [...t, b]));
  }

  function applyOptimal() {
    const o = est?.optimal;
    if (!o) return;
    setParamsB(clamp(roundSig(o.paramsB), PARAMS_B_MIN, PARAMS_B_MAX));
    setTokensB(clamp(roundSig(o.tokensB), TOKENS_B_MIN, maxTokens));
  }

  function start() {
    const r = store.dispatch(actions.startTraining, plan);
    if (r.ok) {
      setErr(null);
      setName(null);
    } else {
      setErr(r.error);
    }
  }

  return (
    <div className="col">
      {s.training && <RunningCard s={s} t={s.training} open={open} />}

      <div>
        <div className="section-title">Новый проект</div>
        {s.training && <Hint>Идёт другой проект: настроить новый можно сейчас, а начать — когда текущий закончится.</Hint>}
      </div>

      <div className="card col">
        <Field label="Название">
          <input type="text" style={{ width: '100%' }} maxLength={40} value={nameValue} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field
          label="Размер (параметры)"
          hint="Качество зависит от общего объёма вычислений и от баланса между размером и данными: большая модель на малом объёме данных выходит слабой. Чем больше параметров, тем дороже обучение, а каждый токен клиента тратит больше вычислений."
        >
          <LogSlider value={paramsB} min={PARAMS_B_MIN} max={PARAMS_B_MAX} onChange={setParamsB} format={fmtParams} />
        </Field>

        <Field
          label="Данные (токены)"
          hint={`Объём обучающих текстов. В ${yearOf(s.day)} году в мире набирается не больше ${fmtTokens(maxTokens)} токенов. Чем больше модель, тем больше данных ей нужно.`}
        >
          <LogSlider value={tokens} min={TOKENS_B_MIN} max={maxTokens} onChange={setTokensB} format={fmtTokens} />
        </Field>

        <RatioField s={s} plan={plan} maxTokens={maxTokens} />

        <div>
          <div className="section-title">Состав данных</div>
          <Hint>Чему учить модель. Доли всегда дают в сумме 100 %: при движении одного ползунка остальные подстраиваются. На «Арене» язык весит вдвое больше, чем код или рассуждения.</Hint>
        </div>
        {DOMAINS.map((d) => (
          <Field key={d} label={DOMAIN_RU[d]}>
            <PctSlider value={mix[d]} onChange={(v) => setMix((m) => rescaleMix(m, d, v))} />
          </Field>
        ))}

        <div>
          <div className="section-title">Подгонка под бенчмарки</div>
        </div>
        <Field label="Данные под бенчмарки">
          <PctSlider value={share} max={Math.round(BENCH_SHARE_MAX * 100)} onChange={setShare} />
        </Field>
        <div className={share > 0 ? 'warn small' : 'muted small'}>
          {share > 0 ? '⚠ ' : ''}Баллы на выбранных тестах вырастут, но настоящее качество (Арена, реальные задачи) немного упадёт. Если модель выпустить, подгонку могут раскрыть:
          тогда упадут репутация и шумиха, а в таблице покажут честные баллы.
        </div>
        <div className="col" style={{ gap: 4 }}>
          <Hint>
            Под какие тесты подгонять (не больше {MAX_BENCH_TARGETS}; выбрано {targets.length}). Учитывается, только если доля данных больше нуля.
          </Hint>
          {benches.length === 0 && <Hint>Пока не вышло ни одного теста.</Hint>}
          <div className="row" style={{ gap: 14 }}>
            {benches.map((b) => {
              const def = benchDef(b);
              const checked = targets.includes(b);
              const blocked = !checked && targets.length >= MAX_BENCH_TARGETS;
              return (
                <label
                  key={b}
                  className="row"
                  style={{ gap: 4 }}
                  title={blocked ? `Уже выбрано ${MAX_BENCH_TARGETS} теста: снимите отметку с другого` : def.description}
                >
                  <input type="checkbox" checked={checked} disabled={blocked} onChange={() => toggleTarget(b)} />
                  <span className={blocked ? 'dim' : undefined}>{def.name}</span>
                  <span className="muted small">{DOMAIN_RU[def.domain]}</span>
                </label>
              );
            })}
          </div>
          {share > 0 && targets.length === 0 && benches.length > 0 && (
            <div className="warn small">Тесты не выбраны: данные под бенчмарки потратятся впустую и только снизят качество.</div>
          )}
        </div>

        <Field
          label="RLHF"
          hint={
            rlhfDone ? (
              `Обучение на отзывах людей: выше Эло на «Арене» и чуть лучше язык. Платите разметчикам при старте и тратите на ${fmtPct(RLHF_FLOP_EXTRA * 100, 0)} больше вычислений.`
            ) : (
              <>
                Пока недоступно: сначала изучите «RLHF» в окне «Исследования».{' '}
                <button className="btn small" onClick={() => open('research')}>Исследования</button>
              </>
            )
          }
        >
          <label className="row" style={{ gap: 6 }} title={rlhfDone ? undefined : 'Сначала изучите «RLHF» в окне «Исследования»'}>
            <input type="checkbox" checked={rlhf && rlhfDone} disabled={!rlhfDone} onChange={(e) => setRlhf(e.target.checked)} />
            Обучение на отзывах людей
          </label>
        </Field>
      </div>

      <EstimateCard s={s} plan={plan} est={est} maxTokens={maxTokens} open={open} onApplyOptimal={applyOptimal} />

      <div className="row">
        <button className="btn primary" disabled={!canStart} title={canStart ? undefined : (startBlock ?? 'Оценка проекта недоступна')} onClick={start}>
          Начать обучение
        </button>
        {!canStart && (
          <span className="muted small">
            {est?.error || est === null ? 'Сначала исправьте ошибку в оценке проекта.' : 'Сначала выделите мощность на обучение в окне «Мощности».'}
          </span>
        )}
        {canStart && est?.days === null && (
          <span className="warn small">Проект начнётся, но будет стоять, пока на обучение нет мощности.</span>
        )}
      </div>
      <ErrorText error={err} />
    </div>
  );
}
