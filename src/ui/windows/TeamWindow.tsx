// Окно «Команда»: сотрудники по ролям и уровням, опыт до повышения, кандидаты месяца и что команда даёт лаборатории.
// Найм, повышение и увольнение - через подтверждение с ценой (sim/staff.ts).

import { useState } from 'react';
import type { WindowProps } from '.';
import {
  EQUITY_SHARE,
  hireBlock,
  nextSeatsStage,
  payrollMonthly,
  promotedSalary,
  READY_QUIT_DAYS,
  SEVERANCE_MONTHS,
  staffOf,
  staffSeats,
} from '../../sim/staff';
import { isWorking, LEVEL_NAMES, LEVEL_NAMES_GEN, ROLE_INFO, STAFF_ROLES, staffEffect, type Candidate, type Employee, type StaffRole } from '../../sim/staffEffects';
import { dayToDate, formatDateShort, isMonthStart } from '../../sim/time';
import type { GameState } from '../../sim/types';
import { ConfirmDialog, ErrorText, GuardButton } from '../components/common';
import { fmtDays, fmtMoney } from '../format';
import { labStage, LAB_STAGES } from '../labStage';
import { actions, store } from '../store';
import './TeamWindow.css';

const TRAIT_TEXT = { fast: 'быстро растёт', equity: `просит долю ${String(EQUITY_SHARE * 100).replace('.', ',')} %` } as const;
/** Месяцев до следующего уровня - как в sim/staff.ts (XP_MONTHS), для подписи «до мидла 7 мес.». */
const XP_MONTHS = [12, 18, 30];

function Face({ role }: { role: StaffRole }) {
  return (
    <svg className="tm-face" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="10" r="6" fill="#d9b48f" />
      <path d="M3 28c0-6 5-10 11-10s11 4 11 10z" fill={ROLE_INFO[role].color} />
    </svg>
  );
}

function LevelPips({ level }: { level: number }) {
  return (
    <span className="tm-pips" aria-hidden="true">
      {LEVEL_NAMES.map((_, i) => (
        <i key={i} className={i <= level ? 'on' : undefined} />
      ))}
    </span>
  );
}

function nextMonthStart(day: number): number {
  let d = day + 1;
  while (!isMonthStart(d)) d++;
  return d;
}

const MONTHS_GEN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

/** Строка опыта: полоса и подпись «до мидла 7 мес.», «можно повысить, ещё 120 дн.» или «высший уровень». */
function Xp({ s, e }: { s: GameState; e: Employee }) {
  if (e.level >= 3) return <small>высший уровень</small>;
  if (!isWorking(e, s.day)) return <small>выйдет {formatDateShort(e.startDay)}</small>;
  const ready = e.xp >= 1;
  const monthsLeft = Math.ceil((1 - e.xp) * XP_MONTHS[e.level] / (e.trait === 'fast' ? 1.7 : 1));
  const quitIn = e.readyDay !== null ? Math.max(0, READY_QUIT_DAYS - (s.day - e.readyDay)) : null;
  return (
    <>
      <span className="tm-bar">
        <i style={{ width: `${Math.min(1, e.xp) * 100}%` }} />
      </span>
      <small className={ready ? 'warn' : undefined} title={ready ? `Опыта хватает для повышения; без него уйдёт через ${fmtDays(quitIn ?? 0)}` : undefined}>
        {ready ? `повысить: ещё ${quitIn ?? 0} дн.` : `до ${LEVEL_NAMES_GEN[e.level + 1]} ${monthsLeft} мес.`}
      </small>
    </>
  );
}

type Pending = { kind: 'hire'; c: Candidate } | { kind: 'promote'; e: Employee } | { kind: 'fire'; e: Employee };

