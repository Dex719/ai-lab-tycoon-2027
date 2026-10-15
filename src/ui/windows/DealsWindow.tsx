// Окно «Сделки» (с 2023 года): крупные траты с выбором и последствиями - звёздные команды, покупка стартапов,
// облачная сделка. Симуляция - sim/deals.ts, данные - data/deals.ts.

import { useState, type CSSProperties } from 'react';
import { CLOUDS, MAX_TEAMS, OFFER_DAYS, TEAMS, TEAM_RETAIN_MONTHS, type CloudDef, type StartupDef, type TeamDef } from '../../data/deals';
import { LABS } from '../../data/labs';
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
import { availableGpus, rentCapFor } from '../../sim/compute';
import { formatDate, formatDateShort } from '../../sim/time';
import type { CloudId, StartupId, TeamId } from '../../sim/lateState';
import type { GameState, LabId } from '../../sim/types';
import { ConfirmDialog, GuardButton, NewBadge, ProgressBar, Tabs } from '../components/common';
import { fmtDays, fmtMoney, fmtNum } from '../format';
import { store } from '../store';
import type { WindowProps } from './index';
import './DealsWindow.css';

type Tab = 'teams' | 'startups' | 'cloud';

const LAB = new Map<LabId, { name: string; color: string }>(LABS.map((l) => [l.id, { name: l.name, color: l.color }]));

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

function times(x: number): string {
  return `×${String(Math.round(x * 100) / 100).replace('.', ',')}`;
}

// ---------- Команды ----------

