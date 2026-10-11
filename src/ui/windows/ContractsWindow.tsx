// Окно «Контракты» (FR-9): тендеры, на которые можно подать заявку, и контракты в работе.

import { useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { CLIENTS } from '../../data/clients';
import { benchDef } from '../../sim/benchmarks';
import { pool } from '../../sim/compute';
import { REP_CONTRACT_FAIL, TENDER_APPLY_DAYS } from '../../sim/constants';
import { applyChance, canApply } from '../../sim/contracts';
import { modelScore } from '../../sim/training';
import type { Contract, GameState, PlayerModel, Tender } from '../../sim/types';
import { Empty, ErrorText, ProgressBar, Tabs } from '../components/common';
import { fmtMoney, fmtNum, fmtPct, fmtShare } from '../format';
import { actions, store } from '../store';

type Tab = 'tenders' | 'contracts';
type OpenFn = WindowProps['open'];

const FACTS_GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '6px 12px' } as const;

function clientName(id: string): string {
  return CLIENTS.find((c) => c.id === id)?.name ?? 'Клиент';
}

function typeLabel(t: Tender): string {
  return t.type === 'rlhf' ? 'RLHF' : 'Дообучение';
}

function TypeBadge({ t }: { t: Tender }) {
  return (
    <span className="badge" style={{ background: t.type === 'rlhf' ? 'var(--accent-2)' : 'var(--border-light)' }}>
      {typeLabel(t)}
    </span>
  );
}

function Fact({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div>
      <div className="muted small">{label}</div>
      <div className={`num${tone ? ` ${tone}` : ''}`} style={{ textAlign: 'left' }}>
        {value}
      </div>
    </div>
  );
}

/** Лучшая модель для заявки: сначала те, что проходят требования, среди них — с наибольшим показанным баллом. */
function bestCandidate(s: GameState, t: Tender, released: PlayerModel[]): PlayerModel {
  let best = released[0];
  let bestKey = -Infinity;
  for (const m of released) {
    const key = (canApply(s, t, m) === null ? 1000 : 0) + modelScore(m, t.benchmark, false);
    if (key > bestKey) {
      best = m;
      bestKey = key;
    }
  }
  return best;
}

// ---------- Тендеры ----------

