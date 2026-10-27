// Экран партии (как в Processor Tycoon): верхняя панель, рабочий стол с иконками и окнами, боковая панель, панель задач.

import { ClientFeed } from './ClientFeed';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { openChoices, pendingChoice, unreadCount } from '../sim/events';
import { goalOfferOpen, unseenReview } from '../sim/goals';
import type { GameState } from '../sim/types';
import { ChoiceModal } from './ChoiceModal';
import { Dialog, ErrorText, isFresh } from './components/common';
import { listSlots } from './saves';
import { EndDialog } from './EndDialog';
import { YearReviewModal } from './YearReviewModal';
import { GoalChoiceModal } from './GoalChoice';
import { IconExit, IconFolder, IconGear, IconLogo, IconSave, IconTrophy } from './icons';
import { dayToDate, formatDateShort } from '../sim/time';
import { TICK_MS } from '../sim/constants';
import { SettingsDialog, SlotsDialog } from './MainMenu';
import { SidePanel } from './SidePanel';
import { store, useSpeed } from './store';
import { Toasts } from './Toasts';
import { ArenaBanner } from './ArenaFeedback';
import { Juice } from './Juice';
import { SceneLive } from './SceneLive';
import { ReleaseCard } from './ReleaseCard';
import { Moments } from './Moments';
import { LabFloor } from './LabFloor';
import { RailIcon } from './railIcons';
import './shell.css';
import './feel.css';
import { FeelLayer } from './FeelLayer';
import './alive.css';
import { reducedMotion, watchTabSwaps } from './alive';
import { pushNotice } from './Toasts';
import { MonthStrip } from './MonthStrip';
import { AchievementsDialog, AchievementToasts } from './Achievements';
import { TopBar } from './TopBar';
import { TutorialPanel } from './Tutorial';
import { useViewport } from './viewport';
import { clampPos, deskAreaOf, placeWindow, Window, type WinGeom } from './Window';
import { resolveWindow, WINDOWS, type WindowAlias, type WindowId, type WindowProps } from './windows';

interface OpenWin extends WinGeom {
  id: WindowId;
  min: boolean;
}


interface BodyProps extends WindowProps {
  C: ComponentType<WindowProps>;
  id: WindowId;
  closeWin: (id: WindowId) => void;
  version: number; // состояние меняется на месте, поэтому для memo новизну данных показывает версия
}

/** Содержимое окна перерисовывается на каждый ход игры, но не когда соседнее окно двигают. */
const WindowBody = memo(function WindowBody({ C, s, open, id, closeWin }: BodyProps) {
  return <C s={s} open={open} close={() => closeWin(id)} />;
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
        // Окно раскладывается в свободной от HUD области: не под сводку, не под показатели и плитку денег (плейтест 17.10).
        const n = ws.filter((x) => !x.min).length;
        return [...ws, { id, ...placeWindow(def, area, n), z: top, min: false }];
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

  const close = useCallback((id: WindowId) => setWins((ws) => ws.filter((w) => w.id !== id)), []);
  const minimize = useCallback((id: WindowId) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, min: true } : w))), []);
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

