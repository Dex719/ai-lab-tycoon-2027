// Окно «Контракты» (FR-9): вкладки «Тендеры» и «Мои контракты»; слева заказы-билеты с эмблемами клиентов,
// справа карточка заказа: сверху тёмная шапка с главным (оплата, шанс, срок), ниже требование на шкале и выбор модели.

import { useState, type CSSProperties, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { CLIENTS } from '../../data/clients';
import { benchDef } from '../../sim/benchmarks';
import { cheapestH100eDay, pool } from '../../sim/compute';
import { REP_CONTRACT_FAIL, RLHF_TENDER_LABELERS } from '../../sim/constants';
import { applyChance, canApply, contractWorkFor } from '../../sim/contracts';
import { modelScore } from '../../sim/training';
import type { Contract, GameState, PlayerModel, Tender } from '../../sim/types';
import { Cards } from '../components/Cards';
import { Alert, ConfirmDialog, ErrorText, GuardButton, ProgressBar } from '../components/common';
import { endSentence, fmtDays, fmtH100e, fmtMoney, fmtNum, fmtPct, fmtShare } from '../format';
import { IconAlert, IconCheck, IconChevronLeft } from '../icons';
import { ClientEmblem, clientColor } from '../icons/clients';
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

/** Объём работы: «20 H100e-дн.», «12,5 тыс. H100e-дн.» */
function workDays(n: number): string {
  return `${fmtNum(n)} H100e-дн.`;
}

/** Мощность: «0,33 H100e в день», «1,2 тыс. H100e в день» */
function perDay(n: number): string {
  return `${fmtH100e(n)} H100e в день`;
}

/** Показанный балл проходит, а честный (без подгонки) ниже требования: на сдаче контракт будет провален. */
function isTrap(m: PlayerModel, t: Tender): boolean {
  return modelScore(m, t.benchmark, false) >= t.requirement && modelScore(m, t.benchmark, true) < t.requirement;
}

/** Модели, которыми можно подать заявку: сначала с честным баллом выше требования, затем по шансу. */
function suitableModels(s: GameState, t: Tender, released: PlayerModel[]): PlayerModel[] {
  return released
    .filter((m) => canApply(s, t, m) === null)
    .sort((a, b) => Number(isTrap(a, t)) - Number(isTrap(b, t)) || applyChance(s, t, b) - applyChance(s, t, a));
}

/** Выпущенная модель с наибольшим показанным баллом: её показываем, если ни одна не подходит. */
function closestModel(t: Tender, released: PlayerModel[]): PlayerModel | null {
  let best: PlayerModel | null = null;
  for (const m of released) if (!best || modelScore(m, t.benchmark, false) > modelScore(best, t.benchmark, false)) best = m;
  return best;
}

interface Best {
  chanceId: string | null; // у модели самый высокий шанс победы
  lightId: string | null; // у модели меньше всего работы
}

/** Лучшие среди подходящих моделей: с наибольшим шансом победы и с наименьшим объёмом работы. */
function bestPicks(s: GameState, t: Tender, suitable: PlayerModel[]): Best {
  const best: Best = { chanceId: null, lightId: null };
  if (suitable.length < 2) return best;
  let bestChance = -Infinity;
  let bestWork = Infinity;
  for (const m of suitable) {
    const c = applyChance(s, t, m);
    const w = contractWorkFor(s, t, m);
    if (c > bestChance) {
      bestChance = c;
      best.chanceId = m.id;
    }
    if (w < bestWork) {
      bestWork = w;
      best.lightId = m.id;
    }
  }
  return best;
}

/** «Модель 2a · 60 % · шанс 54 %», с пометкой, если честный балл ниже требования. */
function optionLabel(s: GameState, t: Tender, m: PlayerModel): string {
  const note = isTrap(m, t) ? ' · честный балл ниже' : '';
  return `${m.name} · ${fmtPct(modelScore(m, t.benchmark, false))} · шанс ${fmtShare(applyChance(s, t, m), 0)}${note}`;
}

/** Цвет по мощности: нет совсем - красный, не хватает до срока - оранжевый, хватает - зелёный. */
function supplyTone(have: number, need: number): 'good' | 'warn' | 'bad' {
  if (have <= 0) return 'bad';
  return have + 1e-9 < need ? 'warn' : 'good';
}

function chanceTone(c: number | null): string {
  if (c === null) return 'dim';
  return c >= 0.5 ? 'good' : c >= 0.3 ? 'warn' : 'bad';
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
  need: number; // H100e в день, чтобы успеть к сроку
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
    need: remaining / Math.max(1, left),
  };
}

