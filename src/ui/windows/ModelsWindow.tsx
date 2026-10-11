// Окно «Модели»: список моделей игрока слева, карточка выбранной справа.
// Образец - «Инспектор» и «Проект завершён» из Processor Tycoon.

import { Fragment, useId, useState } from 'react';
import type { WindowProps } from '.';
import { benchDef, DOMAIN_NAMES, introducedBenchmarks } from '../../sim/benchmarks';
import { pool, rentPerDay } from '../../sim/compute';
import { TOKENS_PER_USER_DAY, TRAIN_FLOP_PER_H100E_DAY } from '../../sim/constants';
import { awaitingEvent } from '../../sim/events';
import { contextLabel } from '../../sim/research';
import { arenaRank, benchRank } from '../../sim/leaderboard';
import { minPrice, refPrice } from '../../sim/market';
import { formatDateShort } from '../../sim/time';
import { arenaElo as forecastElo, capsFromPlan, modelScore } from '../../sim/training';
import {
  DOMAINS,
  type BenchmarkId,
  type GameState,
  type ModelRef,
  type PlayerModel,
  type Result,
  type TrainingPlan,
  type TrainingRun,
} from '../../sim/types';
import { Alert, ErrorText, ProgressBar } from '../components/common';
import { fmtElo, fmtMoney, fmtNum, fmtParams, fmtPct, fmtPrice, fmtShare, fmtTokens } from '../format';
import { IconModels } from '../icons';
import { fmtRank } from '../labels';
import { actions, store } from '../store';
import './ModelsWindow.css';

const MAX_PRICE = 10_000;

/** Рекомендуемые цены относительно опорной цены рынка. */
const TIERS = [
  { id: 'cheap', label: 'Дешевле рынка', k: 0.6 },
  { id: 'market', label: 'Рынок', k: 1 },
  { id: 'dear', label: 'Дороже рынка', k: 1.5 },
] as const;

type Tone = 'idle' | 'sale' | 'off';

function saleState(m: PlayerModel): { text: string; tone: Tone } {
  if (m.releasedDay === null) return { text: 'Обучена', tone: 'idle' };
  return m.onApi ? { text: 'В продаже', tone: 'sale' } : { text: 'Снята', tone: 'off' };
}

/** Округление до тех знаков, которые показывает fmtPrice: подставленная цена совпадает с видимой. */
function roundPrice(v: number): number {
  const k = 10 ** (v < 1 ? 3 : v < 10 ? 2 : 0);
  return Math.round(v * k) / k;
}

/**
 * Цена из поля и причина отказа. price - null, если поле пустое или цена не годится.
 * Границы и слова те же, что в проверке симуляции (actions.ts): нижняя - minPrice(day), опорная цена / 100.
 */
function parsePrice(text: string, day: number): { price: number | null; error: string | null } {
  if (text.trim() === '') return { price: null, error: null };
  const v = Number(text.replace(',', '.'));
  if (!Number.isFinite(v)) return { price: null, error: 'Цена должна быть числом.' };
  const min = minPrice(day);
  if (v < min) return { price: null, error: `Цена не может быть ниже ${fmtPrice(min)} за 1 млн токенов.` };
  if (v > MAX_PRICE) return { price: null, error: `Цена не может быть выше ${fmtPrice(MAX_PRICE)} за 1 млн токенов.` };
  return { price: v, error: null };
}

function versusMarket(price: number, ref: number): string {
  const rel = Math.round((price / ref - 1) * 100);
  if (rel === 0) return 'На уровне рынка';
  return `${rel > 0 ? '+' : '−'}${fmtPct(Math.abs(rel), 0)} к рынку`;
}

/** Продажи модели сегодня: доля, токены, пользователи, выручка в день (undefined - не в продаже). */
function salesOf(s: GameState, m: PlayerModel) {
  const share: number | undefined = m.onApi ? s.market.shares[`player:${m.id}`] : undefined;
  // Доля в s.market уже после ограничения мощностью (market.ts servedShares), отдельно на served не умножаем.
  const tokens = share !== undefined ? share * s.market.totalTokens : undefined;
  const users = tokens !== undefined ? tokens / TOKENS_PER_USER_DAY : undefined;
  const revenue = tokens !== undefined ? (tokens * m.price) / 1e6 : undefined;
  return { share, tokens, users, revenue };
}

/** Модель, план которой ещё обучается: id для списка. */
const TRAINING_ID = 'training';

const PRICE_TITLE = 'Цена за 1 млн токенов в долларах. Чем ниже цена, тем больше доля рынка и выше нагрузка на мощности «Клиенты».';