/** Сколько первых дней партии названия разделов видны у иконок всегда (потом - по наведению). */
const DOCK_LABEL_DAYS = 60;
/** Цвет верхней полосы заголовка: у всех окон один (бирюзовая грань), разноцветные окна пестрили (docs/COLORS.md). */
const WIN_EDGE = 'var(--brand-edge)';
const WIN_ACCENT: Record<WindowId, string> = {
  research: WIN_EDGE,
  compute: WIN_EDGE,
  newModel: WIN_EDGE,
  contracts: WIN_EDGE,
  investors: WIN_EDGE,
  models: WIN_EDGE,
  mail: WIN_EDGE,
  analytics: WIN_EDGE,
  datacenters: WIN_EDGE,
  deals: WIN_EDGE,
  finale: WIN_EDGE,
  team: WIN_EDGE,
  products: WIN_EDGE,
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
  // Окно уходит 110 мс (закрытие вниз и в прозрачность, сворачивание к панели задач), потом его убирают из списка.
  const [leaving, setLeaving] = useState<Partial<Record<WindowId, 'close' | 'min'>>>({});
  const leaveTimers = useRef(new Map<WindowId, number>());
  const winsRef = useRef(wins);
  winsRef.current = wins;
  // Окна развёрнуты на всю область, видно только верхнее. Остальные сворачиваем: иначе закрытие верхнего показывало
  // окно, открытое раньше, и казалось, что раздел открылся сам (QA 19.10). На телефоне окна и так по одному.
  const hideOthers = useCallback(
    (keep: WindowId) => {
      if (phone) return;
      for (const w of winsRef.current) if (w.id !== keep && !w.min) minimize(w.id);
    },
    [phone, minimize],
  );
  const focusOnly = useCallback(
    (id: WindowId) => {
      hideOthers(id);
      focus(id);
    },
    [hideOthers, focus],
  );
  const open = useCallback(
    (id: WindowId | WindowAlias) => {
      setSheet(false);
      // Окно открыли снова, пока оно уходило: уход отменяется, иначе таймер закрывал только что открытое окно.
      const win = resolveWindow(id);
      const t = leaveTimers.current.get(win);
      if (t !== undefined) {
        window.clearTimeout(t);
        leaveTimers.current.delete(win);
        setLeaving((x) => {
          const { [win]: _drop, ...rest } = x;
          return rest;
        });
      }
      hideOthers(win);
      openWin(id);
    },
    [openWin, hideOthers],
  );
  useEffect(() => {
    if (!phone) setSheet(false);
  }, [phone]);
  const speed = useSpeed();
  // Скорость игры в CSS: полосы прогресса едут ровно столько, сколько длится один игровой день.
  useEffect(() => {
    const ms = speed === 0 ? 300 : TICK_MS[speed]; // на паузе - мягкая анимация без игрового дня
    document.documentElement.style.setProperty('--tick', `${ms}ms`);
  }, [speed]);
  const leave = useCallback(
    (id: WindowId, how: 'close' | 'min', done: (id: WindowId) => void) => {
      if (phone || reducedMotion()) return done(id);
      if (leaveTimers.current.has(id)) return;
      setLeaving((l) => ({ ...l, [id]: how }));
      const t = window.setTimeout(() => {
        leaveTimers.current.delete(id);
        done(id);
        setLeaving((x) => {
          const { [id]: _drop, ...rest } = x;
          return rest;
        });
      }, 110);
      leaveTimers.current.set(id, t);
    },
    [phone],
  );
  const closeAnim = useCallback((id: WindowId) => leave(id, 'close', close), [leave, close]);
  const minAnim = useCallback((id: WindowId) => leave(id, 'min', minimize), [leave, minimize]);
  useEffect(() => (deskRef.current ? watchTabSwaps(deskRef.current) : undefined), []);
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
  // Окно игры закрывают посреди партии (крестик exe, вкладка браузера): партия уходит в автосохранение.
  useEffect(() => {
    const save = () => void store.autosaveOnLeave();
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, []);
  const [startOpen, setStartOpen] = useState(false);
  const [dialog, setDialog] = useState<GameDialog>(null);
  const [watched, setWatched] = useState<GameState | null>(null);
  const [released, setReleased] = useState<string | null>(null); // карточка выхода модели
  const closeReleased = useCallback(() => setReleased(null), []);
  const [contractsSeenDay, setContractsSeenDay] = useState(-1); // день, когда игрок последний раз видел список тендеров

  const visible = wins.filter((w) => !w.min);
  const topZ = visible.reduce((m, w) => Math.max(m, w.z), 0);
  // Разделы в колонке: открываются по ходу игры (к 2024 году их 14).
  const docked = WINDOWS.filter((d) => !d.openedDay || d.openedDay(s) !== null);
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
  // Отложенное окно целей (крестик) не закрывает интерфейс: игрок смотрит окна, а время стоит.
  const blocked = showEnd || pendingChoice(s) !== null || dialog !== null || (!s.outcome && (unseenReview(s) !== null || (goalOfferOpen(s) && !store.goalsHidden)));

  // Раздел открылся по ходу игры (дата-центры, сделки, финал): ярлык появляется с кольцом, плюс уведомление «Открыт раздел».
  const shownLeft = WINDOWS.filter((d) => d.side === 'left' && (!d.openedDay || d.openedDay(s) !== null)).map((d) => d.id);
  const knownIcons = useRef<{ state: GameState; ids: Set<WindowId> } | null>(null);
  const [freshIcons, setFreshIcons] = useState<ReadonlySet<WindowId>>(new Set());
  useEffect(() => {
    const prev = knownIcons.current;
    knownIcons.current = { state: s, ids: new Set(shownLeft) };
    if (!prev || prev.state !== s) return;
    const added = shownLeft.filter((id) => !prev.ids.has(id));
    if (added.length === 0) return;
    setFreshIcons((f) => new Set([...f, ...added]));
    for (const id of added) {
      const def = WINDOWS.find((d) => d.id === id);
      if (def) pushNotice({ kind: 'event', label: 'Новый раздел', title: `Открыт раздел «${def.title}»`, win: id });
    }
    // Без очистки таймера: эффект идёт на каждый ход игры, а метку надо снять ровно через 3,2 с.
    window.setTimeout(() => setFreshIcons((f) => new Set([...f].filter((id) => !added.includes(id)))), 3200);
  });

  function iconCount(id: WindowId): number {
    if (id === 'mail') return unread;
    if (id === 'contracts') return newTenders;
    // Обученные и не выпущенные модели: плейтест 17.10 - модель простояла готовой почти четыре месяца незамеченной.
    if (id === 'models') return s.models.filter((m) => m.releasedDay === null).length;
    return 0;
  }

  function startAction(d: GameDialog) {
    setStartOpen(false);
    // Выход тоже на паузе: пока игрок решает, не должны приходить письма и начинаться банкротство.
    if (d === 'save' || d === 'load' || d === 'settings' || d === 'achievements' || d === 'quit') store.setSpeed(0);
    setDialog(d);
  }

  // Меню игры: на компьютере - последняя кнопка в колонке разделов (другим цветом), на телефоне - в панели задач.
  const startMenu = (
    <div className="start-wrap">
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
    </div>
  );

  return (
    <>
    <div className="game" inert={blocked}>
      <TopBar s={s} phone={phone} sheetOpen={sheet} onToggleSheet={() => setSheet((v) => !v)} />
      <div className="desk" ref={deskRef} onPointerDown={() => setStartOpen(false)}>
        {!phone && <LabFloor s={s} open={open} />}
        {phone && (
        <div className="icons">
        <div className="icon-col left">
          {WINDOWS.filter((d) => d.side === 'left' && (!d.openedDay || d.openedDay(s) !== null)).map((d) => (
            <DeskIcon key={d.id} def={d} count={iconCount(d.id)} selected={openIds.has(d.id)} onOpen={() => open(d.id)} newSince={d.openedDay?.(s) ?? null} day={s.day} fresh={freshIcons.has(d.id)} />
          ))}
        </div>
        <div className="icon-col right">
          {WINDOWS.filter((d) => d.side === 'right').map((d) => (
            <DeskIcon key={d.id} def={d} count={iconCount(d.id)} selected={openIds.has(d.id)} onOpen={() => open(d.id)} />
          ))}
        </div>
        </div>
        )}
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
              maximized={!phone}
              maxSize={{ w: def.w, h: def.h }}
              hidden={w.z !== topZ}
              leaving={leaving[w.id]}
              accent={WIN_ACCENT[w.id]}
              icon={RAIL[w.id]}
              onFocus={() => focus(w.id)}
              onClose={() => closeAnim(w.id)}
              onMinimize={() => (phone ? minimizeAll() : minAnim(w.id))}
              onMove={(g) => move(w.id, g)}
            >
              <WindowBody C={def.Component} s={s} open={open} id={w.id} closeWin={closeAnim} version={store.version} />
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
        {phone && startMenu}
        <div className="task-sep" />
        {!phone && (
          <nav
            className={`dock${s.day < DOCK_LABEL_DAYS || s.tutorial.active ? ' labels' : ''}`}
            aria-label="Разделы"
            // Кнопок с меню игры: по нему колонка ужимает кнопки, чтобы поместиться по высоте (tpc.css, --dock-sz).
            style={{ ['--dock-n' as string]: docked.length + 1 }}
          >
            {docked.map((d) => {
              const w = wins.find((x) => x.id === d.id);
              const active = !!w && !w.min && w.z === topZ;
              const count = iconCount(d.id);
              const since = d.openedDay?.(s) ?? null;
              return (
                <button
                  key={d.id}
                  className={`dock-btn${w ? ' open' : ''}${active ? ' active' : ''}${freshIcons.has(d.id) ? ' fresh' : ''}`}
                  style={{ ['--wa' as string]: WIN_ACCENT[d.id] }}
                  title={d.title}
                  data-tutorial={`icon-${d.id}`}
                  onClick={() => (active ? minAnim(d.id) : w ? focusOnly(d.id) : open(d.id))}
                >
                  <RailIcon id={d.id} />
                  <span className="dock-tip">{d.title}</span>
                  {count > 0 && (
                    <i className="count" key={count}>
                      {count}
                    </i>
                  )}
                  {since !== null && isFresh(s.day, since) && <i className="new-badge dock-new">Новое</i>}
                </button>
              );
            })}
            <span className="dock-sep" aria-hidden="true" />
            {startMenu}
          </nav>
        )}
        {phone && wins.map((w) => {
          const def = WINDOWS.find((d) => d.id === w.id)!;
          const active = !w.min && w.z === topZ;
          return (
            <button
              key={w.id}
              className={`task-win${active ? ' active' : ''}${w.min ? ' min' : ''}`}
              style={{ ['--wa' as string]: WIN_ACCENT[w.id] }}
              title={def.title}
              onClick={() => (active ? (phone ? minimizeAll() : minAnim(w.id)) : focus(w.id))}
            >
              <def.icon size={22} />
              <span>{def.title}</span>
            </button>
          );
        })}
        <MonthStrip s={s} />
        {!phone && <MonthsBar day={s.day} />}
        <div className="task-clock">{clock}</div>
      </footer>
    </div>

      <Toasts s={s} open={open} />
      <ArenaBanner s={s} open={open} />
      <AchievementToasts s={s} />
      <FeelLayer />
      <Juice s={s} onRelease={setReleased} />
      <SceneLive s={s} />
      <ClientFeed s={s} />
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
      {store.simError !== null && <SimErrorDialog error={store.simError} />}
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
  /** Раздел только что открылся: появление с кольцом. */
  fresh?: boolean;
}) {
  const { def, count, selected, onOpen, newSince, day, fresh } = props;
  return (
    <button className={`desk-icon${selected ? ' selected' : ''}${fresh ? ' fresh' : ''}`} onClick={onOpen} data-tutorial={`icon-${def.id}`}>
      <def.icon size={56} />
      {count > 0 && (
        <span className="count" key={count}>
          {count}
        </span>
      )}
      {newSince != null && day !== undefined && isFresh(day, newSince) && <span className="new-badge desk-new">Новое</span>}
      <span className="icon-label">{def.title}</span>
    </button>
  );
}

/** Значок раздела для круга в заголовке окна - тот же белый контурный, что в колонке слева. */
const RAIL = Object.fromEntries(WINDOWS.map((d) => [d.id, ({ size }: { size?: number }) => <RailIcon id={d.id} size={size} />])) as Record<WindowId, (p: { size?: number }) => ReturnType<typeof RailIcon>>;

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** Полоса месяцев года внизу экрана: прошедшие светлее, текущий - бирюзой с полосой прошедших дней. */
function MonthsBar({ day }: { day: number }) {
  const d = dayToDate(day);
  return (
    <div className="months-bar" aria-label={`${d.year} год`}>
      <b className="mb-year">{d.year}</b>
      {MONTH_SHORT.map((m, i) => (
        <span key={m} className={i + 1 < d.month ? 'past' : i + 1 === d.month ? 'now' : undefined}>
          {i + 1 === d.month && <i style={{ width: `${Math.round(((d.day - 1) / 30) * 100)}%` }} />}
          <em>{m}</em>
        </span>
      ))}
    </div>
  );
}

/**
 * Ошибка в симуляции: время стоит. День мог пройти наполовину (часть расходов уже списана), поэтому надёжнее вернуться
 * к автосохранению; можно и продолжить как есть. Текст ошибки - для отчёта разработчику.
 */
function SimErrorDialog({ error }: { error: string }) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [auto] = useState(() => listSlots().find((x) => x.id === 'auto')?.meta ?? null);
  return (
    <Dialog
      title="Ошибка в игре"
      wide
      onClose={() => store.dismissSimError()}
      footer={
        <>
          <button className="btn" onClick={() => store.quit()}>
            В главное меню
          </button>
          <button className="btn" onClick={() => store.dismissSimError()}>
            Продолжить
          </button>
          {auto && (
            <button className="btn primary" onClick={() => setLoadError(store.loadSlot('auto'))}>
              Загрузить автосохранение
            </button>
          )}
        </>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <div>
          В расчётах игры произошла ошибка, время остановлено. Часть изменений могла уже примениться, поэтому надёжнее загрузить
          автосохранение{auto ? ` («${auto.labName}», ${formatDateShort(auto.day)})` : ''}.
        </div>
        <div className="small muted" style={{ wordBreak: 'break-word' }}>
          Текст ошибки: {error}
        </div>
        <ErrorText error={loadError} />
      </div>
    </Dialog>
  );
}

function QuitDialog({ onClose }: { onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  // Один раз при открытии: listSlots разбирает все ячейки целиком, а Game перерисовывается на каждом ходу.
  const [auto] = useState(() => listSlots().find((x) => x.id === 'auto')?.meta ?? null);
  const day = store.state?.day ?? null;
  const finished = !!store.state?.outcome;
  function quit() {
    onClose();
    store.quit();
  }
  function saveAndQuit() {
    // В ячейку автосохранения: «Продолжить» в главном меню откроет партию с этого дня.
    if (!store.saveToSlot('auto')) {
      setError('Сохранить не удалось: хранилище переполнено или недоступно.');
      return;
    }
    quit();
  }
  // Партия окончена («Посмотреть игру»): сохранять нечего, автосохранение остаётся с последнего живого дня.
  if (finished) {
    return (
      <Dialog
        title="Выйти в главное меню"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={onClose}>
              Отмена
            </button>
            <button className="btn primary" onClick={quit}>
              Выйти
            </button>
          </>
        }
      >
        <div className="col" style={{ gap: 6 }}>
          <div>Партия окончена, сохранять нечего. Автосохранение остаётся с последнего игрового дня.</div>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="Выйти в главное меню"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn danger" onClick={quit}>
            Выйти без сохранения
          </button>
          <button className="btn primary" onClick={saveAndQuit}>
            Сохранить и выйти
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 6 }}>
        <div>
          Сейчас в игре {day !== null ? formatDateShort(day) : '-'}. Последнее автосохранение:{' '}
          {auto ? `${formatDateShort(auto.day)}, ${auto.labName}` : 'нет'}.
        </div>
        <div className="small muted">«Сохранить и выйти» запишет партию в автосохранение: «Продолжить» в главном меню вернёт к этому дню.</div>
        <ErrorText error={error} />
      </div>
    </Dialog>
  );
}
