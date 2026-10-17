// Боковая панель справа (как «Боковое окно» в Processor Tycoon): текущие проекты и модели в продаже.

import { fmtGap, raceName, standingOf } from './ArenaFeedback';
import { ModelEmblem } from './components/ModelEmblem';
import { LabEmblem } from './components/LabEmblem';
import { openDossier } from './dossier';
import { duelOf, mainRival, timesCount } from '../sim/duel';
import { LABS } from '../data/labs';
import { useState, type ReactElement, type ReactNode } from 'react';
import { pool } from '../sim/compute';
import { idleWarnings, type IdleItem } from '../sim/idle';
import { canApply, lateContracts } from '../sim/contracts';
import { TRAIN_FLOP_PER_H100E_DAY } from '../sim/constants';
import { playerSales, subsOpen } from '../sim/market';
import { researchDaysLeft, rpPerDay, TECHS, techCost } from '../sim/research';
import { CLIENTS } from '../data/clients';
import { benchDef } from '../sim/benchmarks';
import { openChoices } from '../sim/events';
import { ARENA_PLACE_TITLE } from './arena';
import { formatDateShort } from '../sim/time';
import { trainingPoolPerRun } from '../sim/training';
import type { GameState } from '../sim/types';
import { ProgressBar } from './components/common';
import { fmtH100e, fmtMoney, fmtNum, fmtPrice, fmtShare } from './format';
import { IconChevronLeft, IconChevronRight } from './icons';
import { GoalsPanel } from './GoalsPanel';
import { reviewNote } from './labels';
import { store } from './store';
import type { Viewport } from './viewport';
import type { WindowAlias, WindowId } from './windows';

type Tab = 'projects' | 'models';

const finite = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

function days(n: number): string {
  return Number.isFinite(n) ? `${fmtNum(Math.ceil(n))} дн.` : '-';
}

