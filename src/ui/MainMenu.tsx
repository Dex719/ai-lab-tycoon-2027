// Главное меню и его окна: «Настройка игры», «Загрузить», «Настройки».

import { useState } from 'react';
import { START_CASH } from '../sim/constants';
import { formatDateShort } from '../sim/time';
import { Dialog, ErrorText } from './components/common';
import { fmtMoney } from './format';
import { fmtRank } from './labels';
import { deleteSlot, formatSavedAt, latestSlot, listSlots, MANUAL_SLOTS, type SlotId, type SlotInfo } from './saves';
import { getSettings, setSettings } from './settings';
import { store } from './store';

export const VERSION = 'v0.2';
const NAME_MAX = 22;
const FOUNDER_MAX = 24;

type MenuDialog = null | 'new' | 'load' | 'settings';

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
        <button className="menu-item" onClick={() => setDialog('settings')}>
          Настройки
        </button>
        {error && <div className="menu-sub" style={{ color: '#ff8a8a' }}>{error}</div>}
      </nav>
      <div className="version">{VERSION}</div>
      {dialog === 'new' && <NewGameDialog onClose={() => setDialog(null)} />}
      {dialog === 'load' && <SlotsDialog mode="load" onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function NewGameDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Нейрон');
  const [founder, setFounder] = useState('');
  const [tutorial, setTutorial] = useState(true);
  const valid = name.trim().length > 0;

  function start() {
    if (!valid) return;
    store.newGame(name, { founderName: founder, tutorial });
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
          <span>Цель</span>
          <span>{fmtRank(1)} на «Арене»</span>
          <span>Соперники</span>
          <span>7 лабораторий</span>
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} />
          <span>Обучение для новичков</span>
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
              {formatDateShort(m.day)} · {fmtMoney(m.cash)} · {m.arenaRank !== null ? `${fmtRank(m.arenaRank)} на «Арене»` : 'моделей на «Арене» нет'}
            </div>
            <div className="m">Сохранено {formatSavedAt(m.savedAt)}</div>
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
  const [confirm, setConfirm] = useState<SlotId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SlotId | null>(null);
  const visible = mode === 'save' ? slots.filter((s) => s.id !== 'auto') : slots;

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
    setConfirm(null);
    setSlots(listSlots());
  }

  return (
    <Dialog title={mode === 'load' ? 'Загрузить' : 'Сохранить'} onClose={onClose} wide>
      <div className="slots">
        {visible.map((slot) => (
          <SlotRow key={slot.id} slot={slot}>
            {mode === 'load' && slot.meta && (
              <>
                {confirm === slot.id ? (
                  <>
                    <span className="small">Удалить?</span>
                    <button className="btn small danger" onClick={() => remove(slot.id)}>
                      Удалить
                    </button>
                    <button className="btn small" onClick={() => setConfirm(null)}>
                      Отмена
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn small primary" onClick={() => load(slot.id)}>
                      Загрузить
                    </button>
                    <button className="btn small danger" onClick={() => setConfirm(slot.id)}>
                      Удалить
                    </button>
                  </>
                )}
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
    </Dialog>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, set] = useState(getSettings);
  const toggle = (k: keyof typeof settings) => set(setSettings({ [k]: !settings[k] }));
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
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnImportant} onChange={() => toggle('pauseOnImportant')} />
          <span>Пауза при важных письмах</span>
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.pauseOnHidden} onChange={() => toggle('pauseOnHidden')} />
          <span>Пауза, когда вкладка браузера скрыта</span>
        </label>
        <div className="small muted">Управление: пробел - пауза. Кнопки скорости - на верхней панели.</div>
      </div>
    </Dialog>
  );
}