export default function TeamWindow({ s }: WindowProps) {
  const st = staffOf(s);
  const [role, setRole] = useState<StaffRole | 'all'>('all');
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seats = staffSeats(s);
  const stage = LAB_STAGES[labStage(s)];
  const next = nextSeatsStage(s);
  const list = st.people.filter((p) => role === 'all' || p.role === role);
  const payroll = payrollMonthly(s);
  const refresh = nextMonthStart(s.day);
  const monthName = MONTHS_GEN[dayToDate(s.day).month - 1];

  function confirm() {
    if (!pending) return;
    const r =
      pending.kind === 'hire'
        ? store.dispatch(actions.hireCandidate, pending.c.id)
        : pending.kind === 'promote'
          ? store.dispatch(actions.promoteEmployee, pending.e.id)
          : store.dispatch(actions.fireEmployee, pending.e.id);
    setError(r.ok ? null : r.error);
    setPending(null);
  }

  return (
    <div className="tm">
      <header className="tm-head">
        <div className="tm-fig">
          <span className="tm-fig-l">Сотрудники</span>
          <span className="tm-fig-v">
            {st.people.length}
            <small> из {seats} мест</small>
          </span>
          <span className="tm-fig-s">{next ? `${stage.name}: больше мест - на этапе «${next}»` : `${stage.name}: мест больше всего`}</span>
          <dl className="tm-kv">
            <dt>Зарплаты в месяц</dt>
            <dd className={payroll > 0 ? 'bad' : undefined}>{payroll > 0 ? fmtMoney(payroll) : '-'}</dd>
            <dt>Новые кандидаты</dt>
            <dd>{formatDateShort(refresh)}</dd>
          </dl>
        </div>
        <div className="tm-effects">
          <span className="tm-fig-l">Что даёт команда</span>
          {STAFF_ROLES.map((r) => {
            const eff = staffEffect(s, r);
            return (
              <div key={r} className="tm-eff">
                <span className="tm-dot" style={{ background: ROLE_INFO[r].color }} />
                <span className="tm-eff-n">{ROLE_INFO[r].name}</span>
                <b className={eff > 0 ? 'good' : 'dim'}>{eff > 0 ? `+${Math.round(eff * 100)} %` : '-'}</b>
                <span className="tm-eff-t">
                  {ROLE_INFO[r].effect}, до +{Math.round(ROLE_INFO[r].cap * 100)} %
                </span>
              </div>
            );
          })}
        </div>
      </header>
      <div className="tm-body">
        <section className="tm-staff">
          <div className="tm-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={role === 'all'} className={role === 'all' ? 'on' : undefined} onClick={() => setRole('all')}>
              Все {st.people.length}
            </button>
            {STAFF_ROLES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={role === r} className={role === r ? 'on' : undefined} onClick={() => setRole(r)}>
                {ROLE_INFO[r].name} {st.people.filter((p) => p.role === r).length}
              </button>
            ))}
          </div>
          <div className="tm-rows">
            {st.people.length === 0 ? (
              <div className="tm-empty">Пока работают только основатели. Наймите первых сотрудников из кандидатов справа.</div>
            ) : list.length === 0 ? (
              <div className="tm-empty">В этой роли сотрудников нет.</div>
            ) : (
              list.map((p) => (
                <div key={p.id} className={`tm-row${isWorking(p, s.day) ? '' : ' wait'}`}>
                  <Face role={p.role} />
                  <div className="tm-row-main">
                    <b>{p.name}</b>
                    <span>
                      {ROLE_INFO[p.role].name}
                      {p.trait ? ` · ${TRAIT_TEXT[p.trait]}` : ''}
                    </span>
                  </div>
                  <div className="tm-lvl">
                    <span>{LEVEL_NAMES[p.level]}</span>
                    <LevelPips level={p.level} />
                  </div>
                  <div className="tm-xp">
                    <Xp s={s} e={p} />
                  </div>
                  <div className="tm-sal">{fmtMoney(p.salary)}/мес.</div>
                  <div className="tm-act">
                    {p.level < 3 && p.xp >= 1 && (
                      <button className="btn small" onClick={() => setPending({ kind: 'promote', e: p })}>
                        Повысить
                      </button>
                    )}
                    <button className="btn small" onClick={() => setPending({ kind: 'fire', e: p })}>
                      Уволить
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
        <aside className="tm-cands">
          <h3 className="tm-h">Кандидаты в {monthName}</h3>
          {st.candidates.length === 0 && <div className="tm-empty">Новые кандидаты придут {formatDateShort(refresh)}.</div>}
          {st.candidates.map((c) => (
            <div key={c.id} className="tm-cand">
              <Face role={c.role} />
              <div className="tm-row-main">
                <b>{c.name}</b>
                <span>
                  {LEVEL_NAMES[c.level]}, {ROLE_INFO[c.role].name.toLowerCase()}
                </span>
                {c.trait && <span className="tm-note">{TRAIT_TEXT[c.trait]}</span>}
              </div>
              <div className="tm-cand-r">
                <b>{fmtMoney(c.salary)}/мес.</b>
                <small>выход через {c.wait} дн.</small>
                <GuardButton className="btn small primary" reason={hireBlock(s, c)} onClick={() => setPending({ kind: 'hire', c })}>
                  Нанять
                </GuardButton>
              </div>
            </div>
          ))}
          <ErrorText error={error} />
        </aside>
      </div>
      {pending?.kind === 'hire' && (
        <ConfirmDialog title="Нанять" confirmLabel="Нанять" onConfirm={confirm} onClose={() => setPending(null)}>
          <div className="kv">
            <span>Сотрудник</span>
            <span>
              {pending.c.name}, {LEVEL_NAMES[pending.c.level].toLowerCase()}
            </span>
            <span>Роль</span>
            <span>{ROLE_INFO[pending.c.role].name}</span>
            <span>Зарплата</span>
            <span className="bad">{fmtMoney(pending.c.salary)} в месяц</span>
            <span>Выйдет на работу</span>
            <span>{formatDateShort(s.day + pending.c.wait)}</span>
            <span>Мест после найма</span>
            <span>
              {st.people.length + 1} из {seats}
            </span>
            {pending.c.trait === 'equity' && (
              <>
                <span>Доля компании</span>
                <span className="bad">−{String(EQUITY_SHARE * 100).replace('.', ',')} %</span>
              </>
            )}
          </div>
        </ConfirmDialog>
      )}
      {pending?.kind === 'promote' && (
        <ConfirmDialog title="Повысить" confirmLabel="Повысить" onConfirm={confirm} onClose={() => setPending(null)}>
          <div className="kv">
            <span>Сотрудник</span>
            <span>{pending.e.name}</span>
            <span>Уровень</span>
            <span>
              {LEVEL_NAMES[pending.e.level]} → {LEVEL_NAMES[pending.e.level + 1]}
            </span>
            <span>Зарплата</span>
            <span className="bad">
              {fmtMoney(pending.e.salary)} → {fmtMoney(promotedSalary(s, pending.e))} в месяц
            </span>
          </div>
        </ConfirmDialog>
      )}
      {pending?.kind === 'fire' && (
        <ConfirmDialog title="Уволить" confirmLabel="Уволить" danger onConfirm={confirm} onClose={() => setPending(null)}>
          <div className="kv">
            <span>Сотрудник</span>
            <span>
              {pending.e.name}, {LEVEL_NAMES[pending.e.level].toLowerCase()}
            </span>
            <span>Выходное пособие</span>
            <span className="bad">{fmtMoney(pending.e.salary * SEVERANCE_MONTHS)}</span>
            <span>Команда теряет</span>
            <span>вклад в роль «{ROLE_INFO[pending.e.role].name}»</span>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
