// Окно «Контракты» (FR-9): вкладки «Тендеры» и «Мои контракты»; слева список, справа карточка выбранного.

import { useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { CLIENTS } from '../../data/clients';
import { benchDef } from '../../sim/benchmarks';
import { cheapestH100eDay, pool } from '../../sim/compute';
import { REP_CONTRACT_FAIL, RLHF_TENDER_LABELERS, TENDER_APPLY_DAYS } from '../../sim/constants';
import { applyChance, canApply } from '../../sim/contracts';
import { modelScore } from '../../sim/training';
import type { Contract, GameState, PlayerModel, Tender } from '../../sim/types';
import { Alert, ConfirmDialog, ErrorText, ProgressBar } from '../components/common';
import { endSentence, fmtMoney, fmtNum, fmtPct, fmtShare } from '../format';
import { IconAlert, IconCheck } from '../icons';
import { actions, store } from '../store';
import './ContractsWindow.css';

type View = 'tenders' | 'contracts';
type TypeFilter = 'all' | Tender['type'];
type OpenFn = WindowProps['open'];

const REP_LOSS = `−${Math.abs(REP_CONTRACT_FAIL)}`;
const AUTO_APPLY_HINT = 'В начале месяца на каждый новый тендер подаётся заявка лучшей подходящей моделью';

// ---------- Общие помощники ----------

function clientName(id: string): string {
  return CLIENTS.find((c) => c.id === id)?.name ?? 'Клиент';
}

function clientIndustry(id: string): string {
  const industry = CLIENTS.find((c) => c.id === id)?.industry ?? '';
  return industry.charAt(0).toUpperCase() + industry.slice(1);
}

function typeLabel(t: Tender): string {
  return t.type === 'rlhf' ? 'RLHF' : 'Дообучение';
}

function days(n: number): string {
  return `${fmtNum(n)} дн.`;
}

/** Объём работы: «20 H100e-дн.», «12,5 тыс. H100e-дн.» */
function workDays(n: number): string {
  return `${fmtNum(n)} H100e-дн.`;
}

/** Мощность: «0,33 H100e в день», «1,2 тыс. H100e в день» */
function perDay(n: number): string {
  return `${fmtNum(n)} H100e в день`;
}

/** Две буквы: первые буквы первых двух слов названия («Банк «Северный»» → «БС»). */
function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase() || '?';
}

