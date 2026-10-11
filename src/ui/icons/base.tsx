// Общие типы и обёртки для иконок. Цветные иконки рабочего стола — viewBox 64x64, линейные — 24x24.

import type { CSSProperties, ReactNode } from 'react';

export interface IconProps {
  /** Размер в пикселях (квадрат). По умолчанию 56. */
  size?: number;
  /** Серый вариант с замком в углу для недоступных разделов. */
  disabled?: boolean;
  className?: string;
}

export interface LineIconProps {
  /** Размер в пикселях (квадрат). По умолчанию 20. */
  size?: number;
  className?: string;
  /** Толщина линии в единицах viewBox 24x24. По умолчанию 2. */
  strokeWidth?: number;
}

/** Превращает цвет иконки в итоговый: обычный или серый. */
export type Tone = (hex: string) => string;

const keep: Tone = (hex) => hex;

/** Серый тон для недоступных иконок: яркость сохраняется, диапазон сужен (от #50 до #83), как у закрытых иконок PT. */
const gray: Tone = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const v = Math.round(80 + luma * 0.2);
  const h = (x: number) => x.toString(16).padStart(2, '0');
  return `#${h(v)}${h(v)}${h(v + 2)}`;
};

export function toneFor(disabled: boolean | undefined): Tone {
  return disabled ? gray : keep;
}

/** Замок в правом нижнем углу недоступной иконки. Цвета заданы прямо, поверх серых тонов иконки. */
function LockBadge() {
  return (
    <g>
      <circle cx={50} cy={50} r={12.5} fill="#26282c" stroke="#8b8e93" strokeWidth={2} />
      <rect x={44.5} y={49.5} width={11} height={8} rx={1.8} fill="#c4c8ce" />
      <path d="M46.9 49.5 V46.8 A3.1 3.1 0 0 1 53.1 46.8 V49.5" fill="none" stroke="#c4c8ce" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

/** Обёртка цветной иконки рабочего стола. С `locked` в углу рисуется замок. */
export function Flat(props: { size?: number; className?: string; style?: CSSProperties; locked?: boolean; children: ReactNode }) {
  const { size = 56, className, style, locked, children } = props;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} style={style} aria-hidden="true" focusable="false">
      {children}
      {locked && <LockBadge />}
    </svg>
  );
}

/** Обёртка линейной иконки: контур currentColor, скруглённые концы. */
export function Line(props: LineIconProps & { children: ReactNode }) {
  const { size = 20, className, strokeWidth = 2, children } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
