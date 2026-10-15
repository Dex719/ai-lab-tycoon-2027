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
} from '../icons';
import AnalyticsWindow from './AnalyticsWindow';
import ComputeWindow from './ComputeWindow';
import ContractsWindow from './ContractsWindow';
import DatacentersWindow from './DatacentersWindow';
import InvestorsWindow from './InvestorsWindow';
import MailWindow from './MailWindow';
import ModelsWindow from './ModelsWindow';
import ResearchWindow from './ResearchWindow';
import TrainingWindow from './TrainingWindow';

export type WindowId = 'research' | 'compute' | 'newModel' | 'contracts' | 'investors' | 'models' | 'mail' | 'analytics' | 'datacenters';

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
  { id: 'research', title: 'Исследования', icon: IconResearch, side: 'left', w: 1000, h: 560, Component: ResearchWindow },
  { id: 'compute', title: 'Мощности', icon: IconCompute, side: 'left', w: 1000, h: 700, Component: ComputeWindow },
  { id: 'newModel', title: 'Новая модель', icon: IconNewModel, side: 'left', w: 1000, h: 680, Component: TrainingWindow },
  { id: 'contracts', title: 'Контракты', icon: IconContracts, side: 'left', w: 1000, h: 620, Component: ContractsWindow },
  { id: 'investors', title: 'Инвесторы', icon: IconInvestors, side: 'left', w: 720, h: 560, Component: InvestorsWindow },
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
  { id: 'models', title: 'Модели', icon: IconModels, side: 'right', w: 900, h: 620, Component: ModelsWindow },
  { id: 'mail', title: 'Почта', icon: IconMail, side: 'right', w: 820, h: 520, Component: MailWindow },
  { id: 'analytics', title: 'Аналитика', icon: IconAnalytics, side: 'right', w: 1100, h: 660, Component: AnalyticsWindow },
];
