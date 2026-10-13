// Окно «Модели»: список моделей игрока слева, карточка выбранной справа.
// Образец - «Инспектор» и «Проект завершён» из Processor Tycoon.
// Две панели продаж: «API» (цена за 1 млн токенов) и «Подписка» (цена в месяц, внешняя проверка сильных моделей).

import { Fragment, useId, useState } from 'react';
import type { WindowProps } from '.';
import { benchDef, DOMAIN_NAMES, introducedBenchmarks } from '../../sim/benchmarks';
import { pool, rentPerDay } from '../../sim/compute';
import {
  SUBS_PRICE_MAX,
  SUBS_PRICE_MIN,
  TIER_API_PRICE_MULT,
  TIER_SUBS_PRICE,
  TOKENS_PER_USER_DAY,
  TRAIN_FLOP_PER_H100E_DAY,
} from '../../sim/constants';
import { awaitingEvent } from '../../sim/events';
import { contextLabel } from '../../sim/research';
import { benchRank } from '../../sim/leaderboard';
import { ARENA_PLACE_TITLE, modelArenaPlace } from '../arena';
import { minPrice, playerSales, refPrice, subsOpen } from '../../sim/market';
import { formatDateShort } from '../../sim/time';
import {
  arenaElo as forecastElo,
  capsFromPlan,
  modelScore,
  reviewCost,
  reviewDays,
  reviewReason,
  trainingPoolPerRun,
} from '../../sim/training';
import {
  DOMAINS,
  TIER_NAMES,
  type BenchmarkId,
  type GameState,
  type ModelRef,
  type PlayerModel,
  type Result,
  type TrainingPlan,
  type TrainingRun,
} from '../../sim/types';
import { Cards } from '../components/Cards';
import { Alert, ConfirmDialog, DenyNote, ErrorText, GuardButton, ProgressBar, useFlash } from '../components/common';
import { TierBadge } from '../components/TierBadge';
import { fmtDays, fmtElo, fmtH100e, fmtMoney, fmtNum, fmtParams, fmtPct, fmtPrice, fmtShare, fmtTokens } from '../format';
import { tokensWord } from '../../sim/text';
import { IconChevronLeft, IconModels } from '../icons';
import { fmtRank } from '../labels';
import { actions, store } from '../store';
import './ModelsWindow.css';

const MAX_PRICE = 10_000;

/** Три готовые цены относительно типичной цены уровня модели. */
const PRICE_STEPS = [
  { id: 'cheap', label: 'Дешевле рынка', k: 0.6 },
  { id: 'market', label: 'Рынок', k: 1 },
  { id: 'dear', label: 'Дороже рынка', k: 1.5 },
] as const;

const PRICE_TITLE = 'Цена за 1 млн токенов в долларах. Чем ниже цена, тем больше доля рынка и выше нагрузка на мощности «API».';
const SUBS_PRICE_TITLE = 'Цена подписки в долларах в месяц. Чем ниже цена, тем больше подписчиков и выше нагрузка на мощности «Подписки».';
const SUBS_CLOSED = 'Подписки появятся позже.';
const REVIEW_FIRST = 'Сначала пройдите внешнюю проверку.';

type Tone = 'idle' | 'sale' | 'off';

/** Состояние продажи для списка и значка: «Обучена», «В продаже: API, подписка», «Снята». */
export function saleState(m: PlayerModel): { text: string; tone: Tone } {
  if (m.releasedDay === null) return { text: 'Обучена', tone: 'idle' };
  if (m.onApi && m.onSubs) return { text: 'В продаже: API, подписка', tone: 'sale' };
  if (m.onApi) return { text: 'В продаже: API', tone: 'sale' };
  if (m.onSubs) return { text: 'В продаже: подписка', tone: 'sale' };
  return { text: 'Снята', tone: 'off' };
}

/** Строка про внешнюю проверку для списка и значка (null - проверка не нужна или не требовалась). */
export function reviewState(m: PlayerModel): { text: string; tone: 'warn' | 'info' | 'good' } | null {
  if (m.review === 'required') return { text: 'Нужна проверка', tone: 'warn' };
  if (m.review === 'pending' && m.reviewEndDay !== null) return { text: `Проверка до ${formatDateShort(m.reviewEndDay)}`, tone: 'info' };
  if (m.review === 'passed') return { text: 'Проверка пройдена', tone: 'good' };
  return null;
}

