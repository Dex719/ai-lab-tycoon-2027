// Внешний вид карт Fermi Systems по поколениям: общий для 3D-моделей и для цветных меток в окнах.
// Без three.js: файл можно импортировать в любой части интерфейса, стартовый бандл он не утяжеляет.
// Прототипы - серверные ускорители своих лет: пассивные карты PCIe (P100, V100, A100) и модули
// с высоким радиатором для плат на 8 карт (H100, H200). Бренд и фирменный цвет прототипа не используются.

import type { GpuId } from '../../sim/types';

export interface GpuLook {
  /** Короткое имя на корпусе и в подписях: «P100». */
  short: string;
  /** Карта в слот (pcie) или модуль с радиатором для серверной платы (module). */
  form: 'pcie' | 'module';
  /** Как карта охлаждается: окно с рёбрами радиатора, решётка, высокий радиатор. */
  cooler: 'window' | 'lattice' | 'tower';
  /** Основной цвет корпуса. */
  shell: string;
  /** Вставки и окантовка. */
  trim: string;
  /** Подсветка надписи и цветная метка поколения в окнах. */
  accent: string;
  /** Лицевая панель сервера с такими картами в стойке. */
  bezel: string;
  /**
   * Размеры, см (реальные пропорции прототипа). Карта PCIe: длина × высота × толщина.
   * Модуль: длина × глубина платы × высота с радиатором.
   */
  size: [number, number, number];
}

export const GPU_LOOK: Record<GpuId, GpuLook> = {
  p100: { short: 'P100', form: 'pcie', cooler: 'window', shell: '#3a3f46', trim: '#b9bfc6', accent: '#7fb2e5', bezel: '#a4adb7', size: [26.7, 11.1, 3.8] },
  v100: { short: 'V100', form: 'pcie', cooler: 'window', shell: '#c9a862', trim: '#24262a', accent: '#f0c46a', bezel: '#c9a862', size: [26.7, 11.1, 3.8] },
  a100: { short: 'A100', form: 'pcie', cooler: 'lattice', shell: '#b8863f', trim: '#1e2024', accent: '#ff9f4a', bezel: '#b8863f', size: [26.7, 11.1, 3.8] },
  h100: { short: 'H100', form: 'module', cooler: 'tower', shell: '#c3c8ce', trim: '#2a2d33', accent: '#5aa8ff', bezel: '#d5dae0', size: [14.2, 10.8, 9.2] },
  h200: { short: 'H200', form: 'module', cooler: 'tower', shell: '#2a2c31', trim: '#c08a4a', accent: '#b58cff', bezel: '#34363c', size: [14.2, 10.8, 10.6] },
};

/** Цветная метка поколения (для полоски у карты в списках). */
export function gpuAccent(id: GpuId): string {
  return GPU_LOOK[id].accent;
}
