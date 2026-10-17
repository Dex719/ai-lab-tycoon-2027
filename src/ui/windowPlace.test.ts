// Окна раскладываются в свободной от HUD области (плейтест 17.10: «Новая модель» уходила под плитку денег,
// показатели «Доля рынка / Репутация / Шумиха» закрывали низ «Контрактов»).

import { describe, expect, it } from 'vitest';
import { freeRectFor, HUD_LEFT, HUD_RIGHT, HUD_STATS_TOP, HUD_STATS_W, HUD_TOP, placeWindow } from './Window';

/** Стол на компьютере: окно браузера минус полоса месяцев 34 px. */
const desk = (w: number, h: number) => ({ w, h: h - 34 });

describe('раскладка окон', () => {
  for (const [vw, vh] of [
    [1600, 900],
    [1226, 862],
    [1920, 1080],
  ] as const) {
    it(`${vw}×${vh}: окна по умолчанию не заходят под сводку, показатели и плитку денег`, () => {
      const area = desk(vw, vh);
      for (const def of [
        { w: 1000, h: 680 },
        { w: 1060, h: 660 },
        { w: 820, h: 600 },
        { w: 1100, h: 660 },
      ]) {
        for (const n of [0, 1, 2]) {
          const g = placeWindow(def, area, n);
          expect(g.x).toBeGreaterThanOrEqual(HUD_LEFT);
          expect(g.y).toBeGreaterThanOrEqual(HUD_TOP);
          expect(g.x + g.w).toBeLessThanOrEqual(area.w - HUD_RIGHT);
          // Правее показателей окно кончается выше них.
          if (g.x + g.w > area.w - HUD_STATS_W) expect(g.y + g.h).toBeLessThanOrEqual(area.h - HUD_STATS_TOP);
          const r = freeRectFor(area, g.w);
          expect(g.y + g.h).toBeLessThanOrEqual(r.bottom);
        }
      }
    });
  }

  it('1600×900: «Новая модель» целиком помещается левее показателей и не сжимается по высоте', () => {
    const g = placeWindow({ w: 1000, h: 680 }, desk(1600, 900), 0);
    expect(g.h).toBe(680);
    expect(g.x + g.w).toBeLessThanOrEqual(1600 - HUD_STATS_W);
  });
});
