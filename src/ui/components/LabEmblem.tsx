// Эмблема лаборатории-соперника: плоский квадрат цвета лаборатории со знаком, который говорит о её характере.
// Знаки свои, не логотипы настоящих компаний: кольцо у гегемона, щит у осторожной, глобус масштаба, молния-«Z»
// ценового бойца, полумесяц, ступени вниз у самой дешёвой, открытый куб у открытых весов. Без градиентов и теней.

import { LABS } from '../../data/labs';
import type { LabId } from '../../sim/types';

const COLOR = new Map<LabId, string>(LABS.map((l) => [l.id, l.color]));
const NAME = new Map<LabId, string>(LABS.map((l) => [l.id, l.name]));

/** Светлый фон (жёлтый Moonshoot) - знак тёмный, иначе белый. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170 ? '#1f2023' : '#ffffff';
}

function Mark({ lab, ink }: { lab: LabId; ink: string }) {
  const line = { fill: 'none', stroke: ink, strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (lab) {
    case 'openbrain':
      return (
        <>
          <circle cx="16" cy="16" r="8" {...line} />
          <circle cx="16" cy="16" r="2.6" fill={ink} />
        </>
      );
    case 'antropik':
      return <path d="M16 7.5 L23.5 10.5 V16 C23.5 20.5 20.5 23.5 16 25 C11.5 23.5 8.5 20.5 8.5 16 V10.5 Z" {...line} strokeWidth={2.6} />;
    case 'gogle':
      return (
        <>
          <circle cx="16" cy="16" r="8.5" {...line} strokeWidth={2.4} />
          <ellipse cx="16" cy="16" rx="3.6" ry="8.5" {...line} strokeWidth={2.2} />
          <path d="M7.5 16 H24.5" {...line} strokeWidth={2.2} />
        </>
      );
    case 'zhipo':
      return <path d="M10 9.5 H22 L10.5 22.5 H22" {...line} />;
    case 'moonshoot':
      return <path d="M19.5 7.8 A8.6 8.6 0 1 0 24.2 21.5 A7 7 0 0 1 19.5 7.8 Z" fill={ink} />;
    case 'deepcent':
      return <path d="M8.5 10.5 H23.5 M11 16 H21 M13.5 21.5 H18.5" {...line} />;
    case 'alibabo':
      return (
        <>
          <path d="M16 7.5 L23.5 11.5 V20.5 L16 24.5 L8.5 20.5 V11.5 Z" {...line} strokeWidth={2.4} />
          <path d="M8.5 11.5 L16 15.5 L23.5 11.5 M16 15.5 V24.5" {...line} strokeWidth={2.4} />
        </>
      );
  }
}

/** decorative - рядом уже написано название: эмблему не озвучивать второй раз. */
export function LabEmblem({ lab, size = 24, decorative = false }: { lab: LabId; size?: number; decorative?: boolean }) {
  const color = COLOR.get(lab) ?? '#888888';
  return (
    <svg
      className="lab-emblem"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : (NAME.get(lab) ?? lab)}
      style={{ flex: 'none', display: 'block' }}
    >
      <rect width="32" height="32" rx="6" fill={color} />
      <Mark lab={lab} ink={inkOn(color)} />
    </svg>
  );
}