function TeamCard({ s, def, onHire, onRelease }: { s: GameState; def: TeamDef; onHire: () => void; onRelease: () => void }) {
  const hired = s.late?.teams.find((t) => t.id === def.id);
  return (
    <article className={`dl-team${hired ? ' on' : ''}`} style={{ '--team': def.color } as CSSProperties}>
      <div className="dl-team-top">
        <div className="dl-ava" aria-hidden="true">
          {def.initials}
        </div>
        <div className="dl-team-who">
          <b>{def.leader}</b>
          <span>{def.name}</span>
        </div>
      </div>
      <p className="dl-about">{def.about}</p>
      <div className="dl-effect">{def.effect}</div>
      {def.extra && <div className="dl-extra">{def.extra}</div>}
      <div className="kv dl-kv">
        <span>Подъёмные</span>
        <span>{fmtMoney(def.signing)}</span>
        <span>Зарплата</span>
        <span>{fmtMoney(def.salary)} в месяц</span>
      </div>
      <div className="dl-foot">
        {hired ? (
          <>
            <span className="dl-status">В лаборатории с {formatDateShort(hired.since)}</span>
            <button type="button" className="btn small danger" onClick={onRelease} disabled={!!s.outcome}>
              Отпустить
            </button>
          </>
        ) : (
          <GuardButton className="btn primary wide" reason={teamHireError(s, def.id)} onClick={onHire}>
            Нанять за {fmtMoney(def.signing)}
          </GuardButton>
        )}
      </div>
    </article>
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
        <span className="dl-slots">
          Команд: {s.late?.teams.length ?? 0} из {MAX_TEAMS}
        </span>
      </div>
      <div className="dl-teams">
        {TEAMS.map((def) => (
          <TeamCard key={def.id} s={s} def={def} onHire={() => setHire(def.id)} onRelease={() => setFire(def.id)} />
        ))}
      </div>
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
            <span className="bad">−{fmtMoney(hireDef.signing)}</span>
            <span>Зарплата</span>
            <span>{fmtMoney(hireDef.salary)} в месяц</span>
            <span>Эффект</span>
            <span className="good">{hireDef.effect}</span>
          </div>
          <div className="muted small">
            Соперники могут переманить команду: удержать её стоит зарплату за {TEAM_RETAIN_MONTHS} месяцев.
          </div>
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

function OfferCard({ s, o, onBuy }: { s: GameState; o: StartupOffer; onBuy: () => void }) {
  const left = Math.max(0, o.closeDay - s.day + 1);
  const rival = LAB.get(o.def.rival);
  return (
    <article className="dl-offer">
      <div className="dl-offer-head">
        <b>{o.def.name}</b>
        <NewBadge day={s.day} since={o.openDay} />
        <span className="dl-price">{fmtMoney(o.def.price)}</span>
      </div>
      <div className="dl-what">{o.def.what}</div>
      <div className="dl-effect">{o.def.effect}</div>
      <div className="dl-deadline">
        <ProgressBar value={left / OFFER_DAYS} />
        <div className="dl-left-row">
          <span className={`dl-left${left <= 10 ? ' hot' : ''}`}>Осталось {fmtDays(left)}</span>
          <span className="dl-rival">
            потом купит <i className="dl-labdot" style={{ background: rival?.color }} />
            {rival?.name}
          </span>
        </div>
      </div>
      <GuardButton className="btn primary wide" reason={buyStartupError(s, o.def.id)} onClick={onBuy}>
        Купить за {fmtMoney(o.def.price)}
      </GuardButton>
    </article>
  );
}

function StartupsTab({ s }: { s: GameState }) {
  const offers = startupOffers(s);
  const open = offers.filter((o) => o.status === 'open');
  const past = offers.filter((o) => o.status !== 'open');
  const [buy, setBuy] = useState<StartupId | null>(null);
  const buyDef: StartupDef | undefined = offers.find((o) => o.def.id === buy)?.def;
  return (
    <>
      <h3 className="dl-h">Стартапы на продаже</h3>
      {open.length === 0 ? (
        <div className="dl-empty">Сейчас стартапов на продаже нет</div>
      ) : (
        <div className="dl-offers">
          {open.map((o) => (
            <OfferCard key={o.def.id} s={s} o={o} onBuy={() => setBuy(o.def.id)} />
          ))}
        </div>
      )}
      {past.length > 0 && (
        <>
          <h3 className="dl-h dl-h2">Итоги</h3>
          <table className="dl-table">
            <tbody>
              {past.map((o) => (
                <tr key={o.def.id}>
                  <td className="dl-past-name">{o.def.name}</td>
                  <td>
                    {o.status === 'bought' ? (
                      <span className="good">куплен вами</span>
                    ) : (
                      <span className="muted">
                        ушёл к <i className="dl-labdot" style={{ background: LAB.get(o.lab ?? o.def.rival)?.color }} />
                        {LAB.get(o.lab ?? o.def.rival)?.name}
                      </span>
                    )}
                  </td>
                  <td className="muted">{o.status === 'bought' ? o.def.effect : lower(o.def.what)}</td>
                  <td className="num muted">{o.day !== null ? formatDateShort(o.day) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
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
            <span className="bad">−{fmtMoney(buyDef.price)}</span>
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

/** Лимит аренды самых новых карт сейчас и с множителем сделки: «32,8 тыс. → 49,2 тыс. карт H100». base - лимит уже включает сделку. */
function capLine(s: GameState, mult: number, active: boolean): string {
  const gpu = availableGpus(s).at(-1);
  if (!gpu) return times(mult);
  const now = rentCapFor(s, gpu.id);
  const before = active ? Math.floor(now / mult) : now;
  const after = active ? now : Math.floor(now * mult);
  return `${fmtNum(before)} → ${fmtNum(after)} карт ${gpu.name.replace(/^Fermi /, '')}`;
}

function CloudOffer({ s, def, onSign }: { s: GameState; def: CloudDef; onSign: () => void }) {
  const terms = cloudTerms(s, def.id);
  return (
    <article className="dl-cloud">
      <b className="dl-cloud-name">{def.name}</b>
      <div className="kv dl-kv">
        <span>Срок</span>
        <span>{def.months} мес.</span>
        <span>Аренда</span>
        <span className="good">дешевле на {pct(def.discount)}</span>
        <span>Лимит аренды</span>
        <span className="good">{capLine(s, def.capMult, false)}</span>
        <span>Платёж в месяц</span>
        <span>{fmtMoney(terms.monthly)}</span>
      </div>
      <GuardButton className="btn primary wide" reason={cloudSignError(s, def.id)} onClick={onSign}>
        Подписать
      </GuardButton>
    </article>
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
      <h3 className="dl-h">Облачная сделка</h3>
      {c && def ? (
        <div className="dl-active">
          <div className="dl-active-head">
            <b>{def.name}</b>
            <span className="muted">
              {formatDateShort(c.since)} - {formatDateShort(c.until)}
            </span>
          </div>
          <ProgressBar value={(s.day - c.since) / Math.max(1, c.until - c.since)} />
          <div className="kv dl-kv">
            <span>Аренда</span>
            <span className="good">дешевле на {pct(def.discount)}</span>
            <span>Лимит аренды</span>
            <span className="good">{capLine(s, def.capMult, true)}</span>
            <span>Обязательный платёж</span>
            <span>{fmtMoney(c.monthly)} в месяц</span>
            <span>Аренда с начала месяца</span>
            <span className={month && month.rent < month.owedToDate ? 'warn' : 'good'}>{fmtMoney(month?.rent ?? 0)}</span>
            <span>Обязательно за месяц</span>
            <span>{fmtMoney(month?.owedMonth ?? 0)}</span>
            <span>Доплачено за недобор</span>
            <span className={c.shortfall > 0 ? 'bad' : undefined}>{fmtMoney(c.shortfall)}</span>
          </div>
          <div className="dl-active-foot">
            <button type="button" className="btn danger" onClick={() => setExit(true)} disabled={!!s.outcome}>
              Расторгнуть за {fmtMoney(fee)}
            </button>
          </div>
        </div>
      ) : (
        <div className="dl-clouds">
          {CLOUDS.map((d) => (
            <CloudOffer key={d.id} s={s} def={d} onSign={() => setSign(d.id)} />
          ))}
        </div>
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
            <span className="good">{capLine(s, signDef.capMult, false)}</span>
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
            <span className="bad">−{fmtMoney(fee)}</span>
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
  const openOffers = startupOffers(s).filter((o) => o.status === 'open').length;
  return (
    <div className="dl">
      <div className="dl-hero">
        <div className="dl-kpi">
          <div className="dl-l">Деньги на счету</div>
          <div className={`dl-v${s.cash < 0 ? ' bad' : ''}`}>{fmtMoney(s.cash)}</div>
          <div className="dl-s">&nbsp;</div>
        </div>
        <div className="dl-kpi">
          <div className="dl-l">Сделки в месяц</div>
          <div className="dl-v">{fmtMoney(monthly.salary + monthly.cloud)}</div>
          <div className="dl-s">
            команды {fmtMoney(monthly.salary)}, облако {fmtMoney(monthly.cloud)}
          </div>
        </div>
        <div className="dl-kpi dl-kpi-wide">
          <div className="dl-l">Действует</div>
          {effects.length === 0 ? (
            <div className="dl-s dl-none">Сделок пока нет</div>
          ) : (
            <div className="dl-chips">
              {effects.map((e) => (
                <span key={e} className="dl-chip">
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="dl-body">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'teams', label: 'Команды' },
            { id: 'startups', label: openOffers > 0 ? `Стартапы (${openOffers})` : 'Стартапы' },
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