function riskOf(info: ContractInfo): string | null {
  if (info.stalled) return 'Мощность для контрактов не выделена';
  if (info.late) return 'Работа не успевает до срока';
  if (info.weak) return 'Честный балл модели ниже требования';
  return null;
}

// ---------- Левая колонка ----------

/** Что видно справа на билете тендера: поданная заявка, шанс лучшей модели или «нет модели». */
function tenderFit(s: GameState, t: Tender, released: PlayerModel[]): { text: string; tone: string } {
  if (t.application) return { text: `Заявка · ${fmtShare(t.application.chance, 0)}`, tone: 'applied' };
  const ok = suitableModels(s, t, released);
  if (ok.length === 0) return { text: 'Нет модели', tone: 'none' };
  return { text: `Шанс ${fmtShare(applyChance(s, t, ok[0]), 0)}`, tone: chanceTone(applyChance(s, t, ok[0])) };
}

function TenderItem({ s, t, released, on, onPick }: { s: GameState; t: Tender; released: PlayerModel[]; on: boolean; onPick: () => void }) {
  const fit = tenderFit(s, t, released);
  const left = Math.max(0, t.expiresDay - s.day);
  return (
    <button className={`ct-ticket${on ? ' on' : ''}`} style={{ '--cc': clientColor(t.clientId) } as CSSProperties} onClick={onPick}>
      <ClientEmblem clientId={t.clientId} size={38} />
      <span className="ct-ticket-t">
        <span className="ct-ticket-name">{clientName(t.clientId)}</span>
        <span className="ct-ticket-sub">
          {t.type === 'rlhf' && <span className="ct-rlhf">RLHF</span>}
          {benchDef(t.benchmark).name} от {fmtPct(t.requirement, 0)} · {fmtDays(left)}
        </span>
      </span>
      <span className="ct-ticket-end">
        <b className="ct-ticket-pay">{fmtMoney(t.payment)}</b>
        <span className={`ct-fit ${fit.tone}`}>
          {t.application && <IconCheck size={12} />}
          {fit.text}
        </span>
      </span>
    </button>
  );
}

function ContractItem({ s, c, on, onPick }: { s: GameState; c: Contract; on: boolean; onPick: () => void }) {
  const info = contractInfo(s, c);
  const risk = riskOf(info);
  return (
    <button className={`ct-ticket${on ? ' on' : ''}`} style={{ '--cc': clientColor(c.tender.clientId) } as CSSProperties} onClick={onPick}>
      <ClientEmblem clientId={c.tender.clientId} size={38} />
      <span className="ct-ticket-t">
        <span className="ct-ticket-name">{clientName(c.tender.clientId)}</span>
        <span className={`ct-ticket-sub ${supplyTone(info.share, info.need)}`}>
          Готово {fmtPct(info.progress * 100, 0)} · до срока {fmtDays(info.left)}
        </span>
        <ProgressBar value={info.progress} title={`Выполнено ${fmtPct(info.progress * 100, 0)}`} />
      </span>
      <span className="ct-ticket-end">
        <b className="ct-ticket-pay">{fmtMoney(c.tender.payment)}</b>
        {risk ? (
          <span className="ct-fit bad" title={risk}>
            <IconAlert size={13} /> Риск
          </span>
        ) : (
          <span className="ct-fit good">В срок</span>
        )}
      </span>
    </button>
  );
}

// ---------- Шапка заказа ----------

