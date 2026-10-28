// Окно «Дата-центры»: сверху своя мощность одним числом и короткий список расходов; ниже слева четыре площадки,
// справа выбранная площадка в 3D (кампус, который достраивается по этапам, или машинный зал с картами)
// и её сведения: условия, этапы стройки или стоящие карты. Стройка и покупка - через подтверждение.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { DC_SITES, DC_SIZES, DC_STAGE_NAMES, DC_STAGES, DC_UPKEEP_PER_MW_MONTH, type DcSiteDef, type DcSiteId } from '../../data/datacenters';
import { GPUS } from '../../data/gpus';
import { availableGpus, gpuAvailableDay, gpuDef, ownedH100e, rentPerGpuDay } from '../../sim/compute';
import {
  buildCost,
  buildMonths,
  cardsInTransit,
  dcCostPerDay,
  dcPowerPerDay,
  dcReady,
  dcUpkeepPerDay,
  deliveryDays,
  expectedReadyDay,
  findDc,
  freeSlots,
  gpuBuyPrice,
  gpuKwAt,
  gpusPerMw,
  ownedCards,
  ownedRentEquivalentPerDay,
  resaleFactor,
  resalePrice,
  stageProgress,
  usedKw,
} from '../../sim/datacenters';
import { formatDate } from '../../sim/time';
import type { Datacenter, GameState, GpuId } from '../../sim/types';
import { ConfirmDialog, Dialog, ErrorText, GuardButton, ProgressBar, Range } from '../components/common';
import { fmtDays, fmtH100e as fmtH, fmtInt, fmtMoney, fmtNum, ruPlural } from '../format';
import { IconCheck } from '../icons';
import { playSound } from '../sound';
import { actions, store } from '../store';
import { GpuChooser, powerFact } from '../three/GpuChooser';
import { GpuBadge } from '../GpuBadge';
import './DatacentersWindow.css';

const MONTH = 30;

/** Риск задержки этапа словом и цветом. */
function riskOf(def: DcSiteDef): { text: string; tone: 'low' | 'mid' | 'high' } {
  if (def.risk >= 0.3) return { text: 'высокий', tone: 'high' };
  if (def.risk >= 0.15) return { text: 'средний', tone: 'mid' };
  return { text: 'низкий', tone: 'low' };
}

/** Самая мощная из вышедших карт: по ней считается вместимость в подсказках. */
function bestGpu(s: GameState): GpuId {
  return availableGpus(s).reduce((b, g) => (g.h100e > gpuDef(b).h100e ? g.id : b), availableGpus(s)[0]?.id ?? GPUS[0].id);
}

function monthsText(n: number): string {
  return `${n} ${ruPlural(n, 'месяц', 'месяца', 'месяцев')}`;
}

function cardsText(n: number): string {
  return `${fmtInt(n)} ${ruPlural(n, 'карта', 'карты', 'карт')}`;
}

/** «3,2 МВт». */
function fmtMw(kw: number): string {
  return `${fmtNum(Math.round(kw / 100) / 10)} МВт`;
}

/** Что сейчас на площадке: свободна, стройка (этап), готов. */
function siteStatus(s: GameState, def: DcSiteDef): { tone: 'free' | 'building' | 'ready'; text: string; progress: number | null } {
  const dc = findDc(s, def.id);
  if (!dc) return { tone: 'free', text: 'Свободна', progress: null };
  if (!dcReady(dc)) return { tone: 'building', text: `${DC_STAGE_NAMES[dc.stage]}, этап ${dc.stage + 1} из ${DC_STAGES}`, progress: stageProgress(s, dc) };
  const used = usedKw(dc) / (dc.mw * 1000);
  return { tone: 'ready', text: `${dc.mw} МВт, занято ${fmtInt(Math.round(used * 100))} %`, progress: used };
}

// ---------- Шапка ----------

