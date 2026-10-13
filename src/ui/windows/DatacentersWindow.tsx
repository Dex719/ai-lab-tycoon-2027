// Окно «Дата-центры» (.kiro/specs/datacenters/design.md): сводка своей мощности, четыре площадки,
// стройка через подтверждение, покупка карт и списание.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { WindowProps } from '.';
import { DC_SITES, DC_SIZES, DC_STAGE_NAMES, DC_UPKEEP_PER_MW_MONTH, type DcSiteDef, type DcSiteId } from '../../data/datacenters';
import { GPUS } from '../../data/gpus';
import { availableGpus, gpuDef, ownedH100e, rentPerGpuDay } from '../../sim/compute';
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
  resaleFactor,
  resalePrice,
  ownedRentEquivalentPerDay,
  stageProgress,
  usedKw,
} from '../../sim/datacenters';
import { formatDate } from '../../sim/time';
import type { Datacenter, GameState, GpuId } from '../../sim/types';
import { ConfirmDialog, Dialog, ErrorText, ProgressBar, Range } from '../components/common';
import { fmtH100e as fmtH, fmtInt, fmtMoney, fmtNum, ruPlural } from '../format';
import { actions, store } from '../store';
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

/** «3,2 МВт». */
function fmtMw(kw: number): string {
  return `${fmtNum(Math.round(kw / 100) / 10)} МВт`;
}

// ---------- Сводка ----------

function Summary({ s }: { s: GameState }) {
  const own = ownedH100e(s);
  const cost = dcCostPerDay(s) * MONTH;
  const rentEq = ownedRentEquivalentPerDay(s) * MONTH;
  const building = s.datacenters.list.filter((d) => !dcReady(d)).length;
  const saving = rentEq - cost;
  return (
    <header className="dc-info">
      <h2 className="dc-h">Свои дата-центры</h2>
      <div className="dc-kpis">
        <div className="dc-kpi">
          <span className="dc-kpi-l">Своя мощность, H100e</span>
          <span className="dc-kpi-v blue">{fmtH(own)}</span>
          <span className="dc-kpi-s">
            {cardsInTransit(s) > 0
              ? `${fmtInt(cardsInTransit(s))} карт в пути`
              : `${fmtInt(ownedCards(s))} ${ruPlural(ownedCards(s), 'карта', 'карты', 'карт')}`}
          </span>
        </div>
        <div className="dc-kpi">
          <span className="dc-kpi-l">Строится</span>
          <span className="dc-kpi-v">{building}</span>
          <span className="dc-kpi-s">из {DC_SITES.length} площадок</span>
        </div>
        <div className="dc-kpi">
          <span className="dc-kpi-l">Расходы в месяц</span>
          <span className="dc-kpi-v red">{fmtMoney(cost)}</span>
          <span className="dc-kpi-s">без стройки и карт</span>
        </div>
        <div className="dc-kpi">
          <span className="dc-kpi-l">Экономия</span>
          <span className={`dc-kpi-v ${saving > 0 ? 'green' : ''}`}>{own > 0 ? fmtMoney(saving) : '-'}</span>
          <span className="dc-kpi-s">{own > 0 ? `против аренды ${fmtMoney(rentEq)}` : 'нет своих карт'}</span>
        </div>
      </div>
    </header>
  );
}

// ---------- Карточка площадки ----------

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
      <dd>
        {fmtInt(gpusPerMw(def.id, g))} карт {gpuDef(g).name.replace('Fermi ', '')}
      </dd>
      <dt>Стройка 1 МВт</dt>
      <dd className="red">{fmtMoney(buildCost(s, def.id, 1))}</dd>
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
              {state === 'done' ? '✓' : i + 1}
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