/** Типичная цена API для уровня модели: множитель уровня × опорная цена дня. */
function tierPrice(day: number, m: PlayerModel): number {
  return TIER_API_PRICE_MULT[m.plan.tier] * refPrice(day);
}

/** Округление до тех знаков, которые показывает fmtPrice: подставленная цена совпадает с видимой. */
function roundPrice(v: number): number {
  const k = 10 ** (v < 1 ? 3 : v < 10 ? 2 : 0);
  return Math.round(v * k) / k;
}

const priceText = (v: number): string => String(roundPrice(v)).replace('.', ',');

/**
 * Цена API из поля и причина отказа. price - null, если поле пустое или цена не годится.
 * Границы и слова те же, что в проверке симуляции (actions.ts): нижняя - minPrice(day), опорная цена / 100.
 */
export function parsePrice(text: string, day: number): { price: number | null; error: string | null } {
  if (text.trim() === '') return { price: null, error: null };
  const v = Number(text.replace(',', '.'));
  if (!Number.isFinite(v)) return { price: null, error: 'Цена должна быть числом.' };
  const min = minPrice(day);
  if (v < min) return { price: null, error: `Цена не может быть ниже ${fmtPrice(min)} за 1 млн токенов.` };
  if (v > MAX_PRICE) return { price: null, error: `Цена не может быть выше ${fmtPrice(MAX_PRICE)} за 1 млн токенов.` };
  return { price: v, error: null };
}

/** Цена подписки из поля: границы те же, что в actions.setSubsPrice (от SUBS_PRICE_MIN до SUBS_PRICE_MAX, до центов). */
export function parseSubsPrice(text: string): { price: number | null; error: string | null } {
  if (text.trim() === '') return { price: null, error: null };
  const v = Number(text.replace(',', '.'));
  if (!Number.isFinite(v)) return { price: null, error: 'Цена должна быть числом.' };
  if (v < SUBS_PRICE_MIN || v > SUBS_PRICE_MAX) {
    return { price: null, error: `Цена подписки - от ${fmtPrice(SUBS_PRICE_MIN)} до ${fmtPrice(SUBS_PRICE_MAX)} в месяц.` };
  }
  return { price: Math.round(v * 100) / 100, error: null };
}

export function versusMarket(price: number, ref: number): string {
  const rel = Math.round((price / ref - 1) * 100);
  if (rel === 0) return 'На уровне рынка';
  return `${rel > 0 ? '+' : '−'}${fmtPct(Math.abs(rel), 0)} к рынку`;
}

/** Продажи модели игрока за вчера по каналам; у выключенного канала значения нет (undefined). */
function salesOf(s: GameState, m: PlayerModel) {
  const sales = playerSales(s, m.id);
  const onAny = m.onApi || m.onSubs;
  // Общая доля уже после ограничения мощностью (market.ts servedShares), отдельно на served не умножаем.
  const share: number | undefined = onAny ? s.market.shares[`player:${m.id}`] : undefined;
  const apiRevenue = m.onApi ? sales.apiRevenueDay : undefined;
  const subsRevenue = m.onSubs ? sales.subsRevenueDay : undefined;
  return {
    share,
    tokens: m.onApi ? sales.apiTokens : undefined,
    users: m.onApi ? sales.apiTokens / TOKENS_PER_USER_DAY : undefined,
    subscribers: m.onSubs ? sales.subsUsers : undefined,
    apiRevenue,
    subsRevenue,
    revenue: onAny ? (apiRevenue ?? 0) + (subsRevenue ?? 0) : undefined,
  };
}

/** Ключ проекта обучения в списке: у проекта нет id модели. */
const RUN_PREFIX = 'run:';

// ---------- Левая колонка ----------

