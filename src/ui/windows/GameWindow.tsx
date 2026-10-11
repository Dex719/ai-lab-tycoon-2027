// Окно «Игра» (FR-13): сохранения в браузере и в файле, новая игра, управление.

import { useRef, useState, type ChangeEvent } from 'react';
import type { WindowProps } from '.';
import { AUTOSAVE_KEY, deserialize, SAVE_KEY, serialize } from '../../sim/save';
import { dayToDate, formatDate } from '../../sim/time';
import { ErrorText } from '../components/common';
import { readSave, saveTo, store } from '../store';

interface Note {
  ok: boolean;
  text: string;
}

/** Дата игры для имени файла: 2017-06-12. */
function isoDay(day: number): string {
  const d = dayToDate(day);
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export default function GameWindow({ s }: WindowProps) {
  const [note, setNote] = useState<Note | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showOk = (text: string) => setNote({ ok: true, text });
  const showErr = (text: string) => setNote({ ok: false, text });

  function save() {
    if (saveTo(SAVE_KEY, s)) showOk(`Сохранено: ${formatDate(s.day)}`);
    else showErr('Не удалось сохранить: браузер не дал записать данные.');
  }

  /** Загрузка заменяет текущую игру. Несовместимый файл не роняет интерфейс, а показывает ошибку (FR-13.4). */
  function applyJson(json: string) {
    const r = deserialize(json);
    if (!r.ok) {
      showErr(r.error);
      return;
    }
    store.start(r.state);
    showOk(`Загружено: ${formatDate(r.state.day)}`);
  }

  function loadSave() {
    const json = readSave(SAVE_KEY);
    if (json === null) showErr('Ручного сохранения в этом браузере пока нет.');
    else applyJson(json);
  }

  function loadAuto() {
    const json = readSave(AUTOSAVE_KEY);
    if (json === null) showErr('Автосохранения пока нет: оно появляется в начале каждого месяца.');
    else applyJson(json);
  }

  function exportFile() {
    const name = `ai-lab-${isoDay(s.day)}.json`;
    const url = URL.createObjectURL(new Blob([serialize(s)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showOk(`Файл выгружен: ${name}`);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // сбрасываем выбор, чтобы тот же файл можно было открыть снова
    if (!file) return;
    file.text().then(applyJson, () => showErr('Не удалось прочитать файл.'));
  }

  function newGame() {
    if (window.confirm('Начать заново? Несохранённый прогресс пропадёт.')) store.quit();
  }

  return (
    <div className="col">
      <div className="card">
        <div>
          Лаборатория: <b>{s.labName}</b>
        </div>
        <div className="muted small">Зерно генератора: {s.seed.toLocaleString('ru-RU')}</div>
        <div className="muted small">Дата в игре: {formatDate(s.day)}</div>
      </div>

      {store.autosaveError && (
        <div className="card" style={{ borderColor: 'var(--bad)' }}>
          <ErrorText error={store.autosaveError} />
        </div>
      )}

      <div className="col" style={{ gap: 4 }}>
        <div className="section-title">Сохранение в браузере</div>
        <div className="row">
          <button className="btn primary" onClick={save}>
            Сохранить
          </button>
          <button className="btn" onClick={loadSave}>
            Загрузить сохранение
          </button>
          <button className="btn" onClick={loadAuto}>
            Загрузить автосохранение
          </button>
        </div>
        <div className="muted small">
          «Сохранить» перезаписывает прошлое ручное сохранение. Автосохранение делается в начале каждого месяца и хранится
          отдельно.
        </div>
        <div className="warn small">Загрузка заменяет текущую игру: сохраните её заранее.</div>
      </div>

      <div className="col" style={{ gap: 4 }}>
        <div className="section-title">Файл</div>
        <div className="row">
          <button className="btn" onClick={exportFile}>
            Выгрузить в файл
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Загрузить из файла…
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onFile} />
        </div>
        <div className="muted small">Файл можно сохранить как резервную копию или перенести на другой компьютер.</div>
      </div>

      {note && (note.ok ? <div className="good small">{note.text}</div> : <ErrorText error={note.text} />)}

      <div className="col" style={{ gap: 4 }}>
        <div className="section-title">Управление</div>
        <div className="small">Пробел — пауза. Скорость ×1, ×2, ×4 — кнопки ▶ на верхней панели.</div>
      </div>

      <div className="col" style={{ gap: 4 }}>
        <div className="row">
          <button className="btn danger" onClick={newGame}>
            Новая игра
          </button>
        </div>
        <div className="muted small">Вернёт к выбору названия лаборатории. Несохранённый прогресс пропадёт.</div>
      </div>
    </div>
  );
}