// ---------- Левая колонка ----------

function ModelList(props: {
  models: PlayerModel[];
  training: TrainingRun | null;
  selectedId: string;
  onSelect: (id: string) => void;
  open: WindowProps['open'];
}) {
  const t = props.training;
  return (
    <aside className="mw-side">
      <div className="mw-list">
        {t && (
          <button
            className={`mw-item${props.selectedId === TRAINING_ID ? ' is-selected' : ''}`}
            aria-current={props.selectedId === TRAINING_ID}
            onClick={() => props.onSelect(TRAINING_ID)}
          >
            <span className="mw-dot train" />
            <span className="mw-item-text">
              <span className="mw-item-name" title={t.plan.name}>{t.plan.name}</span>
              <span className="mw-item-state">Обучается, {fmtShare(t.flopTotal > 0 ? t.flopDone / t.flopTotal : 0, 0)}</span>
            </span>
          </button>
        )}
        {props.models.map((m) => {
          const st = saleState(m);
          return (
            <button
              key={m.id}
              className={`mw-item${m.id === props.selectedId ? ' is-selected' : ''}`}
              aria-current={m.id === props.selectedId}
              onClick={() => props.onSelect(m.id)}
            >
              <span className={`mw-dot ${st.tone}`} />
              <span className="mw-item-text">
                <span className="mw-item-name" title={m.name}>{m.name}</span>
                <span className="mw-item-state">{st.text}</span>
                {m.exposed && <span className="mw-item-state bad">Подгонка раскрыта</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mw-side-foot">
        <span>Моделей: {props.models.length}</span>
        <button className="btn small" onClick={() => props.open('newModel')}>Создать модель</button>
      </div>
    </aside>
  );
}

// ---------- Визуал модели ----------

function Chip({ lab, name, tone }: { lab: string; name: string; tone: Tone }) {
  return (
    <div className="mw-chip" role="img" aria-label={`${lab}, ${name}`}>
      <div className={`mw-die ${tone}`}>
        <span className="mw-led" />
        <span className="mw-die-lab">{lab}</span>
        <span className="mw-die-name">{name}</span>
      </div>
    </div>
  );
}

// ---------- Цена ----------

function PriceInput(props: { label: string; value: string; onChange: (v: string) => void; onEnter: () => void; invalid: boolean }) {
  const id = useId();
  return (
    <div className="mw-field">
      <label className="mw-sub" htmlFor={id}>{props.label}</label>
      <div className="mw-price-row">
        <span className="mw-cur">$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={props.value}
          className={`mw-price-input${props.invalid ? ' mw-bad' : ''}`}
          aria-invalid={props.invalid}
          title={PRICE_TITLE}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onEnter()}
        />
      </div>
    </div>
  );
}

// ---------- Выпуск (модель обучена, но не продаётся) ----------

function ReleaseBlock({ s, m }: { s: GameState; m: PlayerModel }) {
  const ref = refPrice(s.day);
  const tiers = TIERS.map((t) => ({ ...t, price: roundPrice(ref * t.k) }));
  const [text, setText] = useState(() => String(roundPrice(ref)).replace('.', ','));
  const [err, setErr] = useState<string | null>(null);
  const { price, error } = parsePrice(text, s.day);

  function release() {
    if (price === null) return;
    const r = store.dispatch(actions.releaseModel, m.id, price);
    setErr(r.ok ? null : r.error);
  }

  return (
    <section>
      <h3 className="mw-h">Выпуск на рынок</h3>
      <div className="mw-panel">
        <div className="mw-sub">Рекомендуемая цена за 1 млн токенов</div>
        <div className="mw-tiers" role="radiogroup" aria-label="Рекомендуемая цена">
          {tiers.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={price === t.price}
              className={`mw-tier${price === t.price ? ' on' : ''}`}
              onClick={() => setText(String(t.price).replace('.', ','))}
            >
              <span>{t.label}</span>
              <b className="num">{fmtPrice(t.price)}</b>
            </button>
          ))}
        </div>
        <div className="mw-edit">
          <PriceInput label="Цена за 1 млн токенов" value={text} onChange={setText} onEnter={release} invalid={error !== null} />
          <button
            className="btn primary"
            data-tutorial="release"
            disabled={price === null}
            title={price === null ? (error ?? 'Укажите цену') : undefined}
            onClick={release}
          >
            Выпустить
          </button>
        </div>
        {price !== null && <div className="mw-sub">{versusMarket(price, ref)}</div>}
        {error && <div className="error">{error}</div>}
        <ErrorText error={err} />
      </div>
    </section>
  );
}

// ---------- Продажи (модель выпущена) ----------

function SalesBlock({ s, m, open }: { s: GameState; m: PlayerModel; open: WindowProps['open'] }) {
  const ref = refPrice(s.day);
  const [text, setText] = useState(() => String(Math.round(m.price * 100) / 100).replace('.', ','));
  const [err, setErr] = useState<string | null>(null);
  const { price, error } = parsePrice(text, s.day);

  const { share, tokens } = salesOf(s, m);
  const lost = s.market.lostFraction;
  const noInference = m.onApi && pool(s, 'inference') <= 0;
  const losing = m.onApi && !noInference && lost > 0.01;

  function run(r: Result) {
    setErr(r.ok ? null : r.error);
  }
  const changePrice = () => price !== null && run(store.dispatch(actions.setModelPrice, m.id, price));
  const toggleSale = () => run(store.dispatch(actions.setOnApi, m.id, !m.onApi));

  // Цена в поле округлена до центов, поэтому сравниваем с точностью до цента.
  const unchanged = price !== null && Math.round(price * 100) === Math.round(m.price * 100);

  return (
    <section>
      <h3 className="mw-h">Продажи</h3>
      {noInference && (
        <Alert tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
          Доля «Клиенты» равна нулю: запросы не обслуживаются.
        </Alert>
      )}
      {losing && <Alert tone="warn">Не хватает мощности «Клиенты»: теряется {fmtShare(lost, 0)} спроса.</Alert>}
      <div className="mw-panel">
        <div className="mw-price">
          <div className="mw-price-now">
            <span className="mw-sub">Цена за 1 млн токенов</span>
            <span className={`mw-price-v${m.onApi ? '' : ' muted'}`}>{fmtPrice(m.price)}</span>
            <span className="mw-sub">{versusMarket(m.price, ref)}</span>
          </div>
          <div className="mw-price-side">
            <div className="mw-edit">
              <PriceInput label="Новая цена" value={text} onChange={setText} onEnter={changePrice} invalid={error !== null} />
              <button
                className="btn"
                disabled={price === null || unchanged}
                title={price === null ? (error ?? 'Укажите цену') : unchanged ? 'Цена не изменилась' : undefined}
                onClick={changePrice}
              >
                Изменить цену
              </button>
            </div>
            {price !== null && !unchanged && <div className="mw-sub">{versusMarket(price, ref)}</div>}
            {error && <div className="error">{error}</div>}
          </div>
        </div>
        <div className="mw-panel-foot">
          <span className="mw-sub mw-sales-line">
            <span>
              Доля рынка: <b>{share !== undefined ? fmtShare(share, share < 0.01 ? 2 : 1) : '-'}</b>
            </span>
            <span title="Сколько токенов модель обслуживает за день">
              Токенов в день: <b>{tokens !== undefined ? fmtNum(tokens) : '-'}</b>
            </span>
          </span>
          <button className={`btn small${m.onApi ? ' danger' : ' primary'}`} onClick={toggleSale}>
            {m.onApi ? 'Снять с продажи' : 'Вернуть в продажу'}
          </button>
        </div>
        <ErrorText error={err} />
      </div>
    </section>
  );
}

// ---------- Баллы ----------

function ScoresBlock({ s, m, benches }: { s: GameState; m: PlayerModel; benches: BenchmarkId[] }) {
  if (benches.length === 0) return null;
  const released = m.releasedDay !== null;
  const ref: ModelRef = { kind: 'player', id: m.id };
  const showHonest = benches.some((b) => (m.overfit[b] ?? 0) > 0);

  return (
    <section>
      <h3 className="mw-h">Баллы</h3>
      <table className="grid mw-scores">
        <thead>
          <tr>
            <th>Бенчмарк</th>
            <th>Область</th>
            <th className="num">Балл</th>
            {showHonest && <th className="num" title="Балл без учёта подгонки под бенчмарк">Честный балл</th>}
            {released && <th className="num" title="Место среди выпущенных моделей по этому бенчмарку">Место</th>}
          </tr>
        </thead>
        <tbody>
          {benches.map((b) => {
            const def = benchDef(b);
            const saturated = s.benchmarks[b].saturated;
            const overfit = (m.overfit[b] ?? 0) > 0;
            const rank = released ? benchRank(s, ref, b) : null;
            return (
              <tr key={b} className={saturated ? 'dim' : undefined}>
                <td title={def.description}>
                  {def.name}
                  {saturated && <span className="muted small" title="Бенчмарк насыщен: не влияет на шумиху и тендеры."> · насыщен</span>}
                </td>
                <td className="muted">{DOMAIN_NAMES[def.domain]}</td>
                <td className="num">{fmtPct(modelScore(m, b, false))}</td>
                {showHonest && <td className={`num${overfit ? '' : ' muted'}`}>{overfit ? fmtPct(modelScore(m, b, true)) : '-'}</td>}
                {released && <td className="num">{rank ?? '-'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Карточка модели ----------

/** Крупные показатели под заголовком: на них взгляд падает первым. */
function Kpis({ s, m }: { s: GameState; m: PlayerModel }) {
  const released = m.releasedDay !== null;
  const rank = released ? arenaRank(s, { kind: 'player', id: m.id }) : null;
  const { users, revenue } = salesOf(s, m);
  const items: Kpi[] = released
    ? [
        {
          label: 'Место на «Арене»',
          value: fmtRank(rank),
          sub: `Эло ${fmtElo(m.arenaElo)}`,
          title: 'Рейтинг на «Арене». Подгонка под бенчмарки его не повышает.',
        },
        {
          label: 'Пользователей в день',
          value: users !== undefined ? `≈ ${fmtNum(Math.round(users))}` : '-',
          title: `Оценка: токены в день / ${fmtNum(TOKENS_PER_USER_DAY)}`,
        },
        {
          label: 'Выручка в день',
          value: revenue !== undefined ? fmtMoney(revenue) : '-',
          sub: revenue !== undefined ? `≈ ${fmtMoney(revenue * 30)} в месяц` : undefined,
        },
        { label: 'Заработала всего', value: fmtMoney(m.earned), title: 'Выручка API с момента выпуска' },
      ]
    : [
        { label: 'Эло', value: fmtElo(m.arenaElo), title: 'Рейтинг на «Арене». Подгонка под бенчмарки его не повышает.' },
        { label: 'Параметры', value: fmtParams(m.plan.paramsB) },
        { label: 'Контекст', value: contextLabel(m.plan.context), sub: 'токенов' },
        { label: 'Обучена', value: formatDateShort(m.trainedDay) },
      ];
  return <KpiRow items={items} />;
}

interface Kpi {
  label: string;
  value: string;
  sub?: string;
  title?: string;
}

function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <div className="mw-kpis">
      {items.map((k) => (
        <div key={k.label} className="mw-kpi" title={k.title}>
          <span className="mw-kpi-l">{k.label}</span>
          <span className="mw-kpi-v">{k.value}</span>
          {k.sub && <span className="mw-kpi-s">{k.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function Specs(props: { arch: 'lstm' | 'transformer'; plan: TrainingPlan; dates: [string, number][] }) {
  const { arch, plan } = props;
  const mix = DOMAINS.map((d) => `${DOMAIN_NAMES[d]} ${fmtShare(plan.mix[d], 0)}`).join(', ');
  return (
    <section>
      <h3 className="mw-h">Характеристики</h3>
      <dl className="mw-specs">
        <dt>Архитектура</dt>
        <dd>{arch === 'transformer' ? 'Трансформер' : 'LSTM'}</dd>
        <dt>Параметры</dt>
        <dd>{fmtParams(plan.paramsB)}</dd>
        <dt>Контекст</dt>
        <dd>{contextLabel(plan.context)} токенов</dd>
        <dt>Данные</dt>
        <dd>
          {fmtTokens(plan.tokensB)} токенов
          <small>{mix}</small>
        </dd>
        <dt>RLHF</dt>
        <dd>{plan.rlhf ? 'Да' : 'Нет'}</dd>
        {props.dates.map(([label, day]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{formatDateShort(day)}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}

// ---------- Модель в обучении ----------

const DAYS_IN_MONTH = 30;

function TrainingCard({ s, t, open }: { s: GameState; t: TrainingRun; open: WindowProps['open'] }) {
  const frac = t.flopTotal > 0 ? Math.min(1, t.flopDone / t.flopTotal) : 0;
  const power = pool(s, 'training');
  const perDay = power * TRAIN_FLOP_PER_H100E_DAY;
  const waiting = awaitingEvent(s, 'training-fail');
  const left = perDay > 0 ? Math.max(1, Math.ceil((t.flopTotal - t.flopDone) / perDay)) : null;
  const rentDay = rentPerDay(s) * s.compute.alloc.training;
  const forecast = s.research.done.includes('scaling')
    ? forecastElo(capsFromPlan(t.plan, t.algoLevel, t.arch, t.failPenalty), t.plan.rlhf, t.algoLevel)
    : null;
  const sub = [t.arch === 'transformer' ? 'Трансформер' : 'LSTM', `${fmtParams(t.plan.paramsB)} параметров`, `контекст ${contextLabel(t.plan.context)}`]
    .join(' · ');
  const items: Kpi[] = [
    { label: 'Готово', value: fmtShare(frac, 0) },
    {
      // Пока проект стоит, срока нет: в плитке «-», причина - в подписи.
      label: 'Осталось',
      value: !waiting && left !== null ? `${fmtNum(left)} дн.` : '-',
      sub: waiting ? 'ждёт решения в «Почте»' : left !== null ? `до ${formatDateShort(s.day + left)}` : 'нет мощности на обучение',
    },
    {
      label: 'Аренда в месяц',
      value: fmtMoney(rentDay * DAYS_IN_MONTH),
      sub: left !== null ? `≈ ${fmtMoney(rentDay * left)} до конца` : undefined,
      title: 'Доля «Обучение» от аренды всех карт',
    },
    {
      label: 'Прогноз Эло',
      value: forecast !== null ? fmtElo(forecast) : '-',
      sub: forecast !== null ? undefined : 'нужны «Законы масштабирования»',
    },
  ];

  return (
    <div className="mw-main">
      <header className="mw-head">
        <Chip lab={s.labName} name={t.plan.name} tone="idle" />
        <div className="mw-head-text">
          <h2 className="mw-name" title={t.plan.name}>
            {t.plan.name}
          </h2>
          <div className="mw-head-sub">{sub}</div>
        </div>
        <span className="mw-pill train">Обучается</span>
      </header>
      <KpiRow items={items} />
      <section>
        <h3 className="mw-h">Ход обучения</h3>
        <div className="mw-panel">
          <ProgressBar value={frac} />
          <div className="mw-panel-foot">
            <span className="mw-sub">
              Мощность на обучение: <b>{fmtNum(power)} H100e</b>
            </span>
            <span className="mw-btns">
              <button className="btn small" onClick={() => open('compute')}>
                Открыть «Мощности»
              </button>
              <button className="btn small" onClick={() => open('newModel')}>
                Открыть «Новая модель»
              </button>
            </span>
          </div>
        </div>
      </section>
      <Specs arch={t.arch} plan={t.plan} dates={[['Начато', t.startedDay]]} />
    </div>
  );
}

function ModelCard({ s, m, open }: { s: GameState; m: PlayerModel; open: WindowProps['open'] }) {
  const released = m.releasedDay !== null;
  const st = saleState(m);
  const sub = [
    m.arch === 'transformer' ? 'Трансформер' : 'LSTM',
    `${fmtParams(m.plan.paramsB)} параметров`,
    `контекст ${contextLabel(m.plan.context)}`,
    m.rlhf ? 'RLHF' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mw-main">
      <header className="mw-head">
        <Chip lab={s.labName} name={m.name} tone={st.tone} />
        <div className="mw-head-text">
          <h2 className="mw-name" title={m.name}>
            {m.name}
          </h2>
          <div className="mw-head-sub">{sub}</div>
        </div>
        <span className={`mw-pill ${st.tone}`}>{st.text}</span>
      </header>
      {m.exposed && <Alert tone="bad">Подгонка под бенчмарки раскрыта: показаны честные баллы.</Alert>}
      <Kpis s={s} m={m} />
      {released ? <SalesBlock s={s} m={m} open={open} /> : <ReleaseBlock s={s} m={m} />}
      <ScoresBlock s={s} m={m} benches={introducedBenchmarks(s)} />
      <Specs
        arch={m.arch}
        plan={m.plan}
        dates={m.releasedDay !== null ? [['Обучена', m.trainedDay], ['Выпущена', m.releasedDay]] : [['Обучена', m.trainedDay]]}
      />
    </div>
  );
}

// ---------- Окно ----------

export default function ModelsWindow({ s, open }: WindowProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const t = s.training;
  if (s.models.length === 0 && !t) {
    return (
      <div className="mw-empty">
        <IconModels size={64} />
        <div className="mw-empty-title">Моделей нет.</div>
        <button className="btn primary" onClick={() => open('newModel')}>Создать модель</button>
      </div>
    );
  }

  const models = [...s.models].reverse(); // новые сверху
  const picked = selectedId === TRAINING_ID && t ? null : (models.find((x) => x.id === selectedId) ?? models[0] ?? null);
  const current = picked ? picked.id : TRAINING_ID;

  return (
    <div className="mw">
      <ModelList models={models} training={t} selectedId={current} onSelect={setSelectedId} open={open} />
      {picked ? <ModelCard key={picked.id} s={s} m={picked} open={open} /> : t && <TrainingCard s={s} t={t} open={open} />}
    </div>
  );
}
