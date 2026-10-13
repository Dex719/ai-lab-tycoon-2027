// Боковая панель справа (как «Боковое окно» в Processor Tycoon): текущие проекты и модели в продаже.

import { useState, type ReactElement, type ReactNode } from 'react';
import { pool } from '../sim/compute';
import { idleCompute, type IdleItem } from '../sim/idle';
import { TRAIN_FLOP_PER_H100E_DAY } from '../sim/constants';
import { playerSales, subsOpen } from '../sim/market';
import { rpPerDay, TECHS, techCost } from '../sim/research';
import { CLIENTS } from '../data/clients';
import { benchDef } from '../sim/benchmarks';
import { openChoices } from '../sim/events';
import { ARENA_PLACE_TITLE, bestArenaPlace } from './arena';
import { formatDateShort } from '../sim/time';
import { trainingPoolPerRun } from '../sim/training';
import type { GameState } from '../sim/types';
import { ProgressBar } from './components/common';
import { fmtH100e, fmtMoney, fmtNum, fmtPrice, fmtShare } from './format';
import { IconChevronLeft, IconChevronRight } from './icons';
import { fmtRank, reviewNote } from './labels';
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
      <div className="side-item decision" key={m.id} onClick={() => open('mail')} style={{ cursor: 'pointer' }}>
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
      <div className="side-item" key={t.id} onClick={() => open('newModel')} style={{ cursor: 'pointer' }}>
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
      <div className="side-item" key="research" onClick={() => open('research')} style={{ cursor: 'pointer' }}>
        <div className="t">Исследование: {name}</div>
        <div className="r">
          <span>Осталось</span>
          <span className="v">{days(Math.max(0, cost - pts) / rpPerDay(s))}</span>
        </div>
        <ProgressBar value={pts / cost} />
      </div>,
    );
  }
  const perContract = s.contracts.length ? pool(s, 'contracts') / s.contracts.length : 0;
  for (const c of s.contracts) {
    const client = CLIENTS.find((x) => x.id === c.tender.clientId)?.name ?? 'Клиент';
    items.push(
      <div className="side-item" key={c.id} onClick={() => open('contracts')} style={{ cursor: 'pointer' }}>
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
      <div className="side-item" key="apps" onClick={() => open('contracts')} style={{ cursor: 'pointer' }}>
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
const SIDE_SUBS = '#4fd6cb';
const SIDE_WARN = '#f2b84b';
const SIDE_INFO = '#8ec5ff';

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
          <div className="side-item" key={m.id} onClick={() => open('models')} style={{ cursor: 'pointer' }}>
            <div className="t">{m.name}</div>
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
              <div className="r" style={{ color: note.tone === 'warn' ? SIDE_WARN : SIDE_INFO, fontWeight: 600 }}>
                <span>{note.text}</span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Строка цели: место среди моделей в продаже и сколько закрытых месяцев лаборатория была первой. */
function Goal({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const rank = bestArenaPlace(s);
  const months = Number.isFinite(s.monthsFirst) ? s.monthsFirst : 0;
  const showSubs = subsOpen(s.day) || s.market.playerSubs > 0;
  return (
    <div
      className="side-item"
      style={{ padding: '0 12px 8px', border: 'none', cursor: 'pointer' }}
      title={ARENA_PLACE_TITLE}
      onClick={() => open('analytics')}
    >
      <div className="r">
        <span>«Арена»: {rank !== null ? fmtRank(rank) : 'нет моделей'}</span>
        <span className="v">На 1-м: {fmtNum(months)} мес.</span>
      </div>
      {showSubs && (
        <div className="r" title="Пользователи подписки, обслуженные вчера">
          <span>Подписчиков</span>
          <span className="v" style={{ color: SIDE_SUBS }}>
            {fmtNum(Math.round(finite(s.market.playerSubs)))}
          </span>
        </div>
      )}
    </div>
  );
}

/** Простой мощности: оранжевые строки с кнопкой, которая ведёт туда, где это исправить. */
function Idle({ items, open }: { items: IdleItem[]; open: (id: WindowId | WindowAlias) => void }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 2);
  const rest = items.length - shown.length;
  return (
    <div className="side-idle" role="alert">
      {shown.map((i) => (
        <div className="row" key={i.kind}>
          <span>
            Простаивает <b className="num">{fmtH100e(i.h100e)} H100e</b>: {i.reason}
          </span>
          <button type="button" className="btn small" title="Мощность оплачивается, но не работает" onClick={() => open(i.fix)}>
            {i.fixLabel}
          </button>
        </div>
      ))}
      {rest > 0 && (
        <button type="button" className="side-idle-more" onClick={() => open('compute')}>
          Ещё {rest}: открыть «Мощности»
        </button>
      )}
    </div>
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
      <div className="side-head">Сводка</div>
      <Goal s={s} open={open} />
      <Idle items={idleCompute(s)} open={open} />
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
