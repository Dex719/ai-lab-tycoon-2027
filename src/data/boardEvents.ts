// Письмо о возвращении основателя после отставки советом (sim/board.ts). Приходит через пять дней после голосования,
// не по дате и не из жребия: when.check всегда false, запускает sim/board.boardDay. Без ответа - последний вариант
// (вернуться на условиях совета).

import { BOARD_RETURN_EVENT, boardReturn } from '../sim/board';
import type { EventDef } from './events';
import { addHype, addRep, amount, fixUnit, pay, usd } from './eventKit';

export const BOARD_EVENT: EventDef = {
  id: BOARD_RETURN_EVENT,
  when: { check: () => false },
  onFire: fixUnit,
  choiceDays: 7,
  mail: () => ({
    kind: 'event',
    title: 'Команда требует вернуть основателя',
    body:
      'Почти все сотрудники подписали письмо: если основатель не вернётся, они уйдут к соперникам. Инвесторы испугались за компанию, ' +
      'и совет согласен на возвращение. Осталось договориться об условиях.',
  }),
  choices: [
    {
      label: 'Вернуться с новым советом',
      story: 'Несогласные уйдут из совета, о драме напишут все, часть партнёров насторожится',
      hint: 'доверие совета 80, шумиха +8, репутация -3',
      apply: (s) => {
        boardReturn(s, 80);
        addHype(s, 'player', 8);
        addRep(s, -3);
      },
    },
    {
      label: 'Выкупить место в совете',
      story: 'Голос основателя в совете станет решающим, но это дорого',
      hint: '',
      hintFn: (s) => `-${usd(amount(s, 2))}, доверие совета 95`,
      apply: (s) => {
        pay(s, amount(s, 2));
        boardReturn(s, 95);
      },
    },
    {
      label: 'Вернуться на условиях совета',
      story: 'Совет остаётся прежним и будет внимательно следить за итогами',
      hint: 'доверие совета 50, шумиха +4',
      apply: (s) => {
        boardReturn(s, 50);
        addHype(s, 'player', 4);
      },
    },
  ],
};
