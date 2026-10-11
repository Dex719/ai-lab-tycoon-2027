// Экран партии (как в Processor Tycoon): верхняя панель, рабочий стол с иконками и окнами, боковая панель, панель задач.

import { memo, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { openChoices, pendingChoice, unreadCount } from '../sim/events';
import type { GameState } from '../sim/types';
import { ChoiceModal } from './ChoiceModal';
import { Dialog } from './components/common';
import { EndDialog } from './EndDialog';
import { IconLogo } from './icons';
import { SettingsDialog, SlotsDialog } from './MainMenu';
import { SidePanel } from './SidePanel';
import { store, useSpeed } from './store';
import { TopBar } from './TopBar';
import { TutorialPanel } from './Tutorial';
import { clampPos, deskAreaOf, Window, type WinGeom } from './Window';
import { LOCKED, resolveWindow, WINDOWS, type WindowAlias, type WindowId, type WindowProps } from './windows';

interface OpenWin extends WinGeom {
  id: WindowId;
  min: boolean;
}

/** Ширина колонки иконок слева и боковой панели справа: окна открываются между ними. */
const LEFT_ICONS = 118;
const RIGHT_ICONS = 316;

interface BodyProps extends WindowProps {
  C: ComponentType<WindowProps>;
  version: number; // состояние меняется на месте, поэтому для memo новизну данных показывает версия
}

/** Содержимое окна перерисовывается на каждый ход игры, но не когда соседнее окно двигают. */
const WindowBody = memo(function WindowBody({ C, s, open }: BodyProps) {
  return <C s={s} open={open} />;
});

function useWindows(deskRef: React.RefObject<HTMLDivElement | null>) {
  const [wins, setWins] = useState<OpenWin[]>([]);

  const open = useCallback(
    (raw: WindowId | WindowAlias) => {
      const id = resolveWindow(raw);
      setWins((ws) => {
        const top = ws.reduce((m, w) => Math.max(m, w.z), 0) + 1;
        const area = deskAreaOf(deskRef.current);
        const existing = ws.find((w) => w.id === id);
        if (existing) return ws.map((w) => (w.id === id ? { ...w, ...clampPos(w, area), z: top, min: false } : w));
        const def = WINDOWS.find((d) => d.id === id)!;
        const free = area.w - LEFT_ICONS - RIGHT_ICONS;
        const w = Math.max(320, Math.min(def.w, free > 480 ? free - 16 : area.w - LEFT_ICONS - 16));
        const h = Math.max(200, Math.min(def.h, area.h - 24));
        const n = ws.filter((x) => !x.min).length;
        const cx = LEFT_ICONS + Math.max(0, (free - w) / 2);
        const x = Math.max(LEFT_ICONS, Math.min(area.w - w - 8, cx + n * 26));
        const y = Math.max(8, Math.min(area.h - h - 8, (area.h - h) / 2 + n * 22));
        return [...ws, { id, x, y, w, h, z: top, min: false }];
      });
    },
    [deskRef],
  );

  useEffect(() => {
    function onResize() {
      const area = deskAreaOf(deskRef.current);
      setWins((ws) => ws.map((w) => ({ ...w, ...clampPos(w, area) })));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [deskRef]);

  const close = (id: WindowId) => setWins((ws) => ws.filter((w) => w.id !== id));
  const minimize = (id: WindowId) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: true } : w)));
  const focus = (id: WindowId) =>
    setWins((ws) => {
      const top = ws.reduce((m, w) => Math.max(m, w.z), 0);
      const cur = ws.find((w) => w.id === id);
      if (!cur || (cur.z === top && !cur.min)) return ws;
      return ws.map((w) => (w.id === id ? { ...w, z: top + 1, min: false } : w));
    });
  const move = (id: WindowId, g: Partial<WinGeom>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...g } : w)));
  return { wins, open, close, minimize, focus, move };
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

type GameDialog = null | 'save' | 'load' | 'settings' | 'quit';

