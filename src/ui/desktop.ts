// Связь с оболочкой exe (Electron). В браузере оболочки нет: desktop === null.

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  hz: number;
  primary: boolean;
}

export interface DesktopConfig {
  mode: 'window' | 'fullscreen';
  width: number;
  height: number;
  displayId: number | null;
  scale: number; // масштаб интерфейса, 1 = 100 %
}

export interface DesktopApi {
  getConfig(): Promise<DesktopConfig>;
  setConfig(patch: Partial<DesktopConfig>): Promise<DesktopConfig>;
  displays(): Promise<DisplayInfo[]>;
  quit(): void;
}

export const desktop: DesktopApi | null =
  typeof window !== 'undefined' ? ((window as unknown as { aiLabDesktop?: DesktopApi }).aiLabDesktop ?? null) : null;

/** Стандартные разрешения, которые помещаются на экран. */
export function resolutionsFor(d: DisplayInfo | undefined): [number, number][] {
  const all: [number, number][] = [
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1600, 900],
    [1680, 1050],
    [1920, 1080],
    [1920, 1200],
    [2560, 1440],
    [3840, 2160],
  ];
  if (!d) return all;
  const fit = all.filter(([w, h]) => w <= d.width && h <= d.height);
  if (!fit.some(([w, h]) => w === d.width && h === d.height)) fit.push([d.width, d.height]);
  return fit;
}
