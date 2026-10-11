// Число видеокарт мелкими серыми цифрами рядом с мощностью в H100e: «12,3 H100e ≈ 12 карт».

import type { GameState } from '../../sim/types';
import { fmtCards } from '../format';
import './Cards.css';

/**
 * Подпись «≈ 17 карт» для мощности h100e (пересчёт по текущей аренде, fmtCards).
 * Ставится сразу после значения в H100e; block - отдельной строкой под значением.
 */
export function Cards({ s, h100e, block }: { s: GameState; h100e: number; block?: boolean }) {
  return (
    <span className={`cards-note${block ? ' block' : ''}`} title="Столько карт даёт эта мощность при вашей аренде">
      {fmtCards(s, h100e)}
    </span>
  );
}
