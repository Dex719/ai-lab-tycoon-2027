// Окно «Команда»: вкладка «Сотрудники» - список слева и карточка выбранного (лестница уровней с потолком, опыт,
// что даст следующий уровень, курс и повышение); вкладка «Найм» - кандидаты месяца с выводом, кого выгодно растить.
// Найм, курс, повышение и увольнение - через подтверждение с ценой (sim/staff.ts).

import { useState } from 'react';
import type { WindowProps } from '.';
import {
  courseBlock,
  courseCost,
  courseXp,
  COURSE_COOLDOWN,
  EQUITY_SHARE,
  growthVerdict,
  hireBlock,
  hireGain,
  monthsToNext,
  nextSeatsStage,
  payrollMonthly,
  promotedSalary,
  promotionGain,
  READY_QUIT_DAYS,
  SEVERANCE_MONTHS,
  staffOf,
  staffSeats,
  type GrowthVerdict,
} from '../../sim/staff';
import {
  isWorking,
  LEVEL_NAMES,
  LEVEL_NAMES_GEN,
  levelCap,
  POTENTIAL_INFO,
  ROLE_INFO,
  STAFF_ROLES,
  staffEffect,
  type Candidate,
  type Employee,
  type StaffRole,
} from '../../sim/staffEffects';
import { dayToDate, formatDateShort, isMonthStart } from '../../sim/time';
import type { GameState } from '../../sim/types';
import { ConfirmDialog, ErrorText, GuardButton } from '../components/common';
import { fmtDays, fmtMoney } from '../format';
import { labStage, LAB_STAGES } from '../labStage';
import { playSound } from '../sound';
import { actions, store } from '../store';
import { pushNotice } from '../Toasts';
import './TeamWindow.css';

const TRAIT_TEXT = { fast: 'быстро растёт', equity: `просит долю ${String(EQUITY_SHARE * 100).replace('.', ',')} %` } as const;
const MONTHS_GEN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

/** Вывод словами: кого выгодно растить. */
const VERDICT: Record<GrowthVerdict, { short: string; tone: string }> = {
  worth: { short: 'выгодно растить', tone: 'good' },
  normal: { short: 'растёт обычно', tone: 'mid' },
  slow: { short: 'растёт медленно', tone: 'warn' },
  capped: { short: 'расти некуда', tone: 'dim' },
  top: { short: 'высший уровень', tone: 'dim' },
};

function verdictLine(e: { level: number; potential?: Employee['potential'] }): string {
  const v = growthVerdict(e);
  const cap = LEVEL_NAMES_GEN[levelCap(e)];
  if (v === 'worth') return `Высокий потенциал: растёт быстрее и дорастёт до ${cap}, курсы дают в 1,5 раза больше опыта.`;
  if (v === 'normal') return `Средний потенциал: дорастёт до ${cap}.`;
  if (v === 'slow') return `Низкий потенциал: растёт медленно, потолок - ${LEVEL_NAMES[levelCap(e)].toLowerCase()}, курсы дают половину опыта.`;
  if (v === 'capped') return 'Потолок потенциала: выше не вырастет, тратить на курсы незачем.';
  return 'Высший уровень.';
}

const pct = (x: number): string => `+${String(Math.round(x * 1000) / 10).replace('.', ',')} %`;

function Face({ role, size = 28 }: { role: StaffRole; size?: number }) {
  return (
    <svg className="tm-face" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx="14" cy="10" r="6" fill="#d9b48f" />
      <path d="M3 28c0-6 5-10 11-10s11 4 11 10z" fill={ROLE_INFO[role].color} />
    </svg>
  );
}

/** Лестница уровней: пройденные и текущий закрашены, достижимые - контуром, выше потолка - штриховкой с подписью. */
function Ladder({ e }: { e: { level: number; potential?: Employee['potential']; role: StaffRole } }) {
  const cap = levelCap(e);
  const color = ROLE_INFO[e.role].color;
  return (
    <div className="tm-ladder" role="list" aria-label="Уровни">
      {LEVEL_NAMES.map((name, i) => (
        <div
          key={name}
          role="listitem"
          className={`tm-step${i < e.level ? ' done' : i === e.level ? ' now' : i <= cap ? ' can' : ' no'}`}
          style={i <= e.level ? { background: color, borderColor: color } : undefined}
        >
          <span>{name}</span>
          {i === e.level && <small>сейчас</small>}
          {i > cap && i === cap + 1 && <small>потолок</small>}
        </div>
      ))}
    </div>
  );
}