function Head({ s }: { s: GameState }) {
  const own = ownedH100e(s);
  const cost = dcCostPerDay(s) * MONTH;
  const rentEq = ownedRentEquivalentPerDay(s) * MONTH;
  const building = s.datacenters.list.filter((d) => !dcReady(d)).length;
  const transit = cardsInTransit(s);
  const saving = rentEq - cost;
  return (
    <header className="dc-head">
      <div className="dc-main">
        <div className="dc-main-l" title="Мощность карт в своих дата-центрах; входит во «Всего мощности» в окне «Мощности»">
          Своя мощность
        </div>
        <div className={`dc-main-v${own > 0 ? '' : ' dim'}`}>
          {fmtH(own)}
          <span>H100e</span>
        </div>
        <div className="dc-main-s">
          {ownedCards(s) > 0 ? cardsText(ownedCards(s)) : 'Своих карт нет'}
          {transit > 0 && `, в пути ${fmtInt(transit)}`}
        </div>
      </div>
      <dl className="dc-head-kv">
        <dt>Строится</dt>
        <dd>
          {building} из {DC_SITES.length} площадок
        </dd>
        <dt title="Электричество и обслуживание готовых дата-центров, без стройки и покупки карт">Расходы в месяц</dt>
        <dd className={cost > 0 ? 'bad' : undefined}>{cost > 0 ? fmtMoney(cost) : '-'}</dd>
        <dt title="Сколько стоили бы те же карты в аренде, минус расходы своих дата-центров">Экономия против аренды</dt>
        <dd className={own > 0 ? (saving > 0 ? 'good' : 'bad') : undefined}>{own > 0 ? `${saving < 0 ? '−' : ''}${fmtMoney(Math.abs(saving))} в месяц` : '-'}</dd>
      </dl>
    </header>
  );
}

// ---------- Список площадок ----------

function SiteRow({ s, def, selected, onSelect }: { s: GameState; def: DcSiteDef; selected: boolean; onSelect: () => void }) {
  const st = siteStatus(s, def);
  return (
    <button type="button" role="tab" aria-selected={selected} className={`dc-site${selected ? ' is-selected' : ''}`} onClick={onSelect}>
      <span className="dc-site-name">{def.name}</span>
      <span className={`dc-site-st ${st.tone}`}>
        <span className="dc-dot" aria-hidden="true" />
        {st.text}
      </span>
      <span className={`dc-site-bar${st.progress === null ? ' dc-hide' : ''}`}>
        <ProgressBar value={st.progress ?? 0} />
      </span>
    </button>
  );
}

// ---------- Сведения о площадке ----------

function SiteFacts({ s, def }: { s: GameState; def: DcSiteDef }) {
  const risk = riskOf(def);
  const g = bestGpu(s);
  return (
    <dl className="dc-kv">
      <dt>Электричество</dt>
      <dd>${def.powerPrice} за МВт·ч</dd>
      <dt>Стройка</dt>
      <dd>от {monthsText(buildMonths(def.id, DC_SIZES[0]))}</dd>
      <dt>Риск задержки</dt>
      <dd className={`dc-risk ${risk.tone}`}>{risk.text}</dd>
      <dt>На 1 МВт</dt>
      <dd>{cardsText(gpusPerMw(def.id, g))} {gpuDef(g).name}</dd>
      <dt>Стройка 1 МВт</dt>
      <dd className="bad">{fmtMoney(buildCost(s, def.id, 1))}</dd>
    </dl>
  );
}