function OrderHead(props: { clientId: string; kicker: string; sub: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <div className="ct-oh">
      <div className="ct-oh-top">
        <ClientEmblem clientId={props.clientId} size={60} className="ct-oh-emb" />
        <div className="ct-oh-t">
          <div className="ct-oh-k">{props.kicker}</div>
          <div className="ct-oh-name">{clientName(props.clientId)}</div>
          <div className="ct-oh-sub">{props.sub}</div>
        </div>
        {props.badge}
      </div>
      <div className="ct-kpis">{props.children}</div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="ct-kpi">
      <div className="ct-kpi-l">{label}</div>
      <div className={`ct-kpi-v${tone ? ` ${tone}` : ''}`}>{value}</div>
      <div className="ct-kpi-s">{sub ?? ' '}</div>
    </div>
  );
}

/** Шкала 0-100 %: заливка до балла модели, отметка требования, полая отметка балла без подгонки. */
function ScoreGauge({ req, shown, honest }: { req: number; shown: number | null; honest: number | null }) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const pass = shown !== null && shown >= req;
  const gap = shown !== null && honest !== null && Math.abs(shown - honest) > 0.05;
  return (
    <div className="ct-gauge" role="img" aria-label={`Требование ${fmtPct(req, 0)}${shown !== null ? `, балл модели ${fmtPct(shown)}` : ''}`}>
      <div className="ct-g-req" style={{ left: `${clamp(req)}%` }}>
        <span>нужно {fmtPct(req, 0)}</span>
      </div>
      <div className="ct-g-track">
        {shown !== null && <div className={`ct-g-fill ${pass ? 'pass' : 'fail'}`} style={{ width: `${clamp(shown)}%` }} />}
        <i className="ct-g-mark" style={{ left: `${clamp(req)}%` }} />
        {gap && honest !== null && <i className={`ct-g-honest ${honest >= req ? 'pass' : 'fail'}`} style={{ left: `${clamp(honest)}%` }} />}
      </div>
      <div className="ct-g-labels">
        {shown !== null && (
          <span className={`ct-g-shown ${pass ? 'pass' : 'fail'}`} style={{ left: `${clamp(shown)}%` }}>
            {fmtPct(shown)}
          </span>
        )}
      </div>
      {gap && honest !== null && (
        <div className={`ct-g-note ${honest >= req ? '' : 'bad'}`}>Без подгонки под тесты: {fmtPct(honest)}</div>
      )}
    </div>
  );
}

