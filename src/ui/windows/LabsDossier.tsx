// «Лаборатории» в «Аналитике»: досье соперника. Слева список лабораторий со счётом обгонов, справа - досье выбранной:
// эмблема, характер одной строкой, личный счёт с вами (главное число), лучшая модель и цена, отношение к вам и
// последние ходы против вас. Внизу - последние ходы всех соперников.

import { useEffect, useState } from 'react';
import type { WindowProps } from '.';
import { duelOf, fightScore, mainRival, timesCount } from '../../sim/duel';
import { findRivalDefIn, moveName, rivalEloIn, rivalPriceIn, threatOf } from '../../sim/rivalry';
import { formatDateShort } from '../../sim/time';
import { LAB_IDS, type GameState, type LabId, type RivalModelDef } from '../../sim/types';
import { LabEmblem } from '../components/LabEmblem';
import { onDossier, takeDossier } from '../dossier';
import { fmtElo, fmtNum, fmtPrice, fmtShare } from '../format';
import { finite, OwnerTag, ownerName, safe } from './analyticsShared';
import { labRows, recentMoves } from './MarketWindow';
import './LabsDossier.css';

/** Характер одной строкой: кто это и чем отвечает. Полное описание - в подсказке. */
const LAB_LINE: Record<LabId, string> = {
  openbrain: 'Гегемон: держит первое место, цены снижает неохотно',
  antropik: 'Осторожный премиум: честные баллы и длинный контекст, цены не роняет',
  gogle: 'Быстрый последователь: масштаб и каналы продаж, действует медленно',
  zhipo: 'Ценовой боец: скидки и открытые веса',
  moonshoot: 'Длинный контекст: потребительская ниша, цены не трогает',
  deepcent: 'Дешёвый шок: дешевле всех, ведёт ценовые войны',
  alibabo: 'Открытые веса: экосистема и дешёвые версии моделей',
};

/** Сколько ходов против вас показывает досье. */
const DOSSIER_MOVES = 5;

interface BestModel {
  def: RivalModelDef;
  elo: number;
  price: number | null; // null - не продаётся по API
}

/** Лучшая по Эло вышедшая модель лаборатории (кроме только показанных). */
export function labBestModel(s: GameState, lab: LabId): BestModel | null {
  let best: BestModel | null = null;
  for (const id of s.rivalsReleased) {
    const def = findRivalDefIn(id);
    if (!def || def.lab !== lab || def.announcedOnly) continue;
    const elo = rivalEloIn(s, def);
    if (!best || elo > best.elo) best = { def, elo, price: def.api ? rivalPriceIn(s, def) : null };
  }
  return best;
}

/** Угроза, которую лаборатория видит в вас: слово и доля 0..1 (rivalry.threatOf). */
export function threatWord(total: number): string {
  if (total >= 0.5) return 'высокая';
  if (total >= 0.25) return 'заметная';
  if (total > 0) return 'низкая';
  return 'нет';
}

/**
 * Лаборатории в списке: вышедшие на рынок (или уже боровшиеся с вами). Тех, кто ещё не выпустил ни одной модели,
 * не показываем - будущее не раскрываем. Сначала те, кто борется с вами чаще (обгоны и ходы), потом по доле рынка.
 */
export function dossierLabs(s: GameState): ReturnType<typeof labRows> {
  return labRows(s)
    .filter((r) => r.owner !== 'player' && (r.count > 0 || fightScore(duelOf(s, r.owner as LabId)) > 0))
    .sort((a, b) => fightScore(duelOf(s, b.owner as LabId)) - fightScore(duelOf(s, a.owner as LabId)) || b.share - a.share);
}

function firstLab(s: GameState): LabId {
  return mainRival(s) ?? (dossierLabs(s)[0]?.owner as LabId | undefined) ?? LAB_IDS[0];
}

export function LabsTab({ s }: WindowProps) {
  const [sel, setSel] = useState<LabId>(() => takeDossier() ?? firstLab(s));
  useEffect(
    () =>
      onDossier(() => {
        const lab = takeDossier();
        if (lab) setSel(lab);
      }),
    [],
  );
  const rows = dossierLabs(s);
  const main = mainRival(s);
  // Выбранная лаборатория могла ещё не выйти на рынок (старый выбор): тогда первая из списка.
  const shown = rows.some((r) => r.owner === sel) ? sel : ((rows[0]?.owner as LabId | undefined) ?? null);
  if (!shown) {
    return (
      <div className="an-page">
        <div className="an-empty">
          <div>Соперники ещё не выпустили ни одной модели.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="an-page">
      <div className="dos">
        <div className="dos-list" role="listbox" aria-label="Лаборатории">
          {rows.map((r) => {
            const lab = r.owner as LabId;
            const d = duelOf(s, lab);
            return (
              <div
                key={lab}
                role="option"
                aria-selected={lab === shown}
                tabIndex={0}
                className={`list-item dos-row${lab === shown ? ' on' : ''}`}
                onClick={() => setSel(lab)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSel(lab);
                  }
                }}
              >
                <span className="dos-row-n">
                  <LabEmblem lab={lab} size={24} decorative />
                  <span>
                    {ownerName(s, lab)}
                    {lab === main && <small className="dos-main-s">главный соперник</small>}
                  </span>
                </span>
                <span className="dos-row-v" title="Вы обгоняли их : они обгоняли вас">
                  {d.youPassed}:{d.passedYou}
                </span>
              </div>
            );
          })}
        </div>
        <Dossier s={s} lab={shown} main={shown === main} />
      </div>
      <section>
        <h2 className="an-h">Последние ходы всех соперников</h2>
        <RecentMoves s={s} />
      </section>
    </div>
  );
}