/** Приглушённый цвет плитки, один и тот же для одного клиента. */
function tileColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 24% 40%)`;
}

function Monogram({ clientId, size }: { clientId: string; size: number }) {
  return (
    <div
      className="ct-mono"
      style={{ width: size, height: size, background: tileColor(clientId), fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {initials(clientName(clientId))}
    </div>
  );
}

/** Показанный балл проходит, а честный (без подгонки) ниже требования: на сдаче контракт будет провален. */
function isTrap(m: PlayerModel, t: Tender): boolean {
  return modelScore(m, t.benchmark, false) >= t.requirement && modelScore(m, t.benchmark, true) < t.requirement;
}

/** Модель по умолчанию: проходит требования, затем с честным баллом выше требования, затем с наибольшим баллом. */
function bestCandidate(s: GameState, t: Tender, released: PlayerModel[]): PlayerModel {
  let best = released[0];
  let bestKey = -Infinity;
  for (const m of released) {
    const key =
      (canApply(s, t, m) === null ? 1000 : 0) +
      (modelScore(m, t.benchmark, true) >= t.requirement ? 500 : 0) +
      modelScore(m, t.benchmark, false);
    if (key > bestKey) {
      best = m;
      bestKey = key;
    }
  }
  return best;
}

function optionLabel(s: GameState, t: Tender, m: PlayerModel): string {
  const score = fmtPct(modelScore(m, t.benchmark, false));
  const note = canApply(s, t, m) !== null ? ' · не подходит' : isTrap(m, t) ? ' · честный балл ниже' : '';
  return `${m.name} · ${score}${note}`;
}

function toneOf(ok: boolean | null): string {
  return ok === null ? '' : ok ? ' good' : ' bad';
}

// ---------- Контракт в работе: расчёт ----------

interface ContractInfo {
  model: PlayerModel | undefined;
  honest: number | null;
  left: number; // дней до срока
  share: number; // H100e в день на этот контракт
  remaining: number; // H100e-дней работы
  eta: number | null; // дней до конца работы; null - работа не идёт
  progress: number; // 0..1
  stalled: boolean; // мощность на контракты не выделена
  late: boolean; // работа не успевает до срока
  weak: boolean; // честный балл ниже требования
}

function contractInfo(s: GameState, c: Contract): ContractInfo {
  const t = c.tender;
  const model = s.models.find((m) => m.id === c.modelId);
  const honest = model ? modelScore(model, t.benchmark, true) : null;
  const left = Math.max(0, c.deadlineDay - s.day);
  const share = pool(s, 'contracts') / Math.max(1, s.contracts.length);
  const remaining = Math.max(0, t.work - c.workDone);
  const eta = share > 0 ? Math.ceil(remaining / share) : null;
  return {
    model,
    honest,
    left,
    share,
    remaining,
    eta,
    progress: t.work > 0 ? Math.min(1, c.workDone / t.work) : 0,
    stalled: eta === null,
    late: eta !== null && eta > left,
    weak: honest !== null && honest < t.requirement,
  };
}

function riskOf(info: ContractInfo): string | null {
  if (info.stalled) return 'Мощность для контрактов не выделена';
  if (info.late) return 'Работа не успевает до срока';
  if (info.weak) return 'Честный балл модели ниже требования';
  return null;
}

// ---------- Левая колонка ----------

function TenderItem({ t, on, onPick }: { t: Tender; on: boolean; onPick: () => void }) {
  return (
    <button className={`ct-item${on ? ' is-selected' : ''}`} onClick={onPick}>
      <Monogram clientId={t.clientId} size={32} />
      <span className="ct-item-text">
        <span className="ct-item-name">{clientName(t.clientId)}</span>
        <span className="ct-item-sub">
          {benchDef(t.benchmark).name} · от {fmtPct(t.requirement, 0)} · {fmtMoney(t.payment)}
        </span>
      </span>
      {(t.type === 'rlhf' || t.application) && (
        <span className="ct-item-end">
          {t.type === 'rlhf' && <span className="ct-tag">RLHF</span>}
          {t.application && (
            <span className="ok" title="Заявка подана">
              <IconCheck size={16} />
            </span>
          )}
        </span>
      )}
    </button>
  );
}

function ContractItem({ s, c, on, onPick }: { s: GameState; c: Contract; on: boolean; onPick: () => void }) {
  const info = contractInfo(s, c);
  const risk = riskOf(info);
  return (
    <button className={`ct-item${on ? ' is-selected' : ''}`} onClick={onPick}>
      <Monogram clientId={c.tender.clientId} size={32} />
      <span className="ct-item-text">
        <span className="ct-item-name">{clientName(c.tender.clientId)}</span>
        <span className="ct-item-sub">
          {fmtMoney(c.tender.payment)} · до срока {days(info.left)}
        </span>
        <ProgressBar value={info.progress} title={`Выполнено ${fmtPct(info.progress * 100, 0)}`} />
      </span>
      {risk && (
        <span className="ct-item-end">
          <span className="risk" title={risk}>
            <IconAlert size={16} />
          </span>
        </span>
      )}
    </button>
  );
}

// ---------- Карточка тендера ----------

function CardHead({ clientId, type, text }: { clientId: string; type: string; text: string }) {
  const industry = clientIndustry(clientId);
  return (
    <div className="ct-head">
      <Monogram clientId={clientId} size={84} />
      <div>
        <div className="ct-name">{clientName(clientId)}</div>
        <div className="ct-sub">{industry ? `${industry} · ${type}` : type}</div>
        <p className="ct-desc">{text}</p>
      </div>
    </div>
  );
}

function tenderText(t: Tender): string {
  const who = t.type === 'rlhf' ? 'Нужна модель, обученная с RLHF, с баллом' : 'Нужна модель с баллом';
  return `${who} не ниже ${fmtPct(t.requirement, 0)} на ${benchDef(t.benchmark).name}.`;
}

function TenderCard(props: {
  s: GameState;
  t: Tender;
  released: PlayerModel[];
  pick: string | null;
  onPick: (modelId: string) => void;
  open: OpenFn;
}) {
  const { s, t, released, pick, onPick, open } = props;
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bench = benchDef(t.benchmark);
  const app = t.application;
  const appModel = app ? (s.models.find((m) => m.id === app.modelId) ?? null) : null;
  const model = app ? appModel : released.length > 0 ? (released.find((m) => m.id === pick) ?? bestCandidate(s, t, released)) : null;

  const shown = model ? modelScore(model, t.benchmark, false) : null;
  const honest = model ? modelScore(model, t.benchmark, true) : null;
  const reason = app ? null : model ? canApply(s, t, model) : 'Нет выпущенных моделей';
  const chance = app ? app.chance : model && reason === null ? applyChance(s, t, model) : null;
  const weak = honest !== null && honest < t.requirement;
  const trap = weak && reason === null && !app;
  const gap = shown !== null && honest !== null && Math.abs(shown - honest) > 0.05;

  const rlhf = t.type === 'rlhf';
  const labelers = rlhf ? RLHF_TENDER_LABELERS * t.payment : 0;
  const profit = t.payment - labelers - t.work * cheapestH100eDay(s);
  const left = Math.max(0, t.expiresDay - s.day);
  // Сколько мощности нужно каждый день, чтобы успеть к сроку, и сколько сейчас выделено на контракты.
  const needed = t.work / Math.max(1, t.durationDays);
  const contractsPool = pool(s, 'contracts');

  function submit() {
    setConfirming(false);
    if (!model) return;
    const r = store.dispatch(actions.applyTender, t.id, model.id);
    setErr(r.ok ? null : r.error);
  }

  let picker: ReactNode;
  if (app) {
    picker = <div className="ct-picked">{appModel ? appModel.name : '-'}</div>;
  } else if (!model) {
    picker = (
      <div className="ct-nomodel">
        <span>Нет выпущенных моделей. Заявку подают выпущенной моделью.</span>
        <button className="btn small" onClick={() => open('models')}>
          Открыть «Модели»
        </button>
      </div>
    );
  } else {
    picker = (
      <select value={model.id} onChange={(e) => onPick(e.target.value)} aria-label="Модель для заявки">
        {released.map((m) => (
          <option key={m.id} value={m.id}>
            {optionLabel(s, t, m)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="ct-card">
      <CardHead clientId={t.clientId} type={typeLabel(t)} text={tenderText(t)} />

      <div className="ct-cols">
        <section className="ct-col">
          <h3 className="ct-h">Заявка</h3>
          {picker}
          <div className="ct-cmp">
            <span />
            <span className="ct-cmp-h">Модель</span>
            <span className="ct-cmp-h">Требование</span>

            <span className="ct-cmp-l" title="По этому баллу принимают заявку">
              Балл на {bench.name}
            </span>
            <span className={`num${toneOf(shown === null ? null : shown >= t.requirement)}`}>{shown === null ? '-' : fmtPct(shown)}</span>
            <span className="num">от {fmtPct(t.requirement, 0)}</span>

            {gap && (
              <>
                <span className="ct-cmp-l" title="По этому баллу проверяют контракт при сдаче">
                  Балл без подгонки
                </span>
                <span className={`num${toneOf(honest !== null && honest >= t.requirement)}`}>{fmtPct(honest ?? 0)}</span>
                <span className="num">от {fmtPct(t.requirement, 0)}</span>
              </>
            )}

            {rlhf && (
              <>
                <span className="ct-cmp-l">RLHF</span>
                <span className={`num${toneOf(model ? model.rlhf : null)}`}>{model ? (model.rlhf ? 'Есть' : 'Нет') : '-'}</span>
                <span className="num">Нужен</span>
              </>
            )}
          </div>
          <div className="kv">
            <span title="Зависит от репутации и запаса балла над требованием">Шанс победы</span>
            <span>{chance === null ? '-' : fmtShare(chance, 0)}</span>
            {!app && (
              <>
                <span title="Тендер без заявки исчезает">До закрытия тендера</span>
                <span className={left <= 5 ? 'warn' : ''}>{days(left)}</span>
              </>
            )}
          </div>
        </section>

        <section className="ct-col">
          <h3 className="ct-h">Условия</h3>
          <div className="kv">
            <span>Оплата</span>
            <span>{fmtMoney(t.payment)}</span>
            {rlhf && (
              <>
                <span title="Списываются при победе в тендере">Разметчики</span>
                <span>{fmtMoney(labelers)}</span>
              </>
            )}
            <span title="Списывается при отказе, просрочке и провале при сдаче">Штраф</span>
            <span>{fmtMoney(t.penalty)}</span>
            <span title={`Оплата минус ${rlhf ? 'разметчики и ' : ''}работа по цене самой дешёвой карты`}>Ожидаемая прибыль</span>
            <span className={Number.isFinite(profit) ? (profit >= 0 ? 'good' : 'bad') : ''}>{fmtMoney(profit)}</span>
            <span>Объём работы</span>
            <span>{workDays(t.work)}</span>
            <span title="Отсчитывается со дня победы в тендере">Срок</span>
            <span>{days(t.durationDays)}</span>
            <span title={`Объём работы, делённый на срок. Сейчас на контракты выделено ${perDay(contractsPool)}`}>Нужно мощности</span>
            <span className={needed > contractsPool ? 'warn' : ''}>{perDay(needed)}</span>
          </div>
        </section>
      </div>

      {weak && honest !== null && <Alert tone="bad">Честный балл модели - {fmtPct(honest)}: при сдаче контракт провалится.</Alert>}

      <div className="ct-foot">
        {app ? (
          <span className="ct-state">
            <IconCheck size={16} />
            Заявка подана. Решение через {days(Math.max(0, app.resolveDay - s.day))}, шанс {fmtShare(app.chance, 0)}
          </span>
        ) : (
          <>
            {model && <span className="ct-why">{reason ?? `Решение через ${days(TENDER_APPLY_DAYS)}`}</span>}
            <button
              className="btn primary"
              data-tutorial="apply"
              disabled={reason !== null}
              title={reason ?? undefined}
              onClick={() => (trap ? setConfirming(true) : submit())}
            >
              Подать заявку
            </button>
          </>
        )}
        <ErrorText error={err} />
      </div>

      {confirming && model && honest !== null && (
        <ConfirmDialog title="Подтверждение заявки" confirmLabel="Подать заявку" onConfirm={submit} onClose={() => setConfirming(false)}>
          <div>Честный балл модели «{model.name}» ниже требования: при победе в тендере контракт будет провален при сдаче.</div>
          <div className="kv">
            <span>Честный балл</span>
            <span>{fmtPct(honest)}</span>
            <span>Требование</span>
            <span>от {fmtPct(t.requirement, 0)}</span>
            <span>Штраф</span>
            <span>{fmtMoney(t.penalty)}</span>
            <span>Репутация</span>
            <span>{REP_LOSS}</span>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---------- Карточка контракта ----------

function ContractCard({ s, c, open }: { s: GameState; c: Contract; open: OpenFn }) {
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const t = c.tender;
  const bench = benchDef(t.benchmark);
  const info = contractInfo(s, c);
  const text =
    (info.model ? `Исполнитель - модель «${info.model.name}». ` : '') +
    `Требование - балл не ниже ${fmtPct(t.requirement, 0)} на ${bench.name}.`;

  function cancel() {
    setConfirming(false);
    const r = store.dispatch(actions.cancelContract, c.id);
    if (!r.ok) setErr(r.error);
  }

  const openCompute = { label: 'Открыть «Мощности»', onClick: () => open('compute') };

  return (
    <div className="ct-card">
      <CardHead clientId={t.clientId} type={typeLabel(t)} text={text} />

      <div className="ct-cols">
        <section className="ct-col">
          <h3 className="ct-h">Работа</h3>
          <div>
            <div className="ct-bar-row">
              <span>Выполнено</span>
              <span className="v">
                {fmtNum(c.workDone)} из {workDays(t.work)} · {fmtPct(info.progress * 100, 0)}
              </span>
            </div>
            <ProgressBar value={info.progress} title={`Выполнено ${fmtPct(info.progress * 100, 0)}`} />
          </div>
          <div className="kv">
            <span>До срока</span>
            <span className={info.late || info.stalled ? 'bad' : info.left <= 10 ? 'warn' : ''}>{days(info.left)}</span>
            <span>Осталось работы</span>
            <span>{workDays(info.remaining)}</span>
            <span title="Доля «Контракты» из окна «Мощности», поровну между контрактами">Мощность на контракт</span>
            <span>{perDay(info.share)}</span>
            <span title="При текущей мощности">Завершение через</span>
            <span className={info.late ? 'bad' : ''}>{info.eta === null ? '-' : days(info.eta)}</span>
          </div>
        </section>

        <section className="ct-col">
          <h3 className="ct-h">Условия</h3>
          <div className="kv">
            <span>Требование</span>
            <span>
              от {fmtPct(t.requirement, 0)} на {bench.name}
            </span>
            <span title="По этому баллу проверяют контракт при сдаче">Честный балл модели</span>
            <span className={info.honest === null ? '' : info.weak ? 'bad' : 'good'}>{info.honest === null ? '-' : fmtPct(info.honest)}</span>
            <span>Оплата после сдачи</span>
            <span>{fmtMoney(t.payment)}</span>
            <span title="Списывается при отказе, просрочке и провале при сдаче">Штраф</span>
            <span>{fmtMoney(t.penalty)}</span>
          </div>
        </section>
      </div>

      {(info.stalled || info.late || info.weak) && (
        <div className="ct-alerts">
          {info.stalled && (
            <Alert tone="warn" action={openCompute}>
              Мощность для контрактов не выделена: работа не идёт.
            </Alert>
          )}
          {info.late && info.eta !== null && (
            <Alert tone="bad" action={openCompute}>
              Работа займёт ещё {days(info.eta)}, до срока осталось {days(info.left)}. Контракт будет просрочен, штраф -{' '}
              {endSentence(fmtMoney(t.penalty))}
            </Alert>
          )}
          {info.weak && info.honest !== null && (
            <Alert tone="bad">Честный балл модели - {fmtPct(info.honest)}: при сдаче контракт провалится.</Alert>
          )}
        </div>
      )}

      <div className="ct-foot">
        <button className="btn danger" onClick={() => setConfirming(true)}>
          Отказаться
        </button>
        <ErrorText error={err} />
      </div>

      {confirming && (
        <ConfirmDialog title="Отказ от контракта" confirmLabel="Отказаться" danger onConfirm={cancel} onClose={() => setConfirming(false)}>
          <div>Контракт будет расторгнут сразу, штраф спишется со счёта.</div>
          <div className="kv">
            <span>Клиент</span>
            <span>{clientName(t.clientId)}</span>
            <span>Выполнено</span>
            <span>{fmtPct(info.progress * 100, 0)}</span>
            <span>Штраф</span>
            <span>{fmtMoney(t.penalty)}</span>
            <span>Репутация</span>
            <span>{REP_LOSS}</span>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

// ---------- Окно ----------

function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="ct-empty">
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}

export default function ContractsWindow({ s, open }: WindowProps) {
  const [view, setView] = useState<View>('tenders');
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [tenderSel, setTenderSel] = useState<string | null>(null);
  const [contractSel, setContractSel] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

  const released = s.models.filter((m) => m.releasedDay !== null);
  const tenders = s.tenders.filter((t) => filter === 'all' || t.type === filter);
  const contracts = s.contracts;
  const tender = tenders.find((t) => t.id === tenderSel) ?? tenders[0] ?? null;
  const contract = contracts.find((c) => c.id === contractSel) ?? contracts[0] ?? null;

  const showTenders = view === 'tenders';
  const tabs: { id: View; label: string }[] = [
    { id: 'tenders', label: `Тендеры: ${s.tenders.length}` },
    { id: 'contracts', label: `Мои контракты: ${s.contracts.length}` },
  ];
  const emptyText = showTenders ? (s.tenders.length === 0 ? 'Тендеров нет' : 'Нет тендеров этого типа') : 'Активных контрактов нет';

  let main: ReactNode;
  if (showTenders) {
    main = tender ? (
      <TenderCard
        key={tender.id}
        s={s}
        t={tender}
        released={released}
        pick={picks[tender.id] ?? null}
        onPick={(modelId) => setPicks((p) => ({ ...p, [tender.id]: modelId }))}
        open={open}
      />
    ) : s.tenders.length === 0 ? (
      <Empty title="Тендеров нет" text="Новые тендеры появляются в начале каждого месяца." />
    ) : (
      <Empty title="Нет тендеров этого типа" />
    );
  } else {
    main = contract ? (
      <ContractCard key={contract.id} s={s} c={contract} open={open} />
    ) : (
      <Empty title="Активных контрактов нет" text="Контракт появляется после победы в тендере." />
    );
  }

  return (
    <div className="ct">
      <div className="ct-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === view} className={`tab${t.id === view ? ' on' : ''}`} onClick={() => setView(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="ct-body">
        <aside className="ct-side">
          {showTenders && (
            <>
              <label className="ct-auto" title={AUTO_APPLY_HINT}>
                <input type="checkbox" checked={s.autoApply} onChange={(e) => store.dispatch(actions.setAutoApply, e.target.checked)} />
                Подавать заявки автоматически
              </label>
              <label className="ct-filter">
                <span className="label">Тип</span>
                <select value={filter} onChange={(e) => setFilter(e.target.value as TypeFilter)}>
                  <option value="all">Все</option>
                  <option value="finetune">Дообучение</option>
                  <option value="rlhf">RLHF</option>
                </select>
              </label>
            </>
          )}

          <div className="ct-list">
            {showTenders
              ? tenders.map((t) => <TenderItem key={t.id} t={t} on={tender?.id === t.id} onPick={() => setTenderSel(t.id)} />)
              : contracts.map((c) => <ContractItem key={c.id} s={s} c={c} on={contract?.id === c.id} onPick={() => setContractSel(c.id)} />)}
            {(showTenders ? tenders : contracts).length === 0 && <div className="ct-list-empty">{emptyText}</div>}
          </div>
        </aside>

        <main className="ct-main">{main}</main>
      </div>
    </div>
  );
}
