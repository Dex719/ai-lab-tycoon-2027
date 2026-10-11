// Корень интерфейса: главное меню или партия.

import { Game } from './Game';
import { MainMenu } from './MainMenu';
import { useGame } from './store';
import { TooltipLayer } from './Tooltip';

export function App() {
  const s = useGame();
  return (
    <>
      {s ? <Game key={s.seed} s={s} /> : <MainMenu />}
      <TooltipLayer />
    </>
  );
}
