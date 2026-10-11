import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { actions, store } from './ui/store';
import './ui/theme.css';

// Отладка и проверка агентом во встроенном браузере (NFR-4).
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    store,
    actions,
    state: () => store.state,
    advance: (n: number) => store.advance(n),
    act: (name: keyof typeof actions, ...args: unknown[]) =>
      store.dispatch(actions[name] as (s: unknown, ...a: unknown[]) => never, ...args),
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
