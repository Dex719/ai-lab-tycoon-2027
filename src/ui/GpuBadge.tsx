// Плоская метка видеокарты вместо 3D-миниатюры: плашка с цветом поколения и коротким именем.

import type { GpuId } from '../sim/types';
import { GPU_LOOK } from './three/gpuLook';

export function GpuBadge({ id, size = 'm' }: { id: GpuId; size?: 's' | 'm' | 'l' }) {
  const look = GPU_LOOK[id];
  return (
    <span className={`gpu-badge gpu-badge-${size}`} style={{ ['--ga' as string]: look.accent }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="6" width="12" height="12" rx="1.5" />
        <rect x="9.5" y="9.5" width="5" height="5" />
        <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
      </svg>
      <b>{look.short}</b>
    </span>
  );
}