function ModelList(props: {
  models: PlayerModel[];
  trainings: TrainingRun[];
  selectedId: string;
  onSelect: (id: string) => void;
  open: WindowProps['open'];
}) {
  // Снятые с продажи модели сворачиваем в «Архив»; если выбрана одна из них, группа открыта.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archived = props.models.filter((m) => saleState(m).tone === 'off');
  const active = props.models.filter((m) => saleState(m).tone !== 'off');
  const archiveShown = archiveOpen || archived.some((m) => m.id === props.selectedId);
  const renderModel = (m: PlayerModel) => {
    const st = saleState(m);
    const rv = reviewState(m);
    return (
      <button
        key={m.id}
        className={`mw-item ${st.tone}${m.id === props.selectedId ? ' is-selected' : ''}`}
        aria-current={m.id === props.selectedId}
        onClick={() => props.onSelect(m.id)}
      >
        <span className="mw-item-text">
          <span className="mw-item-name" title={m.name}>{m.name}</span>
          <span className="mw-item-state">
            <TierBadge tier={m.plan.tier} />
            <span>{st.text}</span>
          </span>
          {rv && rv.tone !== 'good' && <span className={`mw-item-state ${rv.tone}`}>{rv.text}</span>}
          {m.exposed && <span className="mw-item-state bad">Подгонка раскрыта</span>}
        </span>
      </button>
    );
  };
  return (
    <aside className="mw-side">
      <div className="mw-list">
        {props.trainings.map((t) => {
          const id = RUN_PREFIX + t.id;
          return (
            <button
              key={t.id}
              className={`mw-item train${props.selectedId === id ? ' is-selected' : ''}`}
              aria-current={props.selectedId === id}
              onClick={() => props.onSelect(id)}
            >
              <span className="mw-item-text">
                <span className="mw-item-name" title={t.plan.name}>{t.plan.name}</span>
                <span className="mw-item-state">
                  <TierBadge tier={t.plan.tier} />
                  <span>Обучается, {fmtShare(t.flopTotal > 0 ? t.flopDone / t.flopTotal : 0, 0)}</span>
                </span>
              </span>
            </button>
          );
        })}
        {active.map(renderModel)}
        {archived.length > 0 && (
          <button
            type="button"
            className="mw-archive"
            aria-expanded={archiveShown}
            title="Модели, снятые с продажи"
            onClick={() => setArchiveOpen((v) => !v)}
          >
            <span className="mw-archive-arrow">{archiveShown ? '▾' : '▸'}</span>
            Архив ({archived.length})
          </button>
        )}
        {archiveShown && archived.map(renderModel)}
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

// ---------- Поля и переключатели ----------

function PriceInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  invalid: boolean;
  title: string;
  disabled?: boolean;
}) {
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
          disabled={props.disabled}
          className={`mw-price-input${props.invalid ? ' mw-bad' : ''}`}
          aria-invalid={props.invalid}
          title={props.title}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onEnter()}
        />
      </div>
    </div>
  );
}

/**
 * Переключатель канала продаж: флажок с подписью. Пока есть причина (reason), флажок выглядит недоступным,
 * но нажатие на него показывает причину красной строкой на 3,5 секунды.
 */
function Switch(props: { checked: boolean; label: string; title?: string; reason?: string | null; onChange: (v: boolean) => void }) {
  const [note, flash] = useFlash();
  const blocked = !!props.reason;
  return (
    <span className="mw-switch-wrap">
      <label
        className={`mw-switch${props.checked ? ' on' : ''}${blocked ? ' disabled' : ''}`}
        title={props.title}
        onClick={(e) => {
          if (!blocked) return;
          e.preventDefault();
          flash(props.reason!);
        }}
      >
        <input
          type="checkbox"
          checked={props.checked}
          aria-disabled={blocked || undefined}
          onChange={(e) => !blocked && props.onChange(e.target.checked)}
        />
        <span>{props.label}</span>
      </label>
      <DenyNote text={note} />
    </span>
  );
}

// ---------- Выпуск (модель обучена, но не продаётся) ----------

