// Свои дата-центры (дизайн - .kiro/specs/datacenters/design.md): стройка по этапам, покупка карт, электричество.
// Случайность (задержка этапа) - только при начале этапа, поэтому партия без дата-центров идёт как раньше.

import {
  DC_COST_PER_MW,
  DC_DELAY_REASONS,
  DC_DELIVERY_DAYS,
  DC_GPU_KW,
  DC_GPU_PRICE,
  DC_MONTH_DAYS,
  DC_SITE_IDS,
  DC_SITES,
  DC_SIZE_EXTRA_MONTHS,
  DC_SIZES,
  DC_STAGE_NAMES,
  DC_STAGES,
  DC_UNLOCK_CASH,
  DC_UNLOCK_DATE,
  DC_UNLOCK_MONTH_REVENUE,
  DC_UPKEEP_PER_MW_MONTH,
  dcSite,
  type DcSiteDef,
  type DcSiteId,
} from '../data/datacenters';
import { GPUS } from '../data/gpus';
import { gpuDef, isGpuAvailable, rentPerGpuDay } from './compute';
import { addMail } from './events';
import { lastMonthRevenue, spend } from './finance';
import { nextRandom } from './rng';
import { byYear, dateToDay, formatDate, yearOf } from './time';
import type { Datacenter, GameState, GpuId, Result } from './types';
import { GPU_IDS } from './types';

const UNLOCK_DAY = dateToDay(DC_UNLOCK_DATE);

/** «$1,2 млн», «$350 тыс.», «$800» (как в investors.ts). */
function fmtMoney(x: number): string {
  const one = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  if (x >= 999_950_000) return `$${one(x / 1e9)} млрд`;
  if (x >= 999_500) return `$${one(x / 1e6)} млн`;
  if (x >= 1e3) return `$${Math.round(x / 1e3)} тыс.`;
  return `$${Math.round(x)}`;
}

function fmtCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** «1 мес.», «2 мес.». */
function months(n: number): string {
  return `${n} мес.`;
}

export function emptyGpuCounts(): Record<GpuId, number> {
  return Object.fromEntries(GPU_IDS.map((id) => [id, 0])) as Record<GpuId, number>;
}

// ---------- Открытие функции ----------

export function dcUnlocked(s: GameState): boolean {
  return s.datacenters.unlockedDay !== null;
}

/** Открыть дата-центры: с 2021 года или раньше, если денег или выручки много. Дата игроку не сообщается. */
function checkUnlock(s: GameState): void {
  if (dcUnlocked(s)) return;
  if (s.day < UNLOCK_DAY && s.cash < DC_UNLOCK_CASH && lastMonthRevenue(s) < DC_UNLOCK_MONTH_REVENUE) return;
  s.datacenters.unlockedDay = s.day;
  addMail(s, {
    kind: 'news',
    title: 'Свои дата-центры',
    body:
      'Лаборатория выросла: теперь можно строить свои дата-центры. Стройка занимает от 6 до 18 месяцев и стоит дорого, ' +
      'зато свои карты обходятся дешевле аренды и не упираются в её лимит. Площадки и цены - в окне «Дата-центры» на рабочем столе.',
  });
}

// ---------- Расчёты ----------

export function findDc(s: GameState, site: DcSiteId): Datacenter | undefined {
  return s.datacenters.list.find((d) => d.site === site);
}

export function dcReady(dc: Datacenter): boolean {
  return dc.stage >= DC_STAGES;
}

/** Стоимость стройки на сегодня: $ за МВт по году × множитель площадки × МВт. */
export function buildCost(s: GameState, site: DcSiteId, mw: number): number {
  return byYear(DC_COST_PER_MW, yearOf(s.day)) * dcSite(site).costMult * mw;
}

/** Длительность этапа в месяцах без задержек: к «Зданию» прибавка за размер. */
export function stageMonths(def: DcSiteDef, mw: number, stage: number): number {
  return def.stageMonths[stage] + (stage === 2 ? (DC_SIZE_EXTRA_MONTHS[mw] ?? 0) : 0);
}

