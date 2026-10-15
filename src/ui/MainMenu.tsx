// Главное меню и его окна: «Настройка игры», «Загрузить», «Настройки».

import { useEffect, useRef, useState } from 'react';
import { START_CASH } from '../sim/constants';
import { DIFFICULTY, DIFFICULTY_IDS, type Difficulty } from '../sim/rivalry';
import { formatDateShort } from '../sim/time';
import { ConfirmDialog, DenyNote, Dialog, ErrorText, useFlash, useModalFocus } from './components/common';
import { LABS } from '../data/labs';
import { IconClose, IconLogo } from './icons';
import './menu.css';
import { fmtMoney } from './format';
import { fmtRank } from './labels';
import { deleteSlot, exportCode, formatSavedAt, importCode, latestSlot, listSlots, MANUAL_SLOTS, type SlotId, type SlotInfo } from './saves';
import { AchievementsDialog } from './Achievements';
import { applyRealNames } from './realNamesDom';
import { musicSettingsChanged } from './music';
import { applySfxVolume, playSound } from './sound';
import { getSettings, setSettings } from './settings';
import { store } from './store';
import { desktop } from './desktop';
import { ScreenSettings } from './ScreenSettings';

export const VERSION = 'v0.2';
const NAME_MAX = 22;
const FOUNDER_MAX = 24;

type MenuDialog = null | 'new' | 'load' | 'settings' | 'achievements';

