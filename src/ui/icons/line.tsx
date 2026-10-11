// Мелкие значки интерфейса (viewBox 24x24, контур currentColor). Размер по умолчанию 18 px.

import { Line, type LineIconProps } from './base';

/** Для кнопок скорости: заполненные фигуры, толщина контура только скругляет углы. */
const SOLID_STROKE = 1.5;

export function IconBank(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M3 9 L12 3.5 L21 9 Z" />
      <path d="M6 12 V17 M12 12 V17 M18 12 V17" />
      <path d="M3.5 21 H20.5" />
    </Line>
  );
}

export function IconCalendar(p: LineIconProps) {
  return (
    <Line {...p}>
      <rect x={4} y={5} width={16} height={15} rx={2} />
      <path d="M4 10 H20 M8 3 V7 M16 3 V7" />
      <path d="M8 14 H8.01 M12 14 H12.01 M16 14 H16.01 M8 17.2 H8.01 M12 17.2 H12.01" strokeWidth={2.4} />
    </Line>
  );
}

export function IconPause({ strokeWidth = SOLID_STROKE, ...p }: LineIconProps) {
  return (
    <Line {...p} strokeWidth={strokeWidth}>
      <rect x={6} y={5} width={4} height={14} rx={1} fill="currentColor" />
      <rect x={14} y={5} width={4} height={14} rx={1} fill="currentColor" />
    </Line>
  );
}

export function IconPlay({ strokeWidth = SOLID_STROKE, ...p }: LineIconProps) {
  return (
    <Line {...p} strokeWidth={strokeWidth}>
      <path d="M7.5 5 L19 12 L7.5 19 Z" fill="currentColor" />
    </Line>
  );
}

export function IconFast({ strokeWidth = SOLID_STROKE, ...p }: LineIconProps) {
  return (
    <Line {...p} strokeWidth={strokeWidth}>
      <path d="M4 6 L12 12 L4 18 Z" fill="currentColor" />
      <path d="M12 6 L20 12 L12 18 Z" fill="currentColor" />
    </Line>
  );
}

export function IconFaster({ strokeWidth = SOLID_STROKE, ...p }: LineIconProps) {
  return (
    <Line {...p} strokeWidth={strokeWidth}>
      <path d="M2.5 7 L8.5 12 L2.5 17 Z" fill="currentColor" />
      <path d="M9 7 L15 12 L9 17 Z" fill="currentColor" />
      <path d="M15.5 7 L21.5 12 L15.5 17 Z" fill="currentColor" />
    </Line>
  );
}

export function IconClose(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M6 6 L18 18 M18 6 L6 18" />
    </Line>
  );
}

export function IconChevronLeft(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M15 5 L8 12 L15 19" />
    </Line>
  );
}

export function IconChevronRight(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M9 5 L16 12 L9 19" />
    </Line>
  );
}

export function IconCheck(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M5 12.5 L10 17.5 L19 7" />
    </Line>
  );
}

export function IconLock(p: LineIconProps) {
  return (
    <Line {...p}>
      <rect x={5} y={11} width={14} height={10} rx={2} />
      <path d="M8 11 V8 A4 4 0 0 1 16 8 V11" />
      <path d="M12 15 V17" />
    </Line>
  );
}

/** Рост и убыток: зелёная стрелка вверх и красная вниз, цвета заданы в иконке (для тёмной панели). */
export function IconArrowUpDown(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M8 20 V5 M4 9 L8 5 L12 9" stroke="#5ed37f" />
      <path d="M16 4 V19 M12 15 L16 19 L20 15" stroke="#ff6b6b" />
    </Line>
  );
}

export function IconSave(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M6 3 H16.5 L21 7.5 V18 A3 3 0 0 1 18 21 H6 A3 3 0 0 1 3 18 V6 A3 3 0 0 1 6 3 Z" />
      <path d="M7.5 3 V8 H15 V3" />
      <path d="M7 21 V14 H17 V21" />
    </Line>
  );
}

export function IconTrash(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M4 7 H20" />
      <path d="M9 7 V4.5 H15 V7" />
      <path d="M6 7 L7 19.5 A1.5 1.5 0 0 0 8.5 21 H15.5 A1.5 1.5 0 0 0 17 19.5 L18 7" />
      <path d="M10 11 V17 M14 11 V17" />
    </Line>
  );
}

export function IconTrophy(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M7 4 H17 V10 A5 5 0 0 1 7 10 Z" />
      <path d="M7 6 H4 V8 A3 3 0 0 0 7 11 M17 6 H20 V8 A3 3 0 0 1 17 11" />
      <path d="M12 15 V18 M9.5 18 H14.5 M8 21 H16" />
    </Line>
  );
}

export function IconAlert(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M12 3.5 L21.5 20 H2.5 Z" />
      <path d="M12 10 V14" />
      <path d="M12 17 H12.01" strokeWidth={2.4} />
    </Line>
  );
}

export function IconInfo(p: LineIconProps) {
  return (
    <Line {...p}>
      <circle cx={12} cy={12} r={9} />
      <path d="M12 11 V16" />
      <path d="M12 8 H12.01" strokeWidth={2.4} />
    </Line>
  );
}