function ReleaseBlock({ s, m }: { s: GameState; m: PlayerModel }) {
  const tier = m.plan.tier;
  const base = roundPrice(tierPrice(s.day, m));
  const steps = PRICE_STEPS.map((t) => ({ ...t, price: roundPrice(base * t.k) }));
  const [apiOn, setApiOn] = useState(true);
  const [subsWanted, setSubsWanted] = useState(true);
  const [text, setText] = useState(() => priceText(base));
  const [subsText, setSubsText] = useState(() => priceText(TIER_SUBS_PRICE[tier] ?? TIER_SUBS_PRICE.mid));
  const [err, setErr] = useState<string | null>(null);
  const api = parsePrice(text, s.day);
  const subs = parseSubsPrice(subsText);

  // Подписка при выпуске: канал открыт с чат-момента, а сильной модели сначала нужна внешняя проверка.
  const reason = reviewReason(s, m);
  const subsBlock = !subsOpen(s.day)
    ? SUBS_CLOSED
    : reason !== null
      ? `Нужна внешняя проверка: ${reason}. Подписку можно включить после неё.`
      : null;
  const subsOn = subsWanted && subsBlock === null;

  const canRelease = (apiOn || subsOn) && (!apiOn || api.price !== null) && (!subsOn || subs.price !== null);
  const blockReason = !(apiOn || subsOn)
    ? 'Выберите хотя бы один канал продаж.'
    : apiOn && api.price === null
      ? (api.error ?? 'Укажите цену API')
      : subsOn && subs.price === null
        ? (subs.error ?? 'Укажите цену подписки')
        : null;

  function release() {
    if (!canRelease) return;
    // releaseModel всегда включает API: если игрок снял флажок, выключаем канал сразу после выпуска.
    const r = store.dispatch((st: GameState) => {
      const res = actions.releaseModel(st, m.id, api.price ?? base, { onSubs: subsOn, subsPrice: subs.price ?? undefined });
      if (res.ok && !apiOn) actions.setOnApi(st, m.id, false);
      return res;
    });
    setErr(r.ok ? null : r.error);
  }

  return (
    <section>
      <h3 className="mw-h">Выпуск на рынок</h3>
      {reason !== null && subsOpen(s.day) && (
        <Alert tone="info">
          Нужна внешняя проверка: {reason}. До неё модель можно продавать только по API. Проверка займёт {fmtDays(reviewDays(s, m))} и стоит{' '}
          {fmtMoney(reviewCost(m))}; начать её можно в этом окне после выпуска.
        </Alert>
      )}
      <div className="mw-panel">
        <div className="mw-sub">Уровень «{TIER_NAMES[tier]}»: типичная цена за 1 млн токенов - {fmtPrice(base)}</div>
        <div className="mw-tiers" role="radiogroup" aria-label="Рекомендуемая цена">
          {steps.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={api.price === t.price}
              disabled={!apiOn}
              className={`mw-tier${api.price === t.price ? ' on' : ''}`}
              onClick={() => setText(priceText(t.price))}
            >
              <span>{t.label}</span>
              <b className="num">{fmtPrice(t.price)}</b>
            </button>
          ))}
        </div>

        <div className="mw-release-ch">
          <div className="mw-release-row">
            <Switch
              checked={apiOn}
              label="Продавать по API"
              title="Корпоративные клиенты и разработчики покупают токены модели."
              onChange={setApiOn}
            />
            <div className="mw-edit">
              <PriceInput
                label="Цена за 1 млн токенов"
                value={text}
                onChange={setText}
                onEnter={release}
                invalid={apiOn && api.error !== null}
                title={PRICE_TITLE}
                disabled={!apiOn}
              />
              {apiOn && api.price !== null && <span className="mw-sub mw-vs">{versusMarket(api.price, base)}</span>}
            </div>
          </div>
          {apiOn && api.error && <div className="error">{api.error}</div>}

          <div className="mw-release-row">
            <Switch
              checked={subsOn}
              label="Продавать по подписке"
              title={subsBlock ?? 'Обычные пользователи платят за чат с моделью каждый месяц.'}
              reason={subsBlock}
              onChange={setSubsWanted}
            />
            <div className="mw-edit">
              <PriceInput
                label="Цена подписки в месяц"
                value={subsText}
                onChange={setSubsText}
                onEnter={release}
                invalid={subsOn && subs.error !== null}
                title={SUBS_PRICE_TITLE}
                disabled={!subsOn}
              />
            </div>
          </div>
          {subsOn && subs.error && <div className="error">{subs.error}</div>}
          {subsBlock !== null && <div className="mw-sub">{subsBlock}</div>}
        </div>

        <div className="mw-panel-foot">
          <span className="mw-sub">Цены можно менять после выпуска.</span>
          <GuardButton
            className="btn primary"
            data-tutorial="release"
            reason={canRelease ? null : (blockReason ?? 'Модель пока нельзя выпустить.')}
            title={canRelease ? 'Выпустить модель на рынок' : undefined}
            onClick={release}
          >
            Выпустить
          </GuardButton>
        </div>
        <ErrorText error={err} />
      </div>
    </section>
  );
}

