// «Ваши моменты»: газетная полоса на весь экран, когда лаборатория делает что-то впервые и громко.
// Показывается один раз за партию (флаг moment:<id> в s.flags), игра встаёт на паузу.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FINALE_START } from '../sim/finale';
import { arenaStanding, type ArenaStanding } from '../sim/leaderboard';
import { ruPlural } from '../sim/text';
import { END_DAY, formatDateShort } from '../sim/time';
import type { GameState } from '../sim/types';
import { fmtGap, raceName } from './ArenaFeedback';
import { useModalFocus } from './components/common';
import { fmtDays, fmtInt } from './format';
import { playSound } from './sound';
import { store } from './store';
import './moments.css';

interface Moment {
  id: string;
  kicker: string;
  headline: string;
  sub: string;
  body: string;
  art: 'attention' | 'chat' | 'trophy' | 'arena' | 'rlhf' | 'final';
}

function standing(s: GameState): ArenaStanding | null {
  try {
    return arenaStanding(s);
  } catch {
    return null;
  }
}

function names(list: { name: string }[]): string {
  const shown = list.slice(0, 2).map((n) => n.name);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(', ')} и ещё ${more}` : shown.join(' и ');
}

/** Моменты, которые сейчас выполнены (показан или нет - решает флаг). */
function currentMoments(s: GameState): Moment[] {
  const lab = s.labName;
  const out: Moment[] = [];
  if (s.firedEvents.includes('attention-paper-player')) {
    out.push({
      id: 'attention-first',
      kicker: 'Исследования',
      headline: `«${lab}» опередила Gogle`,
      sub: 'Лаборатория изучила механизм внимания до того, как вышла статья «Внимание - всё, что нужно».',
      body: 'Теперь решение за вами: опубликовать результаты первыми или оставить метод в секрете.',
      art: 'attention',
    });
  }
  if (s.firedEvents.includes('chat-moment-player')) {
    out.push({
      id: 'chat-moment',
      kicker: 'Рынок',
      headline: `Чат «${lab}» на равных с ChatGTP`,
      sub: 'Интерес к чат-ботам вырос в разы, и модель лаборатории не уступает лучшей модели OpenBrain.',
      body: 'Шумиха +40, репутация +10. Это ваш момент: спрос на чат сейчас выше, чем когда-либо.',
      art: 'chat',
    });
  }
  const st = standing(s);
  if (st && st.rank === 1 && st.metric.kind === 'bench') {
    out.push({
      id: 'first-place-bench',
      kicker: 'Гонка',
      headline: `«${lab}» - первая по ${st.metric.name}`,
      sub: `Модель «${st.modelName}» обошла ${st.behind.length > 0 ? names(st.behind) : 'всех соперников'}.`,
      body: st.below
        ? `Ближайший соперник - ${st.below.name}, отставание ${fmtGap(st.metric, st.below.gap)} балла. Удержать первое место будет сложнее, чем занять.`
        : 'Удержать первое место будет сложнее, чем занять.',
      art: 'trophy',
    });
  }
  if (st && st.rank === 1 && st.metric.kind === 'arena') {
    out.push({
      id: 'first-place-arena',
      kicker: raceName(st.metric),
      headline: `«${lab}» возглавила «Арену»`,
      sub: `Модель «${st.modelName}» - первая среди моделей в продаже: ${fmtInt(st.value)} Эло.`,
      body: st.below
        ? `${st.below.name} отстаёт на ${fmtGap(st.metric, st.below.gap)} Эло. Победа - первое место на 31.12.2024.`
        : 'Победа - первое место на 31.12.2024.',
      art: 'arena',
    });
  }
  const chat = s.models.find((m) => m.releasedDay !== null && m.rlhf);
  if (chat) {
    out.push({
      id: 'first-rlhf',
      kicker: 'Продукт',
      headline: `Первая чат-модель «${lab}»`,
      sub: `«${chat.name}» обучена на отзывах людей: она отвечает как собеседник, а не продолжает текст.`,
      body: 'Такие модели выше на «Арене» и открывают тендеры на дообучение с RLHF.',
      art: 'rlhf',
    });
  }
  // Финальный квартал (sim/finale.ts): полоса в день старта, с местом в гонке и объявленными рывками.
  if (s.day >= FINALE_START && !s.outcome) {
    const pushes = s.late?.finale.pushes.length ?? 0;
    const arena = st && st.metric.kind === 'arena' ? st : null;
    out.push({
      id: 'finale-start',
      kicker: 'Финал',
      headline: `До итогов гонки ${fmtDays(Math.max(0, END_DAY - s.day))}`,
      sub: !arena
        ? `У «${lab}» нет модели в продаже: место в гонке пока не считается.`
        : arena.rank === 1
          ? `«${lab}» на первом месте: «${arena.modelName}», ${fmtInt(arena.value)} Эло.${arena.below ? ` ${arena.below.name} отстаёт на ${fmtGap(arena.metric, arena.below.gap)} Эло.` : ''}`
          : `«${lab}» на ${arena.rank}-м месте: до первого ${fmtGap(arena.metric, arena.ahead[0]?.gap ?? 0)} Эло (${arena.ahead[0]?.name ?? 'лидер'}).`,
      body:
        (pushes > 0
          ? pushes === 1
            ? 'Один соперник уже объявил финальный рывок. '
            : `${pushes} ${ruPlural(pushes, 'соперник', 'соперника', 'соперников')} уже объявили финальные рывки. `
          : 'Лаборатории готовят выпуски к концу года. ') +
        'Победит первая модель на «Арене» 31 декабря. Рывки, анонсы и доработка моделей - в окне «Финал».',
      art: 'final',
    });
  }
  return out;
}

const flag = (id: string): string => `moment:${id}`;

/** Клетчатый флаг финала: плоский рисунок для газетной полосы. */
function FinishFlag() {
  const cells: [number, number][] = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) if ((r + c) % 2 === 0) cells.push([c, r]);
  return (
    <svg className="mo-flag" viewBox="0 0 150 120" aria-hidden="true">
      <rect x={14} y={6} width={6} height={110} fill="#1e1b16" />
      <rect x={20} y={10} width={112} height={80} fill="#f4efe2" stroke="#1e1b16" strokeWidth={2} />
      {cells.map(([c, r]) => (
        <rect key={`${c}-${r}`} x={20 + c * 16} y={10 + r * 16} width={16} height={16} fill="#1e1b16" />
      ))}
    </svg>
  );
}

function Art({ kind }: { kind: Moment['art'] }) {
  if (kind === 'final') {
    return (
      <div className="mo-art art-final" aria-hidden="true">
        <FinishFlag />
      </div>
    );
  }
  return (
    <div className={`mo-art art-${kind}`} aria-hidden="true">
      <span className="mo-glyph">{{ attention: 'Q·K·V', chat: '«…»', trophy: '1', arena: '★', rlhf: '+1', final: '' }[kind]}</span>
    </div>
  );
}

/** Следит за партией и показывает газетную полосу, когда выполнен новый момент. */
export function Moments({ s }: { s: GameState }) {
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const seenState = useRef<GameState | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  const { ref, onKeyDown } = useModalFocus<HTMLDivElement>(queue[0]?.id ?? '');

  useEffect(() => {
    const now = currentMoments(s).filter((m) => !s.flags[flag(m.id)]);
    if (seenState.current !== s) {
      // Новая партия или загрузка: уже случившееся не показываем задним числом.
      seenState.current = s;
      for (const m of now) s.flags[flag(m.id)] = true;
      setQueue([]);
      return;
    }
    if (now.length === 0) return;
    for (const m of now) s.flags[flag(m.id)] = true;
    setQueue((q) => [...q, ...now]);
    store.pauseReason = now[0].headline;
    store.setSpeed(0);
    playSound('first');
  }, [s, version]);

  const m = queue[0];
  if (!m) return null;
  const close = () => setQueue((q) => q.slice(1));
  return (
    <div className="modal-backdrop mo-backdrop" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div ref={ref} tabIndex={-1} key={m.id} className="mo-paper" role="dialog" aria-modal="true" aria-label={m.headline} onKeyDown={onKeyDown}>
        <div className="mo-mast">
          <span>Вестник технологий</span>
          <span className="mo-date">{formatDateShort(s.day)}</span>
        </div>
        <div className="mo-kicker">{m.kicker}</div>
        <h1 className="mo-headline">{m.headline}</h1>
        <div className="mo-cols">
          <Art kind={m.art} />
          <div className="mo-text">
            <p className="mo-sub">{m.sub}</p>
            <p className="mo-body">{m.body}</p>
          </div>
        </div>
        <div className="mo-foot">
          <button className="btn primary" onClick={close} autoFocus>
            Продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