/** Весь срок стройки без задержек, месяцев. */
export function buildMonths(site: DcSiteId, mw: number): number {
  const def = dcSite(site);
  let sum = 0;
  for (let i = 0; i < DC_STAGES; i++) sum += stageMonths(def, mw, i);
  return sum;
}

/** Ожидаемый день готовности: конец текущего этапа плюс оставшиеся этапы без задержек. */
export function expectedReadyDay(dc: Datacenter): number {
  if (dcReady(dc)) return dc.stageEndDay;
  const def = dcSite(dc.site);
  let day = dc.stageEndDay;
  for (let i = dc.stage + 1; i < DC_STAGES; i++) day += stageMonths(def, dc.mw, i) * DC_MONTH_DAYS;
  return day;
}

/** Доля пройденного текущего этапа, 0..1 (задержка - часть этапа). */
export function stageProgress(s: GameState, dc: Datacenter): number {
  if (dcReady(dc)) return 1;
  const len = stageMonths(dcSite(dc.site), dc.mw, dc.stage) * DC_MONTH_DAYS + dc.stageDelay;
  const start = dc.stageEndDay - len;
  return Math.max(0, Math.min(1, (s.day - start) / Math.max(1, len)));
}

/** Цена одной карты (с долей сервера и сети) на сегодня. */
export function gpuBuyPrice(s: GameState, gpu: GpuId): number {
  return byYear(DC_GPU_PRICE[gpu], yearOf(s.day));
}

/** кВт на карту на площадке: карта с сервером × PUE. */
export function gpuKwAt(site: DcSiteId, gpu: GpuId): number {
  return DC_GPU_KW[gpu] * dcSite(site).pue;
}

/** Сколько карт данного типа помещается в 1 МВт площадки. */
export function gpusPerMw(site: DcSiteId, gpu: GpuId): number {
  return Math.floor(1000 / gpuKwAt(site, gpu));
}

/** Занято кВт: стоящие карты и заказы в пути. */
export function usedKw(dc: Datacenter): number {
  let kw = 0;
  for (const id of GPU_IDS) kw += (dc.gpus[id] ?? 0) * gpuKwAt(dc.site, id);
  for (const o of dc.orders) kw += o.count * gpuKwAt(dc.site, o.gpu);
  return kw;
}

/** Сколько ещё карт типа gpu помещается (с учётом заказов в пути). */
export function freeSlots(dc: Datacenter, gpu: GpuId): number {
  return Math.max(0, Math.floor((dc.mw * 1000 - usedKw(dc) + 1e-6) / gpuKwAt(dc.site, gpu)));
}

/** Доставка заказа, сделанного сегодня, дней. */
export function deliveryDays(s: GameState): number {
  return byYear(DC_DELIVERY_DAYS, yearOf(s.day));
}

/** Электричество дата-центра в день, $: карты × кВт × PUE × 24 ч × цена. */
export function dcPowerPerDay(dc: Datacenter): number {
  let kw = 0;
  for (const id of GPU_IDS) kw += (dc.gpus[id] ?? 0) * gpuKwAt(dc.site, id);
  return (kw * 24 * dcSite(dc.site).powerPrice) / 1000;
}

/** Обслуживание готового дата-центра в день, $. */
export function dcUpkeepPerDay(dc: Datacenter): number {
  return dcReady(dc) ? (dc.mw * DC_UPKEEP_PER_MW_MONTH) / 30 : 0;
}

/** Электричество и обслуживание всех дата-центров в день. */
export function dcCostPerDay(s: GameState): number {
  let sum = 0;
  for (const dc of s.datacenters.list) sum += dcPowerPerDay(dc) + dcUpkeepPerDay(dc);
  return sum;
}

