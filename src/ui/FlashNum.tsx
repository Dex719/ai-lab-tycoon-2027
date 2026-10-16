// Число, которое при заметном изменении коротко подсвечивается: рост - зелёным, падение - красным.
// Подсветка - полупрозрачная подложка под числом, анимируется только прозрачность. Падение медленнее и тише роста.

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  value: number;
  /** Минимальное изменение: доля от текущего значения (по умолчанию 1 %) и не меньше minAbs. */
  frac?: number;
  minAbs?: number;
  /** Меньше - лучше (место в гонке): падение числа считается ростом. */
  invert?: boolean;
  className?: string;
  children: ReactNode;
}

export function FlashNum({ value, frac = 0.01, minAbs = 1, invert, className, children }: Props) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; k: number } | null>(null);
  useEffect(() => {
    const d = value - prev.current;
    prev.current = value;
    if (Math.abs(d) < Math.max(minAbs, Math.abs(value) * frac)) return;
    const good = invert ? d < 0 : d > 0;
    setFlash((f) => ({ dir: good ? 'up' : 'down', k: (f?.k ?? 0) + 1 }));
  }, [value, frac, minAbs, invert]);
  return (
    <span className={`nf${className ? ` ${className}` : ''}`}>
      {children}
      {flash && <i key={flash.k} className={`nf-t ${flash.dir}`} aria-hidden="true" />}
    </span>
  );
}
