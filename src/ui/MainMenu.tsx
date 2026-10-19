// Главное меню и его окна: «Новая игра», «Загрузить», «Настройки».

import './alive.css';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { START_CASH } from '../sim/constants';
import { CHALLENGES, WORLD_MODS } from '../sim/challenges';
import { COFOUNDER_IDS, cofounderDef } from '../sim/cofounder';
import { COUNTRIES } from '../sim/country';
import { DIFFICULTY, DIFFICULTY_IDS, type Difficulty } from '../sim/rivalry';
import { COUNTRY_IDS, type ChallengeId, type CofounderId, type CountryId, type WorldModId } from '../sim/types';
import { CountryFlag } from './components/CountryFlag';
import { formatDateShort } from '../sim/time';
import { ConfirmDialog, DenyNote, Dialog, ErrorText, useFlash, useModalFocus } from './components/common';
import { LABS } from '../data/labs';
import { IconClose, IconLogo } from './icons';
import './menu.css';
import { fmtMoney } from './format';
import { fmtRank } from './labels';
import { deleteSlot, formatSavedAt, latestSlot, listSlots, MANUAL_SLOTS, type SlotId, type SlotInfo } from './saves';
import { AchievementsDialog } from './Achievements';
import { applyRealNames } from './realNamesDom';
import { musicSettingsChanged } from './music';
import { applySfxVolume, playSound } from './sound';
import { getSettings, setSettings } from './settings';
import { store } from './store';
import { ALLOC_ROWS } from './alloc';
import type { LabSpec } from './three/specs';
import { View3D } from './three/View3D';
import { desktop } from './desktop';
import { ScreenSettings } from './ScreenSettings';

export const VERSION = 'v0.3';
const NAME_MAX = 22;
const FOUNDER_MAX = 24;

type MenuDialog = null | 'new' | 'load' | 'settings' | 'achievements';

