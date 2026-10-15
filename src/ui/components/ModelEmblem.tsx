// Эмблема модели - микросхема, как чип на картинке «Инспектора» в Processor Tycoon. Каждая модель выглядит
// по-своему, и всё на рисунке что-то значит:
// - корпус: у LSTM - «длинный» корпус с выводами по двум сторонам (старая архитектура), у трансформера -
//   квадратный корпус с выводами по четырём сторонам;
// - размер корпуса растёт с числом параметров, число выводов - с длиной контекста;
// - цветная полоса на корпусе - уровень (лёгкая бирюзовая, средняя синяя, флагман фиолетовая);
// - на корпусе номер модели из названия («Модель 12» → 12) или первые буквы;
// - золотые выводы - модель держит 1-е место; красная точка - подгонка раскрыта;
// - у модели в обучении корпус бледный, внизу полоса готовности.
// Цвета плоские, без градиентов и теней.

import { CONTEXT_LEVELS } from '../../sim/constants';
import type { Tier } from '../../sim/types';
import './ModelEmblem.css';

export interface EmblemSource {
  id: string;
  name: string;
  arch: 'lstm' | 'transformer';
  plan: { tier: Tier; paramsB: number; context: number; rlhf: boolean };
}

/** Цвет полосы уровня - тот же, что у значка уровня (TierBadge). */
const TIER_BAND: Record<Tier, string> = { light: '#1fa8a0', mid: '#2f80e4', flagship: '#7b5cd6' };

/** Номер из названия или первые буквы: «Модель 12» → «12», «Нейрон-Про» → «НП». */
export function monogram(name: string): string {
  const num = name.match(/(\d+(?:[.,]\d+)?)\s*$/)?.[1] ?? name.match(/\d+/)?.[0];
  if (num) return num.length > 3 ? num.slice(-3) : num;
  const words = name
    .split(/[\s\-_«»"]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() ?? '');
  return (words.length >= 2 ? words[0] + words[1] : (name.trim().slice(0, 2) || '?')).toUpperCase();
}

/** Сторона корпуса (из 64): от 34 у крошечной модели до 46 у самой большой. */
function bodySide(paramsB: number): number {
  const lg = Math.log10(Math.max(0.001, paramsB)); // -3 .. 3,3
  return Math.round(Math.max(34, Math.min(46, 40 + lg * 2)));
}

/** Выводов на сторону: по уровню контекста, от 3 у 512 токенов до 8 у 1 млн. */
function pinsPerSide(context: number): number {
  let idx = 0;
  CONTEXT_LEVELS.forEach(([tokens], i) => {
    if (context >= tokens) idx = i;
  });
  return 3 + Math.min(5, idx);
}

export function ModelEmblem(props: {
  m: EmblemSource;
  size?: number;
  /** Модель в обучении: бледный корпус и полоса готовности (0..1). */
  progress?: number;
  /** Модель держит 1-е место: золотые выводы. */
  gold?: boolean;
  /** Подгонка раскрыта: красная точка. */
  exposed?: boolean;
  /** Снята с продажи: эмблема бледнее. */
  faded?: boolean;
  className?: string;
}) {
  const { m, size = 64, progress, gold, exposed, faded, className } = props;
  const dip = m.arch === 'lstm';
  const side = bodySide(m.plan.paramsB);
  const n = pinsPerSide(m.plan.context);
  // У LSTM корпус вытянут по вертикали, выводы слева и справа.
  const bw = dip ? Math.round(side * 0.72) : side;
  const bh = dip ? Math.min(54, Math.round(side * 1.18)) : side;
  const x0 = (64 - bw) / 2;
  const y0 = (64 - bh) / 2;
  const pinLen = 5;
  const pinW = 2.6;
  const pins: { x: number; y: number; w: number; h: number }[] = [];
  const along = (len: number, i: number) => ((i + 1) * len) / (n + 1);
  for (let i = 0; i < n; i++) {
    const py = y0 + along(bh, i) - pinW / 2;
    pins.push({ x: x0 - pinLen, y: py, w: pinLen, h: pinW }, { x: x0 + bw, y: py, w: pinLen, h: pinW });
    if (!dip) {
      const px = x0 + along(bw, i) - pinW / 2;
      pins.push({ x: px, y: y0 - pinLen, w: pinW, h: pinLen }, { x: px, y: y0 + bh, w: pinW, h: pinLen });
    }
  }
  const mono = monogram(m.name);
  const tiny = size < 30;
  const font = (mono.length > 2 ? 0.3 : 0.4) * Math.min(bw, bh);
  const band = Math.max(4, Math.round(bh * 0.14));
  const training = progress !== undefined;
  const p = Math.max(0, Math.min(1, progress ?? 0));

  return (
    <svg
      className={`emb${training ? ' training' : ''}${faded ? ' faded' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <g className={gold ? 'emb-pins gold' : 'emb-pins'}>
        {pins.map((q, i) => (
          <rect key={i} x={q.x} y={q.y} width={q.w} height={q.h} />
        ))}
      </g>
      <rect className="emb-body" x={x0} y={y0} width={bw} height={bh} rx="2" />
      <rect x={x0} y={y0} width={bw} height={band} fill={TIER_BAND[m.plan.tier]} />
      {/* Метка первого вывода, как на настоящей микросхеме. */}
      <circle className="emb-key" cx={x0 + 4.5} cy={y0 + band + 4.5} r="1.8" />
      {!tiny && (
        <text x="32" y={y0 + band + (bh - band) / 2 + (training ? -2 : 0.5)} className="emb-mono" fontSize={font} textAnchor="middle" dominantBaseline="central">
          {mono}
        </text>
      )}
      {training && (
        <>
          <rect className="emb-bar-bg" x={x0 + 4} y={y0 + bh - 7} width={bw - 8} height="3" />
          <rect className="emb-bar" x={x0 + 4} y={y0 + bh - 7} width={(bw - 8) * p} height="3" />
        </>
      )}
      {exposed && <circle className="emb-exposed" cx={x0 + bw - 4.5} cy={y0 + band + 4.5} r="3.2" />}
    </svg>
  );
}
