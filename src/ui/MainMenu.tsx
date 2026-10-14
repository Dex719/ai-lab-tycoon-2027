// Главное меню и его окна: «Настройка игры», «Загрузить», «Настройки».

import { useState } from 'react';
import { START_CASH } from '../sim/constants';
import { DIFFICULTY, DIFFICULTY_IDS, type Difficulty } from '../sim/rivalry';
import { formatDateShort } from '../sim/time';
import { ConfirmDialog, Dialog, ErrorText } from './components/common';
import { fmtMoney } from './format';
import { fmtRank } from './labels';
import { deleteSlot, exportCode, formatSavedAt, importCode, latestSlot, listSlots, MANUAL_SLOTS, type SlotId, type SlotInfo } from './saves';
import { AchievementsDialog } from './Achievements';
import { applyRealNames } from './realNamesDom';
import { playSound } from './sound';
import { getSettings, setSettings } from './settings';
import { store } from './store';

export const VERSION = 'v0.2';
const NAME_MAX = 22;
const FOUNDER_MAX = 24;

type MenuDialog = null | 'new' | 'load' | 'settings' | 'achievements';

export function MainMenu() {
  const [dialog, setDialog] = useState<MenuDialog>(null);
  const [error, setError] = useState<string | null>(null);
  const last = latestSlot();

  function cont() {
    if (last === null) return;
    setError(store.loadSlot(last));
  }

  return (
    <div className="menu-screen">
      <div className="menu-title">AI Lab Tycoon</div>
      <div className="menu-sub-title">2017-2024</div>
      <nav className="menu-items" aria-label="Главное меню">
        {last !== null && (
          <button className="menu-item" onClick={cont}>
            Продолжить
          </button>
        )}
        <button className="menu-item" onClick={() => setDialog('new')}>
          Новая игра
        </button>
        <button className="menu-item" onClick={() => setDialog('load')}>
          Загрузить
        </button>
        <button className="menu-item" onClick={() => setDialog('achievements')}>
          Достижения
        </button>
        <button className="menu-item" onClick={() => setDialog('settings')}>
          Настройки
        </button>
        {error && <div className="menu-sub" style={{ color: '#ff8a8a' }}>{error}</div>}
      </nav>
      <div className="version">{VERSION}</div>
      {dialog === 'new' && <NewGameDialog onClose={() => setDialog(null)} />}
      {dialog === 'load' && <SlotsDialog mode="load" onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'achievements' && <AchievementsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function NewGameDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Нейрон');
  const [founder, setFounder] = useState('');
  const [tutorial, setTutorial] = useState(true);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const valid = name.trim().length > 0;

  function start() {
    if (!valid) return;
    store.newGame(name, { founderName: founder, tutorial, difficulty });
  }

  return (
    <Dialog title="Настройка игры" onClose={onClose}>
      <form
        className="col"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <label className="col" style={{ gap: 4 }}>
          <span>Название лаборатории</span>
          <input type="text" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
          <span className="small muted num">
            {name.length}/{NAME_MAX}
          </span>
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span>Имя основателя</span>
          <input type="text" value={founder} maxLength={FOUNDER_MAX} onChange={(e) => setFounder(e.target.value)} />
          <span className="small muted num">
            {founder.length}/{FOUNDER_MAX}
          </span>
        </label>
        <div className="kv">
          <span>Дата начала</span>
          <span>01.01.2017</span>
          <span>Стартовый капитал</span>
          <span className="good">{fmtMoney(START_CASH)}</span>
          <span>Конец партии</span>
          <span>31.12.2024</span>
          <span title="Победа: ваша модель первая по Эло среди моделей, которые продаются через API, 31.12.2024">Цель</span>
          <span>{fmtRank(1)} среди моделей в продаже</span>
          <span>Соперники</span>
          <span>7 лабораторий</span>
        </div>
        <fieldset className="col" style={{ gap: 6, margin: 0, padding: 0, border: 0 }}>
          <legend style={{ padding: 0, marginBottom: 4 }}>Сложность</legend>
          <div className="row" role="radiogroup" aria-label="Сложность" style={{ gap: 18 }}>
            {DIFFICULTY_IDS.map((d) => (
              <label key={d} className="row" style={{ gap: 8 }} title={DIFFICULTY[d].description}>
                <input
                  type="radio"
                  name="difficulty"
                  value={d}
                  checked={difficulty === d}
                  onChange={() => setDifficulty(d)}
                  style={{ accentColor: 'var(--accent)', width: 16, height: 16, margin: 0 }}
                />
                <span>{DIFFICULTY[d].name}</span>
              </label>
            ))}
          </div>
          <span className="small muted">{DIFFICULTY[difficulty].description}</span>
        </fieldset>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} />
          <span>Обучение игре</span>
        </label>
        <button type="submit" className="btn primary wide" disabled={!valid}>
          Начать
        </button>
      </form>
    </Dialog>
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
                  <button className="btn small primary" onClick={() => (slot.meta ? setConfirm(slot.id) : save(slot.id))}>
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
  const toggle = (k: Exclude<keyof typeof settings, 'volume'>) => set(setSettings({ [k]: !settings[k] }));
  return (
    <Dialog
      title="Настройки"
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={onClose}>
          Готово
        </button>
      }
    >
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
          <span>Пауза, когда вкладка браузера скрыта</span>
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
        <label className="row" style={{ gap: 10 }}>
          <span>Громкость звука</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.volume * 100)}
            onChange={(e) => set(setSettings({ volume: Number(e.target.value) / 100 }))}
            onPointerUp={() => playSound('coin')}
            onKeyUp={() => playSound('coin')}
            style={{ flex: 1 }}
          />
          <span style={{ width: 44, textAlign: 'right' }}>{settings.volume > 0 ? `${Math.round(settings.volume * 100)} %` : 'Выкл.'}</span>
        </label>
        <div className="small muted">Управление: пробел - пауза. Кнопки скорости - на верхней панели.</div>
      </div>
    </Dialog>
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