// ---------- Продажи (модель выпущена) ----------

/** Показатель панели канала: подпись, значение и необязательная приглушённая строка под ним. */
function Metric(props: { label: string; value: string; sub?: string; tone?: 'income'; title?: string; off?: boolean }) {
  return (
    <div className="mw-metric" title={props.title}>
      <span className="mw-metric-l">{props.label}</span>
      <span className={`mw-metric-v${props.tone ? ` ${props.tone}` : ''}${props.off ? ' off' : ''}`}>{props.value}</span>
      {props.sub && <span className="mw-metric-s">{props.sub}</span>}
    </div>
  );
}

function ApiPanel({ s, m, open }: { s: GameState; m: PlayerModel; open: WindowProps['open'] }) {
  const typical = tierPrice(s.day, m);
  const [text, setText] = useState(() => String(Math.round(m.price * 100) / 100).replace('.', ','));
  const [err, setErr] = useState<string | null>(null);
  const { price, error } = parsePrice(text, s.day);
  const { tokens, users, apiRevenue } = salesOf(s, m);
  const noPool = m.onApi && pool(s, 'api') <= 0;
  const lost = s.market.lostApi;
  const losing = m.onApi && !noPool && lost > 0.01;

  function run(r: Result) {
    setErr(r.ok ? null : r.error);
  }
  const changePrice = () => price !== null && run(store.dispatch(actions.setModelPrice, m.id, price));
  // Цена в поле округлена до центов, поэтому сравниваем с точностью до цента.
  const unchanged = price !== null && Math.round(price * 100) === Math.round(m.price * 100);

  return (
    <div className={`mw-ch api${m.onApi ? ' on' : ''}`}>
      <div className="mw-ch-head">
        <h4 className="mw-ch-title">API</h4>
        <Switch
          checked={m.onApi}
          label="Продавать по API"
          title="Корпоративные клиенты и разработчики покупают токены модели."
          onChange={(v) => run(store.dispatch(actions.setOnApi, m.id, v))}
        />
      </div>
      {noPool && (
        <Alert tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
          Доля «API» равна 0 %: запросы не обслуживаются.
        </Alert>
      )}
      {losing && <Alert tone="warn">Не хватает мощности «API»: теряется {fmtShare(lost, 0)} спроса.</Alert>}
      <div className="mw-metrics">
        <Metric label="Токенов в день" value={tokens !== undefined ? fmtNum(Math.round(tokens)) : '-'} off={tokens === undefined}
          sub={users !== undefined ? `≈ ${fmtNum(Math.round(users))} пользователей` : undefined}
          title={`Оценка пользователей: токены в день / ${fmtNum(TOKENS_PER_USER_DAY)}`} />
        <Metric label="Цена за 1 млн" value={fmtPrice(m.price)} off={!m.onApi} sub={versusMarket(m.price, typical)}
          title={`Типичная цена для уровня «${TIER_NAMES[m.plan.tier]}»: ${fmtPrice(typical)}`} />
        <Metric label="Выручка в день" value={apiRevenue !== undefined ? fmtMoney(apiRevenue) : '-'} tone="income" off={apiRevenue === undefined} />
      </div>
      <div className="mw-edit mw-ch-edit">
        <PriceInput label="Новая цена за 1 млн токенов" value={text} onChange={setText} onEnter={changePrice} invalid={error !== null} title={PRICE_TITLE} />
        <button
          className="btn"
          disabled={price === null || unchanged}
          title={price === null ? (error ?? 'Укажите цену') : unchanged ? 'Цена не изменилась' : 'Применить новую цену'}
          onClick={changePrice}
        >
          Изменить цену
        </button>
      </div>
      {price !== null && !unchanged && <div className="mw-sub">{versusMarket(price, typical)}</div>}
      {error && <div className="error">{error}</div>}
      <ErrorText error={err} />
    </div>
  );
}

