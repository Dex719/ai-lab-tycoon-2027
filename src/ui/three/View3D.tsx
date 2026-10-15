// 3D-вид в окне: холст, в который общий рендерер рисует сцену по описанию (spec).
// three.js и модели подгружаются при первом показе (динамический импорт): старт игры не замедляется.
// Сцена перестраивается, только когда меняется её описание; кадры - по требованию (см. engine.ts).

import { useEffect, useRef, useState } from 'react';
import type { GpuId } from '../../sim/types';
import { specKey, type ViewSpec } from './specs';
import './three.css';

type Engine = typeof import('./engine');
type ViewHandle = ReturnType<Engine['createView']>;

let enginePromise: Promise<Engine> | null = null;

/** Загрузить движок (один раз за игру). */
export function loadEngine(): Promise<Engine> {
  enginePromise ??= import('./engine');
  return enginePromise;
}

export function View3D(props: {
  spec: ViewSpec;
  /** Вращать мышью (по умолчанию да). */
  interactive?: boolean;
  /** Плавное вращение, пока не трогают (превью карты). */
  autoRotate?: boolean;
  className?: string;
  /** Подпись для экранного диктора. */
  label: string;
}) {
  const { spec, interactive = true, autoRotate = false } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewHandle | null>(null);
  const specRef = useRef(spec);
  specRef.current = spec;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = specKey(spec);

  useEffect(() => {
    let alive = true;
    let ro: ResizeObserver | null = null;
    loadEngine()
      .then((eng) => {
        const canvas = canvasRef.current;
        if (!alive || !canvas) return;
        const v = eng.createView(canvas, { interactive, autoRotate, onFail: () => alive && setFailed(true) });
        viewRef.current = v;
        const size = () => {
          const r = canvas.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) v.resize(r.width, r.height);
        };
        size();
        ro = new ResizeObserver(size);
        ro.observe(canvas);
        v.setSpec(specRef.current);
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      ro?.disconnect();
      viewRef.current?.dispose();
      viewRef.current = null;
    };
  }, [interactive, autoRotate]);

  useEffect(() => {
    if (ready) viewRef.current?.setSpec(specRef.current);
  }, [key, ready]);

  return (
    <div className={`v3d${props.className ? ` ${props.className}` : ''}${ready ? ' ready' : ''}${failed ? ' failed' : ''}`}>
      <canvas ref={canvasRef} className={interactive ? 'v3d-grab' : undefined} role="img" aria-label={props.label} title={interactive ? 'Потяните мышью, чтобы повернуть' : undefined} />
    </div>
  );
}

/** Картинка карты для списков (рисуется один раз). Пока движок грузится - null. */
export function useGpuThumb(gpu: GpuId, w: number, h: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadEngine()
      .then((eng) => {
        if (!alive) return;
        try {
          setUrl(eng.gpuThumb(gpu, w, h));
        } catch {
          setUrl(null);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [gpu, w, h]);
  return url;
}
