// Рекорды лаборатории словами и числами: общая подпись для итога месяца и страницы «Рекорды».

import type { RecordId } from '../sim/types';
import { fmtElo, fmtH100e, fmtInt, fmtMoney, fmtShare } from './format';

export function fmtRecord(id: RecordId, v: number): string {
  switch (id) {
    case 'revenue':
    case 'contract':
      return fmtMoney(v);
    case 'elo':
      return fmtElo(v);
    case 'share':
      return fmtShare(v, 1);
    case 'compute':
      return fmtH100e(v);
    case 'subs':
    case 'staff':
      return fmtInt(v);
  }
}
