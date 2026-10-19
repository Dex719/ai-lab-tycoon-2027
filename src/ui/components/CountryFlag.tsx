// Флаг страны лаборатории (sim/country.ts): упрощённый рисунок 3:2, плоские цвета, без эмодзи.

import type { CountryId } from '../../sim/types';

/** Пятиконечная звезда с центром (cx, cy) и радиусом r: точки для <polygon>. */
function star(cx: number, cy: number, r: number, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = rot + (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function Us() {
  const stripes = [];
  for (let i = 0; i < 7; i++) stripes.push(<rect key={i} x={0} y={(2 * i * 40) / 13} width={60} height={40 / 13} fill="#c8102e" />);
  const dots = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) dots.push(<circle key={`${r}-${c}`} cx={3 + c * 4.6 + (r % 2) * 2.3} cy={3 + r * 4.6} r={1} fill="#fff" />);
  return (
    <>
      <rect width={60} height={40} fill="#fff" />
      {stripes}
      <rect width={26} height={21.5} fill="#1f3a7a" />
      {dots}
    </>
  );
}

function Cn() {
  return (
    <>
      <rect width={60} height={40} fill="#de2910" />
      <polygon points={star(10, 10, 6)} fill="#ffde00" />
      <polygon points={star(20, 4, 2, 0.4)} fill="#ffde00" />
      <polygon points={star(24, 8, 2, 0.9)} fill="#ffde00" />
      <polygon points={star(24, 14, 2, 0)} fill="#ffde00" />
      <polygon points={star(20, 18, 2, 0.5)} fill="#ffde00" />
    </>
  );
}

function Fr() {
  return (
    <>
      <rect width={20} height={40} fill="#0055a4" />
      <rect x={20} width={20} height={40} fill="#fff" />
      <rect x={40} width={20} height={40} fill="#ef4135" />
    </>
  );
}

/** Флаг высотой size px (ширина 1,5 × size). */
export function CountryFlag({ id, size = 16, title }: { id: CountryId; size?: number; title?: string }) {
  return (
    <svg
      className="flag"
      width={size * 1.5}
      height={size}
      viewBox="0 0 60 40"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ flex: 'none', borderRadius: 2, boxShadow: '0 0 0 1px rgb(0 0 0 / 0.15)' }}
    >
      {id === 'us' ? <Us /> : id === 'cn' ? <Cn /> : <Fr />}
    </svg>
  );
}
