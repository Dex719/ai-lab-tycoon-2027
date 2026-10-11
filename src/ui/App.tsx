// Корень интерфейса: экран новой игры или рабочий стол с панелью, модальным выбором и итогом.

import { useState } from 'react';
import { pendingChoice } from '../sim/events';
import type { GameState } from '../sim/types';
import { ChoiceModal } from './ChoiceModal';
import { Desktop } from './Desktop';
import { EndScreen, NewGameScreen } from './Screens';
import { useGame } from './store';
import { TopBar } from './TopBar';

export function App() {
  const s = useGame();
  // Партия, итоги которой игрок решил смотреть в окнах. Держим сам объект состояния, а не флаг:
  // у новой игры и у загруженного сохранения объект новый, поэтому итог их конца показывается снова.
  const [watched, setWatched] = useState<GameState | null>(null);
  if (!s) return <NewGameScreen />;
  const showEnd = !!s.outcome && watched !== s;
  // Пока открыто окно выбора или итог, всё остальное закрыто: ни кликов, ни Tab, ни Enter по скрытым кнопкам.
  const blocked = showEnd || pendingChoice(s) !== null;
  return (
    <>
      <div className="app" inert={blocked}>
        <TopBar s={s} />
        <Desktop key={s.seed} s={s} />
      </div>
      <ChoiceModal s={s} />
      {showEnd && <EndScreen s={s} onWatch={() => setWatched(s)} />}
    </>
  );
}