function nextMonthStart(day: number): number {
  let d = day + 1;
  while (!isMonthStart(d)) d++;
  return d;
}

type Pending = { kind: 'hire'; c: Candidate } | { kind: 'promote'; e: Employee } | { kind: 'fire'; e: Employee } | { kind: 'train'; e: Employee };

/** Карточка выбранного сотрудника: всё о росте - где сейчас, куда дорастёт, что даст следующий уровень и как ускорить. */
function Profile({ s, e, act }: { s: GameState; e: Employee; act: (p: Pending) => void }) {
  const v = growthVerdict(e);
  const working = isWorking(e, s.day);
  const canGrow = e.level < levelCap(e);
  const ready = canGrow && e.xp >= 1;
  const months = monthsToNext(e);
  const gain = canGrow ? promotionGain(s, e) : 0;
  const quitIn = e.readyDay !== null ? Math.max(0, READY_QUIT_DAYS - (s.day - e.readyDay)) : null;
  return (
    <div className="tm-prof">
      <div className="tm-prof-head">
        <Face role={e.role} size={56} />
        <div className="tm-prof-id">
          <h3>{e.name}</h3>
          <span>
            {LEVEL_NAMES[e.level]}, {ROLE_INFO[e.role].name.toLowerCase()}
            {e.trait ? ` · ${TRAIT_TEXT[e.trait]}` : ''}
          </span>
          {!working && <span className="tm-wait">выйдет на работу {formatDateShort(e.startDay)}</span>}
        </div>
        <div className="tm-prof-sal">
          <b>{fmtMoney(e.salary)}</b>
          <span>в месяц</span>
        </div>
      </div>

      <p className={`tm-verdict ${VERDICT[v].tone}`}>{verdictLine(e)}</p>
      <Ladder e={e} />

      {canGrow && (
        <div className="tm-grow">
          <div className="tm-xp-big">
            <div className="tm-xp-top">
              <span>Опыт до уровня «{LEVEL_NAMES[e.level + 1]}»</span>
              <b>{Math.round(Math.min(1, e.xp) * 100)} %</b>
            </div>
            <span className="tm-bar big">
              <i style={{ width: `${Math.min(1, e.xp) * 100}%`, background: ROLE_INFO[e.role].color }} />
            </span>
            <small className={ready ? 'warn' : undefined}>
              {ready
                ? `Можно повысить. Без повышения уйдёт через ${fmtDays(quitIn ?? 0)}`
                : months !== null
                  ? `≈ ${months} мес. работы или курсы`
                  : ''}
            </small>
          </div>
          <dl className="tm-next">
            <dt>Повышение даст</dt>
            <dd className="good">
              {pct(gain)} к «{ROLE_INFO[e.role].name}»
            </dd>
            <dt>Зарплата станет</dt>
            <dd className="bad">
              {fmtMoney(promotedSalary(s, e))} <small>(сейчас {fmtMoney(e.salary)})</small>
            </dd>
            <dt>Курс «Обучить»</dt>
            <dd>
              {fmtMoney(courseCost(e))} за +{Math.round(courseXp(e) * 100)} % опыта
            </dd>
          </dl>
        </div>
      )}

      <div className="tm-prof-act">
        {ready ? (
          <button className="btn primary" onClick={() => act({ kind: 'promote', e })}>
            Повысить до уровня «{LEVEL_NAMES[e.level + 1]}»
          </button>
        ) : canGrow ? (
          <GuardButton className="btn primary" reason={courseBlock(s, e)} onClick={() => act({ kind: 'train', e })}>
            Обучить за {fmtMoney(courseCost(e))}
          </GuardButton>
        ) : null}
        <button className="btn tm-fire" onClick={() => act({ kind: 'fire', e })}>
          Уволить
        </button>
      </div>
    </div>
  );
}

