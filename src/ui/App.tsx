// Корень интерфейса: экран новой игры или рабочий стол с панелью, модальным выбором и итогом.

import { useState } from 'react';
import { ChoiceModal } from './ChoiceModal';
import { Desktop } from './Desktop';
import { EndScreen, NewGameScreen } from './Screens';
import { useGame } from './store';
import { TopBar } from './TopBar';

export function App() {
  const s = useGame();
  const [watchEnd, setWatchEnd] = useState(false);
  if (!s) return <NewGameScreen />;
  return (
    <div className="app">
      <TopBar s={s} />
      <Desktop key={s.seed} s={s} />
      <ChoiceModal s={s} />
      {s.outcome && !watchEnd && <EndScreen s={s} onWatch={() => setWatchEnd(true)} />}
    </div>
  );
}
