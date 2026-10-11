// Реестр окон рабочего стола (FR-14.2). Каждое окно — отдельный файл с компонентом по умолчанию.

import type { ComponentType } from 'react';
import type { GameState } from '../../sim/types';
import ComputeWindow from './ComputeWindow';
import ContractsWindow from './ContractsWindow';
import FinanceWindow from './FinanceWindow';
import GameWindow from './GameWindow';
import InvestorsWindow from './InvestorsWindow';
import MailWindow from './MailWindow';
import MarketWindow from './MarketWindow';
import ModelsWindow from './ModelsWindow';
import RatingsWindow from './RatingsWindow';
import ResearchWindow from './ResearchWindow';
import TrainingWindow from './TrainingWindow';

export type WindowId =
  | 'mail' | 'compute' | 'research' | 'training' | 'models' | 'ratings'
  | 'market' | 'contracts' | 'finance' | 'investors' | 'game';

export interface WindowProps {
  s: GameState;
  /** Открыть (или поднять) другое окно — для ссылок вроде «Перейти к обучению». */
  open: (id: WindowId) => void;
}

export interface WindowDef {
  id: WindowId;
  title: string;
  icon: string;
  w: number;
  h: number;
  Component: ComponentType<WindowProps>;
}

export const WINDOWS: WindowDef[] = [
  { id: 'mail', title: 'Почта', icon: '📬', w: 640, h: 440, Component: MailWindow },
  { id: 'compute', title: 'Мощности', icon: '🖥️', w: 620, h: 480, Component: ComputeWindow },
  { id: 'research', title: 'Исследования', icon: '🔬', w: 560, h: 460, Component: ResearchWindow },
  { id: 'training', title: 'Обучение', icon: '🧠', w: 660, h: 600, Component: TrainingWindow },
  { id: 'models', title: 'Модели', icon: '🤖', w: 720, h: 440, Component: ModelsWindow },
  { id: 'ratings', title: 'Рейтинги', icon: '🏆', w: 820, h: 520, Component: RatingsWindow },
  { id: 'market', title: 'Рынок', icon: '📈', w: 680, h: 520, Component: MarketWindow },
  { id: 'contracts', title: 'Контракты', icon: '📝', w: 760, h: 480, Component: ContractsWindow },
  { id: 'finance', title: 'Финансы', icon: '💰', w: 700, h: 540, Component: FinanceWindow },
  { id: 'investors', title: 'Инвесторы', icon: '🤝', w: 520, h: 440, Component: InvestorsWindow },
  { id: 'game', title: 'Игра', icon: '💾', w: 420, h: 360, Component: GameWindow },
];