export function MainMenu() {
  const [dialog, setDialog] = useState<MenuDialog>(null);
  const [error, setError] = useState<string | null>(null);
  const last = latestSlot();
  const lastMeta = last !== null ? (listSlots().find((x) => x.id === last)?.meta ?? null) : null;

  function cont() {
    if (last === null) return;
    setError(store.loadSlot(last));
  }

  return (
    <div className="menu-screen mm">
      <MenuRacks />
      <h1 className="mm-title">AI Lab Tycoon</h1>
      <div className="mm-years">2017-2024</div>
      <nav className="mm-items" aria-label="Главное меню">
        {last !== null && (
          <button className="mm-item" onClick={cont}>
            Продолжить
            {lastMeta && (
              <span className="mm-item-s">
                {lastMeta.labName}, {formatDateShort(lastMeta.day)}
              </span>
            )}
          </button>
        )}
        <button className="mm-item" onClick={() => setDialog('new')}>
          Новая игра
        </button>
        <button className="mm-item" onClick={() => setDialog('load')}>
          Загрузить
        </button>
        <button className="mm-item" onClick={() => setDialog('achievements')}>
          Достижения
        </button>
        <button className="mm-item" onClick={() => setDialog('settings')}>
          Настройки
        </button>
        {desktop && (
          <button className="mm-item" onClick={() => desktop?.quit()}>
            Выход
          </button>
        )}
        <div className="mm-error" role="alert">
          {error}
        </div>
      </nav>
      <div className="version">{VERSION}</div>
      {dialog === 'new' && <NewGameDialog onClose={() => setDialog(null)} />}
      {dialog === 'load' && <SlotsDialog mode="load" onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'achievements' && <AchievementsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Ряд серверных стоек внизу экрана меню: силуэт будущей лаборатории. Рисунок неподвижный. */
const RACKS = 26;
const RACK_H = [150, 186, 122];

function MenuRacks() {
  const w = 46;
  const gap = 10;
  const total = RACKS * (w + gap) - gap;
  const top = Math.max(...RACK_H);
  return (
    <svg className="mm-racks" viewBox={`0 0 ${total} ${top}`} width={total} height={top} aria-hidden="true">
      {Array.from({ length: RACKS }, (_, i) => {
        const h = RACK_H[i % 3];
        const x = i * (w + gap);
        const y = top - h;
        const units = Math.floor((h - 6) / 18);
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} className="mm-rack" />
            {Array.from({ length: units }, (_, u) => (
              <g key={u}>
                <rect x={x + 4} y={y + 5 + u * 18} width={w - 8} height={13} className="mm-unit" />
                <circle cx={x + 10} cy={y + 11.5 + u * 18} r={2} className={(i * 7 + u * 3) % 11 === 0 ? 'mm-led warn' : 'mm-led'} />
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Сколько делений у сложности: лёгкая - одно, сложная - три. */
const DIFF_PIPS: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 3 };

function NewGameDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Нейрон');
  const [founder, setFounder] = useState('');
  const [tutorial, setTutorial] = useState(true);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [note, flash] = useFlash();
  const valid = name.trim().length > 0;
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>('new-game');
  const nameRef = useRef<HTMLInputElement>(null);
  // Окно получает фокус для Tab по кругу, затем курсор сразу встаёт в название лаборатории.
  useEffect(() => nameRef.current?.select(), []);

  function start() {
    if (!valid) {
      flash('Введите название лаборатории.');
      return;
    }
    store.newGame(name, { founderName: founder, tutorial, difficulty });
  }

  return (
    <div className="modal-backdrop ng-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div ref={ref} tabIndex={-1} className="dialog ng" role="dialog" aria-modal="true" aria-label="Настройка игры" onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">Настройка игры</span>
          <button className="wbtn close" onClick={onClose} aria-label="Закрыть" title="Закрыть">
            <IconClose size={14} />
          </button>
        </div>
        <form
          className="ng-form"
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <div className="ng-body">
            <div className="ng-col">
              <label className="ng-field">
                <span className="ng-l">Название лаборатории</span>
                <input ref={nameRef} className="ng-input" type="text" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
                <span className="ng-count">
                  {name.length}/{NAME_MAX}
                </span>
              </label>
              <label className="ng-field">
                <span className="ng-l">Имя основателя</span>
                <input type="text" value={founder} maxLength={FOUNDER_MAX} onChange={(e) => setFounder(e.target.value)} />
                <span className="ng-count">
                  {founder.length}/{FOUNDER_MAX}
                </span>
              </label>
              <div className="ng-l">Сложность</div>
              <div className="ng-diffs" role="radiogroup" aria-label="Сложность">
                {DIFFICULTY_IDS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={difficulty === d}
                    className={`ng-diff d-${d}${difficulty === d ? ' on' : ''}`}
                    onClick={() => setDifficulty(d)}
                  >
                    <span className="ng-pips" aria-hidden="true">
                      {[1, 2, 3].map((i) => (
                        <i key={i} className={i <= DIFF_PIPS[d] ? 'on' : undefined} />
                      ))}
                    </span>
                    {DIFFICULTY[d].name}
                  </button>
                ))}
              </div>
              <div className="ng-diff-desc">{DIFFICULTY[difficulty].description}</div>
              <label className="row ng-tutor">
                <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} />
                <span>Обучение игре</span>
              </label>
            </div>
            <div className="ng-col">
              <div className="ng-sign" aria-hidden="true">
                <IconLogo size={22} />
                <b>{name.trim() || 'Лаборатория'}</b>
              </div>
              <dl className="ng-kv">
                <dt>Дата начала</dt>
                <dd>01.01.2017</dd>
                <dt>Стартовый капитал</dt>
                <dd className="good">{fmtMoney(START_CASH)}</dd>
                <dt>Конец партии</dt>
                <dd>31.12.2024</dd>
                <dt>Соперники</dt>
                <dd>
                  <span className="ng-labs" aria-hidden="true">
                    {LABS.map((l) => (
                      <i key={l.id} style={{ background: l.color }} />
                    ))}
                  </span>
                  {LABS.length} лабораторий
                </dd>
              </dl>
              <div className="ng-goal">
                <span className="ng-l">Цель</span>
                <b>Лучшая модель на «Арене» 31.12.2024</b>
              </div>
            </div>
          </div>
          <div className="ng-foot">
            <span className="guard ng-start-wrap">
              <button type="submit" className="btn primary big wide ng-start" aria-disabled={!valid || undefined}>
                Начать
              </button>
              <DenyNote text={note} />
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

function slotTitle(id: SlotId): string {
  return id === 'auto' ? 'Авто' : String(id);
}

function SlotRow({ slot, children }: { slot: SlotInfo; children: React.ReactNode }) {
  const m = slot.meta;
  return (
    <div className={`slot${m ? '' : ' empty'}`}>
      <div className="n" title={slot.id === 'auto' ? 'Автосохранение в начале каждого месяца' : undefined}>
        {slotTitle(slot.id)}
      </div>
      <div>
        {m ? (
          <>
            <div className="t">{m.labName}</div>
            <div className="m">
              {formatDateShort(m.day)} · {fmtMoney(m.cash)} · {m.arenaRank !== null ? `${fmtRank(m.arenaRank)} в продаже` : 'моделей в продаже нет'}
            </div>
            <div className="m">
              Сохранено {formatSavedAt(m.savedAt)} · <span title={DIFFICULTY[m.difficulty].description}>Сложность: {DIFFICULTY[m.difficulty].name}</span>
            </div>
          </>
        ) : (
          <div className="t">{slot.broken ? 'Сохранение повреждено' : 'Пусто'}</div>
        )}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

/** Ячейки сохранений. mode='load' - загрузка (из меню и из игры), mode='save' - сохранение из игры. */
export function SlotsDialog({ mode, onClose }: { mode: 'load' | 'save'; onClose: () => void }) {
  const [slots, setSlots] = useState(listSlots);
  const [confirm, setConfirm] = useState<SlotId | null>(null); // перезапись при сохранении
  const [del, setDel] = useState<SlotId | null>(null); // ячейка, удаление которой ждёт подтверждения
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SlotId | null>(null);
  const visible = mode === 'save' ? slots.filter((s) => s.id !== 'auto') : slots;
  const delSlot = del !== null ? (slots.find((x) => x.id === del) ?? null) : null;

  function load(id: SlotId) {
    const err = store.loadSlot(id);
    if (err) setError(err);
    else onClose();
  }

  function save(id: SlotId) {
    if (store.saveToSlot(id)) {
      setSaved(id);
      setError(null);
    } else {
      setError('Сохранить не удалось: хранилище браузера переполнено или недоступно.');
    }
    setConfirm(null);
    setSlots(listSlots());
  }

  function remove(id: SlotId) {
    deleteSlot(id);
    setDel(null);
    setSlots(listSlots());
  }

  return (
    <Dialog title={mode === 'load' ? 'Загрузить' : 'Сохранить'} onClose={onClose} wide>
      <div className="slots">
        {visible.map((slot) => (
          <SlotRow key={slot.id} slot={slot}>
            {mode === 'load' && slot.meta && (
              <>
                <button className="btn small primary" onClick={() => load(slot.id)}>
                  Загрузить
                </button>
                <button className="btn small danger" onClick={() => setDel(slot.id)}>
                  Удалить
                </button>
              </>
            )}
            {mode === 'save' && MANUAL_SLOTS.includes(slot.id) && (
              <>
                {saved === slot.id && <span className="small good">Сохранено</span>}
                {confirm === slot.id ? (
                  <>
                    <span className="small">Перезаписать?</span>
                    <button className="btn small primary" onClick={() => save(slot.id)}>
                      Перезаписать
                    </button>
                    <button className="btn small" onClick={() => setConfirm(null)}>
                      Отмена
                    </button>
                  </>
                ) : (
                  <button className="btn small" onClick={() => (slot.meta ? setConfirm(slot.id) : save(slot.id))}>
                    Сохранить сюда
                  </button>
                )}
              </>
            )}
          </SlotRow>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <ErrorText error={error} />
      </div>
      <GameCode mode={mode} onLoaded={onClose} />
      {del !== null && delSlot?.meta && (
        // Подтверждение выводится поверх этого окна; Escape в нём не должен закрывать и список ячеек.
        <span onKeyDown={(e) => e.stopPropagation()}>
          <ConfirmDialog title="Удаление сохранения" confirmLabel="Удалить" danger onConfirm={() => remove(del)} onClose={() => setDel(null)}>
            <div className="kv">
              <span>Ячейка</span>
              <span>{slotTitle(del)}</span>
              <span>Лаборатория</span>
              <span>{delSlot.meta.labName}</span>
              <span>Дата в игре</span>
              <span>{formatDateShort(delSlot.meta.day)}</span>
              <span>Сложность</span>
              <span>{DIFFICULTY[delSlot.meta.difficulty].name}</span>
              <span>Сохранено</span>
              <span>{formatSavedAt(delSlot.meta.savedAt)}</span>
            </div>
          </ConfirmDialog>
        </span>
      )}
    </Dialog>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, set] = useState(getSettings);
  const toggle = (k: Exclude<keyof typeof settings, 'volume' | 'music' | 'fps' | 'quality3d'>) => set(setSettings({ [k]: !settings[k] }));
  return (
    <Dialog
      title="Настройки"
      wide
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Готово
        </button>
      }
    >
      <div className="settings-grid">
      <div className="col" style={{ gap: 12 }}>
        <div className="settings-h">Пауза, когда</div>
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnImportant} onChange={() => toggle('pauseOnImportant')} />
          <span title="Решение в почте, деньги кончились, провал контракта">пришло важное письмо</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnReady} onChange={() => toggle('pauseOnReady')} />
          <span>модель обучена</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnResearch} onChange={() => toggle('pauseOnResearch')} />
          <span>исследование завершено</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnTender} onChange={() => toggle('pauseOnTender')} />
          <span>выигран тендер</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnGoal} onChange={() => toggle('pauseOnGoal')} />
          <span>выполнена цель года</span>
        </label>
        <div className="settings-h">Прочее</div>
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnHidden} onChange={() => toggle('pauseOnHidden')} />
          <span>{desktop ? 'Пауза, когда окно игры свёрнуто' : 'Пауза, когда вкладка браузера скрыта'}</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.toasts} onChange={() => toggle('toasts')} />
          <span>Всплывающие уведомления</span>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.realNames}
            onChange={() => {
              const next = setSettings({ realNames: !settings.realNames });
              set(next);
              applyRealNames(next.realNames);
            }}
          />
          <span>Оригинальные названия</span>
        </label>
        <div className="small muted">Показывает настоящие названия компаний, моделей и тестов. Сохранения не меняются.</div>
        <div className="small muted">Управление: пробел - пауза. Кнопки скорости - на верхней панели.</div>
      </div>
      <div className="col" style={{ gap: 12 }}>
        <div className="settings-h">Экран</div>
        <ScreenSettings />
        <div className="settings-h">Звук</div>
        <VolumeRow
          label="Музыка"
          value={settings.music}
          onChange={(v) => {
            set(setSettings({ music: v }));
            musicSettingsChanged();
          }}
        />
        <VolumeRow
          label="Звуки"
          value={settings.volume}
          onChange={(v) => {
            set(setSettings({ volume: v }));
            applySfxVolume();
          }}
          onRelease={() => playSound('coin')}
        />
      </div>
      </div>
    </Dialog>
  );
}

/** Ползунок громкости 0-100 % с шагом 5; 0 - «Выкл.». */
function VolumeRow({ label, value, onChange, onRelease }: { label: string; value: number; onChange: (v: number) => void; onRelease?: () => void }) {
  return (
    <label className="row" style={{ gap: 10 }}>
      <span style={{ width: 64 }}>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onRelease}
        onKeyUp={onRelease}
        style={{ flex: 1 }}
      />
      <span style={{ width: 44, textAlign: 'right' }}>{value > 0 ? `${Math.round(value * 100)} %` : 'Выкл.'}</span>
    </label>
  );
}

/** Код партии: в «Сохранить» - получить и скопировать, в «Загрузить» - вставить и загрузить. */
function GameCode({ mode, onLoaded }: { mode: 'load' | 'save'; onLoaded: () => void }) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    if (!store.state) return;
    setBusy(true);
    try {
      setCode(await exportCode(store.state));
      setError(null);
    } catch {
      setError('Код получить не удалось: браузер не умеет сжимать данные.');
    }
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setNote('Код скопирован');
    } catch {
      setNote('Выделите код и скопируйте вручную (Ctrl+C)');
    }
  }

  async function load() {
    setBusy(true);
    const r = await importCode(code);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    store.start(r.state);
    onLoaded();
  }

  return (
    <div className="game-code">
      <div className="game-code-h">Код партии</div>
      {mode === 'save' ? (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small" disabled={busy || !store.state} onClick={() => void make()}>
              Получить код
            </button>
            {code && (
              <button className="btn small primary" onClick={() => void copy()}>
                Скопировать
              </button>
            )}
            {code && <span className="small muted">{Math.ceil(code.length / 1024)} КБ</span>}
            {note && <span className="small good">{note}</span>}
          </div>
          {code && <textarea className="game-code-text" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />}
        </>
      ) : (
        <>
          <textarea
            className="game-code-text"
            placeholder="Вставьте код партии"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
          />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small primary" disabled={busy || !code.trim()} onClick={() => void load()}>
              Загрузить из кода
            </button>
          </div>
        </>
      )}
      <ErrorText error={error} />
    </div>
  );
}
