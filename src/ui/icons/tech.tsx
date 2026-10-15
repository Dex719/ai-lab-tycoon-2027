// Значки технологий для окна «Исследования» (viewBox 64x64, плоский цветной стиль как у иконок рабочего стола).
// Цвет - цвет направления технологии; у закрытой технологии значок серый (toneFor).

import type { ReactElement } from 'react';
import type { TechId } from '../../sim/types';
import { Flat, toneFor, type Tone } from './base';

export interface TechIconProps {
  size?: number;
  /** Закрытая технология: серый значок. */
  locked?: boolean;
  className?: string;
}

type Draw = (t: Tone) => ReactElement;

/** Механизм внимания: ряд слов, от выделенного слова дуги внимания к остальным. */
const attention: Draw = (t) => (
  <>
    <g fill="none" stroke={t('#2f80e4')} strokeLinecap="round">
      <path d="M32 44 Q20.5 4 9 44" strokeWidth={4.2} />
      <path d="M32 44 Q26 24 20.5 44" strokeWidth={2} />
      <path d="M32 44 Q38 24 43.5 44" strokeWidth={2.6} />
      <path d="M32 44 Q43.5 10 55 44" strokeWidth={1.6} />
    </g>
    <rect x={3.5} y={45} width={11} height={11} rx={2.5} fill={t('#9cc2f0')} />
    <rect x={15} y={45} width={11} height={11} rx={2.5} fill={t('#9cc2f0')} />
    <rect x={26.5} y={45} width={11} height={11} rx={2.5} fill={t('#1f5aa8')} />
    <rect x={38} y={45} width={11} height={11} rx={2.5} fill={t('#9cc2f0')} />
    <rect x={49.5} y={45} width={11} height={11} rx={2.5} fill={t('#9cc2f0')} />
    <circle cx={32} cy={50.5} r={2.2} fill={t('#ffd34d')} />
  </>
);

/** Законы масштабирования: оси и прямая роста с точками всё крупнее. */
const scaling: Draw = (t) => (
  <>
    <path d="M9 7 V55 H59" fill="none" stroke={t('#9aa5de')} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 48 L51 14" fill="none" stroke={t('#4c5fd0')} strokeWidth={3.5} strokeLinecap="round" />
    <path d="M44 12 H53 V21" fill="none" stroke={t('#4c5fd0')} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={18} cy={45} r={3.4} fill={t('#3a4bb5')} />
    <circle cx={28} cy={35.6} r={4.2} fill={t('#3a4bb5')} />
    <circle cx={38.5} cy={25.7} r={5} fill={t('#3a4bb5')} />
    <circle cx={28} cy={35.6} r={1.6} fill={t('#dfe3fa')} />
    <circle cx={38.5} cy={25.7} r={2} fill={t('#dfe3fa')} />
  </>
);

/** RLHF: большой палец вверх (оценка человека). */
const rlhf: Draw = (t) => (
  <>
    <rect x={6} y={28} width={12} height={28} rx={2.5} fill={t('#4b3699')} />
    <path
      d="M21 30 L30.5 14.5 C32 11.8 35.6 11 37.6 13 C39.3 14.7 39.4 17.4 38.4 20 L35.8 27 H51 C54.6 27 57.2 30.4 56.2 33.8 L51.8 50 C51 53 48.4 55 45.3 55 H21 Z"
      fill={t('#7b5cd6')}
    />
    <g stroke={t('#c5b8f2')} strokeWidth={2.4} strokeLinecap="round">
      <path d="M38 35.5 H53" />
      <path d="M38 42.5 H51" />
      <path d="M38 49 H48" />
    </g>
    <circle cx={12} cy={50} r={2} fill={t('#c5b8f2')} />
  </>
);

/** Алгоритмические улучшения: шестерня и зелёная стрелка вверх. */
const algo: Draw = (t) => {
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <>
      <g fill={t('#c99a1a')}>
        {teeth.map((a) => (
          <rect key={a} x={22.5} y={14} width={9} height={10} rx={2} transform={`rotate(${a} 27 37)`} />
        ))}
        <circle cx={27} cy={37} r={16} />
      </g>
      <circle cx={27} cy={37} r={7} fill={t('#fff3c4')} />
      <circle cx={27} cy={37} r={3} fill={t('#8a670b')} />
      <path d="M52 50 V14" stroke={t('#2e9b4f')} strokeWidth={5.5} strokeLinecap="round" />
      <path d="M43 22 L52 12 L61 22" fill="none" stroke={t('#2e9b4f')} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
};

