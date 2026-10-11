// Окно «Модели»: список моделей игрока слева, карточка выбранной справа.
// Образец — «Инспектор» и «Проект завершён» из Processor Tycoon.

import { useId, useState } from 'react';
import type { WindowProps } from '.';
import { benchDef, DOMAIN_NAMES, introducedBenchmarks } from '../../sim/benchmarks';
import { pool } from '../../sim/compute';
import { arenaRank, benchRank } from '../../sim/leaderboard';
import { refPrice } from '../../sim/market';
import { formatDateShort } from '../../sim/time';
import { modelScore } from '../../sim/training';
import { DOMAINS, type BenchmarkId, type GameState, type ModelRef, type PlayerModel, type Result } from '../../sim/types';
import { ErrorText } from '../components/common';
import { fmtElo, fmtMoney, fmtNum, fmtParams, fmtPct, fmtPrice, fmtShare, fmtTokens } from '../format';
import { IconModels } from '../icons';
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

function parsePrice(text: string): number | null {
  if (text.trim() === '') return null;
  const v = Number(text.replace(',', '.'));
  return Number.isFinite(v) && v > 0 && v <= MAX_PRICE ? v : null;
}

function priceError(text: string): string | null {
  if (text.trim() === '' || parsePrice(text) !== null) return null;
  return `Цена должна быть больше нуля и не больше ${fmtPrice(MAX_PRICE)}.`;
}

function versusMarket(price: number, ref: number): string {
  const rel = Math.round((price / ref - 1) * 100);
  if (rel === 0) return 'На уровне рынка';
  return `${rel > 0 ? '+' : '−'}${fmtPct(Math.abs(rel), 0)} к рынку`;
}

const PRICE_TITLE = 'Цена за 1 млн токенов в долларах. Чем ниже цена, тем больше доля рынка и выше нагрузка на мощности «Клиенты».';

// ---------- Левая колонка ----------

