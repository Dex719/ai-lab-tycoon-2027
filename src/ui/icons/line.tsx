// Мелкие значки интерфейса (viewBox 24x24, контур currentColor). Размер по умолчанию 18 px.

import { Line, type LineIconProps } from './base';

/** Для кнопок скорости: заполненные фигуры, толщина контура только скругляет углы. */
const SOLID_STROKE = 1.5;

/** Банк: заполненный значок, как в верхней панели PT. Контур 1 нужен только для скругления углов. */
export function IconBank(p: LineIconProps) {
  return (
    <Line {...p} strokeWidth={1}>
      <path d="M12 3 L21.5 8.2 V9.4 H2.5 V8.2 Z" fill="currentColor" />
      <path d="M5 11.8 H8.4 V17.2 H5 Z M10.3 11.8 H13.7 V17.2 H10.3 Z M15.6 11.8 H19 V17.2 H15.6 Z" fill="currentColor" />
      <path d="M3 19.5 H21 V21.5 H3 Z" fill="currentColor" />
    </Line>
  );
}

/** Календарь: заполненный значок с двумя кольцами сверху и сеткой дней, вырезанной в корпусе. */
export function IconCalendar(p: LineIconProps) {
  return (
    <Line {...p} strokeWidth={0}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5.5 4.5 H18.5 A2.5 2.5 0 0 1 21 7 V19 A2.5 2.5 0 0 1 18.5 21.5 H5.5 A2.5 2.5 0 0 1 3 19 V7 A2.5 2.5 0 0 1 5.5 4.5 Z
           M5.5 8.4 H18.5 V9.6 H5.5 Z
           M6.2 12.2 H8.6 V14.6 H6.2 Z M10.8 12.2 H13.2 V14.6 H10.8 Z M15.4 12.2 H17.8 V14.6 H15.4 Z
           M6.2 16.4 H8.6 V18.8 H6.2 Z M10.8 16.4 H13.2 V18.8 H10.8 Z"
      />
      <rect x={7} y={2} width={2.6} height={5} rx={1.3} fill="currentColor" />
      <rect x={14.4} y={2} width={2.6} height={5} rx={1.3} fill="currentColor" />
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

/** Рост и убыток: заполненные стрелки, зелёная вверх и красная вниз. Цвета заданы в иконке (для тёмной панели). */
export function IconArrowUpDown(p: LineIconProps) {
  return (
    <Line {...p} strokeWidth={1.2}>
      <path d="M8 3 L12.8 9.5 H9.3 V19.5 H6.7 V9.5 H3.2 Z" fill="#5ed37f" stroke="#5ed37f" />
      <path d="M16 21 L20.8 14.5 H17.3 V4.5 H14.7 V14.5 H11.2 Z" fill="#ff6b6b" stroke="#ff6b6b" />
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

/** Папка: «Загрузить» в меню игры. */
export function IconFolder(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M3 6.5 A1.5 1.5 0 0 1 4.5 5 H9.5 L11.5 7.5 H19.5 A1.5 1.5 0 0 1 21 9 V18 A1.5 1.5 0 0 1 19.5 19.5 H4.5 A1.5 1.5 0 0 1 3 18 Z" />
    </Line>
  );
}

/** Шестерёнка: «Настройки». */
export function IconGear(p: LineIconProps) {
  return (
    <Line {...p}>
      <circle cx={12} cy={12} r={3} />
      <path d="M12 2.5 V5 M12 19 V21.5 M2.5 12 H5 M19 12 H21.5 M5.3 5.3 L7.1 7.1 M16.9 16.9 L18.7 18.7 M5.3 18.7 L7.1 16.9 M16.9 7.1 L18.7 5.3" />
      <circle cx={12} cy={12} r={6.5} />
    </Line>
  );
}

/** Дверь со стрелкой: «Выйти в главное меню». */
export function IconExit(p: LineIconProps) {
  return (
    <Line {...p}>
      <path d="M14 4 H6 A1.5 1.5 0 0 0 4.5 5.5 V18.5 A1.5 1.5 0 0 0 6 20 H14" />
      <path d="M10 12 H20.5 M17 8.5 L20.5 12 L17 15.5" />
    </Line>
  );
}
