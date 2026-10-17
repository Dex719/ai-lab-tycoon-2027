// Корень интерфейса: главное меню или партия.

import { Component, type ReactNode } from 'react';
import { Game } from './Game';
import { MainMenu } from './MainMenu';
import { store, useGame } from './store';
import { TooltipLayer } from './Tooltip';

export function App() {
  const s = useGame();
  return (
    <>
      <Crash>{s ? <Game key={s.seed} s={s} /> : <MainMenu />}</Crash>
      <TooltipLayer />
    </>
  );
}

/**
 * Ошибка отрисовки не оставляет белый экран: показываем, что случилось, и даём выйти в меню или перезагрузить.
 * Партия к этому моменту уже в автосохранении месяца (или будет сохранена при закрытии страницы).
 */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="menu-screen" role="alert" style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ maxWidth: 480, background: 'var(--panel, #fff)', borderRadius: 12, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Что-то пошло не так</h2>
          <p className="small muted" style={{ wordBreak: 'break-word' }}>
            {error.message || String(error)}
          </p>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button
              className="btn primary"
              onClick={() => {
                store.quit();
                this.setState({ error: null });
              }}
            >
              В главное меню
            </button>
            <button className="btn" onClick={() => window.location.reload()}>
              Перезагрузить
            </button>
          </div>
        </div>
      </div>
    );
  }
}