function ApplyForm({ s, t, released }: { s: GameState; t: Tender; released: PlayerModel[] }) {
  const [pick, setPick] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const model = released.find((m) => m.id === pick) ?? bestCandidate(s, t, released);
  const shown = modelScore(model, t.benchmark, false);
  const reason = canApply(s, t, model);
  const chance = reason === null ? applyChance(s, t, model) : null;

  function apply() {
    const r = store.dispatch(actions.applyTender, t.id, model.id);
    setErr(r.ok ? null : r.error);
  }

  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row">
        <select value={model.id} onChange={(e) => setPick(e.target.value)} aria-label="Модель для заявки">
          {released.map((m) => (
            <option key={m.id} value={m.id}>
              {`${m.name} — ${fmtPct(modelScore(m, t.benchmark, false))}`}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={reason !== null} title={reason ?? undefined} onClick={apply}>
          Подать заявку
        </button>
      </div>
      <div className="small">
        <span className="muted">Показанный балл: </span>
        <span className={`num ${shown >= t.requirement ? 'good' : 'bad'}`}>{fmtPct(shown)}</span>
        <span className="muted"> при требовании {fmtPct(t.requirement, 0)}</span>
        {chance !== null && (
          <>
            <span className="muted"> · шанс победы </span>
            <span className="num">≈ {fmtPct(chance * 100, 0)}</span>
          </>
        )}
      </div>
      {reason !== null && <div className="small warn">{reason}</div>}
      <ErrorText error={err} />
    </div>
  );
}

function TenderCard({ s, t, released }: { s: GameState; t: Tender; released: PlayerModel[] }) {
  const bench = benchDef(t.benchmark);
  const app = t.application;
  const left = Math.max(0, t.expiresDay - s.day);

  let footer: ReactNode;
  if (app) {
    const m = s.models.find((x) => x.id === app.modelId);
    const days = Math.max(0, app.resolveDay - s.day);
    footer = (
      <div className="good">
        Заявка подана моделью {m?.name ?? '—'}, решение через {days} дн., шанс ≈ {fmtPct(app.chance * 100, 0)}
      </div>
    );
  } else if (released.length === 0) {
    footer = <div className="muted small">Чтобы подать заявку, нужна выпущенная модель.</div>;
  } else {
    footer = <ApplyForm s={s} t={t} released={released} />;
  }

  return (
    <div className="card col" style={{ gap: 6 }}>
      <div className="row">
        <b className="grow">{clientName(t.clientId)}</b>
        <TypeBadge t={t} />
      </div>
      <div style={FACTS_GRID}>
        <Fact label="Бенчмарк" value={bench.name} />
        <Fact label="Требование" value={`не ниже ${fmtPct(t.requirement, 0)}`} />
        <Fact label="Объём работы" value={`${fmtNum(t.work)} H100e-дн.`} />
        <Fact label="Срок выполнения" value={`${t.durationDays} дн.`} />
        <Fact label="Оплата" value={fmtMoney(t.payment)} />
        <Fact label="Штраф при провале" value={fmtMoney(t.penalty)} />
        {!app && <Fact label="Тендер" value={`исчезнет через ${left} дн.`} tone={left <= 5 ? 'warn' : undefined} />}
      </div>
      {footer}
    </div>
  );
}

function TendersTab({ s, open }: { s: GameState; open: OpenFn }) {
  const released = s.models.filter((m) => m.releasedDay !== null);
  const tenders = [...s.tenders].sort((a, b) => {
    const ka = a.application ? a.application.resolveDay : 1e9 + a.expiresDay;
    const kb = b.application ? b.application.resolveDay : 1e9 + b.expiresDay;
    return ka - kb;
  });

  return (
    <div className="col">
      {released.length === 0 && (
        <Empty>
          У вас пока нет выпущенных моделей, поэтому подать заявку нечем.{' '}
          <button className="btn small" onClick={() => open('models')}>
            Открыть «Модели»
          </button>
        </Empty>
      )}
      {tenders.length === 0 ? (
        <Empty>Сейчас тендеров нет. Новые появляются в начале каждого месяца.</Empty>
      ) : (
        tenders.map((t) => <TenderCard key={t.id} s={s} t={t} released={released} />)
      )}
    </div>
  );
}

// ---------- Мои контракты ----------

function ContractCard({ s, c, open }: { s: GameState; c: Contract; open: OpenFn }) {
  const [err, setErr] = useState<string | null>(null);
  const t = c.tender;
  const bench = benchDef(t.benchmark);
  const model = s.models.find((m) => m.id === c.modelId);
  const honest = model ? modelScore(model, t.benchmark, true) : null;
  const weak = honest !== null && honest < t.requirement;

  const left = Math.max(0, c.deadlineDay - s.day);
  const share = pool(s, 'contracts') / Math.max(1, s.contracts.length);
  const remaining = Math.max(0, t.work - c.workDone);
  const eta = share > 0 ? Math.ceil(remaining / share) : null;
  const progress = t.work > 0 ? c.workDone / t.work : 0;

  function cancel() {
    const ok = window.confirm(
      `Отказаться от контракта с ${clientName(t.clientId)}?\n` +
        `Вы заплатите штраф ${fmtMoney(t.penalty)} и потеряете ${Math.abs(REP_CONTRACT_FAIL)} репутации.`,
    );
    if (!ok) return;
    const r = store.dispatch(actions.cancelContract, c.id);
    if (!r.ok) setErr(r.error);
  }

  let pace: ReactNode;
  if (eta === null) {
    pace = (
      <div className="small bad">
        ⚠ На контракты сейчас не выделена мощность — работа не идёт, срок будет сорван и придётся платить штраф.{' '}
        <button className="btn small" onClick={() => open('compute')}>
          Открыть «Мощности»
        </button>
      </div>
    );
  } else if (eta > left) {
    pace = (
      <div className="small bad">
        ⚠ При текущей мощности до конца работы ещё ≈ {eta} дн., а до срока осталось {left} дн. — будет просрочка и штраф.
        Увеличьте долю «Контракты» в окне «Мощности».
      </div>
    );
  } else {
    pace = <div className="small muted">При текущей мощности работа закончится примерно через {eta} дн.</div>;
  }

  return (
    <div className="card col" style={{ gap: 6 }}>
      <div className="row">
        <b className="grow">{clientName(t.clientId)}</b>
        <TypeBadge t={t} />
      </div>
      <div style={FACTS_GRID}>
        <Fact label="Бенчмарк" value={bench.name} />
        <Fact label="Требование" value={`не ниже ${fmtPct(t.requirement, 0)}`} />
        <Fact label="Модель" value={model?.name ?? '—'} />
        <Fact label="До срока" value={`осталось ${left} дн.`} tone={left <= 10 ? 'warn' : undefined} />
        <Fact label="Оплата после сдачи" value={fmtMoney(t.payment)} />
        <Fact label="Штраф при провале" value={fmtMoney(t.penalty)} />
      </div>
      <div>
        <ProgressBar value={progress} title={`${fmtPct(progress * 100, 0)} выполнено`} />
        <div className="muted small">
          Сделано {fmtNum(c.workDone)} из {fmtNum(t.work)} H100e-дн. ({fmtPct(progress * 100, 0)})
        </div>
      </div>
      {pace}
      {honest !== null &&
        (weak ? (
          <div className="small bad">
            ⚠ настоящий балл модели {fmtPct(honest)} — ниже требования: при сдаче будет штраф
          </div>
        ) : (
          <div className="small muted">
            Настоящий балл модели {fmtPct(honest)} — требование выполняется.
          </div>
        ))}
      <div className="row">
        <button className="btn danger small" onClick={cancel} title="Контракт будет расторгнут, штраф спишется сразу">
          Отказаться (штраф {fmtMoney(t.penalty)})
        </button>
        <ErrorText error={err} />
      </div>
    </div>
  );
}

function ContractsTab({ s, open }: { s: GameState; open: OpenFn }) {
  if (s.contracts.length === 0) {
    return <Empty>Активных контрактов нет. Выиграйте тендер на вкладке «Тендеры», и работа появится здесь.</Empty>;
  }
  return (
    <div className="col">
      {s.contracts.map((c) => (
        <ContractCard key={c.id} s={s} c={c} open={open} />
      ))}
    </div>
  );
}

// ---------- Окно ----------

export default function ContractsWindow({ s, open }: WindowProps) {
  const [tab, setTab] = useState<Tab>('tenders');
  const contractsPool = pool(s, 'contracts');

  return (
    <div className="col">
      <div className="muted small">
        Заказчики хотят модель с баллом не ниже требования. Заявку решают через {TENDER_APPLY_DAYS} дн. после подачи. Работа идёт
        за счёт доли «Контракты» в окне «Мощности» (H100e-день — сутки работы одной видеокарты H100). При сдаче проверяют
        НАСТОЯЩИЙ балл модели, без подгонки под тесты, поэтому подгонка здесь опасна: показанный в рейтингах балл не спасёт от
        штрафа.
        <br />
        Сейчас на контракты выделено {fmtNum(contractsPool)} H100e в день ({fmtShare(s.compute.alloc.contracts, 0)} мощности).
      </div>
      <Tabs<Tab>
        tabs={[
          { id: 'tenders', label: `Тендеры (${s.tenders.length})` },
          { id: 'contracts', label: `Мои контракты (${s.contracts.length})` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'tenders' ? <TendersTab s={s} open={open} /> : <ContractsTab s={s} open={open} />}
    </div>
  );
}