export function Game({ s }: { s: GameState }) {
  const deskRef = useRef<HTMLDivElement>(null);
  const { wins, open, close, minimize, focus, move } = useWindows(deskRef);
  const speed = useSpeed();
  const clock = useClock();
  const [startOpen, setStartOpen] = useState(false);
  const [dialog, setDialog] = useState<GameDialog>(null);
  const [watched, setWatched] = useState<GameState | null>(null);
  const [contractsSeenDay, setContractsSeenDay] = useState(-1); // день, когда игрок последний раз видел список тендеров

  const visible = wins.filter((w) => !w.min);
  const topZ = visible.reduce((m, w) => Math.max(m, w.z), 0);
  const openIds = new Set(wins.filter((w) => !w.min).map((w) => w.id));
  // Отложенные решения прочитаны, но ещё ждут ответа: их тоже считаем на значке «Почты».
  const unread = unreadCount(s) + openChoices(s).filter((m) => m.read).length;
  // Значок «Контрактов» считает только тендеры, появившиеся после последнего открытия окна:
  // пока окно открыто, игрок их видит, и день просмотра сдвигается вместе с игрой.
  const contractsVisible = openIds.has('contracts');
  useEffect(() => {
    if (contractsVisible) setContractsSeenDay(s.day);
  }, [contractsVisible, s.day]);
  const newTenders = s.tenders.filter((t) => !t.application && t.appearedDay > contractsSeenDay).length;
  const showEnd = !!s.outcome && watched !== s;
  // Пока открыт выбор в письме, итог или диалог, остальной интерфейс закрыт для кликов и клавиатуры.
  const blocked = showEnd || pendingChoice(s) !== null || dialog !== null;

  function iconCount(id: WindowId): number {
    if (id === 'mail') return unread;
    if (id === 'contracts') return newTenders;
    return 0;
  }

  function startAction(d: GameDialog) {
    setStartOpen(false);
    if (d === 'save' || d === 'load' || d === 'settings') store.setSpeed(0);
    setDialog(d);
  }

  return (
    <>
    <div className="game" inert={blocked}>
      <TopBar s={s} />
      <div className="desk" ref={deskRef} onPointerDown={() => setStartOpen(false)}>
        <div className="desk-logo">
          <IconLogo size={180} />
        </div>
        <div className="icon-col left">
          {WINDOWS.filter((d) => d.side === 'left').map((d) => (
            <DeskIcon key={d.id} def={d} count={iconCount(d.id)} selected={openIds.has(d.id)} onOpen={() => open(d.id)} />
          ))}
          {LOCKED.map((l) => (
            <button key={l.title} className="desk-icon" disabled title="Появится в следующих версиях">
              <l.icon size={56} disabled />
              <span className="icon-label">{l.title}</span>
            </button>
          ))}
        </div>
        <div className="icon-col right">
          {WINDOWS.filter((d) => d.side === 'right').map((d) => (
            <DeskIcon key={d.id} def={d} count={iconCount(d.id)} selected={openIds.has(d.id)} onOpen={() => open(d.id)} />
          ))}
        </div>
        {visible.map((w) => {
          const def = WINDOWS.find((d) => d.id === w.id)!;
          return (
            <Window
              key={w.id}
              title={def.title}
              geom={w}
              active={w.z === topZ}
              flush
              onFocus={() => focus(w.id)}
              onClose={() => close(w.id)}
              onMinimize={() => minimize(w.id)}
              onMove={(g) => move(w.id, g)}
            >
              <WindowBody C={def.Component} s={s} open={open} version={store.version} />
            </Window>
          );
        })}
        <SidePanel
          s={s}
          open={open}
          top={s.tutorial.active && !s.outcome ? <TutorialPanel s={s} open={openIds} speed={speed} /> : undefined}
        />
      </div>
      <footer className="taskbar">
        <button className={`task-start${startOpen ? ' on' : ''}`} title="Меню игры" aria-label="Меню игры" onClick={() => setStartOpen((v) => !v)}>
          <IconLogo size={26} />
        </button>
        {startOpen && (
          <div className="start-menu" role="menu">
            <button role="menuitem" onClick={() => startAction('save')}>
              Сохранить
            </button>
            <button role="menuitem" onClick={() => startAction('load')}>
              Загрузить
            </button>
            <button role="menuitem" onClick={() => startAction('settings')}>
              Настройки
            </button>
            <hr />
            <button role="menuitem" onClick={() => startAction('quit')}>
              Выйти в главное меню
            </button>
          </div>
        )}
        <div className="task-sep" />
        {wins.map((w) => {
          const def = WINDOWS.find((d) => d.id === w.id)!;
          const active = !w.min && w.z === topZ;
          return (
            <button
              key={w.id}
              className={`task-win${active ? ' active' : ''}${w.min ? ' min' : ''}`}
              title={def.title}
              onClick={() => (active ? minimize(w.id) : focus(w.id))}
            >
              <def.icon size={22} />
              <span>{def.title}</span>
            </button>
          );
        })}
        <div className="task-clock">{clock}</div>
      </footer>
    </div>

      <ChoiceModal s={s} />
      {showEnd && <EndDialog s={s} onWatch={() => setWatched(s)} />}
      {dialog === 'save' && <SlotsDialog mode="save" onClose={() => setDialog(null)} />}
      {dialog === 'load' && <SlotsDialog mode="load" onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'quit' && <QuitDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function DeskIcon(props: { def: (typeof WINDOWS)[number]; count: number; selected: boolean; onOpen: () => void }) {
  const { def, count, selected, onOpen } = props;
  return (
    <button className={`desk-icon${selected ? ' selected' : ''}`} onClick={onOpen} data-tutorial={`icon-${def.id}`}>
      <def.icon size={56} />
      {count > 0 && <span className="count">{count}</span>}
      <span className="icon-label">{def.title}</span>
    </button>
  );
}

function QuitDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Выйти в главное меню"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onClose();
              store.quit();
            }}
          >
            Выйти
          </button>
        </>
      }
    >
      Несохранённый прогресс будет потерян. Автосохранение делается в начале каждого месяца.
    </Dialog>
  );
}