/** Длинный контекст: развёрнутый свиток со строками и стрелка длины под ним. */
const context: Draw = (t) => (
  <>
    <rect x={10} y={14} width={44} height={30} fill={t('#fff1de')} />
    <g stroke={t('#e2b47c')} strokeWidth={2.4} strokeLinecap="round">
      <path d="M16 22 H48" />
      <path d="M16 29 H44" />
      <path d="M16 36 H40" />
    </g>
    <rect x={3} y={10} width={10} height={38} rx={5} fill={t('#d9822b')} />
    <rect x={51} y={10} width={10} height={38} rx={5} fill={t('#d9822b')} />
    <rect x={5.5} y={12} width={3} height={34} rx={1.5} fill={t('#f0b071')} />
    <rect x={53.5} y={12} width={3} height={34} rx={1.5} fill={t('#f0b071')} />
    <g fill="none" stroke={t('#a85a14')} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 56 H52" />
      <path d="M17 51 L12 56 L17 61" />
      <path d="M47 51 L52 56 L47 61" />
    </g>
  </>
);

/** Дистилляция: большая колба перегоняет жидкость в маленькую пробирку. */
const distill: Draw = (t) => (
  <>
    <path d="M20 13 Q21 5 31 7 L47 21" fill="none" stroke={t('#9aa6b2')} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
    <rect x={15} y={10} width={10} height={18} rx={2} fill={t('#dde8f0')} />
    <circle cx={20} cy={41} r={15} fill={t('#dde8f0')} />
    <path d="M5.4 44 A15 15 0 0 0 34.6 44 Z" fill={t('#c99a1a')} />
    <path d="M12 36 A9 9 0 0 1 17 30" fill="none" stroke={t('#ffffff')} strokeWidth={2.4} strokeLinecap="round" />
    <path d="M47 25 C47 25 43.5 29.5 43.5 31.5 A3.5 3.5 0 0 0 50.5 31.5 C50.5 29.5 47 25 47 25 Z" fill={t('#e9b52c')} />
    <rect x={40} y={36} width={14} height={21} rx={3.5} fill={t('#dde8f0')} />
    <rect x={40} y={46} width={14} height={11} rx={3.5} fill={t('#e9b52c')} />
  </>
);

/** Смесь экспертов: распределитель отправляет запрос двум экспертам из четырёх. */
const moe: Draw = (t) => (
  <>
    <g strokeLinecap="round" fill="none">
      <path d="M32 14 L9.5 33" stroke={t('#b9c9de')} strokeWidth={2} />
      <path d="M32 14 L24.5 33" stroke={t('#2f80e4')} strokeWidth={3.6} />
      <path d="M32 14 L39.5 33" stroke={t('#b9c9de')} strokeWidth={2} />
      <path d="M32 14 L54.5 33" stroke={t('#2f80e4')} strokeWidth={3.6} />
      <path d="M24.5 49 L32 56 L54.5 49" stroke={t('#2f80e4')} strokeWidth={3} />
    </g>
    <circle cx={32} cy={11} r={7.5} fill={t('#1f5aa8')} />
    <circle cx={32} cy={11} r={3} fill={t('#ffd34d')} />
    <rect x={3} y={33} width={13} height={16} rx={3} fill={t('#c9dcf5')} />
    <rect x={18} y={33} width={13} height={16} rx={3} fill={t('#2f80e4')} />
    <rect x={33} y={33} width={13} height={16} rx={3} fill={t('#c9dcf5')} />
    <rect x={48} y={33} width={13} height={16} rx={3} fill={t('#2f80e4')} />
    <circle cx={32} cy={57} r={4} fill={t('#1f5aa8')} />
  </>
);

/** Обучение на коде: тёмное окно редактора со знаком «</>». */
const codetrain: Draw = (t) => (
  <>
    <rect x={4} y={9} width={56} height={46} rx={5} fill={t('#1d2433')} />
    <rect x={4} y={9} width={56} height={10} rx={5} fill={t('#2c3548')} />
    <rect x={4} y={15} width={56} height={4} fill={t('#2c3548')} />
    <circle cx={11} cy={14} r={2} fill={t('#e35d5d')} />
    <circle cx={17.5} cy={14} r={2} fill={t('#ffd34d')} />
    <circle cx={24} cy={14} r={2} fill={t('#5ed37f')} />
    <g fill="none" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 29 L14 37 L22 45" stroke={t('#3fd0c6')} />
      <path d="M42 29 L50 37 L42 45" stroke={t('#3fd0c6')} />
      <path d="M35.5 26 L28.5 48" stroke={t('#ffd34d')} />
    </g>
  </>
);

/** Дообучение на инструкциях: планшет со списком, отмеченным галочками. */
const instruct: Draw = (t) => (
  <>
    <rect x={10} y={9} width={44} height={51} rx={5} fill={t('#7b5cd6')} />
    <rect x={15} y={15} width={34} height={40} rx={2.5} fill={t('#f5f2ff')} />
    <rect x={23} y={5} width={18} height={9} rx={2.5} fill={t('#4b3699')} />
    <g fill="none" stroke={t('#2e9b4f')} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 25 L22 28 L27 22" />
      <path d="M19 35 L22 38 L27 32" />
      <path d="M19 45 L22 48 L27 42" />
    </g>
    <g stroke={t('#b7a6ee')} strokeWidth={3} strokeLinecap="round">
      <path d="M31 25.5 H44" />
      <path d="M31 35.5 H42" />
      <path d="M31 45.5 H44" />
    </g>
  </>
);

