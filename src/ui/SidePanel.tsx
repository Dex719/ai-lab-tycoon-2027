// Боковая панель справа (как «Боковое окно» в Processor Tycoon): текущие проекты и модели в продаже.

import { useState, type ReactElement, type ReactNode } from 'react';
import { pool } from '../sim/compute';
import { TRAIN_FLOP_PER_H100E_DAY } from '../sim/constants';
import { rpPerDay, TECHS, techCost } from '../sim/research';
import { CLIENTS } from '../data/clients';
import { benchDef } from '../sim/benchmarks';
import { awaitingEvent, openChoices } from '../sim/events';
import { formatDateShort } from '../sim/time';
import type { GameState } from '../sim/types';
import { ProgressBar } from './components/common';
import { fmtMoney, fmtNum, fmtPrice, fmtShare } from './format';
import { IconChevronLeft, IconChevronRight } from './icons';
import type { WindowAlias, WindowId } from './windows';

type Tab = 'projects' | 'models';

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
  const t = s.training;
  if (t) {
    const speed = pool(s, 'training') * TRAIN_FLOP_PER_H100E_DAY;
    items.push(
      <div className="side-item" key="train" onClick={() => open('newModel')} style={{ cursor: 'pointer' }}>
        <div className="t">Обучение: {t.plan.name}</div>
        <div className="r">
          <span>Готово</span>
          <span className="v">{fmtShare(t.flopDone / t.flopTotal, 0)}</span>
        </div>
        <div className="r">
          <span>Осталось</span>
          <span className="v">
            {awaitingEvent(s, 'training-fail') ? 'ждёт решения' : speed > 0 ? days((t.flopTotal - t.flopDone) / speed) : 'нет мощности'}
          </span>
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

function Models({ s, open }: { s: GameState; open: (id: WindowId | WindowAlias) => void }) {
  const onSale = s.models.filter((m) => m.releasedDay !== null && m.onApi);
  if (!onSale.length) return <div className="side-empty">Моделей в продаже нет.</div>;
  const served = 1 - s.market.lostFraction;
  return (
    <>
      {onSale.map((m) => {
        const share = s.market.shares[`player:${m.id}`] ?? 0;
        const tokens = share * s.market.totalTokens * served;
        return (
          <div className="side-item" key={m.id} onClick={() => open('models')} style={{ cursor: 'pointer' }}>
            <div className="t">{m.name}</div>
            <div className="r">
              <span>Доля рынка</span>
              <span className="v">{fmtShare(share, 1)}</span>
            </div>
            <div className="r">
              <span>Токенов в день</span>
              <span className="v">{fmtNum(tokens)}</span>
            </div>
            <div className="r">
              <span>Выручка в день</span>
              <span className="v">{fmtMoney((tokens * m.price) / 1e6)}</span>
            </div>
            <div className="r">
              <span>Цена за 1 млн</span>
              <span className="v">{fmtPrice(m.price)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function SidePanel({ s, open, top }: { s: GameState; open: (id: WindowId | WindowAlias) => void; top?: ReactNode }) {
  const [shownState, setShown] = useState(true);
  const shown = shownState || !!top; // пока идёт обучение, панель не сворачивается
  const [tab, setTab] = useState<Tab>('projects');
  const projects =
    openChoices(s).filter((m) => m.deferred).length + (s.training ? 1 : 0) + (s.research.current ? 1 : 0) + s.contracts.length;
  const onSale = s.models.filter((m) => m.releasedDay !== null && m.onApi).length;
  return (
    <aside className={`side${top ? ' with-top' : ''}`} aria-label="Боковая панель">
      <button className="side-tab" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Скрыть панель' : 'Показать панель'}>
        {shown ? <IconChevronRight /> : <IconChevronLeft />}
      </button>
      {shown && (
        <div className="side-body">
          {top}
          <div className="side-head">Сводка</div>
          <div className="side-tabs">
            <button className={tab === 'projects' ? 'on' : undefined} onClick={() => setTab('projects')}>
              Проекты: {projects}
            </button>
            <button className={tab === 'models' ? 'on' : undefined} onClick={() => setTab('models')}>
              Модели: {onSale}
            </button>
          </div>
          <div className="side-list">{tab === 'projects' ? <Projects s={s} open={open} /> : <Models s={s} open={open} />}</div>
        </div>
      )}
    </aside>
  );
}
