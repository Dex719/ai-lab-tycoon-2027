// Невидимый слой отклика: включает слежение за кликами и связывает звуки наград с их визуальным откликом.

import { useEffect } from 'react';
import { celebrate, wireClicks } from './feel';
import { onSound } from './sound';

export function FeelLayer() {
  useEffect(() => {
    wireClicks();
    return onSound((id) => {
      if (id === 'first' || id === 'rankUp') celebrate(id);
    });
  }, []);
  return null;
}