/** Сколько стоили бы свои карты в аренде по сегодняшним ценам (без лимита), $ в день. */
export function ownedRentEquivalentPerDay(s: GameState): number {
  let sum = 0;
  for (const dc of s.datacenters.list) {
    for (const id of GPU_IDS) {
      const n = dc.gpus[id] ?? 0;
      if (n > 0) sum += n * rentPerGpuDay(s, id);
    }
  }
  return sum;
}

/** Своих карт всего (стоят в готовых дата-центрах). */
export function ownedCards(s: GameState): number {
  let n = 0;
  for (const dc of s.datacenters.list) for (const id of GPU_IDS) n += dc.gpus[id] ?? 0;
  return n;
}

/** Карт в пути всего. */
export function cardsInTransit(s: GameState): number {
  let n = 0;
  for (const dc of s.datacenters.list) for (const o of dc.orders) n += o.count;
  return n;
}

// ---------- Этапы ----------

/** Начать этап stage: срок по площадке, с вероятностью риска - задержка на 1-2 месяца и письмо. */
function startStage(s: GameState, dc: Datacenter, stage: number): void {
  const def = dcSite(dc.site);
  dc.stage = stage;
  let delay = 0;
  if (nextRandom(s) < def.risk) {
    delay = (nextRandom(s) < 0.5 ? 1 : 2) * DC_MONTH_DAYS;
    dc.delayDays += delay;
    addMail(s, {
      kind: 'finance',
      title: `Стройка в ${placeName(def)} задерживается`,
      body: `Этап «${DC_STAGE_NAMES[stage]}» займёт на ${months(delay / DC_MONTH_DAYS)} дольше: ${DC_DELAY_REASONS[stage]}. Ожидаемая готовность - ${formatDate(s.day + stageMonths(def, dc.mw, stage) * DC_MONTH_DAYS + delay + restDays(def, dc.mw, stage))}.`,
    });
  }
  dc.stageDelay = delay;
  dc.stageEndDay = s.day + stageMonths(def, dc.mw, stage) * DC_MONTH_DAYS + delay;
}

function restDays(def: DcSiteDef, mw: number, stage: number): number {
  let d = 0;
  for (let i = stage + 1; i < DC_STAGES; i++) d += stageMonths(def, mw, i) * DC_MONTH_DAYS;
  return d;
}

/** «Абилине», «Эшберне», «Лулео», «Куинси»: город из названия площадки в предложном падеже. */
export function placeName(def: DcSiteDef): string {
  const city = def.name.split(',')[0];
  return PLACE_PREP[def.id] ?? city;
}

const PLACE_PREP: Record<DcSiteId, string> = { abilene: 'Абилине', ashburn: 'Эшберне', lulea: 'Лулео', quincy: 'Куинси' };

// ---------- Действия ----------

/** Причина, почему стройку начать нельзя, или null. */
export function buildError(s: GameState, site: DcSiteId, mw: number): string | null {
  if (!dcUnlocked(s)) return 'Дата-центры пока недоступны';
  if (!DC_SITE_IDS.includes(site)) return 'Неизвестная площадка';
  if (!DC_SIZES.includes(mw)) return 'Такой мощности нет в списке';
  if (findDc(s, site)) return 'На этой площадке уже есть дата-центр';
  if (s.cash < buildCost(s, site, mw)) return 'Не хватает денег на стройку';
  return null;
}

/** Действие: начать стройку дата-центра; вся стоимость списывается сразу (статья «Дата-центры»). */
export function buildDatacenter(s: GameState, site: DcSiteId, mw: number): Result {
  const err = buildError(s, site, mw);
  if (err) return { ok: false, error: err };
  const cost = buildCost(s, site, mw);
  spend(s, 'capex', cost);
  const dc: Datacenter = {
    site,
    mw,
    startedDay: s.day,
    stage: 0,
    stageEndDay: s.day,
    delayDays: 0,
    stageDelay: 0,
    paid: cost,
    gpus: emptyGpuCounts(),
    orders: [],
  };
  s.datacenters.list.push(dc);
  startStage(s, dc, 0);
  return { ok: true };
}

