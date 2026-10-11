// Экраны «Новая игра» и «Итог» (FR-1.4, FR-1.5, FR-13).

import { useRef, useState } from 'react';
import { valuation } from '../sim/investors';
import { leaderboard } from '../sim/leaderboard';
import { AUTOSAVE_KEY, deserialize, SAVE_KEY } from '../sim/save';
import { playerBestArenaRank } from '../sim/tick';
import { formatDate } from '../sim/time';
import type { GameState } from '../sim/types';
import { ErrorText } from './components/common';
import { fmtElo, fmtMoney, fmtShare } from './format';
import { readSave, store } from './store';

export function NewGameScreen() {
  const [name, setName] = useState('Моя лаборатория');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const manual = readSave(SAVE_KEY);
  const auto = readSave(AUTOSAVE_KEY);

  function load(json: string | null) {
    if (!json) return;
    const r = deserialize(json);
    if (r.ok) store.start(r.state);
    else setError(r.error);
  }

  function loadFile(file: File | undefined) {
    if (!file) return;
    file.text().then(load, () => setError('Не удалось прочитать файл'));
  }

  return (
    <div className="screen">
      <div className="panel card">
        <h1>AI Lab Tycoon</h1>
        <h2>2017–2024: от первых трансформеров до гонки за «Арену»</h2>
        <div className="col">
          <label className="muted" htmlFor="lab-name">
            Название лаборатории
          </label>
          <input
            id="lab-name"
            type="text"
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && store.newGame(name)}
            autoFocus
          />
          <button className="btn primary" onClick={() => store.newGame(name)}>
            Новая игра
          </button>
          <div className="row">
            <button className="btn grow" disabled={!manual} onClick={() => load(manual)}>
              Загрузить сохранение
            </button>
            <button className="btn grow" disabled={!auto} onClick={() => load(auto)}>
              Загрузить автосохранение
            </button>
          </div>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Загрузить из файла…
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => loadFile(e.target.files?.[0])} />
          <ErrorText error={error} />
          <div className="muted small">
            Вы основываете ИИ-лабораторию 1 января 2017 года с $3 млн. Семь настоящих лабораторий выпускают свои модели
            как в жизни. Цель — к концу 2024 года стать №1 на «Арене».
          </div>
        </div>
      </div>
    </div>
  );
}

export function EndScreen({ s, onWatch }: { s: GameState; onWatch: () => void }) {
  const rank = playerBestArenaRank(s);
  const rows = leaderboard(s).filter((r) => r.ref.kind === 'player');
  const best = rows.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.elo > b.elo ? r : b), null);
  const v = valuation(s);
  const title =
    s.outcome === 'victory' ? '🏆 Победа: №1 на «Арене»' : s.outcome === 'bankrupt' ? '💀 Банкротство' : '🏁 Срез пройден';
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="titlebar">
          <span className="t">{title}</span>
        </div>
        <div className="body">
          <div className="col">
            <div>
              {s.outcome === 'bankrupt'
                ? `${s.labName} закрылась ${formatDate(s.day)}: деньги кончились и не вернулись за 60 дней.`
                : `${s.labName} дошла до конца 2024 года.`}
            </div>
            <table className="grid">
              <tbody>
                <tr>
                  <td>Место на «Арене»</td>
                  <td className="num">{rank ?? '—'}</td>
                </tr>
                <tr>
                  <td>Лучшая модель</td>
                  <td className="num">{best ? `${best.name} (Эло ${fmtElo(best.elo)})` : '—'}</td>
                </tr>
                <tr>
                  <td>Деньги</td>
                  <td className="num">{fmtMoney(s.cash)}</td>
                </tr>
                <tr>
                  <td>Оценка компании</td>
                  <td className="num">{fmtMoney(v.total)}</td>
                </tr>
                <tr>
                  <td>Ваша доля</td>
                  <td className="num">
                    {fmtShare(s.founderShare)} ≈ {fmtMoney(v.total * s.founderShare)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="choices">
          <button className="btn primary" onClick={() => store.quit()}>
            Новая игра
          </button>
          <button className="btn" onClick={onWatch}>
            Посмотреть итоги в окнах
          </button>
        </div>
      </div>
    </div>
  );
}