function Projects({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const items: ReactElement[] = [];
  // Отложенные решения сверху: у них есть срок.
  for (const m of openChoices(s).filter((x) => x.deferred)) {
    items.push(
      // Открыть именно это письмо, а не верхнее в списке (плейтест 18.10).
      <div
        className="side-item t-decision decision"
        key={m.id}
        onClick={() => {
          store.focusMail(m.id);
          open('mail');
        }}
        style={{ cursor: 'pointer' }}
      >
        <div className="t">Решение: {m.title}</div>
        <div className="r">
          <span>Ответить до</span>
          <span className="v">{m.replyByDay !== undefined ? formatDateShort(m.replyByDay) : '-'}</span>
        </div>
      </div>,
    );
  }
  // Доля «Обучение» делится между идущими проектами поровну.
  const speed = trainingPoolPerRun(s) * TRAIN_FLOP_PER_H100E_DAY;
  for (const t of s.trainings) {
    items.push(
      <div className="side-item t-train" key={t.id} onClick={() => open('newModel')} style={{ cursor: 'pointer' }}>
        <div className="t">Обучение: {t.plan.name}</div>
        <div className="r">
          <span>Готово</span>
          <span className="v">{fmtShare(t.flopDone / t.flopTotal, 0)}</span>
        </div>
        <div className="r">
          <span>Осталось</span>
          <span className="v">{t.failed ? 'ждёт решения' : speed > 0 ? days((t.flopTotal - t.flopDone) / speed) : 'нет мощности'}</span>
        </div>
        <ProgressBar value={t.flopDone / t.flopTotal} />
      </div>,
    );
  }
  const cur = s.research.current;
  if (cur) {
    const cost = techCost(s, cur);
    const pts = s.research.points[cur];
    const name = TECHS.find((x) => x.id === cur)?.name ?? cur;
    items.push(
      <div className="side-item t-research" key="research" onClick={() => open('research')} style={{ cursor: 'pointer' }}>
        <div className="t">Исследование: {name}</div>
        <div className="r">
          <span>Осталось</span>
          <span className="v">{days(researchDaysLeft(s, cur, rpPerDay(s)))}</span>
        </div>
        <ProgressBar value={pts / cost} />
      </div>,
    );
  }
  const perContract = s.contracts.length ? pool(s, 'contracts') / s.contracts.length : 0;
  for (const c of s.contracts) {
    const client = CLIENTS.find((x) => x.id === c.tender.clientId)?.name ?? 'Клиент';
    items.push(
      <div className="side-item t-contract" key={c.id} onClick={() => open('contracts')} style={{ cursor: 'pointer' }}>
        <div className="t">Контракт: {client}</div>
        <div className="r">
          <span>{benchDef(c.tender.benchmark).name}</span>
          <span className="v">{fmtMoney(c.tender.payment)}</span>
        </div>
        <div className="r">
          <span>До срока</span>
          <span className="v">{days(c.deadlineDay - s.day)}</span>
        </div>
        <div className="r">
          <span>Работа</span>
          <span className="v">{perContract > 0 ? days((c.tender.work - c.workDone) / perContract) : 'нет мощности'}</span>
        </div>
        <ProgressBar value={c.workDone / c.tender.work} />
      </div>,
    );
  }
  const waiting = s.tenders.filter((x) => x.application);
  if (waiting.length) {
    items.push(
      <div className="side-item t-contract" key="apps" onClick={() => open('contracts')} style={{ cursor: 'pointer' }}>
        <div className="t">Заявки на рассмотрении: {waiting.length}</div>
        {waiting.slice(0, 4).map((x) => (
          <div className="r" key={x.id}>
            <span>{CLIENTS.find((c) => c.id === x.clientId)?.name ?? 'Клиент'}</span>
            <span className="v">{days((x.application?.resolveDay ?? s.day) - s.day)}</span>
          </div>
        ))}
      </div>,
    );
  }
  return items.length ? <>{items}</> : <div className="side-empty">Проектов нет.</div>;
}

// Цвета на тёмной панели: доходы - зелёный, подписки - бирюзовый, предупреждения - оранжевый.
const SIDE_GOOD = 'var(--good-on-dark)';
const SIDE_SUBS = 'var(--hud-text)';
const SIDE_WARN = 'var(--warn-on-hud)';
const SIDE_INFO = 'var(--hud-text-2)';

function Models({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const onSale = s.models.filter((m) => m.releasedDay !== null && (m.onApi || m.onSubs));
  if (!onSale.length) return <div className="side-empty">Моделей в продаже нет.</div>;
  const subsAvailable = subsOpen(s.day);
  return (
    <>
      {onSale.map((m) => {
        // Доля в s.market уже после ограничения мощностью (market.ts servedShares), отдельно на served не умножаем.
        const share = s.market.shares[`player:${m.id}`] ?? 0;
        const sales = playerSales(s, m.id);
        const onSubs = m.onSubs && subsAvailable;
        const revenue = sales.apiRevenueDay + sales.subsRevenueDay;
        const note = reviewNote(m);
        return (
          <div className="side-item t-model" key={m.id} onClick={() => open('models')} style={{ cursor: 'pointer' }}>
            <div className="t side-model-t">
              <ModelEmblem m={m} size={26} exposed={m.exposed} />
              {m.name}
            </div>
            <div className="r">
              <span>Доля рынка</span>
              <span className="v">{fmtShare(share, 1)}</span>
            </div>
            {m.onApi && (
              <div className="r">
                <span>Токенов в день</span>
                <span className="v">{fmtNum(sales.apiTokens)}</span>
              </div>
            )}
            {onSubs && (
              <div className="r">
                <span>Подписчиков</span>
                <span className="v" style={{ color: SIDE_SUBS }}>
                  {fmtNum(Math.round(sales.subsUsers))}
                </span>
              </div>
            )}
            <div className="r" title={`API ${fmtMoney(sales.apiRevenueDay)}, подписки ${fmtMoney(sales.subsRevenueDay)}`}>
              <span>Выручка в день</span>
              <span className="v" style={revenue > 0 ? { color: SIDE_GOOD } : undefined}>
                {fmtMoney(revenue)}
              </span>
            </div>
            {m.onApi && (
              <div className="r">
                <span>Цена за 1 млн</span>
                <span className="v">{fmtPrice(m.price)}</span>
              </div>
            )}
            {onSubs && (
              <div className="r">
                <span>Цена подписки</span>
                <span className="v">{fmtPrice(m.subsPrice)} в месяц</span>
              </div>
            )}
            {note && (
              <div className="r" style={{ color: note.tone === 'warn' ? SIDE_WARN : SIDE_INFO, fontWeight: 'var(--fw-strong)' }}>
                <span>{note.text}</span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Гонка: крупное место, ближайший соперник с разрывом и месяцы на 1-м месте (на «Арене»). */
function Goal({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const race = standingOf(s);
  const months = Number.isFinite(s.monthsFirst) ? s.monthsFirst : 0;
  const showSubs = subsOpen(s.day) || s.market.playerSubs > 0;
  const first = race?.rank === 1;
  const near = race ? (first ? race.below : race.above) : null;
  return (
    <div className={`side-race${first ? ' first' : ''}`} title={ARENA_PLACE_TITLE} onClick={() => open('analytics')}>
      {race && <span className="sr-place">{race.rank}-е</span>}
      <span className="sr-txt">
        <span className="sr-k">{race ? `Место: ${raceName(race.metric)}` : 'Гонка'}</span>
        <span className="sr-v">
          {race
            ? near
              ? `${first ? 'Отрыв от' : 'До'} ${near.name}: ${fmtGap(race.metric, near.gap)}${race.metric.kind === 'arena' ? '\u00a0Эло' : '\u00a0балла'}`
              : first
                ? 'Соперников ниже нет'
                : 'Выше никого'
            : s.models.some((m) => m.releasedDay !== null)
              ? 'Соперников пока нет'
              : 'Выпустите первую модель'}
        </span>
        {race?.metric.kind === 'arena' && <span className="sr-m">На 1-м месте: {fmtNum(months)} мес.</span>}
        {showSubs && (
          <span className="sr-m" title="Пользователи подписки, обслуженные вчера">
            Подписчиков: <b style={{ color: SIDE_SUBS }}>{fmtNum(Math.round(finite(s.market.playerSubs)))}</b>
          </span>
        )}
      </span>
    </div>
  );
}

/** Главный соперник в сводке: эмблема, имя и счёт обгонов; щелчок открывает досье. */
function MainRival({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const lab = mainRival(s);
  if (!lab) return null;
  const d = duelOf(s, lab);
  const name = LABS.find((l) => l.id === lab)?.name ?? lab;
  return (
    <div
      className="side-rival"
      role="button"
      tabIndex={0}
      title={`Главный соперник: ${name}. Вы обгоняли их ${timesCount(d.youPassed)}, они вас - ${timesCount(d.passedYou)}. Щелчок открывает досье`}
      onClick={(e) => {
        e.stopPropagation();
        openDossier(lab, open);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          openDossier(lab, open);
        }
      }}
    >
      Главный соперник:
      <LabEmblem lab={lab} size={14} decorative />
      <b>{name}</b>
      <span className="sr-score">
        {d.youPassed}:{d.passedYou}
      </span>
    </div>
  );
}

/** Простой мощности: оранжевые строки с кнопкой, которая ведёт туда, где это исправить. */
function Idle({ items, open }: { items: IdleItem[]; open: (id: WindowId | WindowAlias) => void }) {
  if (items.length === 0) return null;
  // Одна компактная строка: главная причина и кнопка. Остальные причины видны в «Мощностях».
  const first = items[0];
  const rest = items.length - 1;
  const total = items.reduce((a, i) => a + i.h100e, 0);
  return (
    <div className="side-idle" role="alert">
      <span
        className="txt"
        title={[`Простаивает ${fmtH100e(total)} H100e`].concat(items.map((i) => `${fmtH100e(i.h100e)} H100e: ${i.reason}`)).concat('Мощность оплачивается, но не работает').join(String.fromCharCode(10))}
      >
        <b>Простой:</b> {first.reason}
        {rest > 0 ? ` (+${rest})` : ''}
      </span>
      <button type="button" className="btn small" onClick={() => open(rest > 0 && first.fix === 'compute' ? 'compute' : first.fix)}>
        {first.fixLabel}
      </button>
    </div>
  );
}

/** Тендер закрывается: показываем, когда осталось столько дней или меньше (0 - последний день). */
export const TENDER_SOON_DAYS = 2;

interface SideAlert {
  key: string;
  label: string;
  text: string;
  title?: string;
  action: string;
  open: WindowId | WindowAlias;
}

/** Что ждёт игрока прямо сейчас: контракт не успевает, тендер закрывается, модель готова и не выпущена. */
export function sideAlerts(s: GameState): SideAlert[] {
  const out: SideAlert[] = [];
  const client = (id: string) => CLIENTS.find((c) => c.id === id)?.name ?? id;
  for (const l of lateContracts(s)) {
    out.push({
      key: `late:${l.contract.id}`,
      label: 'Контракт не успевает',
      // Сколько не хватает, а не «нужно 1,75, есть 1,75»: при округлении до сотых разница пропадала (плейтест 18.10).
      text: `${client(l.contract.tender.clientId)}: не хватает ${fmtH100e(l.need - l.have)} из ${fmtH100e(l.need)} H100e`,
      title: `До срока ${l.left} дн. Поднимите долю «Контракты» или арендуйте карты, иначе штраф ${fmtMoney(l.contract.tender.penalty)}`,
      action: 'Мощности',
      open: 'compute',
    });
  }
  for (const m of s.models) {
    if (m.releasedDay !== null) continue;
    out.push({ key: `ready:${m.id}`, label: 'Модель готова', text: `«${m.name}» ждёт выпуска`, action: 'Выпустить', open: 'models' });
  }
  const released = s.models.filter((m) => m.releasedDay !== null);
  for (const t of s.tenders) {
    const left = t.expiresDay - s.day;
    if (t.application !== null || left > TENDER_SOON_DAYS) continue;
    if (!released.some((m) => canApply(s, t, m) === null)) continue;
    out.push({
      key: `tender:${t.id}`,
      label: 'Тендер закрывается',
      text: `${client(t.clientId)}, ${left <= 0 ? 'последний день' : `через ${left} дн.`}`,
      action: 'Подать',
      open: 'contracts',
    });
  }
  return out;
}

/** Тревоги в сводке: белые карточки как «Простой», красное только слово-причина, кнопка ведёт туда, где это исправить. */
function Alerts({ items, open }: { items: SideAlert[]; open: (id: WindowId | WindowAlias) => void }) {
  if (items.length === 0) return null;
  return (
    <>
      {items.slice(0, 3).map((a) => (
        <div key={a.key} className="side-idle" role="alert">
          <span className="txt" title={a.title}>
            <b>{a.label}:</b> {a.text}
          </span>
          <button type="button" className="btn small" onClick={() => open(a.open)}>
            {a.action}
          </button>
        </div>
      ))}
    </>
  );
}

export function SidePanel({
  s,
  open,
  top,
  vp,
  sheetOpen,
  onSheetClose,
}: {
  s: GameState;
  open: (id: WindowId | WindowAlias) => void;
  top?: ReactNode;
  vp: Viewport;
  sheetOpen: boolean;
  onSheetClose: () => void;
}) {
  const [shownState, setShown] = useState(vp === 'desktop'); // на планшете панель по умолчанию свёрнута
  const pinned = !!top; // пока идёт обучение, панель закреплена: подсказка помощника должна оставаться на виду
  const shown = shownState || pinned;
  const [tab, setTab] = useState<Tab>('projects');
  const projects =
    openChoices(s).filter((m) => m.deferred).length + s.trainings.length + (s.research.current ? 1 : 0) + s.contracts.length;
  const onSale = s.models.filter((m) => m.releasedDay !== null && (m.onApi || m.onSubs)).length;
  const tabLabel = shown ? 'Скрыть панель' : 'Показать панель';
  const content = (
    <>
      {top}
      <div className="side-head">
        <span>Сводка</span>
      </div>
      <Goal s={s} open={open} />
      <MainRival s={s} open={open} />
      <Alerts items={sideAlerts(s)} open={open} />
      <Idle items={idleWarnings(s)} open={open} />
      <GoalsPanel s={s} open={open} />
      <div className="side-tabs">
        <button className={tab === 'projects' ? 'on' : undefined} onClick={() => setTab('projects')}>
          Проекты: {projects}
        </button>
        <button className={tab === 'models' ? 'on' : undefined} onClick={() => setTab('models')}>
          Модели: {onSale}
        </button>
      </div>
      <div className="side-list">{tab === 'projects' ? <Projects s={s} open={open} /> : <Models s={s} open={open} />}</div>
    </>
  );
  if (vp === 'phone') {
    if (!sheetOpen) return null;
    return (
      <>
        <div className="side-scrim" onPointerDown={onSheetClose} />
        <aside className="side sheet" aria-label="Сводка">
          <button className="side-grab" onClick={onSheetClose} aria-label="Скрыть сводку">
            <span />
          </button>
          <div className="side-body">{content}</div>
        </aside>
      </>
    );
  }
  return (
    <aside className={`side${top ? ' with-top' : ''}`} aria-label="Боковая панель">
      <button
        className="side-tab"
        onClick={() => setShown((v) => !v)}
        disabled={pinned}
        aria-label={tabLabel}
        title={pinned ? 'Панель закреплена на время обучения' : tabLabel}
      >
        {shown ? <IconChevronRight /> : <IconChevronLeft />}
      </button>
      {shown && <div className="side-body">{content}</div>}
    </aside>
  );
}
