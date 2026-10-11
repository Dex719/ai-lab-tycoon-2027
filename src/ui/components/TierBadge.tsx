// Значок уровня модели: «Лёгкая» - бирюзовый, «Средняя» - синий, «Флагман» - фиолетовый.

import { TIER_NAMES, type Tier } from '../../sim/types';
import './TierBadge.css';

/** Цвета уровней для заливок и рамок (значок использует те же оттенки в тёмном виде для текста). */
export const TIER_COLOR: Record<Tier, string> = { light: '#1fa8a0', mid: '#2f80e4', flagship: '#7b5cd6' };

const TIER_TITLE: Record<Tier, string> = {
  light: 'Дёшево обслуживать и быстро обучать, но модель слабее.',
  mid: 'Баланс цены и качества.',
  flagship: 'Самая сильная модель и самая дорогая в обслуживании.',
};

export function TierBadge({ tier, title }: { tier: Tier; title?: string }) {
  return (
    <span className={`tier-badge ${tier}`} title={title ?? TIER_TITLE[tier]}>
      {TIER_NAMES[tier]}
    </span>
  );
}
