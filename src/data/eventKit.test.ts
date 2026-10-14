import { describe, expect, it } from 'vitest';
import { createInitialState } from '../sim/state';
import { finishRollLog, roll, startRollLog } from './eventKit';

describe('исход выбора со случайностью', () => {
  it('без записи бросков исхода нет', () => {
    const s = createInitialState('Тест', 1);
    roll(s, 1, true);
    expect(finishRollLog()).toBeNull();
  });

  it('выпал хороший исход - повезло, выпал плохой - не повезло', () => {
    const s = createInitialState('Тест', 1);
    startRollLog();
    roll(s, 1, true); // грант одобрен
    expect(finishRollLog()).toEqual({ lucky: true });
    startRollLog();
    roll(s, 1, false); // утечку заметили
    expect(finishRollLog()).toEqual({ lucky: false });
    startRollLog();
    roll(s, 0, false); // утечку не заметили
    expect(finishRollLog()).toEqual({ lucky: true });
  });
});
