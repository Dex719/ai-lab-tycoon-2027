// «Ваши моменты»: газетная полоса на весь экран, когда лаборатория делает что-то впервые и громко.
// Показывается один раз за партию (флаг moment:<id> в s.flags), игра встаёт на паузу.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { FINALE_START } from '../sim/finale';
import { arenaStanding, type ArenaStanding } from '../sim/leaderboard';
import { ruPlural } from '../sim/text';
import { END_DAY, formatDateShort } from '../sim/time';
import type { GameState } from '../sim/types';
import { fmtGap, raceName } from './ArenaFeedback';
import { useModalFocus } from './components/common';
import { fmtDays, fmtInt } from './format';
import { lateMoments } from './lateMoments';
import { playSound } from './sound';
import { store } from './store';
import './moments.css';

interface Moment {
  id: string;
  kicker: string;
  headline: string;
  sub: string;
  body: string;
  art: 'attention' | 'chat' | 'trophy' | 'arena' | 'rlhf' | 'final' | 'push' | 'swap' | 'deal' | 'office' | 'floor' | 'campus';
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
  out.push(...lateMoments(s, st));
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
  // Две строки «Арены»: рывок второй строки (штриховка) не дотянул до черты первой.
  push: {
    caption: '«Арена»: рывок не достал до первой строки',
    draw: () => (
      <g>
        <g className="mo-ink">
          <rect x={34} y={30} width={130} height={22} fillOpacity={0.88} />
          <rect x={34} y={78} width={86} height={22} fillOpacity={0.3} />
        </g>
        <g className="mo-line">
          <rect x={120} y={78} width={34} height={22} />
          <path d="M128 78 L120 86 M138 78 L120 96 M148 78 L126 100 M154 82 L136 100 M154 92 L146 100" className="mo-thin" />
          <path d="M164 18 V112" className="mo-dash" />
          <path d="M124 116 H150 M144 110 L150 116 L144 122" />
        </g>
        <g className="mo-num">
          <text x={20} y={47}>1</text>
          <text x={20} y={95}>2</text>
        </g>
      </g>
    ),
  },
  // Таблица гонки: две строки поменялись местами, стрелки справа.
  swap: {
    caption: 'Таблица гонки: строки поменялись местами',
    draw: () => (
      <g>
        <g className="mo-ink">
          <rect x={20} y={28} width={120} height={26} fillOpacity={0.88} />
        </g>
        <g className="mo-line">
          <rect x={20} y={28} width={120} height={26} />
          <rect x={20} y={86} width={120} height={26} />
          <path d="M34 99 H96" className="mo-thin" />
          <path d="M152 99 C178 99 178 41 152 41 M158 35 L152 41 L158 47" />
        </g>
        <g className="mo-num">
          <text x={10} y={47}>1</text>
          <text x={10} y={105}>2</text>
        </g>
        <path d="M34 41 H96" className="mo-line inv" />
      </g>
    ),
  },
  // Переезды лаборатории (labStage.ts): офис, этаж в бизнес-центре, кампус.
  office: {
    caption: 'Новый офис лаборатории',
    draw: () => (
      <g>
        <g className="mo-line">
          <path d="M20 128 H180" />
          <rect x={48} y={44} width={104} height={84} />
          <path d="M44 44 H156" />
          <rect x={92} y={98} width={16} height={30} />
        </g>
        <g className="mo-ink">
          {[60, 90, 120].map((x) => (
            <rect key={`a${x}`} x={x} y={56} width={20} height={14} fillOpacity={0.75} />
          ))}
          {[60, 120].map((x) => (
            <rect key={`b${x}`} x={x} y={80} width={20} height={14} fillOpacity={0.75} />
          ))}
        </g>
      </g>
    ),
  },
  floor: {
    caption: 'Этаж лаборатории в бизнес-центре',
    draw: () => (
      <g>
        <g className="mo-line">
          <path d="M20 132 H180" />
          <rect x={70} y={8} width={60} height={124} />
          <path d="M70 20 H130 M70 32 H130 M70 44 H130 M70 56 H130 M70 68 H130 M70 80 H130 M70 92 H130 M70 104 H130 M70 116 H130" className="mo-thin" />
        </g>
        <g className="mo-ink">
          <rect x={70} y={56} width={60} height={12} fillOpacity={0.88} />
        </g>
        <path d="M136 62 H160" className="mo-line" />
      </g>
    ),
  },
  campus: {
    caption: 'Кампус лаборатории',
    draw: () => (
      <g>
        <g className="mo-line">
          <path d="M10 128 H190" />
          <rect x={18} y={70} width={52} height={58} />
          <rect x={78} y={40} width={58} height={88} />
          <rect x={144} y={82} width={40} height={46} />
        </g>
        <g className="mo-ink">
          {[48, 62, 76, 90, 104].map((y) => (
            <rect key={`m${y}`} x={86} y={y} width={42} height={7} fillOpacity={0.7} />
          ))}
          {[80, 96, 112].map((y) => (
            <rect key={`l${y}`} x={26} y={y} width={36} height={7} fillOpacity={0.45} />
          ))}
          {[92, 108].map((y) => (
            <rect key={`r${y}`} x={150} y={y} width={28} height={7} fillOpacity={0.45} />
          ))}
        </g>
      </g>
    ),
  },
  // Договор о покупке: строки текста, подпись и круглая печать.
  deal: {
    caption: 'Договор о покупке подписан',
    draw: () => (
      <g className="mo-line">
        <rect x={50} y={8} width={100} height={124} />
        <path d="M62 24 H138 M62 36 H138 M62 48 H124 M62 60 H138 M62 72 H110" className="mo-thin" />
        <path d="M62 110 C70 96 76 118 84 104 C90 94 94 116 102 106 C106 101 110 104 114 102" />
        <path d="M60 118 H116" className="mo-thin" />
        <circle cx={126} cy={100} r={16} />
        <circle cx={126} cy={100} r={11} className="mo-thin" />
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