/** Причина, почему карты купить нельзя, или null. */
export function buyError(s: GameState, site: DcSiteId, gpu: GpuId, count: number): string | null {
  const dc = findDc(s, site);
  if (!dc) return 'На этой площадке нет дата-центра';
  if (!dcReady(dc)) return 'Дата-центр ещё строится';
  if (!GPUS.some((g) => g.id === gpu)) return 'Неизвестный тип карты';
  if (!isGpuAvailable(s, gpu)) return 'Эта карта ещё не вышла';
  if (!Number.isInteger(count) || count < 1) return 'Число карт должно быть целым и больше нуля';
  if (count > freeSlots(dc, gpu)) return 'Столько карт не помещается в дата-центр';
  if (s.cash < count * gpuBuyPrice(s, gpu)) return 'Не хватает денег на карты';
  return null;
}

/** Действие: купить карты в готовый дата-центр; деньги сразу, карты приедут через deliveryDays. */
export function buyDcGpus(s: GameState, site: DcSiteId, gpu: GpuId, count: number): Result {
  const err = buyError(s, site, gpu, count);
  if (err) return { ok: false, error: err };
  const dc = findDc(s, site)!;
  spend(s, 'capex', count * gpuBuyPrice(s, gpu));
  dc.orders.push({ gpu, count, arriveDay: s.day + deliveryDays(s) });
  return { ok: true };
}

/** Действие: списать карты (без возврата денег), чтобы освободить место. */
export function writeOffDcGpus(s: GameState, site: DcSiteId, gpu: GpuId, count: number): Result {
  const dc = findDc(s, site);
  if (!dc) return { ok: false, error: 'На этой площадке нет дата-центра' };
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'Число карт должно быть целым и больше нуля' };
  if (count > (dc.gpus[gpu] ?? 0)) return { ok: false, error: 'Столько карт этого типа в дата-центре нет' };
  dc.gpus[gpu] -= count;
  return { ok: true };
}

// ---------- Тик ----------

/** День: открытие функции, этапы стройки, доставка карт, электричество и обслуживание. */
export function datacentersDay(s: GameState): void {
  checkUnlock(s);
  for (const dc of s.datacenters.list) {
    const def = dcSite(dc.site);
    if (!dcReady(dc) && s.day >= dc.stageEndDay) {
      if (dc.stage + 1 < DC_STAGES) startStage(s, dc, dc.stage + 1);
      else {
        dc.stage = DC_STAGES;
        dc.stageDelay = 0;
        dc.stageEndDay = s.day;
        const perMw = gpusPerMw(dc.site, 'h100');
        addMail(s, {
          kind: 'finance',
          important: true,
          title: `Дата-центр в ${placeName(def)} готов`,
          body:
            `Дата-центр на ${dc.mw} МВт построен. Он пока пустой: купите карты в окне «Дата-центры». ` +
            `Помещается до ${fmtCount(perMw * dc.mw)} карт H100. Обслуживание - ${fmtMoney(dc.mw * DC_UPKEEP_PER_MW_MONTH)} в месяц.`,
        });
      }
    }
    if (dc.orders.length > 0) {
      const arrived = dc.orders.filter((o) => o.arriveDay <= s.day);
      if (arrived.length > 0) {
        dc.orders = dc.orders.filter((o) => o.arriveDay > s.day);
        for (const o of arrived) dc.gpus[o.gpu] = (dc.gpus[o.gpu] ?? 0) + o.count;
        const text = arrived.map((o) => `${fmtCount(o.count)} ${gpuDef(o.gpu).name}`).join(', ');
        addMail(s, {
          kind: 'finance',
          title: `Карты доставлены в ${placeName(def)}`,
          body: `Доставлено: ${text}. Карты уже работают: их мощность добавлена в «Мощности».`,
        });
      }
    }
    spend(s, 'power', dcPowerPerDay(dc) + dcUpkeepPerDay(dc));
  }
}

export { DC_SITES };
