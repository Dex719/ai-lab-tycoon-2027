// Окно «Модели»: слева коллекция моделей с эмблемами, справа карточка выбранной.
// У карточки тёмная шапка (как полоса прогноза в «Новой модели»): обложка, название и четыре главных числа.
// Две панели продаж: «API» (цена за 1 млн токенов) и «Подписка» (цена в месяц, внешняя проверка сильных моделей).

import { FlashNum } from '../FlashNum';
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { WindowProps } from '.';
import { benchDef, DOMAIN_NAMES, introducedBenchmarks } from '../../sim/benchmarks';
import { pool, rentPerDay } from '../../sim/compute';
import {
  SUBS_PRICE_MAX,
  SUBS_PRICE_MIN,
  SUBS_PRICE_RATIO_MAX,
  SUBS_REF_PRICE,
  TIER_API_PRICE_MULT,
  TIER_SUBS_PRICE,
  TOKENS_PER_USER_DAY,
  TRAIN_FLOP_PER_H100E_DAY,
} from '../../sim/constants';
import { awaitingEvent } from '../../sim/events';
import { contextLabel } from '../../sim/research';
import { benchRank, type RaceMetric } from '../../sim/leaderboard';
import { ARENA_PLACE_TITLE } from '../arena';
import { minPrice, overpriceFrom, playerSales, refPrice, subsOpen } from '../../sim/market';
import { formatDateShort } from '../../sim/time';
import { REDTEAM, redTeamBlock, redTeamCost } from '../../sim/redteam';
import { disputeWarning, releaseDisputed } from '../../sim/cofounder';
import {
  arenaElo as forecastElo,
  capsFromPlan,
  exposureChance,
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
  type DomainId,
  type GameState,
  type ModelRef,
  type PlayerModel,
  type Result,
  type TrainingPlan,
  type TrainingRun,
} from '../../sim/types';
import { Cards } from '../components/Cards';
import { Alert, ConfirmDialog, DenyNote, ErrorText, GuardButton, ProgressBar, useFlash } from '../components/common';
import { ModelEmblem } from '../components/ModelEmblem';
import { TierBadge } from '../components/TierBadge';
import { endSentence, fmtDays, fmtElo, fmtH100e, fmtMoney, fmtNum, fmtParams, fmtPct, fmtPrice, fmtShare, fmtTokens, ruPlural } from '../format';
import { tokensWord } from '../../sim/text';
import { IconCaret, IconChevronLeft, IconModels } from '../icons';
import { raceMetricOf, raceRows } from '../race';
import { actions, store } from '../store';
import './ModelsWindow.css';

/** Части подписи модели не рвутся посередине («2 тыс.», «109 млрд»): перенос только между частями. */
const nb = (part: string): string => part.replace(/ /g, String.fromCharCode(160));

const MAX_PRICE = 10_000;

/** Три готовые цены относительно типичной цены уровня модели. */
const PRICE_STEPS = [
  { id: 'cheap', label: 'Дешевле рынка', k: 0.6 },
  { id: 'market', label: 'Рынок', k: 1 },
  { id: 'dear', label: 'Дороже рынка', k: 1.5 },
] as const;

const PRICE_TITLE = 'Цена за 1 млн токенов в долларах. Чем ниже цена, тем больше доля рынка и выше нагрузка на мощности «API».';
const SUBS_PRICE_TITLE = 'Цена подписки в долларах в месяц. Чем ниже цена, тем больше подписчиков и выше нагрузка на мощности «Подписки».';
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