/** Цепочки рассуждений: лесенка из шагов, наверху звезда - ответ. */
const cot: Draw = (t) => (
  <>
    <g fill="none" stroke={t('#9b84e6')} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 44 V36 H21" />
      <path d="M28 30 V22 H38" />
      <path d="M45 16 V12 H48" />
    </g>
    <rect x={4} y={44} width={14} height={14} rx={3.5} fill={t('#7b5cd6')} />
    <rect x={21} y={30} width={14} height={14} rx={3.5} fill={t('#7b5cd6')} />
    <rect x={38} y={16} width={14} height={14} rx={3.5} fill={t('#6244c0')} />
    <circle cx={11} cy={51} r={2.4} fill={t('#ffffff')} />
    <circle cx={28} cy={37} r={2.4} fill={t('#ffffff')} />
    <circle cx={45} cy={23} r={2.4} fill={t('#ffffff')} />
    <path
      d="M54 2.5 L56.4 7.6 L62 8.3 L57.9 12.1 L59 17.6 L54 14.9 L49 17.6 L50.1 12.1 L46 8.3 L51.6 7.6 Z"
      fill={t('#ffd34d')}
      stroke={t('#c08a00')}
      strokeWidth={1}
      strokeLinejoin="round"
    />
  </>
);

/** Квантизация: плавная кривая и её «ступенчатая» копия меньшей точности. */
const quant: Draw = (t) => (
  <>
    <path d="M5 56 H59" stroke={t('#d5d9df')} strokeWidth={2} strokeLinecap="round" />
    <path
      d="M5 32 7 28.1 9 24.4 11 21.1 13 18.4 15 16.4 17 15.3 19 15 21 15.7 23 17.3 25 19.6 27 22.7 29 26.2 31 30 33 34 35 37.8 37 41.3 39 44.4 41 46.7 43 48.3 45 49 47 48.7 49 47.6 51 45.6 53 42.9 55 39.6 57 35.9 59 32"
      fill="none"
      stroke={t('#9aa3ae')}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 24 H11 V16 H23 V24 H29 V32 H35 V40 H41 V48 H53 V40 H59"
      fill="none"
      stroke={t('#c99a1a')}
      strokeWidth={4.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
);

/** Мультимодальность: картинка с горами и солнцем и облачко текста поверх. */
const multimodal: Draw = (t) => (
  <>
    <rect x={4} y={10} width={42} height={34} rx={4} fill={t('#d9822b')} />
    <rect x={8} y={14} width={34} height={26} rx={2} fill={t('#fff1de')} />
    <path d="M9 39 L19.5 25 L27 33.5 L32 28 L41 39 Z" fill={t('#a85a14')} />
    <circle cx={34} cy={20.5} r={3.6} fill={t('#ffd34d')} />
    <path d="M33 35 H59 A3 3 0 0 1 62 38 V53 A3 3 0 0 1 59 56 H44 L37 62 V56 H33 A3 3 0 0 1 30 53 V38 A3 3 0 0 1 33 35 Z" fill={t('#2f80e4')} />
    <g stroke={t('#ffffff')} strokeWidth={2.6} strokeLinecap="round">
      <path d="M36 42 H56" />
      <path d="M36 49 H50" />
    </g>
  </>
);

/** Синтетические данные: база данных и искры - данные, созданные моделью. */
const synthetic: Draw = (t) => (
  <>
    <path d="M8 18 V48 A18 6.5 0 0 0 44 48 V18 Z" fill={t('#1fa8a0')} />
    <ellipse cx={26} cy={18} rx={18} ry={6.5} fill={t('#13807a')} />
    <g fill="none" stroke={t('#8fe0da')} strokeWidth={2.2}>
      <path d="M8 28 A18 6.5 0 0 0 44 28" />
      <path d="M8 38 A18 6.5 0 0 0 44 38" />
    </g>
    <path d="M51 8 L53.6 15.4 L61 18 L53.6 20.6 L51 28 L48.4 20.6 L41 18 L48.4 15.4 Z" fill={t('#ffd34d')} />
    <path d="M54 34 L55.6 38.4 L60 40 L55.6 41.6 L54 46 L52.4 41.6 L48 40 L52.4 38.4 Z" fill={t('#ffd34d')} />
  </>
);

const DRAW: Record<TechId, Draw> = {
  attention,
  scaling,
  rlhf,
  algo,
  context,
  distill,
  moe,
  codetrain,
  instruct,
  cot,
  quant,
  multimodal,
  synthetic,
};

/** Значок технологии. */
export function TechIcon({ id, size = 40, locked, className }: TechIconProps & { id: TechId }) {
  const t = toneFor(locked);
  return (
    <Flat size={size} className={className}>
      {DRAW[id](t)}
    </Flat>
  );
}
