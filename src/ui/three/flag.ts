// Флаг страны для 3D-сцены: тот же упрощённый рисунок, что у components/CountryFlag, но на canvas (текстура полотнища).

import * as THREE from 'three';
import type { CountryId } from '../../sim/types';

const W = 120;
const H = 80;

function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, rot = 0): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.4;
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

function draw(g: CanvasRenderingContext2D, id: CountryId): void {
  // Рисунок в координатах 60 × 40, как у SVG-флага.
  g.scale(W / 60, H / 40);
  if (id === 'us') {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 60, 40);
    g.fillStyle = '#c8102e';
    for (let i = 0; i < 7; i++) g.fillRect(0, (2 * i * 40) / 13, 60, 40 / 13);
    g.fillStyle = '#1f3a7a';
    g.fillRect(0, 0, 26, 21.5);
    g.fillStyle = '#fff';
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 5; c++) {
        g.beginPath();
        g.arc(3 + c * 4.6 + (r % 2) * 2.3, 3 + r * 4.6, 1, 0, Math.PI * 2);
        g.fill();
      }
  } else if (id === 'cn') {
    g.fillStyle = '#de2910';
    g.fillRect(0, 0, 60, 40);
    g.fillStyle = '#ffde00';
    star(g, 10, 10, 6);
    star(g, 20, 4, 2, 0.4);
    star(g, 24, 8, 2, 0.9);
    star(g, 24, 14, 2, 0);
    star(g, 20, 18, 2, 0.5);
  } else {
    g.fillStyle = '#003399';
    g.fillRect(0, 0, 60, 40);
    g.fillStyle = '#ffcc00';
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12;
      star(g, 30 + 11 * Math.cos(a), 20 + 11 * Math.sin(a), 2);
    }
  }
}

/** Текстура флага; вызывающий освобождает её (dispose) вместе со сценой. */
export function flagTexture(id: CountryId): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (g) draw(g, id);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
