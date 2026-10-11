// Общие типы и обёртки для иконок. Цветные иконки рабочего стола — viewBox 64x64, линейные — 24x24.

import type { CSSProperties, ReactNode } from 'react';

export interface IconProps {
  /** Размер в пикселях (квадрат). По умолчанию 56. */
  size?: number;
  /** Серый вариант для недоступных разделов. */
  disabled?: boolean;
  className?: string;
}

export interface LineIconProps {
  /** Размер в пикселях (квадрат). По умолчанию 18. */
  size?: number;
  className?: string;
  /** Толщина линии в единицах viewBox 24x24. По умолчанию 2. */
  strokeWidth?: number;
}

/** Превращает цвет иконки в итоговый: обычный или серый. */
export type Tone = (hex: string) => string;

const keep: Tone = (hex) => hex;

/** Серый тон для недоступных иконок: яркость сохраняется, но диапазон сужен и приглушён, как у закрытых иконок PT. */
const gray: Tone = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const v = Math.round(76 + luma * 0.19);
  const h = (x: number) => x.toString(16).padStart(2, '0');
  return `#${h(v)}${h(v)}${h(v + 2)}`;
};

export function toneFor(disabled: boolean | undefined): Tone {
  return disabled ? gray : keep;
}

/** Обёртка цветной иконки рабочего стола. */
export function Flat(props: { size?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  const { size = 56, className, style, children } = props;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} style={style} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Обёртка линейной иконки: контур currentColor, скруглённые концы. */
export function Line(props: LineIconProps & { children: ReactNode }) {
  const { size = 18, className, strokeWidth = 2, children } = props;
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