function Dossier({ s, lab, main }: { s: GameState; lab: LabId; main: boolean }) {
  const row = labRows(s).find((r) => r.owner === lab);
  const d = duelOf(s, lab);
  const best = labBestModel(s, lab);
  const threat = safe(() => threatOf(s, lab));
  const stance = row?.stance ?? null;
  const moves = s.rivalry.history.filter((h) => h.lab === lab).slice(-DOSSIER_MOVES).reverse();
  const onMarket = (row?.count ?? 0) > 0;
  const level = threat && onMarket ? threat.total : 0;
  return (
    <div className="dos-card">
      <div className="dos-head">
        <LabEmblem lab={lab} size={56} decorative />
        <div className="dos-title">
          <h3>{ownerName(s, lab)}</h3>
          <div className="dos-line" title={row?.character?.description}>
            {LAB_LINE[lab]}
          </div>
          {main && <div className="dos-main">Ваш главный соперник: борется с вами чаще всех</div>}
        </div>
      </div>

      <div className="dos-body">
        <div className="dos-score-box">
          <div className="dos-score">
            <span title="Вы обгоняли их">{d.youPassed}</span>
            <span className="sep">:</span>
            <span title="Они обгоняли вас">{d.passedYou}</span>
          </div>
          <div className="dos-score-l">
            {d.youPassed + d.passedYou === 0
              ? 'Обгонов в гонке пока не было'
              : `Обгоняли вас ${timesCount(d.passedYou)}, вы их - ${timesCount(d.youPassed)}`}
          </div>
          {d.lastDay !== null && <div className="dos-score-l muted">Последний обгон {formatDateShort(d.lastDay)}</div>}
        </div>

        <div className="kv dos-kv">
          <span>Лучшая модель</span>
          <span>{best ? `${best.def.gameName}, ${fmtElo(best.elo)} Эло` : 'моделей ещё нет'}</span>
          <span title="Доллары за 1 млн токенов">Цена за 1 млн токенов</span>
          <span>{best ? (best.price !== null ? fmtPrice(best.price) : 'не продаётся по API') : '-'}</span>
          <span>Доля рынка</span>
          <span>{fmtShare(finite(row?.share))}</span>
          <span>Моделей вышло</span>
          <span>
            {fmtNum(row?.count ?? 0)}
            {row?.since != null && `, с ${formatDateShort(row.since)}`}
          </span>
          <span>Настрой к вам</span>
          <span title={stance?.hint}>{stance ? `${stance.label}${stance.hint ? `, ${stance.hint}` : ''}` : '-'}</span>
          <span title="Насколько лаборатория считает вас угрозой: ваша доля, Эло, цена и место на «Арене» против её моделей">
            Угроза в их глазах
          </span>
          <span className="dos-threat">
            <span className="dos-meter" aria-hidden>
              <i className={level >= 0.5 ? 'hi' : level >= 0.25 ? 'mid' : 'lo'} style={{ width: `${Math.round(level * 100)}%` }} />
            </span>
            <span className={level >= 0.5 ? 'bad' : level >= 0.25 ? 'warn' : undefined}>{threatWord(level)}</span>
          </span>
        </div>
      </div>

      <h4 className="dos-h">Ходы против вас{d.moves > 0 && `: ${fmtNum(d.moves)}`}</h4>
      {moves.length === 0 ? (
        <div className="muted dos-none">Ходов против вас не было</div>
      ) : (
        <table className="grid dos-moves">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Ход</th>
              <th>Что произошло</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((h, i) => (
              <tr key={`${h.day}:${i}`}>
                <td className="dos-d">{formatDateShort(h.day)}</td>
                <td>{moveName(h.move)}</td>
                <td className="dos-move-t">{h.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Последние ходы всех соперников: дата, лаборатория, ход, текст. */
function RecentMoves({ s }: { s: GameState }) {
  const rows = recentMoves(s);
  if (rows.length === 0) return <div className="muted">Ходов пока нет</div>;
  return (
    <div className="lab-moves">
      {rows.map((h, i) => (
        <div key={`${h.day}:${h.lab}:${i}`} className="lab-moves-row">
          <span className="d">{formatDateShort(h.day)}</span>
          <span className="l">
            <OwnerTag s={s} owner={h.lab} />
          </span>
          <span className="m">{moveName(h.move)}</span>
          <span className="t">{h.text}</span>
        </div>
      ))}
    </div>
  );
}
