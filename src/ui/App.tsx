// Корень интерфейса: главное меню или партия.

import { Game } from './Game';
import { MainMenu } from './MainMenu';
import { useGame } from './store';

export function App() {
  const s = useGame();
  if (!s) return <MainMenu />;
  return <Game key={s.seed} s={s} />;
}
