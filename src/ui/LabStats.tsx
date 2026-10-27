// Показатели лаборатории на верхней панели: доля рынка, репутация, шумиха. Изменение от события вспыхивает «+3».

import { useEffect, useRef, useState } from 'react';
import { dayToDate } from '../sim/time';
import type { GameState } from '../sim/types';
import { fmtShare } from './format';
import { FlashNum } from './FlashNum';

const FLASH_MS = 2200;

/** Вспышка изменения: показатель вырос или упал на целое число за один шаг (событие, цель, письмо). */
function useDelta(s: GameState, value: number): number | null {
  const prev = useRef<{ state: GameState; day: number; value: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []); // снять таймер при уходе компонента
  useEffect(() => {
    const p = prev.current;
    prev.current = { state: s, day: s.day, value };
    if (!p || p.state !== s || s.day < p.day) return;
    const d = value - p.value;
    if (Math.abs(d) < 1) return;
    // Ежемесячное остывание шумихи (×0,9 в начале месяца) не показываем: это не событие.
    if (d < 0 && s.day !== p.day && dayToDate(s.day).day <= s.day - p.day) return;
    setDelta(Math.round(d));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDelta(null), FLASH_MS);
  }, [s, value]);
  return delta;
}

function Stat(props: { label: string; value: string; raw?: number; delta?: number | null; title: string; level?: number }) {
  const { label, value, raw, delta, title, level } = props;
  return (
    <div className={`lab-stat${delta ? (delta > 0 ? ' up' : ' down') : ''}`} title={title}>
      <span className="ls-k">{label}</span>
      <span className="ls-v">
        {raw !== undefined ? <FlashNum value={raw} frac={0} minAbs={1}>{value}</FlashNum> : value}
        {delta ? (
          <b key={`${delta}`} className="ls-d">
            {delta > 0 ? '+' : '−'}
            {Math.abs(delta)}
          </b>
        ) : null}
      </span>
      {level !== undefined && (
        <span className="ls-bar">
          <i style={{ width: `${Math.max(0, Math.min(100, level))}%` }} />
        </span>
      )}
    </div>
  );
}

export function LabStats({ s }: { s: GameState }) {
  const rep = Math.round(s.reputation);
  const hype = Math.round(s.hype.player);
  const repDelta = useDelta(s, s.reputation);
  const hypeDelta = useDelta(s, s.hype.player);
  return (
    <>
      <Stat label="Доля рынка" value={fmtShare(s.market.labShares.player ?? 0, 1)} title="Доля лаборатории на рынке API и подписок" />
      <Stat
        label="Репутация"
        value={String(rep)}
        raw={rep}
        delta={repDelta}
        level={rep}
        title="Репутация из 100: доверие клиентов и инвесторов. Влияет на тендеры и оценку компании"
      />
      <Stat
        label="Шумиха"
        value={String(hype)}
        raw={hype}
        delta={hypeDelta}
        level={hype}
        title="Шумиха из 100: внимание прессы и покупателей. Растёт от выпусков и событий, каждый месяц остывает"
      />
    </>
  );
}