function ModelList(props: { models: PlayerModel[]; selectedId: string; onSelect: (id: string) => void; open: WindowProps['open'] }) {
  return (
    <aside className="mw-side">
      <div className="mw-list">
        {props.models.map((m) => {
          const st = saleState(m);
          return (
            <button
              key={m.id}
              className={`mw-item${m.id === props.selectedId ? ' on' : ''}`}
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
        <button className="btn small" onClick={() => props.open('newModel')}>Новая модель</button>
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

function Fact(props: { label: string; value: string; sub?: string; title?: string; wide?: boolean }) {
  return (
    <div className={`mw-fact${props.wide ? ' wide' : ''}`} title={props.title}>
      <dt>{props.label}</dt>
      <dd>
        {props.value}
        {props.sub && <small>{props.sub}</small>}
      </dd>
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
          type="number"
          min={0}
          step="any"
          value={props.value}
          className={props.invalid ? 'mw-bad' : undefined}
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
  const [text, setText] = useState(() => String(roundPrice(ref)));
  const [err, setErr] = useState<string | null>(null);
  const price = parsePrice(text);
  const error = priceError(text);

  function release() {
    if (price === null) return;
    const r = store.dispatch(actions.releaseModel, m.id, price);
    setErr(r.ok ? null : r.error);
  }

  return (
    <section>
      <h3 className="mw-h">Выпуск</h3>
      <div className="mw-block">
        <div className="mw-tiers">
          <div className="mw-sub">Рекомендуемые цены</div>
          {tiers.map((t) => (
            <button key={t.id} className={`mw-tier${price === t.price ? ' on' : ''}`} title="Подставить цену" onClick={() => setText(String(t.price))}>
              <span>{t.label}</span>
              <b className="num">{fmtPrice(t.price)}</b>
            </button>
          ))}
        </div>
        <div className="mw-ctl">
          <PriceInput label="Цена за 1 млн токенов" value={text} onChange={setText} onEnter={release} invalid={error !== null} />
          {price !== null && <div className="mw-sub">{versusMarket(price, ref)}</div>}
          {error && <div className="error">{error}</div>}
          <div className="mw-btns">
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
          <ErrorText error={err} />
        </div>
      </div>
    </section>
  );
}

// ---------- Продажи (модель выпущена) ----------

function SalesBlock({ s, m, open }: { s: GameState; m: PlayerModel; open: WindowProps['open'] }) {
  const ref = refPrice(s.day);
  const [text, setText] = useState(() => String(Math.round(m.price * 100) / 100).replace('.', ','));
  const [err, setErr] = useState<string | null>(null);
  const price = parsePrice(text);
  const error = priceError(text);

  const share: number | undefined = m.onApi ? s.market.shares[`player:${m.id}`] : undefined;
  const lost = s.market.lostFraction;
  const tokens = share !== undefined ? share * s.market.totalTokens * (1 - lost) : undefined;
  const revenue = tokens !== undefined ? (tokens * m.price) / 1e6 : undefined;
  const noInference = m.onApi && pool(s, 'inference') <= 0;
  const losing = m.onApi && !noInference && lost > 0.01;
  const dash = <span className="muted">—</span>;

  function run(r: Result) {
    setErr(r.ok ? null : r.error);
  }
  const changePrice = () => price !== null && run(store.dispatch(actions.setModelPrice, m.id, price));
  const toggleSale = () => run(store.dispatch(actions.setOnApi, m.id, !m.onApi));

  const unchanged = price !== null && price === m.price;

  return (
    <section>
      <h3 className="mw-h">Продажи</h3>
      {noInference && (
        <div className="mw-note warn">
          <span>Доля «Клиенты» равна нулю: запросы не обслуживаются.</span>
          <button className="btn small" onClick={() => open('compute')}>Открыть «Мощности»</button>
        </div>
      )}
      {losing && <div className="mw-note warn">Не хватает мощности «Клиенты»: теряется {fmtShare(lost, 0)} спроса.</div>}
      <div className="mw-block">
        <dl className="mw-rows">
          <div>
            <dt>Цена за 1 млн токенов</dt>
            <dd className={m.onApi ? undefined : 'muted'}>{fmtPrice(m.price)}</dd>
          </div>
          <div>
            <dt>Доля рынка</dt>
            <dd>{share !== undefined ? fmtShare(share, share < 0.01 ? 2 : 1) : dash}</dd>
          </div>
          <div title="Сколько токенов модель обслуживает за день.">
            <dt>Токенов в день</dt>
            <dd>{tokens !== undefined ? fmtNum(tokens) : dash}</dd>
          </div>
          <div>
            <dt>Выручка в день</dt>
            <dd>{revenue !== undefined ? fmtMoney(revenue) : dash}</dd>
          </div>
        </dl>
        <div className="mw-ctl">
          <PriceInput label="Новая цена" value={text} onChange={setText} onEnter={changePrice} invalid={error !== null} />
          {price !== null && <div className="mw-sub">{versusMarket(price, ref)}</div>}
          {error && <div className="error">{error}</div>}
          <div className="mw-btns">
            <button
              className="btn"
              disabled={price === null || unchanged}
              title={price === null ? (error ?? 'Укажите цену') : unchanged ? 'Цена не изменилась' : undefined}
              onClick={changePrice}
            >
              Изменить цену
            </button>
            <button className={`btn${m.onApi ? ' danger' : ' primary'}`} onClick={toggleSale}>
              {m.onApi ? 'Снять с продажи' : 'Вернуть в продажу'}
            </button>
          </div>
          <ErrorText error={err} />
        </div>
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
      {m.exposed && <div className="mw-note bad">Подгонка раскрыта: показаны честные баллы.</div>}
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
                {showHonest && <td className={`num${overfit ? '' : ' muted'}`}>{overfit ? fmtPct(modelScore(m, b, true)) : '—'}</td>}
                {released && <td className="num">{rank ?? '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------- Карточка модели ----------

function ModelCard({ s, m, open }: { s: GameState; m: PlayerModel; open: WindowProps['open'] }) {
  const released = m.releasedDay !== null;
  const st = saleState(m);
  const rank = released ? arenaRank(s, { kind: 'player', id: m.id }) : null;
  const mix = DOMAINS.map((d) => `${DOMAIN_NAMES[d]} ${fmtShare(m.plan.mix[d], 0)}`).join(' · ');

  return (
    <div className="mw-main">
      <div className="mw-top">
        <div className="mw-chipcol">
          <Chip lab={s.labName} name={m.name} tone={st.tone} />
          <div className="mw-status">
            <span className={`mw-dot ${st.tone}`} />
            <span>{st.text}</span>
          </div>
        </div>
        <dl className="mw-facts">
          <Fact label="Архитектура" value={m.arch === 'transformer' ? 'Трансформер' : 'LSTM'} />
          <Fact label="Параметры" value={fmtParams(m.plan.paramsB)} />
          <Fact label="Данные" value={`${fmtTokens(m.plan.tokensB)} токенов`} sub={mix} wide />
          <Fact label="RLHF" value={m.rlhf ? 'Да' : 'Нет'} />
          <Fact label="Эло на «Арене»" value={fmtElo(m.arenaElo)} title="Рейтинг на «Арене». Подгонка под бенчмарки его не повышает." />
          <Fact
            label="Место на «Арене»"
            value={rank !== null ? String(rank) : '—'}
            title={released ? undefined : 'Модель не выпущена'}
          />
          <Fact label="Дата обучения" value={formatDateShort(m.trainedDay)} />
          {m.releasedDay !== null && <Fact label="Дата выпуска" value={formatDateShort(m.releasedDay)} />}
        </dl>
      </div>
      {released ? <SalesBlock s={s} m={m} open={open} /> : <ReleaseBlock s={s} m={m} />}
      <ScoresBlock s={s} m={m} benches={introducedBenchmarks(s)} />
    </div>
  );
}

// ---------- Окно ----------

export default function ModelsWindow({ s, open }: WindowProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (s.models.length === 0) {
    const t = s.training;
    const done = t && t.flopTotal > 0 ? t.flopDone / t.flopTotal : 0;
    return (
      <div className="mw-empty">
        <IconModels size={64} />
        <div className="mw-empty-title">Моделей нет.</div>
        {t && <div className="small">Идёт обучение: «{t.plan.name}», {fmtShare(done, 0)}.</div>}
        <button className="btn primary" onClick={() => open('newModel')}>Новая модель</button>
      </div>
    );
  }

  const models = [...s.models].reverse(); // новые сверху
  const m = models.find((x) => x.id === selectedId) ?? models[0];

  return (
    <div className="mw">
      <ModelList models={models} selectedId={m.id} onSelect={setSelectedId} open={open} />
      <ModelCard key={m.id} s={s} m={m} open={open} />
    </div>
  );
}
