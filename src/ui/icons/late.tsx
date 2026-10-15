// Иконки рабочего стола поздней игры: «Сделки» (2023-2024) и «Финал» (последний квартал 2024 года).
// Тот же стиль, что в desktop.tsx: плоские цветные формы, viewBox 64x64, серый вариант через toneFor.

import { Flat, toneFor, type IconProps } from './base';

/** Сделки: рукопожатие над золотой монетой. */
export function IconDeals({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <circle cx={44} cy={44} r={15} fill={t('#b8861a')} />
      <circle cx={44} cy={44} r={12.5} fill={t('#e8b93a')} />
      <path d="M47.5 39.5 C47.5 38 46 37.4 44 37.4 C41.8 37.4 40.5 38.4 40.5 40 C40.5 43.6 47.5 42.6 47.5 46.6 C47.5 48.4 46 49.4 44 49.4 C42 49.4 40.4 48.6 40.4 47.2 M44 35 V53" fill="none" stroke={t('#8a6210')} strokeWidth={2.2} strokeLinecap="round" />
      {/* Левая рука (синий рукав) и правая (серый рукав) сходятся в рукопожатии. */}
      <path d="M2 22 L13 18 L19 34 L8 38 Z" fill={t('#2f80e4')} />
      <path d="M62 22 L51 18 L45 34 L56 38 Z" fill={t('#6b7380')} />
      <path d="M13 18 L24 16 L33 22 L40 19 L50 19 L45 34 L36 40 Q32 42 29 39 L19 34 Z" fill={t('#f2c9a0')} />
      <path d="M24 26 L31 31 M27 23 L35 29 M30 34 L35 37" stroke={t('#c99a72')} strokeWidth={2} strokeLinecap="round" />
      <path d="M33 22 L40 26" stroke={t('#c99a72')} strokeWidth={2} strokeLinecap="round" />
    </Flat>
  );
}

/** Финал: клетчатый флаг на древке с золотым навершием. */
export function IconFinale({ size, disabled, className }: IconProps) {
  const t = toneFor(disabled);
  const cells: [number, number][] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) if ((r + c) % 2 === 0) cells.push([c, r]);
  return (
    <Flat size={size} className={className} locked={disabled}>
      <rect x={9} y={8} width={4} height={52} rx={1.5} fill={t('#8a8e95')} />
      <circle cx={11} cy={7} r={4} fill={t('#e8b93a')} />
      <path d="M13 10 Q30 6 37 11 Q45 16 58 11 V37 Q45 42 37 37 Q30 32 13 36 Z" fill={t('#f4f5f7')} />
      <clipPath id="ic-finale-flag">
        <path d="M13 10 Q30 6 37 11 Q45 16 58 11 V37 Q45 42 37 37 Q30 32 13 36 Z" />
      </clipPath>
      <g clipPath="url(#ic-finale-flag)" fill={t('#1f2023')}>
        {cells.map(([c, r]) => (
          <rect key={`${c}-${r}`} x={13 + c * 9} y={6 + r * 9} width={9} height={9} />
        ))}
      </g>
      <path d="M13 10 Q30 6 37 11 Q45 16 58 11 V37 Q45 42 37 37 Q30 32 13 36 Z" fill="none" stroke={t('#3a3d42')} strokeWidth={1.4} />
    </Flat>
  );
}
