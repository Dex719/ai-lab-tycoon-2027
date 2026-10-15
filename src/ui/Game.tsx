// Экран партии (как в Processor Tycoon): верхняя панель, рабочий стол с иконками и окнами, боковая панель, панель задач.

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { openChoices, pendingChoice, unreadCount } from '../sim/events';
import { goalOfferOpen, unseenReview } from '../sim/goals';
import type { GameState } from '../sim/types';
import { ChoiceModal } from './ChoiceModal';
import { Dialog, isFresh } from './components/common';
import { EndDialog } from './EndDialog';
import { YearReviewModal } from './YearReviewModal';
import { GoalChoiceModal } from './GoalChoice';
import { IconExit, IconFolder, IconGear, IconLogo, IconSave, IconTrophy } from './icons';
import { formatDateShort } from '../sim/time';
import { SettingsDialog, SlotsDialog } from './MainMenu';
import { SidePanel } from './SidePanel';
import { store, useSpeed } from './store';
import { Toasts } from './Toasts';
import { ArenaBanner } from './ArenaFeedback';
import { Juice } from './Juice';
import { ReleaseCard } from './ReleaseCard';
import { Moments } from './Moments';
import { DeskScene } from './DeskScene';
import './shell.css';
import { MonthStrip } from './MonthStrip';
import { AchievementsDialog, AchievementToasts } from './Achievements';
import { TopBar } from './TopBar';
import { TutorialPanel } from './Tutorial';
import { useViewport } from './viewport';
import { clampPos, deskAreaOf, Window, type WinGeom } from './Window';
import { resolveWindow, WINDOWS, type WindowAlias, type WindowId, type WindowProps } from './windows';

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
        // Лесенка новых окон не заходит под боковую панель: иначе кнопки справа (например, «Подать заявку») скрыты.
        const maxX = free > 480 ? LEFT_ICONS + free - w : area.w - w - 8;
        const x = Math.max(LEFT_ICONS, Math.min(maxX, cx + n * 26));
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
  const minimizeAll = () => setWins((ws) => ws.map((w) => ({ ...w, min: true })));
  const move = (id: WindowId, g: Partial<WinGeom>) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...g } : w)));
  return { wins, open, close, minimize, minimizeAll, focus, move };
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Цвет верхней полосы заголовка каждого окна. */
const WIN_ACCENT: Record<WindowId, string> = {
  research: 'var(--c-purple)',
  compute: 'var(--c-blue)',
  newModel: 'var(--c-blue)',
  contracts: 'var(--c-orange)',
  investors: 'var(--c-green)',
  models: 'var(--c-teal)',
  mail: 'var(--c-amber)',
  analytics: 'var(--c-indigo)',
  datacenters: 'var(--c-teal)',
  deals: 'var(--c-amber)',
  finale: 'var(--c-red)',
};

type GameDialog = null | 'save' | 'load' | 'settings' | 'achievements' | 'quit';

