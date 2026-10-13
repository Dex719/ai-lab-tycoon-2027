// Дата-центры у ботов (дизайн - .kiro/specs/datacenters/design.md, «Боты»). Вызывается из bots.botAct раз в неделю.

import type { DcSiteId } from '../data/datacenters';
import { availableGpus, rentPerDay } from './compute';
import { buildCost, buildDatacenter, buyDcGpus, dcCostPerDay, dcReady, dcUnlocked, freeSlots, gpuBuyPrice, gpusPerMw } from './datacenters';
import { overheadPerDay } from './finance';
import { yearOf } from './time';
import type { GameState, GpuId } from './types';

interface DcPlan {
  site: DcSiteId;
  sizes: readonly number[]; // от большего к меньшему
  fromYear: number;
  toYear: number;
  cashMult: number; // строить, если денег не меньше стольких стоимостей
}

/**
 * Сильный строит самое быстрое (Абилин) в 2022-2023 годах. Разумный - в Лулео (10 месяцев, низкий риск) в 2022 году:
 * стройка в Куинси с 2023 года была готова только к середине 2024-го и не успевала окупиться (Эло 1317 вместо 1341).
 */
const DC_PLANS: Record<'reasonable' | 'strong', DcPlan> = {
  strong: { site: 'abilene', sizes: [50, 20], fromYear: 2022, toYear: 2023, cashMult: 2 },
  reasonable: { site: 'lulea', sizes: [20, 5], fromYear: 2022, toYear: 2023, cashMult: 2 },
};

/** Запас денег, который бот не тратит на карты: столько дней аренды, накладных и электричества. */
const RESERVE_DAYS = 120;
/** На один заказ карт - не больше такой доли свободных денег. */
const ORDER_CASH_SHARE = 0.5;
/** Мелкие заказы не делаем: не меньше такой доли вместимости (или весь остаток места). */
const MIN_ORDER_SHARE = 0.1;

/** Самая мощная из вышедших карт: место в дата-центре ограничено, а новые карты дают больше H100e на 1 МВт. */
function bestGpu(s: GameState): GpuId | null {
  let best: { id: GpuId; h: number } | null = null;
  for (const g of availableGpus(s)) if (!best || g.h100e > best.h) best = { id: g.id, h: g.h100e };
  return best?.id ?? null;
}

export function botDatacenters(s: GameState, kind: 'reasonable' | 'strong'): void {
  if (!dcUnlocked(s)) return;
  const plan = DC_PLANS[kind];
  const year = yearOf(s.day);
  if (s.datacenters.list.length === 0 && year >= plan.fromYear && year <= plan.toYear) {
    const mw = plan.sizes.find((size) => s.cash >= plan.cashMult * buildCost(s, plan.site, size));
    if (mw !== undefined) buildDatacenter(s, plan.site, mw);
  }

  const gpu = bestGpu(s);
  if (!gpu) return;
  for (const dc of s.datacenters.list) {
    if (!dcReady(dc)) continue;
    const free = freeSlots(dc, gpu);
    if (free <= 0) continue;
    const reserve = RESERVE_DAYS * (rentPerDay(s) + overheadPerDay(s) + dcCostPerDay(s));
    const budget = Math.max(0, s.cash - reserve) * ORDER_CASH_SHARE;
    const count = Math.min(free, Math.floor(budget / gpuBuyPrice(s, gpu)));
    const capacity = Math.floor(dc.mw * gpusPerMw(dc.site, gpu));
    if (count < 1 || (count < free && count < MIN_ORDER_SHARE * capacity)) continue;
    buyDcGpus(s, dc.site, gpu, count);
  }
}
