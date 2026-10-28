// Окно «Команда»: вкладка «Сотрудники» - список слева и карточка выбранного (лестница уровней с потолком, опыт,
// что даст следующий уровень, курс и повышение); вкладка «Найм» - кандидаты месяца с выводом, кого выгодно растить.
// Найм, курс, повышение и увольнение - через подтверждение с ценой (sim/staff.ts).

import { useState } from 'react';
import type { WindowProps } from '.';
import {
  courseBlock,
  courseCost,
  courseDays,
  courseProgress,
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
  SEVERANCE_MONTHS,
  staffOf,
  staffSeats,
  type GrowthVerdict,
} from '../../sim/staff';
import {
  isOnCourse,
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
import { COFOUNDER_LIMIT, cofounderDef } from '../../sim/cofounder';
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

function nextMonthStart(day: number): number {
  let d = day + 1;
  while (!isMonthStart(d)) d++;
  return d;
}

/** Фигурка на карточке: голова и плечи цвета роли. */
function Bust({ role }: { role: StaffRole }) {
  return (
    <svg className="tm-bust" width="84" height="92" viewBox="0 0 84 92" aria-hidden="true">
      <circle cx="42" cy="30" r="22" fill="#f1c9a5" />
      <path d="M42 8c-14 0-22 9-22 20 6-6 15-8 22-8s16 2 22 8c0-11-8-20-22-20z" fill="#3b2a1e" />
      <path d="M6 92c0-22 16-36 36-36s36 14 36 36z" fill={ROLE_INFO[role].color} />
      <path d="M30 60l12 14 12-14" fill="none" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
    </svg>
  );
}

/** Ступени уровня: четыре деления; пройденные и текущее залиты, до потолка - пустые, выше потолка - пунктир. */
function Steps({ e }: { e: { level: number; potential?: Employee['potential'] } }) {
  const cap = levelCap(e);
  return (
    <span className="tm-steps" role="img" aria-label={`Уровень ${e.level + 1} из 4, потолок: ${LEVEL_NAMES[cap].toLowerCase()}`} title={`Уровень ${e.level + 1} из 4. Потолок: ${LEVEL_NAMES[cap].toLowerCase()}`}>
      {LEVEL_NAMES.map((n, i) => (
        <i key={n} className={i <= e.level ? 'on' : i <= cap ? 'can' : 'no'} />
      ))}
    </span>
  );
}

/** Карточка человека: полоса и точка цвета роли, имя, фигурка на нейтральном фоне, уровень и зарплата текстом, опыт полосой, вывод и одно действие. */
function PersonCard(props: { s: GameState; e?: Employee; c?: Candidate; act: (p: Pending) => void }) {
  const { s, e, c, act } = props;
  const p = (e ?? c)!;
  const v = growthVerdict(p);
  const working = e ? isWorking(e, s.day) : true;
  const canGrow = e ? e.level < levelCap(e) : false;
  const ready = !!e && canGrow && e.xp >= 1;
  // Причина, почему кнопка «Расти некуда» закрыта: сотрудник уже на потолке своего уровня.
  const capReason = e ? (e.level < 3 ? `Выше уровня «${LEVEL_NAMES[e.level]}» не вырастет` : 'Высший уровень') : 'Некого обучать';
  const xp = e ? Math.round(Math.min(1, e.xp) * 100) : 0;
  const studying = !!e && isOnCourse(e, s.day);
  const study = e && studying ? Math.round(courseProgress(e, s.day) * 100) : 0;
  return (
    <div className={`tm-card r-${p.role}${ready ? ' ready' : ''}`} style={{ ['--rc' as string]: ROLE_INFO[p.role].color }}>
      <div className="tm-card-top">
        <span className="tm-name" title={p.name}>
          {p.name}
        </span>
        <span className="tm-role">
          <i className="tm-role-dot" />
          {ROLE_INFO[p.role].name}
        </span>
      </div>
      <div className="tm-card-art">
        <Bust role={p.role} />
      </div>
      <div className="tm-card-body">
        <div className="tm-line">
          <span className="tm-lvl">
            {LEVEL_NAMES[p.level]}
            <Steps e={p} />
          </span>
          <span className="tm-sal">
            {fmtMoney(p.salary)}<small>/мес.</small>
          </span>
        </div>
        {studying && e?.course && (
          <div className="tm-xp tm-course" title={`Курс: опыт +${Math.round(e.course.xp * 100)} % по окончании. Пока идёт курс, вклада в команду нет.`}>
            <span className="tm-xp-l">
              <b>На обучении до {formatDateShort(e.course.endDay)}</b>
              <span>{study} %</span>
            </span>
            <span className="tm-meter">
              <i style={{ width: `${study}%` }} />
            </span>
          </div>
        )}
        {e ? (
          canGrow ? (
            <div className="tm-xp" title={monthsToNext(e) !== null ? `≈ ${monthsToNext(e)} мес. работы или курсы до уровня «${LEVEL_NAMES[e.level + 1]}»` : undefined}>
              <span className="tm-xp-l">
                {ready ? <b className="good">Можно повысить</b> : <span>Опыт до уровня «{LEVEL_NAMES[e.level + 1]}»</span>}
                <b>{xp} %</b>
              </span>
              <span className="tm-meter">
                <i style={{ width: `${xp}%` }} />
              </span>
            </div>
          ) : (
            <span className="tm-xp-l cap">{e.level < 3 ? `Выше уровня «${LEVEL_NAMES[e.level]}» не вырастет` : 'Высший уровень'}</span>
          )
        ) : (
          <span className="tm-xp-l">
            <span>Сразу даст</span>
            <b className="good">{pct(hireGain(s, c!))}</b>
          </span>
        )}
        {!(e && !canGrow) && (
          <span className={`tm-verdict ${ready ? 'warn' : VERDICT[v].tone}`} title={verdictLine(p)}>
          {ready ? 'Опыта хватает для повышения' : VERDICT[v].short[0].toUpperCase() + VERDICT[v].short.slice(1)}
          </span>
        )}
        {!working && e && <span className="tm-wait">Выйдет на работу {formatDateShort(e.startDay)}</span>}
        {p.trait && <span className="tm-trait">{TRAIT_TEXT[p.trait][0].toUpperCase() + TRAIT_TEXT[p.trait].slice(1)}</span>}
      </div>
      <div className="tm-card-act">
        {c ? (
          <GuardButton className="btn primary" reason={hireBlock(s, c)} onClick={() => act({ kind: 'hire', c })}>
            Нанять
          </GuardButton>
        ) : ready ? (
          <button className="btn primary" onClick={() => act({ kind: 'promote', e: e! })}>
            Повысить
          </button>
        ) : canGrow ? (
          <GuardButton className="btn primary" reason={courseBlock(s, e!)} onClick={() => act({ kind: 'train', e: e! })}>
            {studying ? 'На обучении' : `Обучить · ${fmtMoney(courseCost(e!))}`}
          </GuardButton>
        ) : (
          <GuardButton className="btn" reason={capReason} onClick={() => undefined}>
            Расти некуда
          </GuardButton>
        )}
        {e && (
          <button className="tm-fire" onClick={() => act({ kind: 'fire', e })} title="Уволить">
            Уволить
          </button>
        )}
      </div>
    </div>
  );
}

type Pending = { kind: 'hire'; c: Candidate } | { kind: 'promote'; e: Employee } | { kind: 'fire'; e: Employee } | { kind: 'train'; e: Employee };

export default function TeamWindow({ s }: WindowProps) {
  const st = staffOf(s);
  const [tab, setTab] = useState<'staff' | 'hire'>(st.people.length === 0 ? 'hire' : 'staff');
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
      pushNotice({ kind: 'news', label: 'Курс начат', title: `${p.e.name}: учёба ${fmtDays(courseDays(p.e))}, опыт +${Math.round(courseXp(p.e) * 100)} % по окончании`, win: 'team' });
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
            {s.cofounder && (
              <>
                <dt>Сооснователь</dt>
                <dd className={s.cofounder.leftDay !== undefined ? 'bad' : s.cofounder.disputes > 0 ? 'warn' : undefined} title={cofounderDef(s.cofounder.id).perk}>
                  {cofounderDef(s.cofounder.id).name},{' '}
                  {s.cofounder.leftDay !== undefined ? `ушёл ${formatDateShort(s.cofounder.leftDay)}` : `споров ${s.cofounder.disputes} из ${COFOUNDER_LIMIT}`}
                </dd>
              </>
            )}
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
          <div className="tm-cards">
            {people.map((p) => (
              <PersonCard key={p.id} s={s} e={p} act={setPending} />
            ))}
          </div>
        )
      ) : (
        <div className="tm-cards">
          {st.candidates.length === 0 && <div className="tm-body-empty">Новые кандидаты придут {formatDateShort(refresh)}.</div>}
          {st.candidates.map((c) => (
            <PersonCard key={c.id} s={s} c={c} act={setPending} />
          ))}
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
                <span className="bad">-{String(EQUITY_SHARE * 100).replace('.', ',')} %</span>
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
            <span>Срок</span>
            <span>
              {fmtDays(courseDays(pending.e))}, до {formatDateShort(s.day + courseDays(pending.e))}
            </span>
            <span>На это время</span>
            <span>учится и не даёт вклада в роль «{ROLE_INFO[pending.e.role].name}»</span>
            <span>Опыт по окончании</span>
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
