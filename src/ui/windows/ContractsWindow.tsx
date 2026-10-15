// Окно «Контракты» (FR-9), как «Контракты» в Processor Tycoon: вкладки «Тендеры» и «Мои контракты», слева список
// заказов с эмблемами клиентов, справа документ заказа: логотип клиента, описание, строка с оплатой, шансом и сроком,
// выбор модели со шкалой балла и условия.

import { useState, type ReactNode } from 'react';
import type { WindowProps } from '.';
import { CLIENTS } from '../../data/clients';
import { benchDef } from '../../sim/benchmarks';
import { cheapestH100eDay, pool } from '../../sim/compute';
import { REP_CONTRACT_FAIL, RLHF_TENDER_LABELERS } from '../../sim/constants';
import { applyChance, canApply, contractWorkFor } from '../../sim/contracts';
import { formatDateShort } from '../../sim/time';
import { modelScore } from '../../sim/training';
import type { Contract, GameState, PlayerModel, Tender } from '../../sim/types';
import { Cards } from '../components/Cards';
import { Alert, ConfirmDialog, ErrorText, GuardButton } from '../components/common';
import { endSentence, fmtDays, fmtH100e, fmtMoney, fmtPct, fmtShare } from '../format';
import { IconAlert, IconCheck, IconChevronLeft } from '../icons';
import { ClientEmblem } from '../icons/clients';
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

/** Мощность: «0,33 H100e в день», «1,2 тыс. H100e в день» */
function perDay(n: number): string {
  return `${fmtH100e(n)} H100e в день`;
}

/** Показанный балл проходит, а честный (без подгонки) ниже требования: на сдаче контракт будет провален. */
function isTrap(m: PlayerModel, t: Tender): boolean {
  return modelScore(m, t.benchmark, false) >= t.requirement && modelScore(m, t.benchmark, true) < t.requirement;
}

/**
 * Модели, которыми можно подать заявку: сначала с честным баллом выше требования, затем с большим шансом,
 * при равном шансе - с меньшим объёмом работы (меньше нужно мощности).
 */
