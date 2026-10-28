// Термин с пунктирной чертой: подсказка игры объясняет его одной строкой. Подсказка - из glossFor (terms.ts)
// по тексту text (или по строковым детям); без термина выводятся только дети.

import type { ReactNode } from 'react';
import { glossFor } from '../terms';

export function Term({ text, children }: { text?: string; children: ReactNode }) {
  const tip = glossFor(text ?? String(children));
  if (!tip) return <>{children}</>;
  return (
    <span className="term" title={tip}>
      {children}
    </span>
  );
}