export default function TeamWindow({ s }: WindowProps) {
  const st = staffOf(s);
  const [tab, setTab] = useState<'staff' | 'hire'>(st.people.length === 0 ? 'hire' : 'staff');
  const [selId, setSelId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seats = staffSeats(s);
  const stage = LAB_STAGES[labStage(s)];
  const next = nextSeatsStage(s);
  const payroll = payrollMonthly(s);
  const refresh = nextMonthStart(s.day);
  const monthName = MONTHS_GEN[dayToDate(s.day).month - 1];
  // Сначала те, кого можно повысить, затем выгодные для роста, затем остальные; внутри - по уровню.
  const order: GrowthVerdict[] = ['worth', 'normal', 'slow', 'capped', 'top'];
  const people = [...st.people].sort((a, b) => {
    const ra = a.xp >= 1 && a.level < levelCap(a) ? -1 : order.indexOf(growthVerdict(a));
    const rb = b.xp >= 1 && b.level < levelCap(b) ? -1 : order.indexOf(growthVerdict(b));
    return ra - rb || b.level - a.level;
  });
  const sel = people.find((p) => p.id === selId) ?? people[0] ?? null;

  function confirm() {
    if (!pending) return;
    const p = pending;
    const r =
      p.kind === 'hire'
        ? store.dispatch(actions.hireCandidate, p.c.id)
        : p.kind === 'promote'
          ? store.dispatch(actions.promoteEmployee, p.e.id)
          : p.kind === 'train'
            ? store.dispatch(actions.trainEmployee, p.e.id)
            : store.dispatch(actions.fireEmployee, p.e.id);
    setError(r.ok ? null : r.error);
    setPending(null);
    if (!r.ok) return;
    // Ответ на действие: звук и уведомление - рост должен ощущаться.
    if (p.kind === 'promote') {
      playSound('goal');
      pushNotice({ kind: 'news', label: 'Повышение', title: `${p.e.name}: теперь ${LEVEL_NAMES[p.e.level + 1].toLowerCase()}`, win: 'team', tone: 'good' });
    } else if (p.kind === 'train') {
      playSound('research');
      pushNotice({ kind: 'news', label: 'Курс пройден', title: `${p.e.name}: опыт +${Math.round(courseXp(p.e) * 100)} %`, win: 'team', tone: 'good' });
    } else if (p.kind === 'hire') {
      playSound('coin');
      setTab('staff');
    }
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
                <b className={eff > 0 ? 'good' : 'dim'}>{eff > 0 ? pct(eff) : '-'}</b>
                <span className="tm-eff-t">
                  {ROLE_INFO[r].effect}, до +{Math.round(ROLE_INFO[r].cap * 100)} %
                </span>
              </div>
            );
          })}
        </div>
      </header>

      <div className="tm-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'staff'} className={tab === 'staff' ? 'on' : undefined} onClick={() => setTab('staff')}>
          Сотрудники {st.people.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'hire'} className={tab === 'hire' ? 'on' : undefined} onClick={() => setTab('hire')}>
          Найм: кандидаты в {monthName} {st.candidates.length}
        </button>
        <ErrorText error={error} />
      </div>

      {tab === 'staff' ? (
        st.people.length === 0 ? (
          <div className="tm-body-empty">
            Пока работают только основатели.
            <button className="btn primary" onClick={() => setTab('hire')}>
              Посмотреть кандидатов
            </button>
          </div>
        ) : (
          <div className="tm-body">
            <div className="tm-list" role="listbox" aria-label="Сотрудники">
              {people.map((p) => {
                const v = growthVerdict(p);
                const ready = p.xp >= 1 && p.level < levelCap(p);
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={sel?.id === p.id}
                    className={`tm-item${sel?.id === p.id ? ' on' : ''}${isWorking(p, s.day) ? '' : ' wait'}`}
                    onClick={() => setSelId(p.id)}
                  >
                    <Face role={p.role} />
                    <span className="tm-item-main">
                      <b>{p.name}</b>
                      <span>
                        {LEVEL_NAMES[p.level]}, {ROLE_INFO[p.role].name.toLowerCase()}
                      </span>
                    </span>
                    <span className={`tm-item-v ${ready ? 'warn' : VERDICT[v].tone}`}>{ready ? 'можно повысить' : VERDICT[v].short}</span>
                  </button>
                );
              })}
            </div>
            {sel && <Profile s={s} e={sel} act={setPending} />}
          </div>
        )
      ) : (
        <div className="tm-hire">
          {st.candidates.length === 0 && <div className="tm-body-empty">Новые кандидаты придут {formatDateShort(refresh)}.</div>}
          {st.candidates.map((c) => {
            const v = growthVerdict(c);
            return (
              <div key={c.id} className="tm-cand">
                <div className="tm-prof-head">
                  <Face role={c.role} size={40} />
                  <div className="tm-prof-id">
                    <h3>{c.name}</h3>
                    <span>
                      {LEVEL_NAMES[c.level]}, {ROLE_INFO[c.role].name.toLowerCase()}
                      {c.trait ? ` · ${TRAIT_TEXT[c.trait]}` : ''}
                    </span>
                  </div>
                  <div className="tm-prof-sal">
                    <b>{fmtMoney(c.salary)}</b>
                    <span>в месяц</span>
                  </div>
                </div>
                <p className={`tm-verdict ${VERDICT[v].tone}`}>{verdictLine(c)}</p>
                <Ladder e={c} />
                <div className="tm-cand-foot">
                  <span>
                    Сразу даст <b className="good">{pct(hireGain(s, c))}</b> к «{ROLE_INFO[c.role].name}», выход через {fmtDays(c.wait)}
                  </span>
                  <GuardButton className="btn primary" reason={hireBlock(s, c)} onClick={() => setPending({ kind: 'hire', c })}>
                    Нанять
                  </GuardButton>
                </div>
              </div>
            );
          })}
          <div className="tm-hire-note">Новые кандидаты - {formatDateShort(refresh)}. Кого не наняли, уйдут к другим.</div>
        </div>
      )}

      {pending?.kind === 'hire' && (
        <ConfirmDialog title="Нанять" confirmLabel="Нанять" onConfirm={confirm} onClose={() => setPending(null)}>
          <div className="kv">
            <span>Сотрудник</span>
            <span>
              {pending.c.name}, {LEVEL_NAMES[pending.c.level].toLowerCase()}
            </span>
            <span>Роль</span>
            <span>{ROLE_INFO[pending.c.role].name}</span>
            <span>Потенциал</span>
            <span>
              {POTENTIAL_INFO[pending.c.potential ?? 'mid'].name}, до уровня «{LEVEL_NAMES[levelCap(pending.c)]}»
            </span>
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
            <span>Команде</span>
            <span className="good">
              {pct(promotionGain(s, pending.e))} к «{ROLE_INFO[pending.e.role].name}»
            </span>
            <span>Зарплата</span>
            <span className="bad">
              {fmtMoney(pending.e.salary)} → {fmtMoney(promotedSalary(s, pending.e))} в месяц
            </span>
          </div>
        </ConfirmDialog>
      )}
      {pending?.kind === 'train' && (
        <ConfirmDialog title="Обучить" confirmLabel="Отправить на курс" onConfirm={confirm} onClose={() => setPending(null)}>
          <div className="kv">
            <span>Сотрудник</span>
            <span>
              {pending.e.name}, {LEVEL_NAMES[pending.e.level].toLowerCase()}
            </span>
            <span>Потенциал</span>
            <span>{POTENTIAL_INFO[pending.e.potential ?? 'mid'].name}</span>
            <span>Курс стоит</span>
            <span className="bad">{fmtMoney(courseCost(pending.e))}</span>
            <span>Опыт</span>
            <span className="good">
              {Math.round(pending.e.xp * 100)} → {Math.round(Math.min(1, pending.e.xp + courseXp(pending.e)) * 100)} % до уровня «{LEVEL_NAMES[pending.e.level + 1]}»
            </span>
            <span>Следующий курс</span>
            <span>через {fmtDays(COURSE_COOLDOWN)}</span>
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
