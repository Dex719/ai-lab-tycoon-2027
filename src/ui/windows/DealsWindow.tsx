// Окно «Сделки» (с 2023 года): крупные траты с выбором и последствиями - звёздные команды, покупка стартапов,
// облачная сделка. Раскладка - ведомость: сверху деньги и что уже действует, ниже таблица по вкладке.
// Симуляция - sim/deals.ts, данные - data/deals.ts.

import { useState } from 'react';
import { CLOUDS, MAX_TEAMS, OFFER_DAYS, TEAMS, TEAM_RETAIN_MONTHS, type CloudDef, type StartupDef, type TeamDef } from '../../data/deals';
import { LABS } from '../../data/labs';
import { availableGpus, rentCapFor } from '../../sim/compute';
import {
  activeEffects,
  buyStartup,
  buyStartupError,
  cloudExitFee,
  cloudMonth,
  cloudSignError,
  cloudTerms,
  dealsMonthly,
  endCloud,
  hireTeam,
  releaseTeam,
  signCloud,
  startupOffers,
  teamHireError,
  type StartupOffer,
} from '../../sim/deals';
import type { CloudId, StartupId, TeamId } from '../../sim/lateState';
import { formatDate, formatDateShort } from '../../sim/time';
import type { GameState, LabId } from '../../sim/types';
import { ConfirmDialog, GuardButton, ProgressBar, Tabs } from '../components/common';
import { fmtDays, fmtMoney, fmtNum } from '../format';
import { store } from '../store';
import type { WindowProps } from './index';
import './DealsWindow.css';

type Tab = 'teams' | 'startups' | 'cloud';

const LAB = new Map<LabId, { name: string; color: string }>(LABS.map((l) => [l.id, { name: l.name, color: l.color }]));

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

function LabName({ lab }: { lab: LabId }) {
  const l = LAB.get(lab);
  return (
    <span className="dl-lab">
      <i className="dl-labdot" style={{ background: l?.color }} />
      {l?.name}
    </span>
  );
}

// ---------- Команды ----------

function TeamRow({ s, def, onHire, onRelease }: { s: GameState; def: TeamDef; onHire: () => void; onRelease: () => void }) {
  const hired = s.late?.teams.find((t) => t.id === def.id);
  return (
    <tr className={hired ? 'on' : undefined}>
      <td>
        <div className="dl-who">
          <span className="dl-ava" style={{ background: def.color }} aria-hidden="true">
            {def.initials}
          </span>
          <span>
            <b>{def.leader}</b>
            <span className="dl-sub">{def.name}</span>
          </span>
        </div>
      </td>
      <td>
        <span className="good">{def.effect}</span>
        {def.extra && <span className="dl-sub good">{def.extra}</span>}
        <span className="dl-sub">{def.about}</span>
      </td>
      <td className="num" data-label="Подъёмные">{fmtMoney(def.signing)}</td>
      <td className="num" data-label="Зарплата в месяц">{fmtMoney(def.salary)}</td>
      <td className="dl-act">
        {hired ? (
          <div className="dl-act-in">
            <span className="dl-sub">с {formatDateShort(hired.since)}</span>
            <button type="button" className="btn small danger" onClick={onRelease} disabled={!!s.outcome}>
              Отпустить
            </button>
          </div>
        ) : (
          <GuardButton className="btn small primary" reason={teamHireError(s, def.id)} onClick={onHire}>
            Нанять
          </GuardButton>
        )}
      </td>
    </tr>
  );
}