// ---------- Карточка тендера ----------

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
  const suitable = suitableModels(s, t, released);
  const closest = closestModel(t, released);
  const model = app ? appModel : (suitable.find((m) => m.id === pick) ?? suitable[0] ?? null);
  // Шкала показывает выбранную модель, а если подходящей нет - ближайшую к требованию.
  const shownModel = model ?? closest;

  const shown = shownModel ? modelScore(shownModel, t.benchmark, false) : null;
  const honest = shownModel ? modelScore(shownModel, t.benchmark, true) : null;
  const reason = app
    ? null
    : model
      ? canApply(s, t, model)
      : released.length === 0
        ? 'Нет выпущенных моделей'
        : closest && canApply(s, t, closest)
          ? canApply(s, t, closest)
          : 'Нет подходящей модели';
  const chance = app ? app.chance : model && reason === null ? applyChance(s, t, model) : null;
  const weak = model !== null && honest !== null && honest < t.requirement;
  const trap = weak && reason === null && !app;

  const rlhf = t.type === 'rlhf';
  const labelers = rlhf ? RLHF_TENDER_LABELERS * t.payment : 0;
  // Объём работы зависит от выбранной модели; у поданной заявки он уже записан.
  const work = app ? (app.work ?? t.work) : model ? contractWorkFor(s, t, model) : t.work;
  const profit = t.payment - labelers - work * cheapestH100eDay(s);
  const left = Math.max(0, t.expiresDay - s.day);
  const needed = work / Math.max(1, t.durationDays);
  const best = bestPicks(s, t, suitable);
  const contractsPool = pool(s, 'contracts');

  function submit() {
    setConfirming(false);
    if (!model) return;
    const r = store.dispatch(actions.applyTender, t.id, model.id);
    setErr(r.ok ? null : r.error);
  }

  let picker: ReactNode;
  if (app) {
    picker = (
      <div className="ct-picked">
        <IconCheck size={14} /> {appModel ? appModel.name : '-'}
      </div>
    );
  } else if (released.length === 0) {
    picker = (
      <div className="ct-nomodel">
        <span>Заявку подают выпущенной моделью.</span>
        {/* Если модель уже обучена, но не выпущена, ведём в «Модели»; иначе - создавать новую. */}
        {s.models.some((m) => m.releasedDay === null) || s.trainings.length > 0 ? (
          <button className="btn small" onClick={() => open('models')}>
            Открыть «Модели»
          </button>
        ) : (
          <button className="btn small" onClick={() => open('newModel')}>
            Создать модель
          </button>
        )}
      </div>
    );
  } else if (!model) {
    picker = (
      <div className="ct-nomodel">
        <span>
          {rlhf && !released.some((m) => m.rlhf)
            ? 'Нужна модель, обученная с RLHF.'
            : closest
              ? `Ни одна модель не проходит: лучшая, «${closest.name}», набирает ${fmtPct(modelScore(closest, t.benchmark, false))}.`
              : 'Ни одна модель не проходит.'}
        </span>
        <button className="btn small" onClick={() => open('newModel')}>
          Создать модель
        </button>
      </div>
    );
  } else {
    picker = (
      <>
        <select value={model.id} onChange={(e) => onPick(e.target.value)} aria-label="Модель для заявки">
          {suitable.map((m) => (
            <option key={m.id} value={m.id}>
              {optionLabel(s, t, m)}
            </option>
          ))}
        </select>
        <div className="ct-tags">
          {model.id === best.chanceId && (
            <span className="ct-pill good" title="Среди подходящих моделей у этой самый высокий балл, а значит, самый высокий шанс победы">
              выше шанс
            </span>
          )}
          {model.id === best.lightId && (
            <span className="ct-pill info" title="Среди подходящих моделей эта требует меньше всего мощности: она самая маленькая">
              меньше мощности
            </span>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="ct-order" style={{ '--cc': clientColor(t.clientId) } as CSSProperties}>
      <OrderHead
        clientId={t.clientId}
        kicker={`Тендер · ${typeLabel(t)}`}
        sub={app ? `${clientIndustry(t.clientId)} · решение через ${fmtDays(Math.max(0, app.resolveDay - s.day))}` : `${clientIndustry(t.clientId)} · тендер закроется через ${fmtDays(left)}`}
        badge={
          app ? (
            <span className="ct-badge applied">
              <IconCheck size={14} /> Заявка подана
            </span>
          ) : null
        }
      >
        <Kpi
          label="Оплата"
          value={fmtMoney(t.payment)}
          tone="gold"
          sub={Number.isFinite(profit) ? <span className={profit >= 0 ? 'up' : 'down'}>прибыль ≈ {fmtMoney(profit)}</span> : undefined}
        />
        <Kpi
          label="Шанс победы"
          value={chance === null ? '-' : fmtShare(chance, 0)}
          tone={chanceTone(chance)}
          sub={app ? 'заявка подана' : model ? `модель «${model.name}»` : 'нет подходящей модели'}
        />
        <Kpi label="Срок работы" value={fmtDays(t.durationDays)} sub={`нужно ${perDay(needed)}`} />
      </OrderHead>

      <div className="ct-ob">
        <section className="ct-req">
          <div className="ct-h">
            Требование: <b>{bench.name}</b> не ниже <b>{fmtPct(t.requirement, 0)}</b>
            {rlhf && (
              <span className={`ct-need-rlhf ${shownModel?.rlhf ? 'ok' : 'miss'}`}>
                {shownModel?.rlhf ? <IconCheck size={12} /> : null} обучена с RLHF
              </span>
            )}
          </div>
          <ScoreGauge req={t.requirement} shown={shown} honest={honest} />
        </section>

        <section className="ct-pick">
          <div className="ct-h">{app ? 'Заявку подала модель' : 'Модель для заявки'}</div>
          {picker}
        </section>

        <dl className="ct-terms">
          <dt title="Списывается при отказе, просрочке и провале при сдаче">Штраф</dt>
          <dd className="bad">{fmtMoney(t.penalty)}</dd>
          {rlhf && (
            <>
              <dt title="Списываются при победе в тендере">Разметчики</dt>
              <dd>{fmtMoney(labelers)}</dd>
            </>
          )}
          <dt title="Зависит от размера модели: у маленькой работы меньше, у большой больше">Объём работы</dt>
          <dd>{workDays(work)}</dd>
          <dt title={`Объём работы, делённый на срок. Сейчас на контракты выделено ${perDay(contractsPool)}`}>Мощность в день</dt>
          <dd className={needed > contractsPool ? 'warn' : ''}>
            {perDay(needed)}
            <Cards s={s} h100e={needed} />
          </dd>
        </dl>

        {weak && honest !== null && <Alert tone="bad">Честный балл модели - {fmtPct(honest)}: при сдаче контракт провалится.</Alert>}
      </div>

      <div className="ct-foot">
        {app ? (
          <span className="ct-state">
            <IconCheck size={16} />
            Решение через {fmtDays(Math.max(0, app.resolveDay - s.day))}, шанс {fmtShare(app.chance, 0)}
          </span>
        ) : (
          <>
            <span className="ct-why">{model ? `Решение при закрытии тендера, через ${fmtDays(left)}` : ' '}</span>
            <GuardButton className="btn primary ct-apply" data-tutorial="apply" reason={reason} onClick={() => (trap ? setConfirming(true) : submit())}>
              Подать заявку
            </GuardButton>
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
  const short = info.share + 1e-9 < info.need;

  function cancel() {
    setConfirming(false);
    const r = store.dispatch(actions.cancelContract, c.id);
    if (!r.ok) setErr(r.error);
  }

  const openCompute = { label: 'Открыть «Мощности»', onClick: () => open('compute') };

  return (
    <div className="ct-order" style={{ '--cc': clientColor(t.clientId) } as CSSProperties}>
      <OrderHead
        clientId={t.clientId}
        kicker={`Контракт · ${typeLabel(t)}`}
        sub={info.model ? `Исполнитель - модель «${info.model.name}»` : clientIndustry(t.clientId)}
      >
        <Kpi label="Оплата после сдачи" value={fmtMoney(t.payment)} tone="gold" sub={<span className="down">штраф {fmtMoney(t.penalty)}</span>} />
        <Kpi
          label="Готово"
          value={fmtPct(info.progress * 100, 0)}
          sub={
            <span className="ct-kpi-bar">
              <i style={{ width: `${info.progress * 100}%` }} />
            </span>
          }
        />
        <Kpi
          label="До срока"
          value={fmtDays(info.left)}
          tone={info.late || info.stalled ? 'bad' : info.left <= 10 ? 'warn' : undefined}
          sub={info.eta === null ? 'работа стоит' : `работа займёт ${fmtDays(info.eta)}`}
        />
      </OrderHead>

      <div className="ct-ob">
        <section className="ct-req">
          <div className="ct-h">
            Требование при сдаче: <b>{bench.name}</b> не ниже <b>{fmtPct(t.requirement, 0)}</b>
          </div>
          <ScoreGauge req={t.requirement} shown={info.honest} honest={null} />
        </section>

        <dl className="ct-terms">
          <dt>Осталось работы</dt>
          <dd>{workDays(info.remaining)}</dd>
          <dt title="Столько мощности в день нужно, чтобы закончить работу к сроку">Нужно в день</dt>
          <dd>
            {perDay(info.need)}
            <Cards s={s} h100e={info.need} />
          </dd>
          <dt title="Доля «Контракты» из окна «Мощности», поровну между контрактами">Выделено в день</dt>
          <dd className={supplyTone(info.share, info.need)}>
            {perDay(info.share)}
            <Cards s={s} h100e={info.share} />
          </dd>
        </dl>

        {(info.stalled || info.late || info.weak || short) && (
          <div className="ct-alerts">
            {info.stalled && (
              <Alert tone="warn" action={openCompute}>
                Мощность для контрактов не выделена: работа стоит.
              </Alert>
            )}
            {!info.stalled && !info.late && short && (
              <Alert tone="warn" action={openCompute}>
                Мощности не хватает: нужно {perDay(info.need)}, выделено {perDay(info.share)}.
              </Alert>
            )}
            {info.late && info.eta !== null && (
              <Alert tone="bad" action={openCompute}>
                Работа займёт ещё {fmtDays(info.eta)}, до срока {fmtDays(info.left)}. Контракт будет просрочен, штраф - {endSentence(fmtMoney(t.penalty))}
              </Alert>
            )}
            {info.weak && info.honest !== null && <Alert tone="bad">Честный балл модели - {fmtPct(info.honest)}: при сдаче контракт провалится.</Alert>}
          </div>
        )}
      </div>

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

const FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'finetune', label: 'Дообучение' },
  { id: 'rlhf', label: 'RLHF' },
];

export default function ContractsWindow({ s, open }: WindowProps) {
  const [view, setView] = useState<View>('tenders');
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [tenderSel, setTenderSel] = useState<string | null>(null);
  const [contractSel, setContractSel] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState(false); // телефон: карточка открыта на весь экран

  const released = s.models.filter((m) => m.releasedDay !== null);
  const tenders = s.tenders.filter((t) => filter === 'all' || t.type === filter);
  const contracts = s.contracts;
  const tender = tenders.find((t) => t.id === tenderSel) ?? tenders[0] ?? null;
  const contract = contracts.find((c) => c.id === contractSel) ?? contracts[0] ?? null;

  const showTenders = view === 'tenders';
  const tabs: { id: View; label: string; n: number }[] = [
    { id: 'tenders', label: 'Тендеры', n: s.tenders.length },
    { id: 'contracts', label: 'Мои контракты', n: s.contracts.length },
  ];
  const emptyText = showTenders ? (s.tenders.length === 0 ? 'Тендеров нет' : 'Нет тендеров этого типа') : 'Активных контрактов нет';
  const hasRlhf = s.tenders.some((t) => t.type === 'rlhf');

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
    <div className={`ct${detail ? ' show-detail' : ''}`}>
      <div className="ct-tabs">
        <div className="ct-tabs-l" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === view}
              className={`tab${t.id === view ? ' on' : ''}`}
              onClick={() => {
                setView(t.id);
                setDetail(false);
              }}
            >
              {t.label} <span className="ct-tab-n">{t.n}</span>
            </button>
          ))}
        </div>
        <label className="ct-auto" title={AUTO_APPLY_HINT}>
          <input type="checkbox" className="ct-switch" checked={s.autoApply} onChange={(e) => store.dispatch(actions.setAutoApply, e.target.checked)} />
          Подавать заявки автоматически
        </label>
      </div>

      <div className="ct-body">
        <aside className="ct-side">
          {showTenders && (hasRlhf || filter !== 'all') && (
            <div className="ct-seg" role="group" aria-label="Тип тендера">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className={f.id === filter ? 'on' : undefined} aria-pressed={f.id === filter} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div className="ct-list">
            {showTenders
              ? tenders.map((t) => (
                  <TenderItem
                    key={t.id}
                    s={s}
                    t={t}
                    released={released}
                    on={tender?.id === t.id}
                    onPick={() => {
                      setTenderSel(t.id);
                      setDetail(true);
                    }}
                  />
                ))
              : contracts.map((c) => (
                  <ContractItem
                    key={c.id}
                    s={s}
                    c={c}
                    on={contract?.id === c.id}
                    onPick={() => {
                      setContractSel(c.id);
                      setDetail(true);
                    }}
                  />
                ))}
            {(showTenders ? tenders : contracts).length === 0 && <div className="ct-list-empty">{emptyText}</div>}
          </div>
        </aside>

        <button type="button" className="btn m-back" onClick={() => setDetail(false)}>
          <IconChevronLeft size={14} />
          К списку
        </button>
        <main className="ct-main">{main}</main>
      </div>
    </div>
  );
}
