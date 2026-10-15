// «Ваши моменты»: газетная полоса на весь экран, когда лаборатория делает что-то впервые и громко.
// Показывается один раз за партию (флаг moment:<id> в s.flags), игра встаёт на паузу.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { arenaStanding, type ArenaStanding } from '../sim/leaderboard';
import { formatDateShort } from '../sim/time';
import type { GameState } from '../sim/types';
import { fmtGap, raceName } from './ArenaFeedback';
import { useModalFocus } from './components/common';
import { fmtInt } from './format';
import { playSound } from './sound';
import { store } from './store';
import './moments.css';

interface Moment {
  id: string;
  kicker: string;
  headline: string;
  sub: string;
  body: string;
  art: 'attention' | 'chat' | 'trophy' | 'arena' | 'rlhf';
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
  return out;
}

const flag = (id: string): string => `moment:${id}`;

/** Карта внимания 8×8: диагональ и несколько дальних связей, как рисунок из статьи. */
function AttentionFig() {
  const n = 8;
  const cells = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const far = (i === 5 && j === 1) || (i === 6 && j === 2) || (i === 7 && j === 4) || (i === 3 && j === 0);
      const v = far ? 0.75 : Math.exp(-Math.abs(i - j) * 1.1);
      cells.push(<rect key={`${i}-${j}`} x={40 + j * 15} y={8 + i * 15} width={14} height={14} fillOpacity={0.08 + 0.85 * v} />);
    }
  }
  return <g className="mo-ink">{cells}</g>;
}

const FIGS: Record<string, { caption: string; draw: () => ReactElement }> = {
  attention: { caption: 'Карта внимания модели', draw: AttentionFig },
  chat: {
    caption: 'Диалог с моделью',
    draw: () => (
      <g className="mo-line">
        <path d="M14 14 H120 V54 H40 L28 66 V54 H14 Z" />
        <path d="M30 28 H104 M30 40 H86" />
        <path d="M80 72 H186 V124 H172 V136 L160 124 H80 Z" />
        <path d="M96 86 H170 M96 98 H170 M96 110 H140" />
      </g>
    ),
  },
  trophy: {
    caption: 'Таблица теста',
    draw: () => (
      <g>
        <g className="mo-line">
          <path d="M30 132 H170" />
          <rect x={36} y={84} width={40} height={48} />
          <rect x={80} y={56} width={40} height={76} />
          <rect x={124} y={100} width={40} height={32} />
        </g>
        <g className="mo-ink">
          <rect x={80} y={56} width={40} height={76} fillOpacity={0.85} />
        </g>
        <g className="mo-num">
          <text x={56} y={114}>2</text>
          <text x={144} y={122}>3</text>
        </g>
        <text x={100} y={102} className="mo-num inv">1</text>
      </g>
    ),
  },
  arena: {
    caption: '«Арена»: первые места',
    draw: () => (
      <g className="mo-ink">
        {[150, 132, 121, 108, 96].map((w, i) => (
          <rect key={i} x={24} y={14 + i * 24} width={w} height={14} fillOpacity={i === 0 ? 0.9 : 0.3} />
        ))}
      </g>
    ),
  },
  rlhf: {
    caption: 'Люди выбирают лучший ответ',
    draw: () => (
      <g>
        <g className="mo-line">
          <rect x={18} y={14} width={76} height={86} />
          <rect x={106} y={14} width={76} height={86} />
          <path d="M30 34 H82 M30 48 H82 M30 62 H70 M118 34 H170 M118 48 H158" />
          <path d="M44 116 L54 126 L72 106" className="mo-tick" />
        </g>
        <g className="mo-num">
          <text x={56} y={92}>А</text>
          <text x={144} y={92}>Б</text>
        </g>
      </g>
    ),
  },
  final: {
    caption: 'Последний день гонки',
    draw: () => (
      <g>
        <g className="mo-line">
          <rect x={56} y={14} width={88} height={112} />
          <path d="M56 40 H144" />
        </g>
        <g className="mo-ink">
          <rect x={56} y={14} width={88} height={26} fillOpacity={0.85} />
        </g>
        <text x={100} y={94} className="mo-num big">31</text>
        <text x={100} y={116} className="mo-num small">декабря</text>
      </g>
    ),
  },
};

/** Рисунок номера: простая гравюра в цвет краски, с подписью. */
function Art({ kind }: { kind: string }) {
  const fig = FIGS[kind];
  if (!fig) return null;
  return (
    <figure className="mo-art" aria-hidden="true">
      <svg viewBox="0 0 200 140">{fig.draw()}</svg>
      <figcaption>{fig.caption}</figcaption>
    </figure>
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
