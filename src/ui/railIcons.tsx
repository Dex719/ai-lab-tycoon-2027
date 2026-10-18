// Белые контурные значки разделов для колонки слева (по образцу Two Point Campus): один стиль, толщина 2, 24×24.
// Пути - Lucide (ISC) и нарисованные в том же стиле (серверная стойка, чип, дата-центр).

import type { ReactElement } from 'react';
import type { WindowId } from './windows';

const P: Record<WindowId, ReactElement> = {
  research: <path d="M10 2v7.5L4.5 19a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9.5V2M8.5 2h7M7 16h10" />,
  compute: (
    <>
      <rect x="3" y="3" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="18" height="7" rx="1.5" />
      <path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6" />
    </>
  ),
  newModel: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </>
  ),
  contracts: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6" />,
  investors: <path d="M10 18v-7M14 18v-7M18 18v-7M6 18v-7M3 22h18M11.1 2.2a2 2 0 0 1 1.8 0l7.8 3.9a.5.5 0 0 1-.2.9h-17a.5.5 0 0 1-.2-.9z" />,
  models: <path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />,
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </>
  ),
  analytics: <path d="M3 3v18h18M7 15l4-5 4 3 5-7" />,
  team: <path d="M2 21v-1a6 6 0 0 1 12 0v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 3.1a4 4 0 0 1 0 7.8M22 21v-1a6 6 0 0 0-4-5.6" />,
  datacenters: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01" />,
  products: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M2 9h20M10 12.5 7.5 15l2.5 2.5M14 12.5l2.5 2.5-2.5 2.5" />
    </>
  ),
  deals: (
    <>
      <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <rect width="20" height="14" x="2" y="6" rx="2" />
    </>
  ),
  finale: <path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2M4 22h16M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1zM17.9 10h1.6A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3M6.1 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" />,
};

export function RailIcon({ id, size = 26 }: { id: WindowId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[id]}
    </svg>
  );
}