function suitableModels(s: GameState, t: Tender, released: PlayerModel[]): PlayerModel[] {
  return released
    .filter((m) => canApply(s, t, m) === null)
    .sort(
      (a, b) =>
        Number(isTrap(a, t)) - Number(isTrap(b, t)) ||
        applyChance(s, t, b) - applyChance(s, t, a) ||
        contractWorkFor(s, t, a) - contractWorkFor(s, t, b),
    );
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

/** Лучшие среди подходящих моделей: с наибольшим шансом победы и с наименьшим объёмом работы (только если лучшая одна). */
function bestPicks(s: GameState, t: Tender, suitable: PlayerModel[]): Best {
  const best: Best = { chanceId: null, lightId: null };
  if (suitable.length < 2) return best;
  const unique = (key: (m: PlayerModel) => number): string | null => {
    const vals = suitable.map((m) => ({ id: m.id, v: key(m) })).sort((a, b) => b.v - a.v);
    return vals[0].v - vals[1].v > 1e-9 ? vals[0].id : null;
  };
  best.chanceId = unique((m) => applyChance(s, t, m));
  best.lightId = unique((m) => -contractWorkFor(s, t, m));
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

/** Что видно на строке тендера: поданная заявка, шанс лучшей модели или «нет модели». */
function tenderFit(s: GameState, t: Tender, released: PlayerModel[]): { text: string; tone: string } {
  if (t.application) return { text: `заявка подана, шанс ${fmtShare(t.application.chance, 0)}`, tone: 'applied' };
  const ok = suitableModels(s, t, released);
  if (ok.length === 0) return { text: released.length === 0 ? 'нет выпущенных моделей' : 'нет подходящей модели', tone: 'none' };
  const c = applyChance(s, t, ok[0]);
  return { text: `шанс ${fmtShare(c, 0)}`, tone: chanceTone(c) };
}

function TenderItem({ s, t, released, on, onPick }: { s: GameState; t: Tender; released: PlayerModel[]; on: boolean; onPick: () => void }) {
  const fit = tenderFit(s, t, released);
  const left = Math.max(0, t.expiresDay - s.day);
  return (
    <button className={`ct-row${on ? ' on' : ''}`} onClick={onPick}>
      <ClientEmblem clientId={t.clientId} size={30} />
      <span className="ct-row-t">
        <span className="ct-row-top">
          <span className="ct-row-name">{clientName(t.clientId)}</span>
          <span className="ct-row-pay">{fmtMoney(t.payment)}</span>
        </span>
        <span className="ct-row-sub">
          {t.type === 'rlhf' ? 'RLHF, ' : ''}
          {benchDef(t.benchmark).name} от {fmtPct(t.requirement, 0)}, ещё {fmtDays(left)}
        </span>
        <span className={`ct-row-fit ${fit.tone}`}>{fit.text}</span>
      </span>
    </button>
  );
}

function ContractItem({ s, c, on, onPick }: { s: GameState; c: Contract; on: boolean; onPick: () => void }) {
  const info = contractInfo(s, c);
  const risk = riskOf(info);
  return (
    <button className={`ct-row${on ? ' on' : ''}`} onClick={onPick}>
      <ClientEmblem clientId={c.tender.clientId} size={30} />
      <span className="ct-row-t">
        <span className="ct-row-top">
          <span className="ct-row-name">{clientName(c.tender.clientId)}</span>
          <span className="ct-row-pay">{fmtMoney(c.tender.payment)}</span>
        </span>
        <span className="ct-row-sub">
          Готово {fmtPct(info.progress * 100, 0)}, до срока {fmtDays(info.left)}
        </span>
        <span className="ct-row-prog" aria-hidden="true">
          <i style={{ width: `${info.progress * 100}%` }} />
        </span>
        {risk && (
          <span className="ct-row-fit bad">
            <IconAlert size={12} /> {risk}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------- Документ заказа ----------

/** «Банк «Северный»» → «Северный»: подпись под эмблемой, как название на логотипе. */
function shortName(id: string): string {
  const m = clientName(id).match(/«(.+)»$/);
  return m ? m[1] : clientName(id);
}

/** Шапка документа: плитка-логотип клиента, название, отрасль и вид работы, описание заказа. */
function DocHead({ clientId, sub, children }: { clientId: string; sub: string; children: ReactNode }) {
  return (
    <div className="ct-doc-head">
      <div className="ct-logo">
        <ClientEmblem clientId={clientId} size={72} />
        <span className="ct-logo-name">{shortName(clientId)}</span>
      </div>
      <div className="ct-doc-t">
        <h2 className="ct-doc-name">{clientName(clientId)}</h2>
        <div className="ct-doc-sub">{sub}</div>
        <p className="ct-doc-desc">{children}</p>
      </div>
    </div>
  );
}

/** Строка заказа: три главных числа в одну линию. */
function Slip({ cells }: { cells: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }[] }) {
  return (
    <div className="ct-slip">
      {cells.map((c) => (
        <div key={c.label} className="ct-slip-c">
          <span className="ct-slip-l">{c.label}</span>
          <b className={`ct-slip-v${c.tone ? ` ${c.tone}` : ''}`}>{c.value}</b>
          <span className="ct-slip-s">{c.sub ?? ' '}</span>
        </div>
      ))}
    </div>
  );
}

/** Подпись над точкой шкалы: у краёв прижимается внутрь, чтобы не вылезать за шкалу. */
function edgeShift(pct: number): string {
  return pct > 88 ? 'translateX(-100%)' : pct < 12 ? 'none' : 'translateX(-50%)';
}

/** Шкала 0-100 %: заливка до балла модели, отметка требования, полая отметка балла без подгонки. */
function ScoreGauge({ req, shown, honest }: { req: number; shown: number | null; honest: number | null }) {
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const pass = shown !== null && shown >= req;
  const gap = shown !== null && honest !== null && Math.abs(shown - honest) > 0.05;
  return (
    <div className="ct-gauge" role="img" aria-label={`Требование ${fmtPct(req, 0)}${shown !== null ? `, балл модели ${fmtPct(shown)}` : ''}`}>
      <div className="ct-g-req" style={{ left: `${clamp(req)}%`, transform: edgeShift(clamp(req)) }}>
        нужно {fmtPct(req, 0)}
      </div>
      <div className="ct-g-track">
        {shown !== null && <div className={`ct-g-fill ${pass ? 'pass' : 'fail'}`} style={{ width: `${clamp(shown)}%` }} />}
        <i className="ct-g-mark" style={{ left: `${clamp(req)}%` }} />
        {gap && honest !== null && <i className={`ct-g-honest ${honest >= req ? 'pass' : 'fail'}`} style={{ left: `${clamp(honest)}%` }} />}
      </div>
      <div className="ct-g-labels">
        {shown !== null && (
          <span className={`ct-g-shown ${pass ? 'pass' : 'fail'}`} style={{ left: `${clamp(shown)}%`, transform: edgeShift(clamp(shown)) }}>
            {fmtPct(shown)}
          </span>
        )}
      </div>
      {gap && honest !== null && <div className={`ct-g-note ${honest >= req ? '' : 'bad'}`}>Без подгонки под тесты: {fmtPct(honest)}</div>}
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
  const decide = app ? Math.max(0, app.resolveDay - s.day) : left;
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
        <IconCheck size={14} /> Заявка подана моделью «{appModel ? appModel.name : '-'}»
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
    const notes = [model.id === best.chanceId ? 'выше шанс' : null, model.id === best.lightId ? 'меньше мощности' : null].filter(Boolean);
    picker = (
      <>
        <select value={model.id} onChange={(e) => onPick(e.target.value)} aria-label="Модель для заявки">
          {suitable.map((m) => (
            <option key={m.id} value={m.id}>
              {optionLabel(s, t, m)}
            </option>
          ))}
        </select>
        <div className="ct-pick-note">{notes.length > 0 ? `Среди подходящих: ${notes.join(', ')}` : ' '}</div>
      </>
    );
  }

  const kind = rlhf ? 'дообучение с RLHF' : 'дообучение';
  return (
    <div className="ct-doc">
      <DocHead clientId={t.clientId} sub={`${clientIndustry(t.clientId)}, ${kind}`}>
        Нужна модель{rlhf ? ', обученная с RLHF,' : ''} с баллом не ниже <b>{fmtPct(t.requirement, 0)}</b> на <b>{bench.name}</b>. Работа займёт{' '}
        <b>{fmtDays(t.durationDays)}</b> после победы, оплата <b>{fmtMoney(t.payment)}</b> после сдачи.
      </DocHead>

      <Slip
        cells={[
          {
            label: 'Оплата',
            value: fmtMoney(t.payment),
            sub: Number.isFinite(profit) ? <span className={profit >= 0 ? 'good' : 'bad'}>прибыль ≈ {fmtMoney(profit)}</span> : undefined,
          },
          {
            label: 'Шанс победы',
            value: chance === null ? '-' : fmtShare(chance, 0),
            tone: chanceTone(chance),
            sub: app ? 'заявка подана' : model ? `модель «${model.name}»` : released.length === 0 ? 'моделей ещё нет' : 'модель не подходит',
          },
          { label: 'Срок работы', value: fmtDays(t.durationDays), sub: `решение через ${fmtDays(decide)}` },
        ]}
      />

      <div className="ct-cols">
        <section className="ct-col">
          <h3 className="ct-h">{app ? 'Заявка' : 'Модель для заявки'}</h3>
          {picker}
          <div className="ct-req-h">
            Балл на {bench.name}
            {rlhf && shownModel && <span className={shownModel.rlhf ? 'good' : 'bad'}>{shownModel.rlhf ? ', RLHF есть' : ', нет RLHF'}</span>}
          </div>
          <ScoreGauge req={t.requirement} shown={shown} honest={honest} />
        </section>

        <section className="ct-col">
          <h3 className="ct-h">Условия</h3>
          <dl className="ct-kv">
            <dt>Требование</dt>
            <dd>
              {bench.name} от {fmtPct(t.requirement, 0)}
            </dd>
            <dt title="Списывается при отказе, просрочке и балле ниже требования; оплаты в этом случае нет">Если сорвать</dt>
            <dd className="bad">
              штраф {fmtMoney(t.penalty)}, репутация −{Math.abs(REP_CONTRACT_FAIL)}
            </dd>
            {rlhf && (
              <>
                <dt title="Списываются при победе в тендере">Разметчики</dt>
                <dd>{fmtMoney(labelers)}</dd>
              </>
            )}
            <dt title={`Зависит от размера модели: маленькой нужно меньше. Сейчас на контракты выделено ${perDay(contractsPool)}`}>Нужно мощности</dt>
            <dd className={needed > contractsPool ? 'warn' : ''}>
              {perDay(needed)}
              <Cards s={s} h100e={needed} block />
            </dd>
            <dt>Решение</dt>
            <dd>{formatDateShort(s.day + decide)}</dd>
          </dl>
        </section>
      </div>

      {weak && honest !== null && <Alert tone="bad">Честный балл модели - {fmtPct(honest)}: при сдаче контракт провалится.</Alert>}

      <div className="ct-foot">
        {app ? (
          <span className="ct-state">
            <IconCheck size={16} />
            Решение через {fmtDays(decide)}, шанс {fmtShare(app.chance, 0)}
          </span>
        ) : (
          <>
            <span className="ct-why">{model ? `Решение при закрытии тендера, через ${fmtDays(left)}` : ' '}</span>
            <GuardButton className="btn primary" data-tutorial="apply" reason={reason} onClick={() => (trap ? setConfirming(true) : submit())}>
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
  const kind = t.type === 'rlhf' ? 'дообучение с RLHF' : 'дообучение';

  return (
    <div className="ct-doc">
      <DocHead clientId={t.clientId} sub={`${clientIndustry(t.clientId)}, ${kind}`}>
        {info.model ? (
          <>
            Работу ведёт модель <b>«{info.model.name}»</b>.{' '}
          </>
        ) : null}
        Сдать до <b>{formatDateShort(c.deadlineDay)}</b> с баллом не ниже <b>{fmtPct(t.requirement, 0)}</b> на <b>{bench.name}</b>, оплата{' '}
        <b>{fmtMoney(t.payment)}</b> после сдачи.
      </DocHead>

      <Slip
        cells={[
          {
            label: 'Оплата после сдачи',
            value: fmtMoney(t.payment),
            sub: (
              <span className="bad" title="Списывается при отказе, просрочке и балле ниже требования; оплаты в этом случае нет">
                если сорвать: штраф {fmtMoney(t.penalty)}, репутация −{Math.abs(REP_CONTRACT_FAIL)}
              </span>
            ),
          },
          {
            label: 'Готовность',
            value: fmtPct(info.progress * 100, 0),
            sub: (
              <span className="ct-slip-bar">
                <i style={{ width: `${info.progress * 100}%` }} />
              </span>
            ),
          },
          {
            label: 'До срока',
            value: fmtDays(info.left),
            tone: info.late || info.stalled ? 'bad' : info.left <= 10 ? 'warn' : undefined,
            sub: info.eta === null ? 'работа стоит' : `работа займёт ${fmtDays(info.eta)}`,
          },
        ]}
      />

      <div className="ct-cols">
        <section className="ct-col">
          <h3 className="ct-h">Работа</h3>
          <dl className="ct-kv">
            <dt title="Столько мощности в день нужно, чтобы закончить работу к сроку">Нужно</dt>
            <dd>
              {perDay(info.need)}
              <Cards s={s} h100e={info.need} block />
            </dd>
            <dt title="Доля «Контракты» из окна «Мощности», поровну между контрактами">Выделено</dt>
            <dd className={supplyTone(info.share, info.need)}>
              {perDay(info.share)}
              <Cards s={s} h100e={info.share} block />
            </dd>
          </dl>
        </section>
        <section className="ct-col">
          <h3 className="ct-h">Проверка при сдаче</h3>
          <div className="ct-req-h">Честный балл на {bench.name}</div>
          <ScoreGauge req={t.requirement} shown={info.honest} honest={null} />
        </section>
      </div>

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
  const [detail, setDetail] = useState(false); // телефон: карточка открыта на весь экран

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
    <div className={`ct${detail ? ' show-detail' : ''}`}>
      <div className="ct-tabs" role="tablist">
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
            {t.label}
          </button>
        ))}
      </div>

      <div className="ct-body">
        <aside className="ct-side">
          {showTenders && (
            <label className="ct-filter">
              <span>Тип:</span>
              <select value={filter} onChange={(e) => setFilter(e.target.value as TypeFilter)}>
                <option value="all">Все</option>
                <option value="finetune">Дообучение</option>
                <option value="rlhf">RLHF</option>
              </select>
            </label>
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

          {showTenders && (
            <label className="ct-auto" title={AUTO_APPLY_HINT}>
              <span>Подавать заявки автоматически</span>
              <input type="checkbox" checked={s.autoApply} onChange={(e) => store.dispatch(actions.setAutoApply, e.target.checked)} />
            </label>
          )}
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