/** Подпись состояния в коллекции: обученная, но не выпущенная модель ждёт выпуска. */
function stateLabel(m: PlayerModel): string {
  return m.releasedDay === null ? 'Ждёт выпуска' : saleState(m).text;
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

// Подписка дороже этой цены теряет пользователей круче (market.ts, OVERPRICE_K).
const SUBS_OVERPRICE_FROM = SUBS_PRICE_RATIO_MAX * SUBS_REF_PRICE;

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

/** Есть ли в таблице гонки модели соперников: без них места не показываем. */
function hasRivals(s: GameState, metric: RaceMetric | null): boolean {
  return metric !== null && raceRows(s, metric).some((x) => x.owner !== 'player');
}

/** Подпись места в гонке: «Место на «Арене»» или «Место: GLUU». */
function placeLabel(metric: RaceMetric | null): string {
  return metric?.kind === 'bench' ? `Место: ${metric.name}` : 'Место на «Арене»';
}

function placeTitle(metric: RaceMetric | null): string {
  return metric?.kind === 'bench'
    ? `Место по тесту ${metric.name} среди всех вышедших моделей: пока соперники не продают модели по API, гонка идёт по этому тесту.`
    : ARENA_PLACE_TITLE;
}

/** Ключ проекта обучения в списке: у проекта нет id модели. */
const RUN_PREFIX = 'run:';

// ---------- Ред-тиминг ----------

/**
 * Ред-тиминг (sim/redteam.ts): сколько уязвимостей примерно осталось, идёт ли проверка, две кнопки - быстрый и полный.
 * Модели без уязвимостей в данных (обучены до этой механики) блока не показывают.
 */
function RedTeamBlock({ s, m }: { s: GameState; m: PlayerModel }) {
  const [err, setErr] = useState<string | null>(null);
  if (m.holes === undefined) return null;
  const status = m.redTeam
    ? `Проверка идёт до ${formatDateShort(m.redTeam.endDay)}.`
    : m.redTeamDone
      ? m.holes === 0
        ? 'Проверена: уязвимостей не осталось.'
        : `Проверена: осталось примерно ${m.holes}.`
      : 'Не проверялась: уязвимостей неизвестно. Каждая может всплыть инцидентом, пока модель в продаже.';
  return (
    <section className="mw-release">
      <h3 className="mw-h">Ред-тиминг</h3>
      <div className="mw-panel">
        <p className="mw-rt-s">{status}</p>
        <div className="mw-rt-btns">
          {REDTEAM_MODES.map((mode) => (
            <GuardButton
              key={mode}
              className="btn"
              reason={redTeamBlock(s, m, mode)}
              onClick={() => {
                const r = store.dispatch(actions.startRedTeam, m.id, mode);
                setErr(r.ok ? null : r.error);
              }}
            >
              {REDTEAM[mode].name}: {REDTEAM[mode].days} дн., {fmtMoney(redTeamCost(s, mode))}
            </GuardButton>
          ))}
        </div>
        <span className="mw-rt-note">Быстрый закрывает около половины уязвимостей, полный - почти все. Пока идёт проверка, модель не выпустить.</span>
        <ErrorText error={err} />
      </div>
    </section>
  );
}

const REDTEAM_MODES = ['quick', 'full'] as const;

// ---------- Коллекция ----------

function ModelList(props: {
  s: GameState;
  models: PlayerModel[];
  trainings: TrainingRun[];
  selectedId: string;
  onSelect: (id: string) => void;
  open: WindowProps['open'];
  /** Модель игрока, которая сейчас на 1-м месте в гонке: золотая рамка. */
  championId: string | null;
}) {
  // Снятые с продажи модели сворачиваем в «Архив»; если выбрана одна из них, группа открыта.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archived = props.models.filter((m) => saleState(m).tone === 'off');
  const active = props.models.filter((m) => saleState(m).tone !== 'off');
  const archiveShown = archiveOpen || archived.some((m) => m.id === props.selectedId);
  const onSale = props.models.filter((m) => saleState(m).tone === 'sale').length;
  const waiting = props.models.filter((m) => m.releasedDay === null).length;
  const total = props.models.length;
  const renderModel = (m: PlayerModel) => {
    const st = saleState(m);
    const rv = reviewState(m);
    const champion = m.id === props.championId;
    return (
      <button
        key={m.id}
        className={`mw-item ${st.tone}${m.id === props.selectedId ? ' is-selected' : ''}`}
        aria-current={m.id === props.selectedId}
        onClick={() => props.onSelect(m.id)}
      >
        <ModelEmblem m={m} size={42} gold={champion} exposed={m.exposed} faded={st.tone === 'off'} />
        <span className="mw-item-text">
          <span className="mw-item-top">
            <span className="mw-item-name" title={m.name}>
              {m.name}
            </span>
            {champion && (
              <b className="mw-crown" title="Лучшая модель в гонке">
                1-е
              </b>
            )}
            <span className="mw-item-elo" title="Рейтинг Эло">
              <FlashNum value={m.arenaElo} frac={0} minAbs={2} className="on-light">{fmtElo(m.arenaElo)}</FlashNum>
            </span>
          </span>
          <span className={`mw-item-state ${st.tone}`}>
            <i className="mw-dot" />
            {stateLabel(m)}
          </span>
          {rv && rv.tone !== 'good' && <span className={`mw-item-state ${rv.tone}`}>{rv.text}</span>}
          {m.exposed && <span className="mw-item-state bad">Подгонка раскрыта</span>}
        </span>
      </button>
    );
  };
  return (
    <aside className="mw-side">
      <div className="mw-side-head">
        <div className="mw-coll">
          <span className="mw-coll-t">Коллекция</span>
          <span className="mw-coll-n">
            {fmtNum(total)} {ruPlural(total, 'модель', 'модели', 'моделей')}
          </span>
        </div>
        <div className="mw-coll-tags">
          <span>
            В продаже <b className="sale">{fmtNum(onSale)}</b>
          </span>
          {waiting > 0 && (
            <span>
              ждут выпуска <b className="idle">{fmtNum(waiting)}</b>
            </span>
          )}
          {props.trainings.length > 0 && (
            <span>
              обучается <b className="train">{fmtNum(props.trainings.length)}</b>
            </span>
          )}
        </div>
      </div>
      <div className="mw-list">
        {props.trainings.map((t) => {
          const id = RUN_PREFIX + t.id;
          const frac = t.flopTotal > 0 ? t.flopDone / t.flopTotal : 0;
          return (
            <button
              key={t.id}
              className={`mw-item train${props.selectedId === id ? ' is-selected' : ''}`}
              aria-current={props.selectedId === id}
              onClick={() => props.onSelect(id)}
            >
              <ModelEmblem m={{ id: t.id, name: t.plan.name, arch: t.arch, plan: t.plan }} size={42} progress={frac} />
              <span className="mw-item-text">
                <span className="mw-item-top">
                  <span className="mw-item-name" title={t.plan.name}>
                    {t.plan.name}
                  </span>
                </span>
                <span className="mw-item-state train">
                  <i className="mw-dot" />
                  Обучается, {fmtShare(frac, 0)}
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
            <IconCaret size={14} className={`mw-caret${archiveShown ? ' open' : ''}`} />
            Архив ({archived.length})
          </button>
        )}
        {archiveShown && archived.map(renderModel)}
      </div>
      <div className="mw-side-foot">
        <button className="btn primary wide" onClick={() => props.open('newModel')}>
          Создать модель
        </button>
      </div>
    </aside>
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
      <label className="mw-sub" htmlFor={id}>
        {props.label}
      </label>
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
  // Кнопка «Выпустить» сама прокручивается в видимую часть окна: в небольшом окне (1024×768) она оказывалась под
  // карточкой и характеристиками, и модель месяцами лежала готовой (плейтест 18.10).
  const footRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = footRef.current;
    // Только ближайший прокручиваемый блок окна: scrollIntoView сдвигал бы и сам рабочий стол.
    let box = el?.parentElement ?? null;
    while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (!el || !box) return;
    const over = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
    if (over > 0) box.scrollTop += over + 12;
  }, [m.id]);

  // Подписка при выпуске: канал открыт с чат-момента (до него строки нет вовсе), сильной модели сначала нужна внешняя проверка.
  const opened = subsOpen(s.day);
  const reason = reviewReason(s, m);
  const subsBlock = !opened ? null : reason !== null ? `Нужна внешняя проверка: ${reason}. Подписку можно включить после неё.` : null;
  const subsOn = opened && subsWanted && subsBlock === null;

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
    <section className="mw-release">
      <h3 className="mw-h">Выпуск на рынок</h3>
      {reason !== null && opened && (
        <Alert tone="info">
          Нужна внешняя проверка: {reason}. До неё модель можно продавать только по API. Проверка займёт {fmtDays(reviewDays(s, m))} и стоит{' '}
          {fmtMoney(reviewCost(m))}; начать её можно в этом окне после выпуска.
        </Alert>
      )}
      <div className="mw-panel release">
        <div className="mw-sub">
          Уровень «{TIER_NAMES[tier]}»: типичная цена за 1 млн токенов - {fmtPrice(base)}
        </div>
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
            {opened ? (
              <Switch checked={apiOn} label="Продавать по API" title="Корпоративные клиенты и разработчики покупают токены модели." onChange={setApiOn} />
            ) : (
              <span className="mw-switch on static">Продажа по API</span>
            )}
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

          {opened && (
            <>
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
            </>
          )}
        </div>

        {releaseDisputed(m) && disputeWarning(s, ['holes']) && <div className="mw-dispute">{disputeWarning(s, ['holes'])}</div>}
        <div className="mw-panel-foot" ref={footRef}>
          <GuardButton
            className="btn primary big mw-release-btn"
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
  const over = overpriceFrom(s.day);
  const overpriced = (price ?? m.price) > over;

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
      {overpriced && (
        <Alert tone="warn">Цена выше {fmtPrice(over)}: клиенты быстро уходят к соперникам, и выручка падает.</Alert>
      )}
      <div className="mw-metrics">
        <Metric
          label="Токенов в день"
          value={tokens !== undefined ? fmtNum(Math.round(tokens)) : '-'}
          off={tokens === undefined}
          sub={users !== undefined ? `≈ ${fmtNum(Math.round(users))} пользователей` : undefined}
          title={`Оценка пользователей: токены в день / ${fmtNum(TOKENS_PER_USER_DAY)}`}
        />
        <Metric
          label="Цена за 1 млн"
          value={fmtPrice(m.price)}
          off={!m.onApi}
          sub={versusMarket(m.price, typical)}
          title={`Типичная цена для уровня «${TIER_NAMES[m.plan.tier]}»: ${fmtPrice(typical)}`}
        />
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
        <span className="mw-sub mw-vs">{price !== null && !unchanged ? versusMarket(price, typical) : ''}</span>
      </div>
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
  const shortText = `Не хватает денег: нужно ${fmtMoney(cost)}, на счету ${endSentence(fmtMoney(s.cash))}`;

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
  const noPool = m.onSubs && pool(s, 'subs') <= 0;
  const lost = s.market.lostSubs;
  const losing = m.onSubs && !noPool && lost > 0.01;

  // Выключить подписку можно всегда; включить - без незавершённой проверки (панель видна только после чат-момента).
  const blocked = !m.onSubs && (m.review === 'required' || m.review === 'pending');
  const blockTitle =
    m.review === 'required' ? REVIEW_FIRST : m.review === 'pending' && m.reviewEndDay !== null ? `Проверка до ${formatDateShort(m.reviewEndDay)}.` : undefined;

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
          reason={blocked ? (blockTitle ?? REVIEW_FIRST) : null}
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
      {(price ?? m.subsPrice) > SUBS_OVERPRICE_FROM && (
        <Alert tone="warn">Подписка дороже {fmtPrice(SUBS_OVERPRICE_FROM)} в месяц: пользователи быстро уходят к соперникам, и выручка падает.</Alert>
      )}
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
  // До открытия подписок панели «Подписка» нет вовсе: будущее не показываем, API занимает всю ширину.
  const subsShown = subsOpen(s.day) || m.onSubs;
  return (
    <section>
      <h3 className="mw-h">Продажи</h3>
      <div className={`mw-channels${subsShown ? '' : ' single'}`}>
        <ApiPanel s={s} m={m} open={open} />
        {subsShown && <SubsPanel s={s} m={m} open={open} />}
      </div>
    </section>
  );
}

// ---------- Баллы ----------

const DOMAIN_COLOR: Record<DomainId, string> = { language: 'var(--dir-train)', code: 'var(--dir-contracts)', reasoning: 'var(--dir-research)' };

function ScoresBlock({ s, m, benches }: { s: GameState; m: PlayerModel; benches: BenchmarkId[] }) {
  if (benches.length === 0) return null;
  const released = m.releasedDay !== null;
  const ref: ModelRef = { kind: 'player', id: m.id };
  const expose = exposureChance(s, m);

  return (
    <section>
      <h3 className="mw-h">Баллы тестов</h3>
      <div className="mw-scores">
        {benches.map((b) => {
          const def = benchDef(b);
          const saturated = s.benchmarks[b].saturated;
          const overfit = (m.overfit[b] ?? 0) > 0;
          const shown = modelScore(m, b, false);
          const honest = modelScore(m, b, true);
          // Место по тесту - только если по нему есть модели соперников: иначе «1-е» среди своих моделей путает (плейтест 17.10).
          const rank = released && hasRivals(s, { kind: 'bench', bid: b, name: benchDef(b).name }) ? benchRank(s, ref, b) : null;
          const style = { '--dc': DOMAIN_COLOR[def.domain] } as CSSProperties;
          return (
            <div key={b} className={`mw-score${saturated ? ' sat' : ''}`} style={style}>
              <span className="mw-score-name" title={saturated ? `${def.description} Тест насыщен: не влияет на шумиху и тендеры.` : def.description}>
                {def.name}
                <small>{saturated ? 'насыщен' : DOMAIN_NAMES[def.domain]}</small>
              </span>
              <span className="mw-score-bar" title={overfit ? `Честный балл без подгонки: ${fmtPct(honest)}` : undefined}>
                <i style={{ width: `${Math.max(0, Math.min(100, shown))}%` }} />
                {overfit && <em style={{ left: `${Math.max(0, Math.min(100, honest))}%` }} />}
              </span>
              <span className="mw-score-v">
                {fmtPct(shown)}
                {overfit && <small className="mw-honest">честно {fmtPct(honest)}</small>}
              </span>
              <span className={`mw-score-rank${rank === 1 ? ' gold' : ''}`} title="Место среди вышедших моделей по этому тесту">
                {rank !== null ? `${fmtNum(rank)}-е` : ''}
              </span>
            </div>
          );
        })}
      </div>
      {expose > 0 && (
        <div className="mw-expose">
          Шанс, что подгонку раскроют: <b>{fmtPct(expose * 100, 0)} в месяц</b>
        </div>
      )}
    </section>
  );
}

// ---------- Шапка карточки ----------

interface Kpi {
  label: string;
  value: string;
  sub?: string;
  title?: string;
  tone?: 'income' | 'cost' | 'gold';
}

/**
 * Шапка карточки как «Инспектор» в Processor Tycoon: серая панель с обложкой, название и строка состояния,
 * под ними сведения «подпись - значение», справа одно крупное число (главное для этой модели).
 */
function Hero(props: {
  emblem: React.ReactNode;
  name: string;
  sub: string;
  status: React.ReactNode;
  kpis: Kpi[];
}) {
  const [focus, ...facts] = props.kpis;
  return (
    <header className="mw-insp">
      <div className="mw-pic">{props.emblem}</div>
      <div className="mw-insp-main">
        <h2 className="mw-name" title={props.name}>
          {props.name}
        </h2>
        <div className="mw-head-sub">{props.sub}</div>
        <div className="mw-status">{props.status}</div>
        <dl className="mw-facts">
          {facts.map((k) => (
            <Fragment key={k.label}>
              <dt>{k.label}</dt>
              <dd title={k.title}>
                <span className={k.tone ? `mw-v ${k.tone}` : 'mw-v'}>{k.value}</span>
                {k.sub && <small>{k.sub}</small>}
              </dd>
            </Fragment>
          ))}
        </dl>
      </div>
      {focus && (
        <div className="mw-focus" title={focus.title}>
          <span className={`mw-focus-v${focus.tone ? ` ${focus.tone}` : ''}`}>{focus.value}</span>
          <span className="mw-focus-l">{focus.label}</span>
          {focus.sub && <span className="mw-focus-s">{focus.sub}</span>}
        </div>
      )}
    </header>
  );
}

/** Крупные показатели в шапке: на них взгляд падает первым. */
function kpisOf(s: GameState, m: PlayerModel, metric: RaceMetric | null, rank: number | null): Kpi[] {
  const released = m.releasedDay !== null;
  if (!released) {
    return [
      { label: 'Эло', value: fmtElo(m.arenaElo), title: 'Рейтинг на «Арене». Подгонка под тесты его не повышает.' },
      { label: 'Параметры', value: fmtParams(m.plan.paramsB) },
      { label: 'Контекст', value: contextLabel(m.plan.context), sub: tokensWord(m.plan.context) },
      { label: 'Обучена', value: formatDateShort(m.trainedDay) },
    ];
  }
  const { share, revenue, apiRevenue, subsRevenue } = salesOf(s, m);
  const subsShown = subsOpen(s.day) || m.onSubs || m.earnedSubs > 0;
  const rivals = hasRivals(s, metric);
  return [
    {
      label: placeLabel(metric),
      value: rank !== null ? `${fmtNum(rank)}-е` : '-',
      sub: rank === null ? `${rivals ? 'Не в зачёте' : 'Соперников пока нет'}, Эло ${fmtElo(m.arenaElo)}` : `Эло ${fmtElo(m.arenaElo)}`,
      title: `${placeTitle(metric)} Подгонка под тесты Эло не повышает.`,
      tone: rank === 1 ? 'gold' : undefined,
    },
    {
      label: 'Доля рынка',
      value: share !== undefined ? fmtShare(share, share < 0.01 ? 2 : 1) : '-',
      title: subsShown ? 'Общая доля среди клиентов API и подписчиков, по выручке' : 'Доля среди клиентов API, по выручке',
    },
    {
      label: 'Выручка в день',
      value: revenue !== undefined ? fmtMoney(revenue) : '-',
      sub: revenue !== undefined && subsShown ? `API ${fmtMoney(apiRevenue ?? 0)}, подписки ${fmtMoney(subsRevenue ?? 0)}` : undefined,
      tone: 'income',
      title: revenue !== undefined ? `≈ ${fmtMoney(revenue * 30)} в месяц` : undefined,
    },
    {
      label: 'Заработала всего',
      value: fmtMoney(m.earned),
      sub: subsShown ? `из них подписки ${fmtMoney(m.earnedSubs)}` : `с ${formatDateShort(m.releasedDay as number)}`,
      tone: 'income',
      title: 'Выручка с момента выпуска',
    },
  ];
}

function Specs(props: { arch: 'lstm' | 'transformer'; plan: TrainingPlan; dates: [string, number][]; stolenCaught?: boolean }) {
  const { arch, plan } = props;
  const mix = DOMAINS.map((d) => `${DOMAIN_NAMES[d]} ${fmtShare(plan.mix[d], 0)}`).join(', ');
  return (
    <section>
      <h3 className="mw-h">Характеристики</h3>
      <dl className="mw-specs">
        <dt>Уровень</dt>
        <dd>
          <TierBadge tier={plan.tier} plain />
        </dd>
        <dt>Архитектура</dt>
        <dd>{arch === 'transformer' ? 'Трансформер' : 'LSTM'}</dd>
        <dt>Параметры</dt>
        <dd>{fmtParams(plan.paramsB)}</dd>
        <dt>Контекст</dt>
        <dd>
          {contextLabel(plan.context)} {tokensWord(plan.context)}
        </dd>
        <dt>Данные</dt>
        <dd>
          {fmtTokens(plan.tokensB)} токенов
          <small>{mix}</small>
        </dd>
        <dt>RLHF</dt>
        <dd>{plan.rlhf ? 'Да' : 'Нет'}</dd>
        {plan.stolenData && (
          <>
            <dt>Чужие данные</dt>
            <dd className={props.stolenCaught ? 'bad' : 'warn'}>{props.stolenCaught ? 'Да, иск уже был' : 'Да, возможен иск'}</dd>
          </>
        )}
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
  const [stopping, setStopping] = useState(false);
  const [stopErr, setStopErr] = useState<string | null>(null);
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
  const sub = [t.arch === 'transformer' ? 'Трансформер' : 'LSTM', `${fmtParams(t.plan.paramsB)} параметров`, `контекст ${contextLabel(t.plan.context)}`].map(nb).join(' · ');
  const items: Kpi[] = [
    { label: 'Готово', value: fmtShare(frac, 0) },
    {
      // Пока проект стоит, срока нет: в плитке «-», причина - в подписи.
      label: 'Осталось',
      value: !waiting && left !== null ? fmtDays(left) : '-',
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
      <Hero
        emblem={<ModelEmblem m={{ id: t.id, name: t.plan.name, arch: t.arch, plan: t.plan }} size={92} progress={frac} />}
        name={t.plan.name}
        sub={sub}
        status={
          <>
            <span className="mw-st train">Обучается</span>
            <TierBadge tier={t.plan.tier} plain />
          </>
        }
        kpis={items}
      />
      <div className="mw-body">
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
                <button className="btn small danger" onClick={() => setStopping(true)}>
                  Прервать обучение
                </button>
              </span>
            </div>
            <ErrorText error={stopErr} />
          </div>
        </section>
        {stopping && (
          <ConfirmDialog
            title="Прервать обучение"
            confirmLabel="Прервать"
            danger
            onConfirm={() => {
              const r = store.dispatch(actions.cancelTraining, t.id);
              setStopping(false);
              setStopErr(r.ok ? null : r.error);
            }}
            onClose={() => setStopping(false)}
          >
            <p>
              «{t.plan.name}» готова на {fmtShare(frac, 0)}. Модели не будет, вычисления пропадут. Ничего не возвращается: аренда за прошедшие дни и
              разметчики уже оплачены. Доля «Обучение» освободится для нового проекта.
            </p>
          </ConfirmDialog>
        )}
        <Specs arch={t.arch} plan={t.plan} dates={[['Начато', t.startedDay]]} />
      </div>
    </div>
  );
}

function ModelCard(props: { s: GameState; m: PlayerModel; open: WindowProps['open']; metric: RaceMetric | null; rank: number | null }) {
  const { s, m, open, metric, rank } = props;
  const champion = rank === 1;
  const released = m.releasedDay !== null;
  const st = saleState(m);
  const rv = reviewState(m);
  const sub = [m.arch === 'transformer' ? 'Трансформер' : 'LSTM', `${fmtParams(m.plan.paramsB)} параметров`, `контекст ${contextLabel(m.plan.context)}`, m.rlhf ? 'RLHF' : '']
    .filter(Boolean)
    .map(nb)
    .join(' · ');

  return (
    <div className="mw-main">
      <Hero
        emblem={<ModelEmblem m={m} size={92} gold={champion} exposed={m.exposed} faded={st.tone === 'off'} />}
        name={m.name}
        sub={sub}
        status={
          <>
            <span className={`mw-st ${st.tone}`}>{stateLabel(m)}</span>
            <TierBadge tier={m.plan.tier} plain />
            {rv && <span className={`mw-st ${rv.tone}`}>{rv.text}</span>}
          </>
        }
        kpis={kpisOf(s, m, metric, rank)}
      />
      <div className="mw-body">
        {m.exposed && <Alert tone="bad">Подгонка под тесты раскрыта: показаны честные баллы.</Alert>}
        {released ? <SalesBlock s={s} m={m} open={open} /> : <ReleaseBlock s={s} m={m} />}
        <RedTeamBlock s={s} m={m} />
        <ScoresBlock s={s} m={m} benches={introducedBenchmarks(s)} />
        <Specs
          arch={m.arch}
          plan={m.plan}
          dates={m.releasedDay !== null ? [['Обучена', m.trainedDay], ['Выпущена', m.releasedDay]] : [['Обучена', m.trainedDay]]}
          stolenCaught={m.stolenCaught}
        />
      </div>
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
        <button className="btn primary" onClick={() => open('newModel')}>
          Создать модель
        </button>
      </div>
    );
  }

  const models = [...s.models].reverse(); // новые сверху
  // Выбран проект обучения, пока он идёт; закончился - выбор падает на первую модель (или на оставшийся проект).
  const run = selectedId?.startsWith(RUN_PREFIX) ? s.trainings.find((t) => RUN_PREFIX + t.id === selectedId) : undefined;
  const picked = run ? null : (models.find((x) => x.id === selectedId) ?? models[0] ?? null);
  const shownRun = run ?? (picked ? undefined : s.trainings[0]);
  const current = picked ? picked.id : shownRun ? RUN_PREFIX + shownRun.id : '';
  const metric = raceMetricOf(s);
  // Места моделей игрока в гонке; золотая рамка - у модели, которая держит 1-е место.
  const places = new Map<string, number>();
  // Без соперников в таблице места нет: верхняя панель в это время пишет «Соперников пока нет».
  if (hasRivals(s, metric)) for (const x of raceRows(s, metric!)) if (x.row.ref.kind === 'player' && x.rank !== null) places.set(x.row.ref.id, x.rank);
  const champion = models.find((m) => places.get(m.id) === 1)?.id ?? null;

  return (
    <div className={`mw${detail ? ' show-detail' : ''}`}>
      <ModelList
        s={s}
        models={models}
        trainings={s.trainings}
        selectedId={current}
        championId={champion}
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
      {picked ? (
        <ModelCard key={picked.id} s={s} m={picked} open={open} metric={metric} rank={places.get(picked.id) ?? null} />
      ) : (
        shownRun && <TrainingCard key={shownRun.id} s={s} t={shownRun} open={open} />
      )}
    </div>
  );
}
