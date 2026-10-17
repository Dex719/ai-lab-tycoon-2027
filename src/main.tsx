import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { botAct, type BotKind } from './sim/bots';
import { applyChoice, openChoices, pendingChoice } from './sim/events';
import { advanceDay } from './sim/tick';
import { App } from './ui/App';
import { initMusic } from './ui/music';
import { initRealNames } from './ui/realNamesDom';
import { actions, store } from './ui/store';
import './ui/theme.css';
import './ui/responsive.css';
import '@fontsource-variable/nunito';
import './ui/tpc.css';

// Отладка и проверка агентом во встроенном браузере (NFR-4).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    store,
    actions,
    state: () => store.state,
    advance: (n: number) => store.advance(n),
    act: (name: keyof typeof actions, ...args: unknown[]) =>
      store.dispatch(actions[name] as (s: unknown, ...a: unknown[]) => never, ...args),
    // Автоигра ботом на n дней (выбор в письмах - первый вариант): быстро дойти до поздней игры.
    autoplay: (days: number, kind: BotKind = 'reasonable') => {
      const s = store.state;
      if (!s) return 0;
      let done = 0;
      while (done < days && !s.outcome) {
        const pending = pendingChoice(s) ?? openChoices(s)[0] ?? null;
        if (pending) {
          applyChoice(s, pending.id, 0);
          continue;
        }
        if (s.day % 7 === 0) botAct(s, kind);
        advanceDay(s);
        done++;
      }
      store.bump();
      return done;
    },
  };
}

// Скрытая вкладка: браузер замедляет её таймеры, а игра за это время уходит вперёд (аренда, сроки, банкротство).
// Ставим на паузу и сами не продолжаем; blur не используем: окно может быть просто неактивным, но видимым.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) store.pauseForHidden();
});

initRealNames();
initMusic();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