/** Внешняя проверка сильной модели: что нужно, сколько стоит, кнопка «Начать проверку» с подтверждением. */
function ReviewBox({ s, m }: { s: GameState; m: PlayerModel }) {
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (m.review === 'pending' && m.reviewEndDay !== null) {
    return (
      <div className="mw-review pending">
        <b>Проверка до {formatDateShort(m.reviewEndDay)}</b>
        <span>Независимые эксперты проверяют модель. Подписку можно будет включить после проверки.</span>
      </div>
    );
  }
  if (m.review === 'passed') {
    return (
      <div className="mw-review passed">
        <b>Проверка пройдена</b>
        <span>Замечаний нет.</span>
      </div>
    );
  }
  if (m.review !== 'required') return null;

  const cost = reviewCost(m);
  const days = reviewDays(s, m);
  const short = cost > s.cash;
  const reason = reviewReason(s, m);
  const shortText = `Не хватает денег: нужно ${fmtMoney(cost)}, на счету ${fmtMoney(s.cash)}.`;

  function start() {
    const r = store.dispatch(actions.startReview, m.id);
    setConfirm(false);
    setErr(r.ok ? null : r.error);
  }

  return (
    <div className="mw-review required">
      <b>Нужна внешняя проверка</b>
      <span>
        {reason !== null ? `Модель заметно сильнее переднего края: ${reason}. ` : 'Модель заметно сильнее переднего края. '}
        До проверки её можно продавать только по API.
      </span>
      <div className="mw-review-act">
        <GuardButton
          className="btn primary"
          reason={short ? shortText : null}
          title={short ? undefined : `Проверка займёт ${fmtDays(days)} и стоит ${fmtMoney(cost)}`}
          onClick={() => setConfirm(true)}
        >
          Начать проверку
        </GuardButton>
        <span className="mw-sub">
          <b className="mw-cost">{fmtMoney(cost)}</b>, {fmtDays(days)}
        </span>
      </div>
      <ErrorText error={err} />
      {confirm && (
        <ConfirmDialog title="Внешняя проверка" confirmLabel="Начать проверку" onConfirm={start} onClose={() => setConfirm(false)}>
          <div className="kv">
            <span>Модель</span>
            <span>{m.name}</span>
            <span>Стоимость</span>
            <span className="mw-cost">{fmtMoney(cost)}</span>
            <span>Срок</span>
            <span>
              {fmtDays(days)}, до {formatDateShort(s.day + days)}
            </span>
            <span>На счету</span>
            <span>{fmtMoney(s.cash)}</span>
          </div>
          <div className="mw-sub">Пока проверка идёт, подписку включить нельзя. API продаётся как обычно.</div>
        </ConfirmDialog>
      )}
    </div>
  );
}

function SubsPanel({ s, m, open }: { s: GameState; m: PlayerModel; open: WindowProps['open'] }) {
  const [text, setText] = useState(() => String(Math.round(m.subsPrice * 100) / 100).replace('.', ','));
  const [err, setErr] = useState<string | null>(null);
  const { price, error } = parseSubsPrice(text);
  const { subscribers, subsRevenue } = salesOf(s, m);
  const opened = subsOpen(s.day);
  const noPool = m.onSubs && pool(s, 'subs') <= 0;
  const lost = s.market.lostSubs;
  const losing = m.onSubs && !noPool && lost > 0.01;

  // Выключить подписку можно всегда; включить - после чат-момента и без незавершённой проверки.
  const blocked = !m.onSubs && (!opened || m.review === 'required' || m.review === 'pending');
  const blockTitle = !opened
    ? SUBS_CLOSED
    : m.review === 'required'
      ? REVIEW_FIRST
      : m.review === 'pending' && m.reviewEndDay !== null
        ? `Проверка до ${formatDateShort(m.reviewEndDay)}.`
        : undefined;

  function run(r: Result) {
    setErr(r.ok ? null : r.error);
  }
  const changePrice = () => price !== null && run(store.dispatch(actions.setSubsPrice, m.id, price));
  const unchanged = price !== null && Math.round(price * 100) === Math.round(m.subsPrice * 100);

  return (
    <div className={`mw-ch subs${m.onSubs ? ' on' : ''}`}>
      <div className="mw-ch-head">
        <h4 className="mw-ch-title">Подписка</h4>
        <Switch
          checked={m.onSubs}
          label="Продавать по подписке"
          title={blocked ? blockTitle : 'Обычные пользователи платят за чат с моделью каждый месяц.'}
          reason={blocked ? (blockTitle ?? SUBS_CLOSED) : null}
          onChange={(v) => run(store.dispatch(actions.setOnSubs, m.id, v))}
        />
      </div>
      <ReviewBox s={s} m={m} />
      {noPool && (
        <Alert tone="warn" action={{ label: 'Открыть «Мощности»', onClick: () => open('compute') }}>
          Доля «Подписки» равна 0 %: чат не обслуживается.
        </Alert>
      )}
      {losing && <Alert tone="warn">Не хватает мощности «Подписки»: теряется {fmtShare(lost, 0)} спроса.</Alert>}
      <div className="mw-metrics">
        <Metric label="Подписчиков" value={subscribers !== undefined ? fmtNum(Math.round(subscribers)) : '-'} off={subscribers === undefined} />
        <Metric label="Цена в месяц" value={fmtPrice(m.subsPrice)} off={!m.onSubs} />
        <Metric label="Выручка в день" value={subsRevenue !== undefined ? fmtMoney(subsRevenue) : '-'} tone="income" off={subsRevenue === undefined} />
      </div>
      <div className="mw-edit mw-ch-edit">
        <PriceInput label="Цена подписки в месяц" value={text} onChange={setText} onEnter={changePrice} invalid={error !== null} title={SUBS_PRICE_TITLE} />
        <button
          className="btn"
          disabled={price === null || unchanged}
          title={price === null ? (error ?? 'Укажите цену') : unchanged ? 'Цена не изменилась' : 'Применить новую цену'}
          onClick={changePrice}
        >
          Изменить цену
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      <ErrorText error={err} />
    </div>
  );
}

