// Эмблема модели: у каждой модели своя обложка, собранная из её свойств, а не случайная картинка.
// Цвет - уровень (лёгкая бирюзовая, средняя синяя, флагман фиолетовый), оттенок и поворот узора - от названия.
// Узор - архитектура: у LSTM узлы связаны цепочкой по кругу (память переходит от шага к шагу),
// у трансформера - хордами «каждый с каждым» (внимание). Число узлов растёт с размером модели,
// число делений внешнего кольца - с длиной контекста. Золотая звезда - обучение с RLHF.
// В центре - номер модели из названия («Модель 12» → 12) или первые буквы.

import { useId } from 'react';
import { CONTEXT_LEVELS } from '../../sim/constants';
import type { Tier } from '../../sim/types';
import './ModelEmblem.css';

export interface EmblemSource {
  id: string;
  name: string;
  arch: 'lstm' | 'transformer';
  plan: { tier: Tier; paramsB: number; context: number; rlhf: boolean };
}

/** Базовый тон уровня (HSL) - те же семейства цветов, что у значка уровня и карточки выхода модели. */
const TIER_HUE: Record<Tier, number> = { light: 174, mid: 214, flagship: 258 };

/** FNV-1a: одно и то же название всегда даёт один и тот же узор. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Число узлов сети: от 4 у крошечной модели до 11 у самой большой. */
function nodeCount(paramsB: number): number {
  const lg = Math.log10(Math.max(0.001, paramsB));
  return Math.max(4, Math.min(11, Math.round(6.5 + lg * 1.25)));
}