export function Game({ s }: { s: GameState }) {
  const deskRef = useRef<HTMLDivElement>(null);
  const { wins, open: openWin, close, minimize, minimizeAll, focus, move } = useWindows(deskRef);
  const vp = useViewport();
  const phone = vp === 'phone';
  const [sheet, setSheet] = useState(false); // телефон: боковая панель как нижний лист
  const [tutorOpen, setTutorOpen] = useState(false); // телефон: подсказка обучения развёрнута
  const dockRef = useRef<HTMLDivElement>(null);
  const open = useCallback(
    (id: WindowId | WindowAlias) => {
      setSheet(false);
      openWin(id);
    },
    [openWin],
  );
  useEffect(() => {
    if (!phone) setSheet(false);
  }, [phone]);
  const speed = useSpeed();
  // Телефон: окна на весь стол заканчиваются над подсказкой обучения, а не под ней (иначе она закрывает нижние кнопки).
  const dockShown = phone && s.tutorial.active && !s.outcome;
  useLayoutEffect(() => {
    const desk = deskRef.current;
    const dock = dockRef.current;
    if (!desk) return;
    if (!dockShown || !dock) {
      desk.style.removeProperty('--dock-h');
      return;
    }
    const apply = () => desk.style.setProperty('--dock-h', `${dock.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(dock);
    return () => {
      ro.disconnect();
      desk.style.removeProperty('--dock-h');
    };
  }, [dockShown]);
  const clock = useClock();
  const [startOpen, setStartOpen] = useState(false);
  const [dialog, setDialog] = useState<GameDialog>(null);
  const [watched, setWatched] = useState<GameState | null>(null);
  const [released, setReleased] = useState<string | null>(null); // карточка выхода модели
  const closeReleased = useCallback(() => setReleased(null), []);
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
  const blocked = showEnd || pendingChoice(s) !== null || dialog !== null || (!s.outcome && (unseenReview(s) !== null || goalOfferOpen(s)));

  function iconCount(id: WindowId): number {
    if (id === 'mail') return unread;
    if (id === 'contracts') return newTenders;
    return 0;
  }

  function startAction(d: GameDialog) {
    setStartOpen(false);
    if (d === 'save' || d === 'load' || d === 'settings' || d === 'achievements') store.setSpeed(0);
    setDialog(d);
  }

  return (
    <>
    <div className="game" inert={blocked}>
      <TopBar s={s} phone={phone} sheetOpen={sheet} onToggleSheet={() => setSheet((v) => !v)} />
      <div className="desk" ref={deskRef} onPointerDown={() => setStartOpen(false)}>
        {!phone && <DeskScene s={s} open={open} />}
        <div className="icons">
        <div className="icon-col left">
          {WINDOWS.filter((d) => d.side === 'left' && (!d.openedDay || d.openedDay(s) !== null)).map((d) => (
            <DeskIcon key={d.id} def={d} count={iconCount(d.id)} selected={openIds.has(d.id)} onOpen={() => open(d.id)} newSince={d.openedDay?.(s) ?? null} day={s.day} />
          ))}
        </div>
        <div className="icon-col right">
          {WINDOWS.filter((d) => d.side === 'right').map((d) => (
            <DeskIcon key={d.id} def={d} count={iconCount(d.id)} selected={openIds.has(d.id)} onOpen={() => open(d.id)} />
          ))}
        </div>
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
              fullscreen={phone}
              hidden={phone && w.z !== topZ}
              accent={WIN_ACCENT[w.id]}
              onFocus={() => focus(w.id)}
              onClose={() => close(w.id)}
              onMinimize={() => (phone ? minimizeAll() : minimize(w.id))}
              onMove={(g) => move(w.id, g)}
            >
              <WindowBody C={def.Component} s={s} open={open} version={store.version} />
            </Window>
          );
        })}
        {phone && s.tutorial.active && !s.outcome && (
          <div ref={dockRef} className={`tutor-dock${tutorOpen ? ' open' : ''}`}>
            <TutorialPanel s={s} open={openIds} speed={speed} />
            <button className="tutor-toggle" onClick={() => setTutorOpen((v) => !v)} aria-expanded={tutorOpen}>
              {tutorOpen ? 'Свернуть подсказку' : 'Показать подсказку'}
            </button>
          </div>
        )}
        <SidePanel
          s={s}
          open={open}
          vp={vp}
          sheetOpen={sheet}
          onSheetClose={() => setSheet(false)}
          top={!phone && s.tutorial.active && !s.outcome ? <TutorialPanel s={s} open={openIds} speed={speed} /> : undefined}
        />
      </div>
      <footer className="taskbar">
        <button className={`task-start${startOpen ? ' on' : ''}`} title="Меню игры" aria-label="Меню игры" onClick={() => setStartOpen((v) => !v)}>
          <IconLogo size={26} />
        </button>
        {startOpen && (
          <div className="start-menu" role="menu">
            <div className="start-head">
              <IconLogo size={30} />
              <span>
                <b>{s.labName}</b>
                <small>{formatDateShort(s.day)}</small>
              </span>
            </div>
            <button role="menuitem" onClick={() => startAction('save')}>
              <IconSave size={18} />
              Сохранить
            </button>
            <button role="menuitem" onClick={() => startAction('load')}>
              <IconFolder size={18} />
              Загрузить
            </button>
            <button role="menuitem" onClick={() => startAction('settings')}>
              <IconGear size={18} />
              Настройки
            </button>
            <button role="menuitem" onClick={() => startAction('achievements')}>
              <IconTrophy size={18} />
              Достижения
            </button>
            <hr />
            <button role="menuitem" className="start-exit" onClick={() => startAction('quit')}>
              <IconExit size={18} />
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
              style={{ ['--wa' as string]: WIN_ACCENT[w.id] }}
              title={def.title}
              onClick={() => (active ? (phone ? minimizeAll() : minimize(w.id)) : focus(w.id))}
            >
              <def.icon size={22} />
              <span>{def.title}</span>
            </button>
          );
        })}
        <div className="task-clock">{clock}</div>
      </footer>
    </div>

      <Toasts s={s} open={open} />
      <ArenaBanner s={s} />
      <MonthStrip s={s} />
      <AchievementToasts s={s} />
      <Juice s={s} onRelease={setReleased} />
      {released && <ReleaseCard s={s} modelId={released} onClose={closeReleased} />}
      <ChoiceModal s={s} />
      <Moments s={s} />
      {!s.outcome && !pendingChoice(s) && <YearReviewModal s={s} />}
      {!s.outcome && !pendingChoice(s) && <GoalChoiceModal s={s} />}
      {showEnd && <EndDialog s={s} onWatch={() => setWatched(s)} />}
      {dialog === 'save' && <SlotsDialog mode="save" onClose={() => setDialog(null)} />}
      {dialog === 'load' && <SlotsDialog mode="load" onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'achievements' && <AchievementsDialog onClose={() => setDialog(null)} />}
      {dialog === 'quit' && <QuitDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function DeskIcon(props: {
  def: (typeof WINDOWS)[number];
  count: number;
  selected: boolean;
  onOpen: () => void;
  /** День открытия раздела: первые дни у ярлыка значок «Новое». */
  newSince?: number | null;
  day?: number;
}) {
  const { def, count, selected, onOpen, newSince, day } = props;
  return (
    <button className={`desk-icon${selected ? ' selected' : ''}`} onClick={onOpen} data-tutorial={`icon-${def.id}`}>
      <def.icon size={56} />
      {count > 0 && <span className="count">{count}</span>}
      {newSince != null && day !== undefined && isFresh(day, newSince) && <span className="new-badge desk-new">Новое</span>}
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