function TeamsTab({ s }: { s: GameState }) {
  const [hire, setHire] = useState<TeamId | null>(null);
  const [fire, setFire] = useState<TeamId | null>(null);
  const hireDef = TEAMS.find((t) => t.id === hire);
  const fireDef = TEAMS.find((t) => t.id === fire);
  return (
    <>
      <div className="dl-row-head">
        <h3 className="dl-h">Звёздные команды</h3>
        <span className="dl-note">
          В лаборатории: {s.late?.teams.length ?? 0} из {MAX_TEAMS}
        </span>
      </div>
      <table className="dl-table">
        <thead>
          <tr>
            <th>Команда</th>
            <th>Что даёт</th>
            <th className="num">Подъёмные</th>
            <th className="num">Зарплата в месяц</th>
            <th className="dl-act" />
          </tr>
        </thead>
        <tbody>
          {TEAMS.map((def) => (
            <TeamRow key={def.id} s={s} def={def} onHire={() => setHire(def.id)} onRelease={() => setFire(def.id)} />
          ))}
        </tbody>
      </table>
      {hireDef && (
        <ConfirmDialog
          title="Нанять команду"
          confirmLabel="Нанять"
          onClose={() => setHire(null)}
          onConfirm={() => {
            setHire(null);
            store.dispatch(hireTeam, hireDef.id);
          }}
        >
          <div className="kv">
            <span>Команда</span>
            <span>
              {hireDef.name}, {hireDef.leader}
            </span>
            <span>Подъёмные сейчас</span>
            <span className="bad">{fmtMoney(-hireDef.signing)}</span>
            <span>Зарплата</span>
            <span>{fmtMoney(hireDef.salary)} в месяц</span>
            <span>Эффект</span>
            <span className="good">{hireDef.effect}</span>
          </div>
          <div className="muted small">Соперники могут переманить команду: удержать её стоит зарплату за {TEAM_RETAIN_MONTHS} месяцев.</div>
        </ConfirmDialog>
      )}
      {fireDef && (
        <ConfirmDialog
          title="Отпустить команду"
          confirmLabel="Отпустить"
          danger
          onClose={() => setFire(null)}
          onConfirm={() => {
            setFire(null);
            store.dispatch(releaseTeam, fireDef.id);
          }}
        >
          <div className="kv">
            <span>Команда</span>
            <span>
              {fireDef.name}, {fireDef.leader}
            </span>
            <span>Пропадёт</span>
            <span className="bad">{fireDef.effect}</span>
            <span>Подъёмные</span>
            <span>не возвращаются</span>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

// ---------- Стартапы ----------

function OfferRow({ s, o, onBuy }: { s: GameState; o: StartupOffer; onBuy: () => void }) {
  const left = Math.max(0, o.closeDay - s.day + 1);
  const open = o.status === 'open';
  return (
    <tr className={open ? undefined : 'past'}>
      <td>
        <b>{o.def.name}</b>
        <span className="dl-sub">{o.def.what}</span>
      </td>
      <td className={open || o.status === 'bought' ? 'good' : undefined}>{o.def.effect}</td>
      <td className="num" data-label="Цена">{fmtMoney(o.def.price)}</td>
      <td className="dl-when">
        {open ? (
          <>
            <span className={left <= 10 ? 'bad' : undefined}>Осталось {fmtDays(left)}</span>
            <ProgressBar value={left / OFFER_DAYS} />
            <span className="dl-sub">
              потом купит <LabName lab={o.def.rival} />
            </span>
          </>
        ) : o.status === 'bought' ? (
          <span className="good">куплен вами {o.day !== null ? formatDateShort(o.day) : ''}</span>
        ) : (
          <span>
            ушёл к <LabName lab={o.lab ?? o.def.rival} /> {o.day !== null ? formatDateShort(o.day) : ''}
          </span>
        )}
      </td>
      <td className="dl-act">
        {open && (
          <GuardButton className="btn small primary" reason={buyStartupError(s, o.def.id)} onClick={onBuy}>
            Купить
          </GuardButton>
        )}
      </td>
    </tr>
  );
}

function StartupsTab({ s }: { s: GameState }) {
  const offers = startupOffers(s);
  const sorted = [...offers.filter((o) => o.status === 'open'), ...offers.filter((o) => o.status !== 'open')];
  const [buy, setBuy] = useState<StartupId | null>(null);
  const buyDef: StartupDef | undefined = offers.find((o) => o.def.id === buy)?.def;
  return (
    <>
      <div className="dl-row-head">
        <h3 className="dl-h">Стартапы на продаже</h3>
        <span className="dl-note">Не купите вы - купит соперник</span>
      </div>
      {sorted.length === 0 ? (
        <div className="dl-empty">Сейчас стартапов на продаже нет</div>
      ) : (
        <table className="dl-table">
          <thead>
            <tr>
              <th>Стартап</th>
              <th>Что даёт</th>
              <th className="num">Цена</th>
              <th>Срок</th>
              <th className="dl-act" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <OfferRow key={o.def.id} s={s} o={o} onBuy={() => setBuy(o.def.id)} />
            ))}
          </tbody>
        </table>
      )}
      {buyDef && (
        <ConfirmDialog
          title="Купить стартап"
          confirmLabel="Купить"
          onClose={() => setBuy(null)}
          onConfirm={() => {
            setBuy(null);
            store.dispatch(buyStartup, buyDef.id);
          }}
        >
          <div className="kv">
            <span>Стартап</span>
            <span>{buyDef.name}</span>
            <span>Цена</span>
            <span className="bad">{fmtMoney(-buyDef.price)}</span>
            <span>Эффект</span>
            <span className="good">{buyDef.effect}</span>
            <span>Срок действия</span>
            <span>до конца игры</span>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

// ---------- Облако ----------

/**
 * Лимит аренды самых новых карт без облачной сделки и с этой сделкой: «65,5 тыс. → 85,2 тыс. H100».
 * Сегодняшний лимит уже включает действующую сделку, поэтому база - лимит без её множителя.
 */
function capLine(s: GameState, mult: number): string {
  const gpu = availableGpus(s).at(-1);
  if (!gpu) return `в ${String(mult).replace('.', ',')} раза выше`;
  const active = s.late?.cloud ? (CLOUDS.find((x) => x.id === s.late?.cloud?.id)?.capMult ?? 1) : 1;
  const base = Math.floor(rentCapFor(s, gpu.id) / active);
  return `${fmtNum(base)} → ${fmtNum(Math.floor(base * mult))} ${gpu.name.replace(/^Fermi /, '')}`;
}

function CloudRow({ s, def, onSign }: { s: GameState; def: CloudDef; onSign: () => void }) {
  const terms = cloudTerms(s, def.id);
  const active = s.late?.cloud?.id === def.id;
  return (
    <tr className={active ? 'on' : undefined}>
      <td>
        <b>{def.name}</b>
      </td>
      <td className="num" data-label="Срок">{def.months} мес.</td>
      <td className="num good" data-label="Аренда">-{pct(def.discount)}</td>
      <td className="num" data-label="Лимит аренды, карт">{capLine(s, def.capMult)}</td>
      <td className="num" data-label="Платёж в месяц">{fmtMoney(active ? (s.late?.cloud?.monthly ?? 0) : terms.monthly)}</td>
      <td className="dl-act">
        {active ? (
          <span className="good">действует</span>
        ) : (
          <GuardButton className="btn small primary" reason={cloudSignError(s, def.id)} onClick={onSign}>
            Подписать
          </GuardButton>
        )}
      </td>
    </tr>
  );
}

function CloudTab({ s }: { s: GameState }) {
  const [sign, setSign] = useState<CloudId | null>(null);
  const [exit, setExit] = useState(false);
  const c = s.late?.cloud ?? null;
  const def = c ? CLOUDS.find((x) => x.id === c.id) : undefined;
  const signDef = CLOUDS.find((x) => x.id === sign);
  const signTerms = signDef ? cloudTerms(s, signDef.id) : null;
  const month = cloudMonth(s);
  const fee = cloudExitFee(s);
  return (
    <>
      <div className="dl-row-head">
        <h3 className="dl-h">Облачные партнёры</h3>
        <span className="dl-note">Платёж списывается, даже если карты не нужны</span>
      </div>
      <table className="dl-table">
        <thead>
          <tr>
            <th>Партнёр</th>
            <th className="num">Срок</th>
            <th className="num">Аренда</th>
            <th className="num">Лимит аренды, карт</th>
            <th className="num">Платёж в месяц</th>
            <th className="dl-act" />
          </tr>
        </thead>
        <tbody>
          {CLOUDS.map((d) => (
            <CloudRow key={d.id} s={s} def={d} onSign={() => setSign(d.id)} />
          ))}
        </tbody>
      </table>
      {c && def && (
        <section className="dl-contract">
          <div className="dl-row-head">
            <h3 className="dl-h">Договор с {def.name}</h3>
            <span className="dl-note">
              {formatDateShort(c.since)} - {formatDateShort(c.until)}
            </span>
          </div>
          <ProgressBar value={(s.day - c.since) / Math.max(1, c.until - c.since)} />
          <div className="kv dl-kv">
            <span>Аренда с начала месяца</span>
            <span className={month && month.rent < month.owedToDate ? 'warn' : undefined}>{fmtMoney(month?.rent ?? 0)}</span>
            <span>Обязательно за месяц</span>
            <span>{fmtMoney(month?.owedMonth ?? 0)}</span>
            <span>Доплачено за недобор</span>
            <span className={c.shortfall > 0 ? 'bad' : undefined}>{fmtMoney(c.shortfall)}</span>
          </div>
          <div className="dl-contract-foot">
            <button type="button" className="btn danger" onClick={() => setExit(true)} disabled={!!s.outcome}>
              Расторгнуть за {fmtMoney(fee)}
            </button>
          </div>
        </section>
      )}
      {signDef && signTerms && (
        <ConfirmDialog
          title="Облачная сделка"
          confirmLabel="Подписать"
          onClose={() => setSign(null)}
          onConfirm={() => {
            setSign(null);
            store.dispatch(signCloud, signDef.id);
          }}
        >
          <div className="kv">
            <span>Партнёр</span>
            <span>{signDef.name}</span>
            <span>Срок</span>
            <span>до {formatDate(signTerms.until)}</span>
            <span>Аренда</span>
            <span className="good">дешевле на {pct(signDef.discount)}</span>
            <span>Лимит аренды</span>
            <span className="good">{capLine(s, signDef.capMult)}</span>
            <span>Обязательный платёж</span>
            <span className="bad">{fmtMoney(signTerms.monthly)} в месяц</span>
            <span>Расторжение</span>
            <span>половина оставшихся платежей</span>
          </div>
          <div className="muted small">Если аренда за месяц меньше платежа, разница списывается в конце месяца.</div>
        </ConfirmDialog>
      )}
      {exit && c && def && (
        <ConfirmDialog
          title="Расторгнуть сделку"
          confirmLabel="Расторгнуть"
          danger
          onClose={() => setExit(false)}
          onConfirm={() => {
            setExit(false);
            store.dispatch(endCloud);
          }}
        >
          <div className="kv">
            <span>Партнёр</span>
            <span>{def.name}</span>
            <span>Плата за расторжение</span>
            <span className="bad">{fmtMoney(-fee)}</span>
            <span>Скидка и лимит</span>
            <span>пропадут сразу</span>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

// ---------- Окно ----------

export default function DealsWindow({ s }: WindowProps) {
  const [tab, setTab] = useState<Tab>('teams');
  const effects = activeEffects(s);
  const monthly = dealsMonthly(s);
  const total = monthly.salary + monthly.cloud;
  const openOffers = startupOffers(s).filter((o) => o.status === 'open').length;
  return (
    <div className="dl">
      <div className="dl-top">
        <div className="dl-main">
          <span className="dl-l">Деньги на счёте</span>
          <span className={`dl-big${s.cash < 0 ? ' bad' : ''}`}>{fmtMoney(s.cash)}</span>
          <span className="dl-l">
            {total > 0
              ? `Сделки стоят ${fmtMoney(total)} в месяц: команды ${fmtMoney(monthly.salary)}, облако ${fmtMoney(monthly.cloud)}`
              : 'Постоянных платежей по сделкам нет'}
          </span>
        </div>
        <div className="dl-effects">
          <span className="dl-l">Действует</span>
          {effects.length === 0 ? (
            <span className="dl-none">Сделок пока нет</span>
          ) : (
            <ul>
              {effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="dl-body">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'teams', label: 'Команды' },
            { id: 'startups', label: openOffers > 0 ? `Стартапы: ${openOffers}` : 'Стартапы' },
            { id: 'cloud', label: 'Облако' },
          ]}
        />
        {tab === 'teams' && <TeamsTab s={s} />}
        {tab === 'startups' && <StartupsTab s={s} />}
        {tab === 'cloud' && <CloudTab s={s} />}
      </div>
    </div>
  );
}