function Stages({ s, dc }: { s: GameState; dc: Datacenter }) {
  return (
    <ol className="dc-stages">
      {DC_STAGE_NAMES.map((name, i) => {
        const state = i < dc.stage ? 'done' : i === dc.stage ? 'now' : 'next';
        return (
          <li key={name} className={state}>
            <span className="dc-stage-mark" aria-hidden="true">
              {state === 'done' ? <IconCheck size={12} /> : i + 1}
            </span>
            <span className="dc-stage-name">{name}</span>
            {state === 'now' && (
              <span className="dc-stage-bar">
                <ProgressBar value={stageProgress(s, dc)} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ReadyBody(props: { s: GameState; dc: Datacenter; onBuy: () => void; onSell: (gpu: GpuId) => void; onWriteOff: (gpu: GpuId) => void }) {
  const { s, dc } = props;
  const used = usedKw(dc);
  const total = dc.mw * 1000;
  const types = GPUS.filter((g) => (dc.gpus[g.id] ?? 0) > 0);
  const full = freeSlots(dc, bestGpu(s)) === 0;
  return (
    <>
      <div className="dc-power">
        <div className="dc-power-t">
          <span>Занято электричества</span>
          <b>
            {fmtMw(used)} из {dc.mw} МВт
          </b>
        </div>
        <div className={`progress ${used / total > 0.95 ? 'orange' : 'green'}`}>
          <div className="pb" style={{ ['--p' as string]: Math.min(1, used / total) }} />
        </div>
      </div>
      {types.length === 0 && dc.orders.length === 0 ? (
        <div className="dc-empty">Карт ещё нет: зал пустой, обслуживание уже идёт.</div>
      ) : (
        <table className="dc-gpus">
          <thead>
            <tr>
              <th colSpan={2}>Карта</th>
              <th className="num">Штук</th>
              <th className="num">Мощность</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.map((g) => (
              <tr key={g.id}>
                <td className="dc-td-thumb">
                  <GpuBadge id={g.id} size="s" />
                </td>
                <td>{g.name}</td>
                <td className="num">{fmtInt(dc.gpus[g.id])}</td>
                <td className="num">{fmtH(dc.gpus[g.id] * g.h100e)} H100e</td>
                <td className="dc-td-act">
                  <button
                    className="btn small"
                    onClick={() => props.onSell(g.id)}
                    title={`Продать за ${fmtMoney(dc.gpus[g.id] * resalePrice(s, g.id))}: ${fmtNum(Math.round(resaleFactor(s, g.id) * 100))} % от цены новой карты`}
                  >
                    Продать
                  </button>
                  <button className="btn small" onClick={() => props.onWriteOff(g.id)} title="Убрать карты без денег, чтобы освободить место">
                    Списать
                  </button>
                </td>
              </tr>
            ))}
            {dc.orders.map((o, i) => (
              <tr key={`o${i}`} className="dc-order">
                <td className="dc-td-thumb">
                  <GpuBadge id={o.gpu} size="s" />
                </td>
                <td>{gpuDef(o.gpu).name}</td>
                <td className="num">{fmtInt(o.count)}</td>
                <td className="num" colSpan={2}>
                  в пути до {formatDate(o.arriveDay)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="dc-kv">
        <dt>Электричество в месяц</dt>
        <dd className="bad">{fmtMoney(dcPowerPerDay(dc) * MONTH)}</dd>
        <dt>Обслуживание в месяц</dt>
        <dd className="bad">{fmtMoney(dcUpkeepPerDay(dc) * MONTH)}</dd>
      </dl>
      <div className="dc-actions">
        <GuardButton className="btn primary" reason={full ? 'Места нет: продайте или спишите старые карты' : null} onClick={props.onBuy}>
          Купить карты
        </GuardButton>
      </div>
    </>
  );
}

function SiteDetail(props: {
  s: GameState;
  def: DcSiteDef;
  onBuild: () => void;
  onBuy: () => void;
  onSell: (gpu: GpuId) => void;
  onWriteOff: (gpu: GpuId) => void;
}) {
  const { s, def } = props;
  const dc = findDc(s, def.id);
  const ready = !!dc && dcReady(dc);
  return (
    <section className="dc-detail" aria-label={def.name}>
      <div className="dc-detail-head">
        <div className="dc-detail-title">
          <h3>{def.name}</h3>
          <p>{def.note}</p>
        </div>
      </div>
      <div className="dc-detail-body">
        {!dc && (
          <>
            <SiteFacts s={s} def={def} />
            <div className="dc-actions">
              <button className="btn primary" onClick={props.onBuild}>
                Построить
              </button>
            </div>
          </>
        )}
        {dc && !ready && (
          <div className="dc-build">
            <Stages s={s} dc={dc} />
            <dl className="dc-kv">
              <dt>Мощность</dt>
              <dd>{dc.mw} МВт</dd>
              <dt>Готовность</dt>
              <dd>примерно {formatDate(expectedReadyDay(dc))}</dd>
              <dt>Задержки</dt>
              <dd className={dc.delayDays > 0 ? 'warn' : undefined}>{dc.delayDays > 0 ? monthsText(Math.round(dc.delayDays / MONTH)) : 'нет'}</dd>
              <dt>Уплачено</dt>
              <dd className="bad">{fmtMoney(dc.paid)}</dd>
            </dl>
          </div>
        )}
        {dc && ready && <ReadyBody s={s} dc={dc} onBuy={props.onBuy} onSell={props.onSell} onWriteOff={props.onWriteOff} />}
      </div>
    </section>
  );
}

// ---------- Стройка ----------

function BuildDialog({ s, def, onClose }: { s: GameState; def: DcSiteDef; onClose: () => void }) {
  const [mw, setMw] = useState<number>(DC_SIZES[0]);
  const [error, setError] = useState<string | null>(null);
  const cost = buildCost(s, def.id, mw);
  const g = bestGpu(s);
  const cards = gpusPerMw(def.id, g) * mw;
  const powerFull = (cards * gpuKwAt(def.id, g) * 24 * MONTH * def.powerPrice) / 1000;
  const risk = riskOf(def);
  return (
    <ConfirmDialog
      title={`Стройка: ${def.name}`}
      confirmLabel="Построить"
      onClose={onClose}
      onConfirm={() => {
        const r = store.dispatch(actions.buildDatacenter, def.id, mw);
        if (r.ok) {
          playSound('rack');
          onClose();
        } else setError(r.error);
      }}
    >
      <div className="dc-dialog dc-build-dialog">
        <div className="dc-sizes" role="radiogroup" aria-label="Мощность дата-центра">
          {DC_SIZES.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={x === mw}
              className={`dc-size${x === mw ? ' is-selected' : ''}`}
              onClick={() => {
                setMw(x);
                setError(null);
              }}
            >
              <b>{x} МВт</b>
              <span>{fmtMoney(buildCost(s, def.id, x))}</span>
            </button>
          ))}
        </div>
        <dl className="dc-kv dc-sum">
          <dt>Стоимость</dt>
          <dd className="bad">{fmtMoney(cost)}</dd>
          <dt>Срок</dt>
          <dd>{monthsText(buildMonths(def.id, mw))}</dd>
          <dt>Риск задержки</dt>
          <dd className={`dc-risk ${risk.tone}`}>
            {risk.text}, {Math.round(def.risk * 100)} % на этап
          </dd>
          <dt>Обслуживание после стройки</dt>
          <dd className="bad">{fmtMoney(mw * DC_UPKEEP_PER_MW_MONTH)} в месяц</dd>
          <dt>Электричество при полной загрузке</dt>
          <dd className="bad">{fmtMoney(powerFull)} в месяц</dd>
          <dt>Поместится</dt>
          <dd>
            {cardsText(cards)} {gpuDef(g).name}
          </dd>
          <dt>Деньги после оплаты</dt>
          <dd className={s.cash - cost < 0 ? 'bad' : undefined}>{fmtMoney(s.cash - cost)}</dd>
        </dl>
        <p className="dc-hint">Карты покупаются отдельно, когда дата-центр готов.</p>
        <div className="dc-err">
          <ErrorText error={error} />
        </div>
      </div>
    </ConfirmDialog>
  );
}

// ---------- Покупка карт ----------

function BuyDialog({ s, site, onClose }: { s: GameState; site: DcSiteId; onClose: () => void }) {
  const dc = findDc(s, site)!;
  const list = availableGpus(s);
  const [id, setId] = useState<GpuId>(bestGpu(s));
  // Предложенное количество: четверть свободного места, целыми серверами по 8 карт (не больше, чем хватает денег)
  const suggest = (gpu: GpuId) => {
    const m = Math.min(freeSlots(dc, gpu), Math.floor(s.cash / gpuBuyPrice(s, gpu)));
    return m <= 0 ? '' : String(Math.max(1, Math.min(m, Math.round(m / 4 / 8) * 8 || m)));
  };
  const [text, setText] = useState(() => suggest(bestGpu(s)));
  const [error, setError] = useState<string | null>(null);
  const g = gpuDef(id);
  const price = gpuBuyPrice(s, id);
  const fit = freeSlots(dc, id);
  const afford = Math.max(0, Math.floor(s.cash / price));
  const max = Math.min(fit, afford);
  const parsed = text.trim() === '' ? NaN : Number(text);
  const count = Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
  const n = count ?? 0;
  const power = (n * gpuKwAt(site, id) * 24 * MONTH * DC_SITES.find((d) => d.id === site)!.powerPrice) / 1000;
  const reason = max === 0 ? (afford === 0 ? 'Не хватает денег даже на одну карту' : 'Места нет') : count === null ? `Введите целое число от 1 до ${fmtInt(max)}` : null;

  const submit = () => {
    if (count === null) return;
    const r = store.dispatch(actions.buyDcGpus, site, id, count);
    if (r.ok) {
      playSound('rack');
      onClose();
    } else setError(r.error);
  };

  return (
    <Dialog
      title="Покупка карт"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отменить
          </button>
          <GuardButton className="btn primary" reason={reason} onClick={submit}>
            Купить
          </GuardButton>
        </>
      }
    >
      <div className="dc-dialog">
        <GpuChooser
          day={s.day}
          items={list.map((x) => ({
            gpu: x,
            since: gpuAvailableDay(s, x.id),
            price: `${fmtMoney(gpuBuyPrice(s, x.id))} за карту`,
            note: (dc.gpus[x.id] ?? 0) > 0 ? `в зале ${fmtInt(dc.gpus[x.id])}` : null,
          }))}
          value={id}
          onPick={(next) => {
            setId(next);
            setText(suggest(next));
            setError(null);
          }}
          facts={[
            { label: 'Мощность', value: powerFact(g, list) },
            { label: 'Цена', value: `${fmtMoney(price)} за карту` },
            { label: 'Поместится', value: `${fmtInt(fit)} шт., свободно ${fmtMw(dc.mw * 1000 - usedKw(dc))}` },
            { label: 'В аренде стоила бы', value: `${fmtMoney(rentPerGpuDay(s, id) * MONTH)} в месяц` },
          ]}
        />
        <div className="dc-qty">
          <label htmlFor="dc-qty-num">Количество</label>
          <Range value={n} min={0} max={Math.max(1, max)} label="Количество карт" onChange={(v) => setText(String(v))} disabled={max === 0} />
          <input
            id="dc-qty-num"
            type="number"
            min={1}
            max={max}
            step={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <div className={`dc-qty-note${max === 0 ? ' bad' : ''}`}>
            {max === 0
              ? afford === 0
                ? 'Не хватает денег даже на одну карту'
                : 'Места нет'
              : `Можно купить до ${fmtInt(max)} шт.${max === afford && afford < fit ? ': больше не хватает денег' : ''}`}
          </div>
        </div>
        <dl className="dc-kv dc-sum dc-sum-2">
          <dt>Стоимость</dt>
          <dd className={n > 0 ? 'bad' : undefined}>{n > 0 ? fmtMoney(n * price) : '-'}</dd>
          <dt>Мощность</dt>
          <dd className={n > 0 ? 'good' : undefined}>{n > 0 ? `+${fmtH(n * g.h100e)} H100e` : '-'}</dd>
          <dt>Доставка</dt>
          <dd>
            {fmtDays(deliveryDays(s))}, до {formatDate(s.day + deliveryDays(s))}
          </dd>
          <dt>Электричество</dt>
          <dd className={n > 0 ? 'bad' : undefined}>{n > 0 ? `${fmtMoney(power)} в месяц` : '-'}</dd>
          <dt>Те же карты в аренде</dt>
          <dd>{n > 0 ? `${fmtMoney(n * rentPerGpuDay(s, id) * MONTH)} в месяц` : '-'}</dd>
          <dt>Деньги после покупки</dt>
          <dd className={s.cash - n * price < 0 ? 'bad' : undefined}>{fmtMoney(s.cash - n * price)}</dd>
        </dl>
        <div className="dc-err">
          <ErrorText error={error} />
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Окно ----------

type Modal = null | { kind: 'build'; site: DcSiteId } | { kind: 'buy'; site: DcSiteId } | { kind: 'writeoff'; site: DcSiteId; gpu: GpuId } | { kind: 'sell'; site: DcSiteId; gpu: GpuId };

/** Площадка по умолчанию: готовый дата-центр, иначе стройка, иначе первая свободная. */
function defaultSite(s: GameState): DcSiteId {
  const ready = DC_SITES.find((d) => {
    const dc = findDc(s, d.id);
    return dc && dcReady(dc);
  });
  const building = DC_SITES.find((d) => findDc(s, d.id));
  return (ready ?? building ?? DC_SITES[0]).id;
}

export default function DatacentersWindow({ s }: WindowProps) {
  const [modal, setModal] = useState<Modal>(null);
  const [site, setSite] = useState<DcSiteId>(() => defaultSite(s));
  const close = () => setModal(null);
  const woDc = modal?.kind === 'writeoff' || modal?.kind === 'sell' ? findDc(s, modal.site) : undefined;
  const def = DC_SITES.find((d) => d.id === site) ?? DC_SITES[0];
  return (
    <div className="dc">
      <Head s={s} />
      <div className="dc-body">
        <nav className="dc-sites" role="tablist" aria-label="Площадки">
          {DC_SITES.map((d) => (
            <SiteRow key={d.id} s={s} def={d} selected={d.id === site} onSelect={() => setSite(d.id)} />
          ))}
        </nav>
        <SiteDetail
          key={def.id}
          s={s}
          def={def}
          onBuild={() => setModal({ kind: 'build', site: def.id })}
          onBuy={() => setModal({ kind: 'buy', site: def.id })}
          onSell={(gpu) => setModal({ kind: 'sell', site: def.id, gpu })}
          onWriteOff={(gpu) => setModal({ kind: 'writeoff', site: def.id, gpu })}
        />
      </div>
      {modal?.kind === 'build' && <BuildDialog s={s} def={DC_SITES.find((d) => d.id === modal.site)!} onClose={close} />}
      {modal?.kind === 'buy' && createPortal(<BuyDialog s={s} site={modal.site} onClose={close} />, document.body)}
      {modal?.kind === 'sell' && woDc && (
        <ConfirmDialog
          title="Продать карты"
          confirmLabel="Продать"
          onClose={close}
          onConfirm={() => {
            store.dispatch(actions.sellDcGpus, modal.site, modal.gpu, woDc.gpus[modal.gpu]);
            close();
          }}
        >
          <p className="dc-confirm">
            Продать {fmtInt(woDc.gpus[modal.gpu])} шт. {gpuDef(modal.gpu).name}? Вы получите{' '}
            <b>{fmtMoney(woDc.gpus[modal.gpu] * resalePrice(s, modal.gpu))}</b> ({fmtNum(Math.round(resaleFactor(s, modal.gpu) * 100))} % от цены новой карты).
            Мощность уменьшится на {fmtH(woDc.gpus[modal.gpu] * gpuDef(modal.gpu).h100e)} H100e, освободится{' '}
            {fmtMw(woDc.gpus[modal.gpu] * gpuKwAt(modal.site, modal.gpu))}.
          </p>
        </ConfirmDialog>
      )}
      {modal?.kind === 'writeoff' && woDc && (
        <ConfirmDialog
          title="Списать карты"
          confirmLabel="Списать"
          danger
          onClose={close}
          onConfirm={() => {
            store.dispatch(actions.writeOffDcGpus, modal.site, modal.gpu, woDc.gpus[modal.gpu]);
            close();
          }}
        >
          <p className="dc-confirm">
            Списать {fmtInt(woDc.gpus[modal.gpu])} шт. {gpuDef(modal.gpu).name}? Мощность уменьшится на{' '}
            {fmtH(woDc.gpus[modal.gpu] * gpuDef(modal.gpu).h100e)} H100e, освободится{' '}
            {fmtMw(woDc.gpus[modal.gpu] * gpuKwAt(modal.site, modal.gpu))}. Деньги за карты не возвращаются.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