export function MainMenu() {
  const [dialog, setDialog] = useState<MenuDialog>(null);
  const [error, setError] = useState<string | null>(null);
  // Ячейки разбираются целиком (с состоянием партии): один раз, и снова - когда закрылся диалог (сохранили, удалили).
  const slots = useMemo(() => listSlots(), [dialog]);
  const last = latestSlot(slots);
  const lastMeta = last !== null ? (slots.find((x) => x.id === last)?.meta ?? null) : null;

  function cont() {
    if (last === null) return;
    setError(store.loadSlot(last));
  }

  return (
    <div className="menu-screen mm">
      <div className="mm-left">
        <h1 className="mm-title">AI Lab Tycoon</h1>
        <div className="mm-years">Своя ИИ-лаборатория, 2017-2024</div>
        {last !== null && (
          <button className="mm-cont" onClick={cont}>
            <span className="mm-cont-k">Продолжить</span>
            {lastMeta && (
              <>
                <span className="mm-cont-n">{lastMeta.labName}</span>
                <span className="mm-cont-d">
                  {formatDateShort(lastMeta.day)} · {fmtMoney(lastMeta.cash)} ·{' '}
                  {lastMeta.arenaRank !== null ? `${fmtRank(lastMeta.arenaRank)} на «Арене»` : 'моделей на «Арене» нет'} ·{' '}
                  {DIFFICULTY[lastMeta.difficulty].name.toLowerCase()}
                </span>
              </>
            )}
          </button>
        )}
        <nav className="mm-items" aria-label="Главное меню">
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
        </nav>
        <div className="mm-error" role="alert">
          {error}
        </div>
      </div>
      <div className="mm-right" aria-hidden="true">
        <View3D spec={MENU_HALL} label="Лаборатория" className="mm-hall" />
      </div>
      <div className="version">{VERSION}</div>
      {dialog === 'new' && <NewGameDialog onClose={() => setDialog(null)} />}
      {dialog === 'load' && <SlotsDialog mode="load" onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'achievements' && <AchievementsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Лаборатория на экране меню: офис с людьми за работой на траве - то, что игрок построит. */
const MENU_HALL: LabSpec = {
  kind: 'lab',
  stage: 1,
  people: 8,
  freeSeats: 0,
  racks: 3,
  racksLit: 20,
  rackColors: ALLOC_ROWS.slice(0, 3).map((r) => r.color),
  research: true,
  training: true,
  models: ['#e8c34a', '#2f80e4', '#1fa8a0'],
  cups: ['goals'],
  base: '#5f8f45',
};

/** Чем сложности отличаются, словами и числами (из DIFFICULTY). */
function diffRows(d: Difficulty): { k: string; v: string; tone?: 'good' | 'bad' }[] {
  const def = DIFFICULTY[d];
  const rent = Math.round((def.rentPrice - 1) * 100);
  const exp = Math.round((def.exposure - 1) * 100);
  return [
    { k: 'Аренда карт', v: rent === 0 ? 'обычная цена' : rent < 0 ? `дешевле на ${-rent} %` : `дороже на ${rent} %`, tone: rent < 0 ? 'good' : rent > 0 ? 'bad' : undefined },
    { k: 'Ответ соперников', v: d === 'easy' ? 'редко' : d === 'normal' ? 'на ваши успехи' : 'быстро и часто', tone: d === 'easy' ? 'good' : d === 'hard' ? 'bad' : undefined },
    { k: 'Подгонку раскрывают', v: exp === 0 ? 'обычно' : exp < 0 ? `реже на ${-exp} %` : `чаще на ${exp} %`, tone: exp < 0 ? 'good' : exp > 0 ? 'bad' : undefined },
  ];
}

function NewGameDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('Нейрон');
  const [founder, setFounder] = useState('');
  const [tutorial, setTutorial] = useState(true);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [country, setCountry] = useState<CountryId>('us');
  const [challenges, setChallenges] = useState<ChallengeId[]>([]);
  const [worldMods, setWorldMods] = useState<WorldModId[]>([]);
  const [cofounder, setCofounder] = useState<CofounderId | null>('engineer');
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const scoreMult = 1 + [...CHALLENGES.filter((c) => challenges.includes(c.id)), ...WORLD_MODS.filter((m) => worldMods.includes(m.id))].reduce((a, x) => a + x.score, 0);
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
    store.newGame(name, { founderName: founder, tutorial, difficulty, country, challenges, worldMods, cofounder: cofounder ?? undefined });
  }

  return (
    <div className="modal-backdrop ng-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div ref={ref} tabIndex={-1} className="dialog ng" role="dialog" aria-modal="true" aria-label="Новая игра" onKeyDown={onKeyDown}>
        <div className="titlebar">
          <span className="t">Новая игра</span>
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
            <section className="ng-sec">
              <h3 className="ng-h">Лаборатория</h3>
              <div className="ng-sign" aria-hidden="true">
                <IconLogo size={22} />
                <b>{name.trim() || 'Лаборатория'}</b>
                <span>{COUNTRIES[country].city}</span>
              </div>
              <label className="ng-field">
                <span className="ng-l">Название</span>
                <input ref={nameRef} className="ng-input" type="text" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
                <span className="ng-count">
                  {name.length}/{NAME_MAX}
                </span>
              </label>
              <label className="ng-field">
                <span className="ng-l">Основатель <small>(необязательно)</small></span>
                <input type="text" value={founder} maxLength={FOUNDER_MAX} placeholder="Ваше имя" onChange={(e) => setFounder(e.target.value)} />
                <span className="ng-count">
                  {founder.length}/{FOUNDER_MAX}
                </span>
              </label>
              <h3 className="ng-h ng-h2">Страна</h3>
              <div className="ng-countries" role="radiogroup" aria-label="Страна">
                {COUNTRY_IDS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={country === c}
                    className={`ng-country${country === c ? ' on' : ''}`}
                    onClick={() => setCountry(c)}
                  >
                    <CountryFlag id={c} size={20} />
                    <span>{COUNTRIES[c].name}</span>
                  </button>
                ))}
              </div>
              <ul className="ng-perks" aria-label={`Особенности: ${COUNTRIES[country].name}`}>
                {COUNTRIES[country].pros.map((p) => (
                  <li key={p} className="good">
                    <b aria-hidden="true">+</b>
                    <span>{p}</span>
                  </li>
                ))}
                {COUNTRIES[country].cons.map((p) => (
                  <li key={p} className="bad">
                    <b aria-hidden="true">-</b>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <h3 className="ng-h ng-h2">Сооснователь</h3>
              <div className="ng-countries ng-cof" role="radiogroup" aria-label="Сооснователь">
                {[...COFOUNDER_IDS, null].map((c) => (
                  <button
                    key={c ?? 'none'}
                    type="button"
                    role="radio"
                    aria-checked={cofounder === c}
                    className={`ng-country${cofounder === c ? ' on' : ''}`}
                    onClick={() => setCofounder(c)}
                  >
                    <span>{c ? cofounderDef(c).role : 'Нет'}</span>
                  </button>
                ))}
              </div>
              <p className="ng-cof-s">
                {cofounder
                  ? `${cofounderDef(cofounder).name}: ${cofounderDef(cofounder).perk.charAt(0).toLowerCase()}${cofounderDef(cofounder).perk.slice(1)}.`
                  : 'Все решения ваши.'}
              </p>
            </section>
            <section className="ng-sec">
              <h3 className="ng-h">Сложность</h3>
              <div className="ng-cards" role="radiogroup" aria-label="Сложность">
                {DIFFICULTY_IDS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={difficulty === d}
                    className={`ng-card${difficulty === d ? ' on' : ''}`}
                    onClick={() => setDifficulty(d)}
                  >
                    <span className="ng-card-h">
                      <span className="ng-radio" aria-hidden="true" />
                      {DIFFICULTY[d].name}
                    </span>
                    <span className="ng-card-kv">
                      {diffRows(d).map((r) => (
                        <span key={r.k} className="ng-card-r">
                          <span>{r.k}</span>
                          <b className={r.tone}>{r.v}</b>
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="ng-sec">
              <h3 className="ng-h">Партия</h3>
              <dl className="ng-kv">
                <dt>Начало</dt>
                <dd>1 января 2017</dd>
                <dt>Конец</dt>
                <dd>31 декабря 2024</dd>
                <dt>На счёте</dt>
                <dd className="good">{fmtMoney(START_CASH)}</dd>
              </dl>
              <div className="ng-goal">
                <span className="ng-l">Цель</span>
                <b>Лучшая модель на «Арене» 31 декабря 2024 года</b>
              </div>
              <div className="ng-goal">
                <span className="ng-l">Соперники уже работают над моделями</span>
                <span className="ng-rivals">
                  {LABS.filter((l) => l.id === 'openbrain' || l.id === 'gogle').map((l) => (
                    <span key={l.id} className="ng-rival">
                      <i style={{ background: l.color }} />
                      {l.name}
                    </span>
                  ))}
                </span>
                <span className="ng-l">Их первые модели и другие лаборатории появятся позже.</span>
              </div>
              <div className="ng-goal ng-ch">
                <span className="ng-l">
                  Испытания и условия мира <small>(необязательно)</small>
                </span>
                {CHALLENGES.map((c) => (
                  <label key={c.id} className="ng-ch-row" title={c.text}>
                    <span>{c.name}</span>
                    <small>{c.text}</small>
                    <input type="checkbox" className="ng-switch" checked={challenges.includes(c.id)} onChange={() => setChallenges((l) => toggle(l, c.id))} />
                  </label>
                ))}
                {WORLD_MODS.map((m) => (
                  <label key={m.id} className="ng-ch-row" title={m.text}>
                    <span>{m.name}</span>
                    <small>{m.text}</small>
                    <input type="checkbox" className="ng-switch" checked={worldMods.includes(m.id)} onChange={() => setWorldMods((l) => toggle(l, m.id))} />
                  </label>
                ))}
                <span className={`ng-ch-mult${scoreMult > 1.001 ? ' good' : scoreMult < 0.999 ? ' bad' : ''}`}>
                  Счёт партии ×{String(Math.round(Math.max(0.5, scoreMult) * 100) / 100).replace('.', ',')}
                </span>
              </div>
              <label className="ng-ch-row ng-tutor">
                <span>Обучение игре: подсказки по шагам</span>
                <input type="checkbox" className="ng-switch" checked={tutorial} onChange={(e) => setTutorial(e.target.checked)} />
              </label>
            </section>
          </div>
          <div className="ng-foot">
            <button type="button" className="btn" onClick={onClose}>
              Отмена
            </button>
            <span className="guard ng-start-wrap">
              <button type="submit" className="btn primary big ng-start" aria-disabled={!valid || undefined}>
                Начать игру
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
      <div className={`n${slot.id === 'auto' ? ' auto' : ''}`} title={slot.id === 'auto' ? 'Автосохранение в начале каждого месяца' : undefined}>
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
  const [loadAsk, setLoadAsk] = useState<SlotId | null>(null); // загрузка поверх идущей партии ждёт подтверждения
  const visible = mode === 'save' ? slots.filter((s) => s.id !== 'auto') : slots;
  const inGame = !!store.state && !store.state.outcome;
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
                {loadAsk === slot.id ? (
                  <>
                    <span className="small">Текущая партия не сохранится. Загрузить?</span>
                    <button className="btn small primary" onClick={() => load(slot.id)}>
                      Загрузить
                    </button>
                    <button className="btn small" onClick={() => setLoadAsk(null)}>
                      Отмена
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn small primary" onClick={() => (inGame ? setLoadAsk(slot.id) : load(slot.id))}>
                      Загрузить
                    </button>
                    <button className="btn small danger" onClick={() => setDel(slot.id)}>
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

type SettingsTab = 'game' | 'screen' | 'sound' | 'keys';
const SETTINGS_TABS: { id: SettingsTab; name: string }[] = [
  { id: 'game', name: 'Игра' },
  { id: 'screen', name: 'Экран' },
  { id: 'sound', name: 'Звук' },
  { id: 'keys', name: 'Управление' },
];

/** Настройки по разделам: слева список разделов, справа один раздел; высота окна постоянная. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [settings, set] = useState(getSettings);
  const [tab, setTab] = useState<SettingsTab>('game');
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
      <div className="st">
        <nav className="st-nav" role="tablist" aria-label="Разделы настроек">
          {SETTINGS_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`st-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
              {t.name}
            </button>
          ))}
        </nav>
        <div className="st-body" role="tabpanel">
          {tab === 'game' && (
            <div className="col" style={{ gap: 10 }}>
              <div className="settings-h">Ставить паузу, когда</div>
              <label className="row">
                <input type="checkbox" checked={settings.pauseOnImportant} onChange={() => toggle('pauseOnImportant')} />
                <span>пришло важное письмо: решение, деньги на исходе, контракт не успевает</span>
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
                <span>выигран тендер по вашей заявке</span>
              </label>
              <label className="row">
                <input type="checkbox" checked={settings.pauseOnGoal} onChange={() => toggle('pauseOnGoal')} />
                <span>выполнена цель года</span>
              </label>
              <label className="row">
                <input type="checkbox" checked={settings.pauseOnHidden} onChange={() => toggle('pauseOnHidden')} />
                <span>{desktop ? 'окно игры свёрнуто' : 'вкладка браузера скрыта'}</span>
              </label>
              <div className="settings-h">Прочее</div>
              <label className="row">
                <input type="checkbox" checked={settings.toasts} onChange={() => toggle('toasts')} />
                <span>Всплывающие уведомления о письмах</span>
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
                <span>Оригинальные названия компаний, моделей и тестов (сохранения не меняются)</span>
              </label>
            </div>
          )}
          {tab === 'screen' && (
            <div className="col" style={{ gap: 12 }}>
              <ScreenSettings />
            </div>
          )}
          {tab === 'sound' && (
            <div className="col" style={{ gap: 12 }}>
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
          )}
          {tab === 'keys' && (
            <dl className="st-keys">
              <dt>
                <kbd>Пробел</kbd>
              </dt>
              <dd>Пауза и продолжение</dd>
              <dt>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
              </dt>
              <dd>Скорость ×1, ×2, ×4</dd>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Закрыть диалог</dd>
              {desktop && (
                <>
                  <dt>
                    <kbd>F11</kbd> или <kbd>Alt</kbd>+<kbd>Enter</kbd>
                  </dt>
                  <dd>Полный экран или окно</dd>
                </>
              )}
            </dl>
          )}
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
        style={{ flex: 1, '--v': `${Math.round(value * 100)}%` } as CSSProperties}
      />
      <span style={{ width: 44, textAlign: 'right' }}>{value > 0 ? `${Math.round(value * 100)} %` : 'Выкл.'}</span>
    </label>
  );
}
