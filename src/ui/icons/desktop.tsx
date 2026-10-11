// Цветные плоские иконки рабочего стола (viewBox 64x64). В «серой» версии цвета идут через toneFor.

import { Flat, toneFor, type IconProps, type Tone } from './base';

/** Знак «$» в начале координат, высота около 12 единиц. Рисуется белым внутри синего значка. */
function Dollar({ cx, cy, scale = 1, color }: { cx: number; cy: number; scale?: number; color: string }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round">
      <path d="M3 -3 C3 -4.6 1.6 -5 0 -5 C-1.8 -5 -3 -4.2 -3 -2.6 C-3 0 3 0 3 2.6 C3 4.2 1.8 5 0 5 C-1.6 5 -3 4.6 -3 3" />
      <path d="M0 -7 V7" />
    </g>
  );
}

/** Вентилятор видеокарты: тёмный круг, пять светлых лопастей, ступица. */
function Fan({ cx, cy, r, t }: { cx: number; cy: number; r: number; t: Tone }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={t('#23262c')} />
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={cx} cy={cy - r * 0.52} rx={r * 0.29} ry={r * 0.48} fill={t('#a3acb8')} transform={`rotate(${a} ${cx} ${cy})`} />
      ))}
      <circle cx={cx} cy={cy} r={r * 0.29} fill={t('#e0e4e9')} />
    </g>
  );
}

/** Исследования: жёлтая лампочка с серым цоколем. */
export function IconResearch({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <path
        d="M32 5 C21.5 5 14 12.6 14 22.5 C14 29 17.2 33.2 20.8 37.2 C22.4 39 23 40.6 23 42.8 V44 H41 V42.8 C41 40.6 41.6 39 43.2 37.2 C46.8 33.2 50 29 50 22.5 C50 12.6 42.5 5 32 5 Z"
        fill={t('#f0c93a')}
      />
      <path
        d="M32 5 C42.5 5 50 12.6 50 22.5 C50 29 46.8 33.2 43.2 37.2 C41.6 39 41 40.6 41 42.8 V44 H35.5 V42.8 C35.5 39.5 36.5 37 39 33.5 C42 29.3 44 26.5 44 21.5 C44 14 39 8 32 5 Z"
        fill={t('#d9aa1e')}
      />
      <path d="M21.5 21 C21.5 15.5 25 11.5 29.5 10" fill="none" stroke={t('#fae38a')} strokeWidth={3} strokeLinecap="round" />
      <rect x={23} y={47} width={18} height={3.2} rx={1.6} fill={t('#9ea2a9')} />
      <rect x={25.5} y={52} width={13} height={3.2} rx={1.6} fill={t('#8c9097')} />
      <rect x={28.5} y={57} width={7} height={3} rx={1.5} fill={t('#7b7f86')} />
    </Flat>
  );
}

/** Мощности: видеокарта. Светлая планка, синевато-серый кожух с двумя вентиляторами, зелёные индикаторы, золотой разъём. */
export function IconCompute({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <g transform="translate(0 3)">
        <rect x={3} y={7} width={5} height={42} rx={1.2} fill={t('#c8cdd4')} />
        <rect x={8} y={9} width={52} height={36} rx={3} fill={t('#6f7a89')} />
        <path d="M8 39 H60 V42 A3 3 0 0 1 57 45 H11 A3 3 0 0 1 8 42 Z" fill={t('#4a525e')} />
        <Fan cx={21.5} cy={24} r={11.5} t={t} />
        <Fan cx={46.5} cy={24} r={11.5} t={t} />
        <circle cx={47} cy={42} r={1.5} fill={t('#5ed37f')} />
        <circle cx={52} cy={42} r={1.5} fill={t('#5ed37f')} />
        <circle cx={57} cy={42} r={1.5} fill={t('#5ed37f')} />
        <rect x={14} y={45} width={14} height={5} fill={t('#d9b44a')} />
        <rect x={31} y={45} width={13} height={5} fill={t('#d9b44a')} />
      </g>
    </Flat>
  );
}