function ReadyBody({ s, dc, onBuy, onSell, onWriteOff }: { s: GameState; dc: Datacenter; onBuy: () => void; onSell: (gpu: GpuId) => void; onWriteOff: (gpu: GpuId) => void }) {
  const used = usedKw(dc);
  const total = dc.mw * 1000;
  const types = GPUS.filter((g) => (dc.gpus[g.id] ?? 0) > 0);
  const full = freeSlots(dc, bestGpu(s)) === 0;
  return (
    <>
      <div className="dc-power">
        <div className="dc-power-t">
          <span>Занято</span>
          <b>
            {fmtMw(used)} из {dc.mw} МВт
          </b>
        </div>
        <div className={`progress ${used / total > 0.95 ? 'orange' : 'green'}`}>
          <div style={{ width: `${Math.min(100, (used / total) * 100)}%` }} />
        </div>
      </div>
      {types.length === 0 && dc.orders.length === 0 ? (
        <div className="dc-empty">Дата-центр пустой: купите карты.</div>
      ) : (
        <table className="dc-gpus">
          <tbody>
            {types.map((g) => (
              <tr key={g.id}>
                <td>{g.name}</td>
                <td className="num">{fmtInt(dc.gpus[g.id])} шт.</td>
                <td className="num">{fmtH(dc.gpus[g.id] * g.h100e)} H100e</td>
                <td className="num">
                  <button
                    className="btn small"
                    onClick={() => onSell(g.id)}
                    title={`Продать за ${fmtMoney(dc.gpus[g.id] * resalePrice(s, g.id))}: ${fmtNum(Math.round(resaleFactor(s, g.id) * 100))} % от цены новой карты`}
                  >
                    Продать
                  </button>{' '}
                  <button className="btn small" onClick={() => onWriteOff(g.id)} title="Убрать карты без денег, чтобы освободить место">
                    Списать
                  </button>
                </td>
              </tr>
            ))}
            {dc.orders.map((o, i) => (
              <tr key={`o${i}`} className="dc-order">
                <td>{gpuDef(o.gpu).name}</td>
                <td className="num">{fmtInt(o.count)} шт.</td>
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
        <dd className="red">{fmtMoney(dcPowerPerDay(dc) * MONTH)}</dd>
        <dt>Обслуживание в месяц</dt>
        <dd className="red">{fmtMoney(dcUpkeepPerDay(dc) * MONTH)}</dd>
      </dl>
      <div className="dc-actions">
        <button className="btn primary" onClick={onBuy} disabled={full}>
          Купить карты
        </button>
        {full && <span className="muted small">Места нет: спишите старые карты</span>}
      </div>
    </>
  );
}

function SiteCard(props: {
  s: GameState;
  def: DcSiteDef;
  onBuild: () => void;
  onBuy: () => void;
  onSell: (gpu: GpuId) => void;
  onWriteOff: (gpu: GpuId) => void;
}) {
  const { s, def } = props;
  const dc = findDc(s, def.id);
  const tone = !dc ? 'free' : dcReady(dc) ? 'ready' : 'building';
  return (
    <section className={`dc-site ${tone}`}>
      <div className="dc-site-head">
        <h3 className="dc-site-name">{def.name}</h3>
        <span className={`dc-tag ${tone}`}>{!dc ? 'Свободна' : dcReady(dc) ? `${dc.mw} МВт` : 'Стройка'}</span>
      </div>
      <p className="dc-note">{def.note}</p>
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
      {dc && !dcReady(dc) && (
        <>
          <Stages s={s} dc={dc} />
          <dl className="dc-kv">
            <dt>Мощность</dt>
            <dd>{dc.mw} МВт</dd>
            <dt>Готовность</dt>
            <dd className="blue">примерно {formatDate(expectedReadyDay(dc))}</dd>
            <dt>Задержки</dt>
            <dd className={dc.delayDays > 0 ? 'warn' : undefined}>{dc.delayDays > 0 ? `${Math.round(dc.delayDays / MONTH)} мес.` : 'нет'}</dd>
            <dt>Уплачено</dt>
            <dd className="red">{fmtMoney(dc.paid)}</dd>
          </dl>
        </>
      )}
      {dc && dcReady(dc) && <ReadyBody s={s} dc={dc} onBuy={props.onBuy} onSell={props.onSell} onWriteOff={props.onWriteOff} />}
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
        if (r.ok) onClose();
        else setError(r.error);
      }}
    >
      <div className="dc-dialog">
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
          <dd className="red">{fmtMoney(cost)}</dd>
          <dt>Срок</dt>
          <dd>{monthsText(buildMonths(def.id, mw))}</dd>
          <dt>Риск задержки</dt>
          <dd className={`dc-risk ${risk.tone}`}>
            {risk.text}, {Math.round(def.risk * 100)} % на этап
          </dd>
          <dt>Обслуживание после стройки</dt>
          <dd className="red">{fmtMoney(mw * DC_UPKEEP_PER_MW_MONTH)} в месяц</dd>
          <dt>Электричество при полной загрузке</dt>
          <dd className="red">{fmtMoney(powerFull)} в месяц</dd>
          <dt>Поместится</dt>
          <dd>
            {fmtInt(cards)} карт {gpuDef(g).name}
          </dd>
          <dt>Деньги после оплаты</dt>
          <dd className={s.cash - cost < 0 ? 'red' : undefined}>{fmtMoney(s.cash - cost)}</dd>
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
  const [text, setText] = useState('');
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

  const submit = () => {
    if (count === null) return;
    const r = store.dispatch(actions.buyDcGpus, site, id, count);
    if (r.ok) onClose();
    else setError(r.error);
  };

  return (
    <Dialog
      title="Покупка карт"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn primary" onClick={submit} disabled={count === null}>
            Купить
          </button>
        </>
      }
    >
      <div className="dc-dialog">
        <div className="dc-gpu-list" role="radiogroup" aria-label="Тип карты">
          <div className="dc-gpu-row head">
            <span>Карта</span>
            <span>H100e</span>
            <span>Цена</span>
            <span>Поместится</span>
          </div>
          {list.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={x.id === id}
              className={`dc-gpu-row${x.id === id ? ' is-selected' : ''}`}
              onClick={() => {
                setId(x.id);
                setText('');
                setError(null);
              }}
            >
              <span>{x.name}</span>
              <span>{fmtH(x.h100e)}</span>
              <span>{fmtMoney(gpuBuyPrice(s, x.id))}</span>
              <span>{fmtInt(freeSlots(dc, x.id))}</span>
            </button>
          ))}
        </div>
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
        </div>
        <div className="dc-qty-note">
          {max === 0
            ? afford === 0
              ? 'Не хватает денег даже на одну карту'
              : 'Места нет'
            : `Можно купить до ${fmtInt(max)} шт.${max === afford && afford < fit ? ': больше не хватает денег' : ''}`}
        </div>
        <dl className="dc-kv dc-sum">
          <dt>Стоимость</dt>
          <dd className="red">{fmtMoney(n * price)}</dd>
          <dt>Мощность</dt>
          <dd className="blue">+{fmtH(n * g.h100e)} H100e</dd>
          <dt>Доставка</dt>
          <dd>
            {deliveryDays(s)} дн., до {formatDate(s.day + deliveryDays(s))}
          </dd>
          <dt>Электричество</dt>
          <dd className="red">{fmtMoney(power)} в месяц</dd>
          <dt>Те же карты в аренде</dt>
          <dd>{fmtMoney(n * rentPerGpuDay(s, id) * MONTH)} в месяц</dd>
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

export default function DatacentersWindow({ s }: WindowProps) {
  const [modal, setModal] = useState<Modal>(null);
  const close = () => setModal(null);
  const woDc = modal?.kind === 'writeoff' || modal?.kind === 'sell' ? findDc(s, modal.site) : undefined;
  return (
    <div className="dc">
      <Summary s={s} />
      <div className="dc-scroll">
        <div className="dc-grid">
          {DC_SITES.map((def) => (
            <SiteCard
              key={def.id}
              s={s}
              def={def}
              onBuild={() => setModal({ kind: 'build', site: def.id })}
              onBuy={() => setModal({ kind: 'buy', site: def.id })}
              onSell={(gpu) => setModal({ kind: 'sell', site: def.id, gpu })}
              onWriteOff={(gpu) => setModal({ kind: 'writeoff', site: def.id, gpu })}
            />
          ))}
        </div>
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
