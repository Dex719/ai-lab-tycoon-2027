// Раздел «Экран» в «Настройках»: в exe - режим, разрешение, монитор и масштаб; везде - предел кадров и качество 3D.

import { useEffect, useState } from 'react';
import { desktop, resolutionsFor, type DesktopConfig, type DisplayInfo } from './desktop';
import { getSettings, setSettings, type Settings } from './settings';

const SCALES = [0, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const FPS_STEPS = [30, 60, 120, 144];
const QUALITY: { id: Settings['quality3d']; name: string }[] = [
  { id: 'low', name: 'Низкое (без теней)' },
  { id: 'mid', name: 'Среднее' },
  { id: 'high', name: 'Высокое' },
];

export function ScreenSettings() {
  const [settings, set] = useState(getSettings);
  const [cfg, setCfg] = useState<DesktopConfig | null>(null);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [browserFull, setBrowserFull] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);

  useEffect(() => {
    if (!desktop) {
      const on = () => setBrowserFull(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', on);
      return () => document.removeEventListener('fullscreenchange', on);
    }
    let live = true;
    void Promise.all([desktop.getConfig(), desktop.displays()]).then(([c, d]) => {
      if (!live) return;
      setCfg(c);
      setDisplays(d);
    });
    return () => {
      live = false;
    };
  }, []);

  async function patch(p: Partial<DesktopConfig>) {
    if (!desktop) return;
    setCfg(await desktop.setConfig(p));
  }

  const display = displays.find((d) => d.id === cfg?.displayId) ?? displays.find((d) => d.primary) ?? displays[0];
  const sizes = resolutionsFor(display);
  const sizeKey = cfg ? `${cfg.width}x${cfg.height}` : '';
  const hz = display?.hz ? ` (${display.hz} Гц)` : '';

  return (
    <>
      {desktop && cfg && (
        <>
          <label className="row settings-line">
            <span className="settings-label">Режим</span>
            <select value={cfg.mode} onChange={(e) => void patch({ mode: e.target.value as DesktopConfig['mode'] })}>
              <option value="fullscreen">Полный экран</option>
              <option value="window">В окне</option>
            </select>
          </label>
          <label className="row settings-line">
            <span className="settings-label">Разрешение</span>
            <select
              value={sizeKey}
              onChange={(e) => {
                const [w, h] = e.target.value.split('x').map(Number);
                void patch({ width: w, height: h });
              }}
            >
              {!sizes.some(([w, h]) => `${w}x${h}` === sizeKey) && (
                <option value={sizeKey}>
                  {cfg.width} × {cfg.height}
                </option>
              )}
              {sizes.map(([w, h]) => (
                <option key={`${w}x${h}`} value={`${w}x${h}`}>
                  {w} × {h}
                  {display && w === display.width && h === display.height ? ' - как у монитора' : ''}
                </option>
              ))}
            </select>
          </label>
          {displays.length > 1 && (
            <label className="row settings-line">
              <span className="settings-label">Монитор</span>
              <select value={display?.id ?? ''} onChange={(e) => void patch({ displayId: Number(e.target.value) })}>
                {displays.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    {i + 1}: {d.label || 'Монитор'}, {d.width} × {d.height}, {d.hz} Гц{d.primary ? ', основной' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="row settings-line">
            <span className="settings-label">Масштаб</span>
            <select value={cfg.scale} onChange={(e) => void patch({ scale: Number(e.target.value) })}>
              {SCALES.map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? 'Авто' : `${Math.round(s * 100)} %`}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {!desktop && (
        <label className="row">
          <input
            type="checkbox"
            checked={browserFull}
            onChange={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
          />
          <span>Полный экран</span>
        </label>
      )}
      <label className="row settings-line">
        <span className="settings-label">Частота кадров</span>
        <select value={settings.fps} onChange={(e) => set(setSettings({ fps: Number(e.target.value) }))}>
          <option value={0}>Как у монитора{hz}</option>
          {FPS_STEPS.filter((f) => !display?.hz || f < display.hz).map((f) => (
            <option key={f} value={f}>
              {f} кадров/с
            </option>
          ))}
        </select>
      </label>
      <label className="row settings-line">
        <span className="settings-label">Качество 3D</span>
        <select
          value={settings.quality3d}
          onChange={(e) => {
            set(setSettings({ quality3d: e.target.value as Settings['quality3d'] }));
            void import('./three/engine').then((m) => m.applyQuality());
          }}
        >
          {QUALITY.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      </label>
      {desktop && <div className="small muted">F11 или Alt+Enter - полный экран.</div>}
    </>
  );
}