/** Новая модель: тёмный чип с сетью из узлов и синим значком «+». */
export function IconNewModel({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  const pins = [16, 24, 32, 40];
  const left = [
    [20, 21],
    [20, 28],
    [20, 35],
  ];
  const right = [
    [36, 24.5],
    [36, 31.5],
  ];
  return (
    <Flat size={size} className={className} locked={disabled}>
      {pins.map((p) => (
        <g key={p} fill={t('#c3c9d1')}>
          <rect x={p - 1.5} y={3} width={3} height={6} rx={1} />
          <rect x={p - 1.5} y={47} width={3} height={6} rx={1} />
          <rect x={3} y={p - 1.5} width={6} height={3} rx={1} />
          <rect x={47} y={p - 1.5} width={6} height={3} rx={1} />
        </g>
      ))}
      <rect x={8} y={8} width={40} height={40} rx={4} fill={t('#5b6676')} />
      <rect x={13} y={13} width={30} height={30} rx={2} fill={t('#1e2227')} />
      <g stroke={t('#4fbf7d')} strokeWidth={1.5} strokeLinecap="round">
        {left.flatMap(([x1, y1]) => right.map(([x2, y2]) => <line key={`${y1}-${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} />))}
      </g>
      <g fill={t('#7be3a0')}>
        {[...left, ...right].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={2.4} />
        ))}
      </g>
      <circle cx={46} cy={46} r={11.5} fill={t('#1d5fb8')} />
      <circle cx={46} cy={46} r={10.2} fill={t('#2f80e4')} />
      <path d="M46 40.2 V51.8 M40.2 46 H51.8" stroke={t('#ffffff')} strokeWidth={3.2} strokeLinecap="round" />
    </Flat>
  );
}

/** Контракты: белый документ с синим значком «$». */
export function IconContracts({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <path d="M13 6 H37 L49 18 V58 H13 Z" fill={t('#f2f3f5')} />
      <path d="M37 6 V18 H49 Z" fill={t('#c5cad1')} />
      <rect x={19} y={13} width={13} height={3} rx={1.5} fill={t('#8e949d')} />
      <g fill={t('#bfc4cb')}>
        <rect x={19} y={22} width={24} height={2} rx={1} />
        <rect x={19} y={27} width={24} height={2} rx={1} />
        <rect x={19} y={32} width={24} height={2} rx={1} />
        <rect x={19} y={37} width={16} height={2} rx={1} />
        <rect x={35} y={48} width={9} height={2} rx={1} />
        <rect x={35} y={53} width={9} height={2} rx={1} />
      </g>
      <circle cx={22} cy={49} r={10.5} fill={t('#f2f3f5')} />
      <circle cx={22} cy={49} r={9} fill={t('#2f80e4')} />
      <Dollar cx={22} cy={49} scale={0.85} color={t('#ffffff')} />
    </Flat>
  );
}

/** Инвесторы: портфель, светлый сверху и серый снизу, с золотым замком. */
export function IconInvestors({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <path d="M21 21 V13 Q21 9 25 9 H39 Q43 9 43 13 V21 H39 V14 Q39 13 38 13 H26 Q25 13 25 14 V21 Z" fill={t('#aeb2b9')} />
      <rect x={6} y={20} width={52} height={35} rx={5} fill={t('#e2e4e8')} />
      <path d="M6 37 H58 V50 A5 5 0 0 1 53 55 H11 A5 5 0 0 1 6 50 Z" fill={t('#c7cad0')} />
      <rect x={27.5} y={31} width={9} height={11} rx={2} fill={t('#e0b43a')} />
      <rect x={31} y={34.5} width={2} height={4} rx={1} fill={t('#9c7616')} />
    </Flat>
  );
}

/** Модели: лупа над чипом. */
export function IconModels({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  const pinPos = [22.5, 26, 29.5];
  return (
    <Flat size={size} className={className} locked={disabled}>
      <path d="M39 39 L56 56" stroke={t('#15171a')} strokeWidth={7} strokeLinecap="round" />
      <circle cx={26} cy={26} r={17.5} fill={t('#7f9cc6')} stroke={t('#15171a')} strokeWidth={5} />
      <g stroke={t('#2d3b55')} strokeWidth={1.4} strokeLinecap="round">
        {pinPos.map((p) => (
          <g key={p}>
            <path d={`M${p} 17.5 V20.5 M${p} 31.5 V34.5`} />
            <path d={`M17.5 ${p} H20.5 M31.5 ${p} H34.5`} />
          </g>
        ))}
      </g>
      <rect x={20.5} y={20.5} width={11} height={11} rx={1.5} fill={t('#2d3b55')} />
      <rect x={23.5} y={23.5} width={5} height={5} rx={0.8} fill={t('#a8c4ee')} />
      <path d="M13.5 22 A13 13 0 0 1 22 13.5" fill="none" stroke={t('#bcd2f2')} strokeWidth={2} strokeLinecap="round" />
    </Flat>
  );
}

/** Почта: жёлтый конверт. */
export function IconMail({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <rect x={6} y={14} width={52} height={36} rx={5} fill={t('#f6cf4a')} />
      <path d="M8 49 L25 33 M56 49 L39 33" fill="none" stroke={t('#e3b92f')} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M9 18.5 L32 36 L55 18.5" fill="none" stroke={t('#d9a521')} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    </Flat>
  );
}

/** Аналитика: монитор с графиком. */
export function IconAnalytics({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <rect x={6} y={8} width={52} height={37} rx={2} fill={t('#eef2f8')} />
      <path d="M6 38 V29 L16 22 L26 29 L38 15 L48 24 L58 19 V38 Z" fill={t('#a6d3f8')} />
      <path d="M6 29 L16 22 L26 29 L38 15 L48 24 L58 19" fill="none" stroke={t('#2f80e4')} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 38 H58 V43 A2 2 0 0 1 56 45 H8 A2 2 0 0 1 6 43 Z" fill={t('#a9adb4')} />
      <circle cx={32} cy={41.5} r={1} fill={t('#e9eaed')} />
      <rect x={29} y={45} width={6} height={7} fill={t('#8a8e95')} />
      <rect x={20} y={52} width={24} height={3.5} rx={1.7} fill={t('#8a8e95')} />
    </Flat>
  );
}

/** Дата-центры: три серверных блока в стойке, у каждого индикатор, прорези и ручка. */
export function IconDatacenters({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      {[6, 24, 42].map((y) => (
        <g key={y}>
          <rect x={6} y={y} width={52} height={15} rx={2.5} fill={t('#c9ced5')} />
          <rect x={9} y={y + 3} width={46} height={9} rx={1.5} fill={t('#3d4249')} />
          <circle cx={14.5} cy={y + 7.5} r={2} fill={t('#5ed37f')} />
          <rect x={21} y={y + 4.8} width={20} height={2} rx={1} fill={t('#7c848f')} />
          <rect x={21} y={y + 8.2} width={20} height={2} rx={1} fill={t('#7c848f')} />
          <rect x={46} y={y + 5.5} width={6} height={4} rx={1} fill={t('#9aa2ad')} />
        </g>
      ))}
    </Flat>
  );
}

/** Команда: два человека, передний синий, задний светлее. */
export function IconTeam({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <circle cx={43} cy={19} r={7.5} fill={t('#8dbaf0')} />
      <path d="M30 38 C33 35 38 34 43 34 C54 34 60 40 60 54 V57 H34 Z" fill={t('#8dbaf0')} />
      <circle cx={24} cy={22} r={9} fill={t('#3d86e0')} />
      <path d="M4 57 C4 44 12 37 24 37 C36 37 44 44 44 57 Z" fill={t('#3d86e0')} />
    </Flat>
  );
}

/** Безопасность: щит с галочкой. */
export function IconSafety({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <path d="M32 5 L54 13 V30 C54 44 44 54 32 59 C20 54 10 44 10 30 V13 Z" fill={t('#3fae66')} />
      <path d="M32 5 L54 13 V30 C54 44 44 54 32 59 Z" fill={t('#2f8f50')} />
      <path d="M20.5 31.5 L29 40 L44 24" fill="none" stroke={t('#ffffff')} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </Flat>
  );
}

/**
 * Логотип игры: нейросеть в кольце. Цвет берётся из currentColor:
 * на рабочем столе - бледно-серый, на панели задач - белый.
 */
export function IconLogo({ size, disabled, className }: IconProps) {
  const input = [25, 39];
  const hidden = [18, 32, 46];
  return (
    <Flat size={size} className={className} style={disabled ? { color: '#6b6f76' } : undefined}>
      <circle cx={32} cy={32} r={28.5} fill="none" stroke="currentColor" strokeWidth={4.5} />
      <g stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        {input.flatMap((y) => hidden.map((h) => <line key={`a${y}-${h}`} x1={18} y1={y} x2={32} y2={h} />))}
        {hidden.flatMap((h) => input.map((y) => <line key={`b${h}-${y}`} x1={32} y1={h} x2={46} y2={y} />))}
      </g>
      <g fill="currentColor">
        {input.map((y) => (
          <g key={y}>
            <circle cx={18} cy={y} r={3.6} />
            <circle cx={46} cy={y} r={3.6} />
          </g>
        ))}
        {hidden.map((y) => (
          <circle key={y} cx={32} cy={y} r={3.6} />
        ))}
      </g>
    </Flat>
  );
}
