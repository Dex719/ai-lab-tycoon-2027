// Реестр окон и иконок рабочего стола (как в Processor Tycoon: группа слева и группа справа).

import type { ComponentType } from 'react';
import type { GameState } from '../../sim/types';
import {
  IconAnalytics,
  IconCompute,
  IconContracts,
  IconDatacenters,
  IconInvestors,
  IconMail,
  IconModels,
  IconNewModel,
  IconResearch,
  IconTeam,
} from '../icons';
import { IconDeals, IconFinale, IconProducts } from '../icons/late';
import { dealsOpenedDay } from '../../sim/deals';
import { finaleOpenedDay } from '../../sim/finale';
import { productsOpenedDay } from '../../sim/products';
import AnalyticsWindow from './AnalyticsWindow';
import ComputeWindow from './ComputeWindow';
import ContractsWindow from './ContractsWindow';
import DatacentersWindow from './DatacentersWindow';
import DealsWindow from './DealsWindow';
import FinaleWindow from './FinaleWindow';
import InvestorsWindow from './InvestorsWindow';
import MailWindow from './MailWindow';
import ModelsWindow from './ModelsWindow';
import ProductsWindow from './ProductsWindow';
import ResearchWindow from './ResearchWindow';
import TeamWindow from './TeamWindow';
import TrainingWindow from './TrainingWindow';

export type WindowId =
  | 'research'
  | 'compute'
  | 'newModel'
  | 'contracts'
  | 'investors'
  | 'models'
  | 'mail'
  | 'analytics'
  | 'datacenters'
  | 'deals'
  | 'finale'
  | 'team'
  | 'products';

/** Старые имена окон (до редизайна) - чтобы ссылки open('training') и т. п. продолжали работать. */
export type WindowAlias = 'training' | 'market' | 'finance' | 'ratings';
const ALIASES: Record<WindowAlias, WindowId> = { training: 'newModel', market: 'analytics', finance: 'analytics', ratings: 'analytics' };

export function resolveWindow(id: WindowId | WindowAlias): WindowId {
  return (ALIASES as Record<string, WindowId>)[id] ?? (id as WindowId);
}

export interface WindowProps {
  s: GameState;
  /** Открыть (или поднять) другое окно. */
  open: (id: WindowId | WindowAlias) => void;
  /** Закрыть это окно (например, после действия, которое завершает работу в нём). */
  close?: () => void;
}

export type IconComponent = ComponentType<{ size?: number; disabled?: boolean }>;

export interface WindowDef {
  id: WindowId;
  title: string;
  icon: IconComponent;
  side: 'left' | 'right';
  w: number;
  h: number;
  Component: ComponentType<WindowProps>;
  /**
   * Раздел, который открывается по ходу игры: день открытия или null - ярлыка ещё нет (будущее не раскрываем).
   * Первые дни после открытия у ярлыка значок «Новое».
   */
  openedDay?: (s: GameState) => number | null;
}

export const WINDOWS: WindowDef[] = [
  { id: 'research', title: 'Исследования', icon: IconResearch, side: 'left', w: 1060, h: 660, Component: ResearchWindow },
  { id: 'compute', title: 'Мощности', icon: IconCompute, side: 'left', w: 1000, h: 560, Component: ComputeWindow },
  { id: 'newModel', title: 'Новая модель', icon: IconNewModel, side: 'left', w: 1000, h: 680, Component: TrainingWindow },
  { id: 'contracts', title: 'Контракты', icon: IconContracts, side: 'left', w: 1000, h: 620, Component: ContractsWindow },
  { id: 'team', title: 'Команда', icon: IconTeam, side: 'left', w: 1040, h: 700, Component: TeamWindow },
  { id: 'investors', title: 'Инвесторы', icon: IconInvestors, side: 'left', w: 820, h: 600, Component: InvestorsWindow },
  {
    id: 'datacenters',
    title: 'Дата-центры',
    icon: IconDatacenters,
    side: 'left',
    w: 1000,
    h: 680,
    Component: DatacentersWindow,
    openedDay: (s) => s.datacenters.unlockedDay,
  },
  // Свои сервисы: переводчик 2017-2020 и ИИ-программист с июля 2021 года; ярлык - с первой выпущенной моделью.
  { id: 'products', title: 'Продукты', icon: IconProducts, side: 'left', w: 860, h: 500, Component: ProductsWindow, openedDay: productsOpenedDay },
  // Поздняя игра: сделки 2023-2024 (команды, стартапы, облако) и финальный квартал 2024 года.
  { id: 'deals', title: 'Сделки', icon: IconDeals, side: 'left', w: 1000, h: 580, Component: DealsWindow, openedDay: dealsOpenedDay },
  { id: 'finale', title: 'Финал', icon: IconFinale, side: 'left', w: 1000, h: 680, Component: FinaleWindow, openedDay: finaleOpenedDay },
  { id: 'models', title: 'Модели', icon: IconModels, side: 'right', w: 980, h: 640, Component: ModelsWindow },
  { id: 'mail', title: 'Почта', icon: IconMail, side: 'right', w: 1000, h: 580, Component: MailWindow },
  { id: 'analytics', title: 'Аналитика', icon: IconAnalytics, side: 'right', w: 1100, h: 660, Component: AnalyticsWindow },
];