function SalesBlock({ s, m, open }: { s: GameState; m: PlayerModel; open: WindowProps['open'] }) {
  // До открытия подписок панель «Подписка» свёрнута в одну строку, API занимает всю ширину.
  const subsLater = !subsOpen(s.day) && !m.onSubs;
  return (
    <section>
      <h3 className="mw-h">Продажи</h3>
      <div className={`mw-channels${subsLater ? ' single' : ''}`}>
        <ApiPanel s={s} m={m} open={open} />
        {subsLater ? <div className="mw-subs-later">{SUBS_CLOSED}</div> : <SubsPanel s={s} m={m} open={open} />}
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

interface Kpi {
  label: string;
  value: string;
  sub?: string;
  title?: string;
  tone?: 'income' | 'cost';
}

/** Крупные показатели под заголовком: на них взгляд падает первым. */
function Kpis({ s, m }: { s: GameState; m: PlayerModel }) {
  const released = m.releasedDay !== null;
  const rank = modelArenaPlace(s, m);
  const { share, revenue, apiRevenue, subsRevenue } = salesOf(s, m);
  const items: Kpi[] = released
    ? [
        {
          label: 'Место на «Арене»',
          value: fmtRank(rank),
          sub: rank === null ? `Не в продаже, Эло ${fmtElo(m.arenaElo)}` : `Эло ${fmtElo(m.arenaElo)}`,
          title: `${ARENA_PLACE_TITLE} Подгонка под бенчмарки Эло не повышает.`,
        },
        {
          label: 'Доля рынка',
          value: share !== undefined ? fmtShare(share, share < 0.01 ? 2 : 1) : '-',
          title: 'Общая доля среди клиентов API и подписчиков, по выручке',
        },
        {
          label: 'Выручка в день',
          value: revenue !== undefined ? fmtMoney(revenue) : '-',
          sub:
            revenue !== undefined
              ? `API ${fmtMoney(apiRevenue ?? 0)}, подписки ${fmtMoney(subsRevenue ?? 0)}`
              : undefined,
          tone: 'income',
          title: revenue !== undefined ? `≈ ${fmtMoney(revenue * 30)} в месяц` : undefined,
        },
        {
          label: 'Заработала всего',
          value: fmtMoney(m.earned),
          sub: `из них подписки ${fmtMoney(m.earnedSubs)}`,
          tone: 'income',
          title: 'Выручка по обоим каналам с момента выпуска',
        },
      ]
    : [
        { label: 'Эло', value: fmtElo(m.arenaElo), title: 'Рейтинг на «Арене». Подгонка под бенчмарки его не повышает.' },
        { label: 'Параметры', value: fmtParams(m.plan.paramsB) },
        { label: 'Контекст', value: contextLabel(m.plan.context), sub: 'токенов' },
        { label: 'Обучена', value: formatDateShort(m.trainedDay) },
      ];
  return <KpiRow items={items} />;
}

function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <div className="mw-kpis">
      {items.map((k) => (
        <div key={k.label} className="mw-kpi" title={k.title}>
          <span className="mw-kpi-l">{k.label}</span>
          <span className={`mw-kpi-v${k.tone ? ` ${k.tone}` : ''}`}>{k.value}</span>
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
        <dt>Уровень</dt>
        <dd>
          <TierBadge tier={plan.tier} />
        </dd>
        <dt>Архитектура</dt>
        <dd>{arch === 'transformer' ? 'Трансформер' : 'LSTM'}</dd>
        <dt>Параметры</dt>
        <dd>{fmtParams(plan.paramsB)}</dd>
        <dt>Контекст</dt>
        <dd>{contextLabel(plan.context)} {tokensWord(plan.context)}</dd>
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
  const power = trainingPoolPerRun(s); // доля «Обучение» делится между идущими проектами
  const perDay = power * TRAIN_FLOP_PER_H100E_DAY;
  const waiting = t.failed || awaitingEvent(s, 'training-fail');
  const left = perDay > 0 ? Math.max(1, Math.ceil((t.flopTotal - t.flopDone) / perDay)) : null;
  // Аренда доли «Обучение» делится между проектами: на этот проект приходится его часть.
  const rentDay = (rentPerDay(s) * s.compute.alloc.training) / Math.max(1, s.trainings.length);
  const forecast = s.research.done.includes('scaling')
    ? forecastElo(capsFromPlan(t.plan, t.algoLevel, t.arch, t.failPenalty, t.techs ?? []), t.plan.rlhf, t.algoLevel, t.techs ?? [])
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
      tone: 'cost',
      title: 'Часть аренды доли «Обучение», которая приходится на этот проект',
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
        <div className="mw-pills">
          <span className="mw-pill train">Обучается</span>
          <TierBadge tier={t.plan.tier} />
        </div>
      </header>
      <KpiRow items={items} />
      <section>
        <h3 className="mw-h">Ход обучения</h3>
        <div className="mw-panel">
          <ProgressBar value={frac} />
          <div className="mw-panel-foot">
            <span className="mw-sub">
              Мощность на обучение: <b>{fmtH100e(power)} H100e</b>
              <Cards s={s} h100e={power} />
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
  const rv = reviewState(m);
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
        <div className="mw-pills">
          <span className={`mw-pill ${st.tone}`}>{st.text}</span>
          <TierBadge tier={m.plan.tier} />
          {rv && <span className={`mw-pill ${rv.tone}`}>{rv.text}</span>}
        </div>
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
  const [detail, setDetail] = useState(false); // телефон: карточка модели открыта на весь экран

  if (s.models.length === 0 && s.trainings.length === 0) {
    return (
      <div className="mw-empty">
        <IconModels size={64} />
        <div className="mw-empty-title">Моделей нет.</div>
        <button className="btn primary" onClick={() => open('newModel')}>Создать модель</button>
      </div>
    );
  }

  const models = [...s.models].reverse(); // новые сверху
  // Выбран проект обучения, пока он идёт; закончился - выбор падает на первую модель (или на оставшийся проект).
  const run = selectedId?.startsWith(RUN_PREFIX) ? s.trainings.find((t) => RUN_PREFIX + t.id === selectedId) : undefined;
  const picked = run ? null : (models.find((x) => x.id === selectedId) ?? models[0] ?? null);
  const shownRun = run ?? (picked ? undefined : s.trainings[0]);
  const current = picked ? picked.id : shownRun ? RUN_PREFIX + shownRun.id : '';

  return (
    <div className={`mw${detail ? ' show-detail' : ''}`}>
      <ModelList
        models={models}
        trainings={s.trainings}
        selectedId={current}
        onSelect={(id) => {
          setSelectedId(id);
          setDetail(true);
        }}
        open={open}
      />
      <button type="button" className="btn m-back" onClick={() => setDetail(false)}>
        <IconChevronLeft size={14} />
        К списку
      </button>
      {picked ? <ModelCard key={picked.id} s={s} m={picked} open={open} /> : shownRun && <TrainingCard key={shownRun.id} s={s} t={shownRun} open={open} />}
    </div>
  );
}
