// Раздел «Экран» в «Настройках»: в exe - режим, разрешение, монитор и масштаб; везде - предел кадров и качество 3D.

import { useEffect, useState } from 'react';
import { desktop, desktopMac, resolutionsFor, type DesktopConfig, type DisplayInfo } from './desktop';
import { getSettings, setSettings, type Settings } from './settings';
import { Select } from './components/Select';

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
          <div className="row settings-line">
            <span className="settings-label">Режим</span>
            <Select
              aria-label="Режим"
              value={cfg.mode}
              options={[
                { value: 'fullscreen', label: 'Полный экран' },
                { value: 'window', label: 'В окне' },
              ]}
              onChange={(mode) => void patch({ mode: mode as DesktopConfig['mode'] })}
            />
          </div>
          <div className="row settings-line">
            <span className="settings-label">Разрешение</span>
            <Select
              aria-label="Разрешение"
              value={sizeKey}
              options={[
                ...(!sizes.some(([w, h]) => `${w}x${h}` === sizeKey) ? [{ value: sizeKey, label: `${cfg.width} × ${cfg.height}` }] : []),
                ...sizes.map(([w, h]) => ({
                  value: `${w}x${h}`,
                  label: `${w} × ${h}${display && w === display.width && h === display.height ? ' - как у монитора' : ''}`,
                })),
              ]}
              onChange={(v) => {
                const [w, h] = v.split('x').map(Number);
                void patch({ width: w, height: h });
              }}
            />
          </div>
          {displays.length > 1 && (
            <div className="row settings-line">
              <span className="settings-label">Монитор</span>
              <Select
                aria-label="Монитор"
                value={display?.id ?? -1}
                options={displays.map((d, i) => ({
                  value: d.id,
                  label: `${i + 1}: ${d.label || 'Монитор'}, ${d.width} × ${d.height}, ${d.hz} Гц${d.primary ? ', основной' : ''}`,
                }))}
                onChange={(id) => void patch({ displayId: id })}
              />
            </div>
          )}
          <div className="row settings-line">
            <span className="settings-label">Масштаб</span>
            <Select
              aria-label="Масштаб"
              value={cfg.scale}
              options={SCALES.map((sc) => ({ value: sc, label: sc === 0 ? 'Авто' : `${Math.round(sc * 100)} %` }))}
              onChange={(scale) => void patch({ scale })}
            />
          </div>
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
      <div className="row settings-line">
        <span className="settings-label">Частота кадров</span>
        <Select
          aria-label="Частота кадров"
          value={settings.fps}
          options={[
            { value: 0, label: `Как у монитора${hz}` },
            ...FPS_STEPS.filter((f) => !display?.hz || f < display.hz).map((f) => ({ value: f, label: `${f} кадров/с` })),
          ]}
          onChange={(fps) => set(setSettings({ fps }))}
        />
      </div>
      <div className="row settings-line">
        <span className="settings-label">Качество 3D</span>
        <Select
          aria-label="Качество 3D"
          value={settings.quality3d}
          options={QUALITY.map((q) => ({ value: q.id, label: q.name }))}
          onChange={(quality3d) => {
            set(setSettings({ quality3d }));
            void import('./three/engine').then((m) => m.applyQuality());
          }}
        />
      </div>
      {desktop && <div className="small muted">{desktopMac ? 'Ctrl+Cmd+F' : 'F11 или Alt+Enter'} - полный экран.</div>}
    </>
  );
}
