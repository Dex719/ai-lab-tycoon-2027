// Эмблемы клиентов тендеров: цветной квадрат со скруглением и белым знаком отрасли (viewBox 64x64).
// У каждого из 20 клиентов своя отрасль, поэтому эмблема узнаётся с первого взгляда.

import type { ReactElement } from 'react';

interface Emblem {
  /** Цвет фона эмблемы и шапки карточки заказа. */
  color: string;
  /** Цвет знака: белый, на светлом фоне - тёмный. */
  ink?: string;
  draw: (ink: string, bg: string) => ReactElement;
}

const W = '#ffffff';

const EMBLEMS: Record<string, Emblem> = {
  // Банк: здание с колоннами.
  'bank-severny': {
    color: '#1f4a8a',
    draw: (ink) => (
      <g fill={ink}>
        <path d="M12 25 L32 12 L52 25 Z" />
        <rect x={16} y={28} width={5} height={16} rx={1} />
        <rect x={25} y={28} width={5} height={16} rx={1} />
        <rect x={34} y={28} width={5} height={16} rx={1} />
        <rect x={43} y={28} width={5} height={16} rx={1} />
        <rect x={12} y={46} width={40} height={6} rx={1.5} />
      </g>
    ),
  },
  // Ритейл: пакет с покупками и знаком «+».
  'retail-berezka': {
    color: '#2e8b57',
    draw: (ink, bg) => (
      <>
        <path d="M24 25 V20 A8 8 0 0 1 40 20 V25" fill="none" stroke={ink} strokeWidth={3.6} strokeLinecap="round" />
        <rect x={14} y={24} width={36} height={28} rx={4} fill={ink} />
        <path d="M32 31 V45 M25 38 H39" stroke={bg} strokeWidth={4} strokeLinecap="round" />
      </>
    ),
  },
  // Авиалинии: самолёт.
  'air-zarya': {
    color: '#2b8fd6',
    draw: (ink) => (
      <path
        d="M32 8 C34.2 8 35.5 10.2 35.5 12.5 V25.5 L54 36.5 V41 L35.5 35.5 V46 L42 51.5 V55 L32 52.5 L22 55 V51.5 L28.5 46 V35.5 L10 41 V36.5 L28.5 25.5 V12.5 C28.5 10.2 29.8 8 32 8 Z"
        fill={ink}
      />
    ),
  },
  // Страхование: щит с галочкой.
  'insure-nadezhny': {
    color: '#13807a',
    draw: (ink, bg) => (
      <>
        <path d="M32 9 L51 16.5 V31 C51 43.5 42.5 51.5 32 56 C21.5 51.5 13 43.5 13 31 V16.5 Z" fill={ink} />
        <path d="M23 32 L29.5 38.5 L41.5 26" fill="none" stroke={bg} strokeWidth={4.4} strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  // Клиника: крест.
  'clinic-zdravnitsa': {
    color: '#c83a3a',
    draw: (ink) => (
      <g fill={ink}>
        <rect x={25} y={12} width={14} height={40} rx={3} />
        <rect x={12} y={25} width={40} height={14} rx={3} />
      </g>
    ),
  },
  // Юристы: весы.
  'law-pravda': {
    color: '#6b4a8e',
    draw: (ink) => (
      <>
        <g stroke={ink} strokeWidth={3} strokeLinecap="round" fill="none">
          <path d="M32 11 V49" />
          <path d="M13 19 H51" />
          <path d="M13 19 L7 35 M13 19 L19 35" strokeWidth={2} />
          <path d="M51 19 L45 35 M51 19 L57 35" strokeWidth={2} />
          <path d="M22 52 H42" strokeWidth={4} />
        </g>
        <path d="M6 35 H20 A7 7 0 0 1 6 35 Z" fill={ink} />
        <path d="M44 35 H58 A7 7 0 0 1 44 35 Z" fill={ink} />
        <circle cx={32} cy={11} r={3.5} fill={ink} />
      </>
    ),
  },
  // Игровая студия «Пиксельный Лис»: пиксельная мордочка лиса.
  'games-pixel-lis': {
    color: '#e0702b',
    draw: (ink) => {
      const rows = ['X......X', 'XX....XX', 'XXXXXXXX', 'XoXXXXoX', 'XXXXXXXX', '.XXXXXX.', '..XnnX..', '...XX...'];
      const cells: ReactElement[] = [];
      rows.forEach((r, y) =>
        [...r].forEach((c, x) => {
          if (c === '.') return;
          cells.push(<rect key={`${x}-${y}`} x={12 + x * 5} y={12 + y * 5} width={5.2} height={5.2} fill={c === 'X' ? ink : '#3a1d08'} />);
        }),
      );
      return <>{cells}</>;
    },
  },
  // Логистика: грузовик.
  'logistics-bystry': {
    color: '#c98a12',
    draw: (ink, bg) => (
      <>
        <g stroke={ink} strokeWidth={2.6} strokeLinecap="round">
          <path d="M3 27 H8" />
          <path d="M5 33 H8" />
        </g>
        <rect x={10} y={18} width={28} height={24} rx={2.5} fill={ink} />
        <path d="M40 25 H49 L57 33.5 V42 H40 Z" fill={ink} />
        <path d="M43 28 H48 L52.5 33 H43 Z" fill={bg} />
        <circle cx={20} cy={45} r={6} fill={ink} stroke={bg} strokeWidth={2.5} />
        <circle cx={48} cy={45} r={6} fill={ink} stroke={bg} strokeWidth={2.5} />
      </>
    ),
  },
  // Телеком: вышка с волнами связи.
  'telecom-svyaztech': {
    color: '#6a4bc4',
    draw: (ink) => (
      <>
        <path d="M32 24 L23 56 H28 L32 42 L36 56 H41 Z" fill={ink} />
        <circle cx={32} cy={20} r={4.5} fill={ink} />
        <g fill="none" stroke={ink} strokeWidth={3.2} strokeLinecap="round">
          <path d="M23 12 A12 12 0 0 0 23 28" />
          <path d="M41 12 A12 12 0 0 1 41 28" />
          <path d="M16 6 A20 20 0 0 0 16 34" />
          <path d="M48 6 A20 20 0 0 1 48 34" />
        </g>
      </>
    ),
  },
  // Портал госуслуг: документ с круглой печатью.
  'gov-gosdostup': {
    color: '#2456a6',
    draw: (ink) => (
      <>
        <rect x={13} y={8} width={30} height={42} rx={3.5} fill={ink} />
        <g stroke="#9db5dd" strokeWidth={2.6} strokeLinecap="round">
          <path d="M19 17 H37" />
          <path d="M19 24 H37" />
          <path d="M19 31 H31" />
        </g>
        <circle cx={43} cy={44} r={11} fill="#ffd34d" stroke="#2456a6" strokeWidth={3} />
        <path d="M38 44 L41.5 47.5 L48 41" fill="none" stroke="#1d3f7a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  // Маркетплейс: тележка с коробками.
  'market-torgovich': {
    color: '#c2368a',
    draw: (ink) => (
      <>
        <path d="M7 14 H15 L21 41 H48 L54 22 H18" fill="none" stroke={ink} strokeWidth={3.8} strokeLinecap="round" strokeLinejoin="round" />
        <rect x={24} y={26} width={10} height={10} rx={1.5} fill={ink} />
        <rect x={36} y={28} width={10} height={8} rx={1.5} fill={ink} />
        <circle cx={24} cy={50} r={4.5} fill={ink} />
        <circle cx={45} cy={50} r={4.5} fill={ink} />
      </>
    ),
  },
  // Автозавод: автомобиль сбоку.
  'auto-ural': {
    color: '#4f5b6b',
    draw: (ink, bg) => (
      <>
        <path d="M6 42 V35 L14 32.5 L21 21 H42 L50 32 L58 34.5 V42 Z" fill={ink} />
        <path d="M24 24 H31 V31 H19.5 Z" fill={bg} />
        <path d="M34 24 H40.5 L45.5 31 H34 Z" fill={bg} />
        <circle cx={18} cy={43} r={7} fill="#262b33" stroke={ink} strokeWidth={2.5} />
        <circle cx={46} cy={43} r={7} fill="#262b33" stroke={ink} strokeWidth={2.5} />
        <circle cx={18} cy={43} r={2.4} fill={ink} />
        <circle cx={46} cy={43} r={2.4} fill={ink} />
      </>
    ),
  },
  // Энергосбыт: молния.
  'energy-svetlograd': {
    color: '#e0a106',
    draw: (ink) => <path d="M37 6 L15 36 H30 L25 58 L49 25 H34 Z" fill={ink} stroke={ink} strokeWidth={1.5} strokeLinejoin="round" />,
  },
  // Университет: шапочка выпускника.
  'edu-novaya-shkola': {
    color: '#3a4bb5',
    draw: (ink) => (
      <>
        <path d="M18 33 V43 C18 47.5 25.5 51 32 51 C38.5 51 46 47.5 46 43 V33 Z" fill="#c9cff3" />
        <path d="M32 13 L59 26 L32 39 L5 26 Z" fill={ink} />
        <path d="M53 29 V43" stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
        <circle cx={53} cy={45} r={3} fill="#ffd34d" />
      </>
    ),
  },
  // Фарма: капсула.
  'pharma-biomedika': {
    color: '#159a8c',
    draw: (ink) => (
      <g transform="rotate(-40 32 32)">
        <rect x={10} y={21} width={44} height={22} rx={11} fill={ink} />
        <path d="M32 21 H43 A11 11 0 0 1 43 43 H32 Z" fill="#ffc9c9" />
        <path d="M17 28 A6 6 0 0 1 22 25" fill="none" stroke="#b9ece6" strokeWidth={2.4} strokeLinecap="round" />
      </g>
    ),
  },
  // Гостиницы «Золотой Берег»: солнце над морем.
  'hotels-zolotoy-bereg': {
    color: '#c7861f',
    draw: (ink) => (
      <>
        <circle cx={32} cy={30} r={11} fill="#ffe08a" />
        <g stroke="#ffe08a" strokeWidth={2.8} strokeLinecap="round">
          <path d="M32 9 V13" />
          <path d="M17 15 L19.8 17.8" />
          <path d="M47 15 L44.2 17.8" />
          <path d="M11 30 H15" />
          <path d="M49 30 H53" />
        </g>
        <path d="M6 41 H58 V58 H6 Z" fill="#c7861f" />
        <g fill="none" stroke={ink} strokeWidth={3.2} strokeLinecap="round">
          <path d="M7 42 Q13.5 37.5 20 42 T33 42 T46 42 T58 42" />
          <path d="M7 51 Q13.5 46.5 20 51 T33 51 T46 51 T58 51" />
        </g>
      </>
    ),
  },
  // Стройгрупп: каска.
  'build-opora': {
    color: '#d9661f',
    draw: (ink, bg) => (
      <>
        <path d="M12 40 C12 25.5 20.5 17 32 17 C43.5 17 52 25.5 52 40 Z" fill={ink} />
        <rect x={7} y={39} width={50} height={7} rx={3.5} fill={ink} />
        <rect x={28.5} y={14} width={7} height={16} rx={2.5} fill={bg} />
        <path d="M19 37 C19 30 21.5 25.5 25 23" fill="none" stroke={bg} strokeWidth={2.6} strokeLinecap="round" />
      </>
    ),
  },
  // Медиа «Эфир-24»: экран с кнопкой воспроизведения.
  'media-efir': {
    color: '#d13b3b',
    draw: (ink, bg) => (
      <>
        <rect x={8} y={12} width={48} height={33} rx={5} fill={ink} />
        <path d="M27 21 L41 28.5 L27 36 Z" fill={bg} />
        <path d="M24 53 H40" stroke={ink} strokeWidth={4} strokeLinecap="round" />
        <path d="M32 45 V52" stroke={ink} strokeWidth={3.5} />
      </>
    ),
  },
  // Агрохолдинг «Колос»: колос пшеницы.
  'agro-kolos': {
    color: '#5f8a1f',
    draw: (ink) => (
      <>
        <path d="M32 58 V14" stroke={ink} strokeWidth={3} strokeLinecap="round" />
        <g fill={ink}>
          <ellipse cx={32} cy={11} rx={4} ry={7} />
          {[20, 29, 38].map((y) => (
            <g key={y}>
              <ellipse cx={25.5} cy={y} rx={4} ry={7.5} transform={`rotate(-35 25.5 ${y})`} />
              <ellipse cx={38.5} cy={y} rx={4} ry={7.5} transform={`rotate(35 38.5 ${y})`} />
            </g>
          ))}
        </g>
        <path d="M32 50 Q24 47 20 41" fill="none" stroke={ink} strokeWidth={2.6} strokeLinecap="round" />
      </>
    ),
  },
  // Такси «Попутчик»: машина спереди с шашечкой на крыше.
  'taxi-poputchik': {
    color: '#f2c21b',
    ink: '#1c1c1e',
    draw: (ink, bg) => (
      <>
        <rect x={26} y={9} width={12} height={7} rx={1.5} fill={ink} />
        <path d="M17 29 L22.5 18 H41.5 L47 29 Z" fill={ink} />
        <path d="M22 27 L25.5 21 H38.5 L42 27 Z" fill="#8fc1ff" />
        <rect x={10} y={28} width={44} height={17} rx={5} fill={ink} />
        <circle cx={18} cy={36.5} r={3.5} fill={bg} />
        <circle cx={46} cy={36.5} r={3.5} fill={bg} />
        <rect x={25} y={34} width={14} height={4} rx={1} fill={bg} />
        <rect x={13} y={44} width={8} height={8} rx={2} fill={ink} />
        <rect x={43} y={44} width={8} height={8} rx={2} fill={ink} />
      </>
    ),
  },
};

const FALLBACK: Emblem = {
  color: '#5b6676',
  draw: (ink) => <circle cx={32} cy={32} r={14} fill={ink} />,
};

/** Цвет клиента (фон эмблемы, шапка карточки). */
export function clientColor(clientId: string): string {
  return (EMBLEMS[clientId] ?? FALLBACK).color;
}

/** Эмблема клиента: квадрат цвета клиента со знаком отрасли. */
export function ClientEmblem({ clientId, size = 40, className }: { clientId: string; size?: number; className?: string }) {
  const e = EMBLEMS[clientId] ?? FALLBACK;
  const ink = e.ink ?? W;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width={64} height={64} rx={14} fill={e.color} />
      {e.draw(ink, e.color)}
    </svg>
  );
}

/** Все клиенты, у которых есть эмблема (для проверки). */
export const EMBLEM_IDS = Object.keys(EMBLEMS);