/** Деления внешнего кольца: номер уровня контекста (512 токенов - одно деление). */
function contextTicks(context: number): number {
  let idx = 0;
  CONTEXT_LEVELS.forEach(([tokens], i) => {
    if (context >= tokens) idx = i;
  });
  return idx + 2;
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(a0)} A${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

export function ModelEmblem(props: {
  m: EmblemSource;
  size?: number;
  /** Модель в обучении: приглушённая обложка и кольцо готовности (0..1). */
  progress?: number;
  /** Лучшая модель или 1-е место: золотая рамка. */
  gold?: boolean;
  /** Подгонка раскрыта: красная метка. */
  exposed?: boolean;
  /** Снята с продажи: обложка бледнее. */
  faded?: boolean;
  className?: string;
}) {
  const { m, size = 64, progress, gold, exposed, faded, className } = props;
  const uid = useId().replace(/:/g, '');
  const seed = hash(`${m.id}|${m.name}`);
  const r = rng(seed);
  const hue = TIER_HUE[m.plan.tier] + Math.round((r() - 0.5) * 40);
  const top = `hsl(${hue} 62% 50%)`;
  const bottom = `hsl(${hue + 12} 58% 17%)`;
  const glow = `hsl(${hue - 8} 90% 72%)`;
  const turn = r() * Math.PI * 2;
  const n = nodeCount(m.plan.paramsB);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = turn + (i / n) * Math.PI * 2;
    return { x: 32 + 17.5 * Math.cos(a), y: 32 + 17.5 * Math.sin(a) };
  });
  const links: [number, number][] = [];
  if (m.arch === 'transformer') {
    // Внимание: каждый узел смотрит на несколько других.
    const p = 0.34 + Math.min(0.3, n * 0.02);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < p || j === i + 2) links.push([i, j]);
  } else {
    for (let i = 0; i < n; i++) links.push([i, (i + 1) % n]);
  }
  const accent = Math.floor(r() * n);
  const ticks = contextTicks(m.plan.context);
  const gap = 0.16;
  const motif = Math.floor(r() * 3); // фон: косые полосы, сетка точек или волны
  const tiny = size < 30;
  const small = size < 56;
  const mono = monogram(m.name);
  const monoSize = small ? (mono.length > 2 ? 12 : 16) : mono.length > 2 ? 9 : 11.5;
  const coreR = small ? 12.5 : 11.5;
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
      <defs>
        <linearGradient id={`eg${uid}`} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <radialGradient id={`er${uid}`} cx="0.5" cy="0.45" r="0.55">
          <stop offset="0" stopColor={glow} stopOpacity="0.55" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="64" height="64" rx="11" fill={`url(#eg${uid})`} />
      <rect x="0" y="0" width="64" height="64" rx="11" fill={`url(#er${uid})`} />
      <g className="emb-motif">
        {motif === 0 &&
          Array.from({ length: 9 }, (_, i) => <line key={i} x1={-8 + i * 10} y1="66" x2={20 + i * 10} y2="-2" />)}
        {motif === 1 &&
          Array.from({ length: 36 }, (_, i) => <circle key={i} cx={5.3 + (i % 6) * 10.7} cy={5.3 + Math.floor(i / 6) * 10.7} r="1.1" />)}
        {motif === 2 && [12, 20, 28, 36, 44].map((rr) => <circle key={rr} cx={64 * (seed % 2)} cy="64" r={rr} className="ring" />)}
      </g>
      {!small &&
        Array.from({ length: ticks }, (_, i) => {
          const a0 = turn + (i / ticks) * Math.PI * 2 + gap / 2;
          const a1 = turn + ((i + 1) / ticks) * Math.PI * 2 - gap / 2;
          return <path key={i} d={arcPath(32, 32, 27, a0, a1)} className="emb-tick" />;
        })}
      <g className={`emb-links ${m.arch}`}>
        {links.map(([a, b]) =>
          m.arch === 'transformer' ? (
            <line key={`${a}-${b}`} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} />
          ) : (
            <path
              key={`${a}-${b}`}
              d={`M${pts[a].x.toFixed(2)} ${pts[a].y.toFixed(2)} Q${(32 + (pts[a].x + pts[b].x - 64) * 0.95).toFixed(2)} ${(
                32 +
                (pts[a].y + pts[b].y - 64) * 0.95
              ).toFixed(2)} ${pts[b].x.toFixed(2)} ${pts[b].y.toFixed(2)}`}
            />
          ),
        )}
      </g>
      {pts.map((q, i) => (
        <circle key={i} cx={q.x} cy={q.y} r={i === accent ? 3.1 : 2.3} className={i === accent ? 'emb-node hot' : 'emb-node'} />
      ))}
      {tiny ? (
        <circle cx="32" cy="32" r="5" className="emb-core" />
      ) : (
        <>
          <circle cx="32" cy="32" r={coreR} className="emb-core" />
          <text x="32" y="32.5" className="emb-mono" fontSize={monoSize} textAnchor="middle" dominantBaseline="central">
            {mono}
          </text>
        </>
      )}
      {m.plan.rlhf && (
        <path
          className="emb-star"
          transform={small ? 'translate(52 12) scale(1.3)' : 'translate(53 11)'}
          d="M0 -5.2 L1.5 -1.6 L5.2 -1.6 L2.2 0.7 L3.3 4.4 L0 2.2 L-3.3 4.4 L-2.2 0.7 L-5.2 -1.6 L-1.5 -1.6 Z"
        />
      )}
      {exposed && (
        <g className="emb-exposed">
          <circle cx="12" cy="52" r="7" />
          <path d="M12 48 V53 M12 55.6 V55.8" />
        </g>
      )}
      {training && (
        <>
          <rect x="0" y="0" width="64" height="64" rx="11" className="emb-veil" />
          <circle cx="32" cy="32" r="29" className="emb-ring-bg" />
          {p > 0 && (
            <path
              d={p >= 0.999 ? 'M32 3 A29 29 0 1 1 31.99 3' : arcPath(32, 32, 29, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)}
              className="emb-ring"
            />
          )}
        </>
      )}
      {gold && <rect x="1.25" y="1.25" width="61.5" height="61.5" rx="10" className="emb-gold" />}
    </svg>
  );
}
