// Невидимый мост между партией и 3D-залами: сообщает им, идёт ли время, насколько занята мощность и случилось ли
// что-то заметное (обучение началось или закончилось, вышла модель, деньги в минусе). Залы сами решают, как это показать.
// Симуляцию не трогает: только читает состояние.

import { useEffect, useRef } from 'react';
import { totalH100e } from '../sim/compute';
import { idleCompute } from '../sim/idle';
import type { GameState } from '../sim/types';
import { fireSceneEvent, resetLive, setLive } from './three/live';
import { useSpeed } from './store';

interface Snap {
  state: GameState;
  day: number;
  trainings: number;
  released: number;
  negative: boolean;
  /** Карт всего (аренда и свои) и вышедших на работу сотрудников: рост - событие для людей в зале. */
  cards: number;
  staff: number;
}

function cardsOf(s: GameState): number {
  let n = 0;
  for (const v of Object.values(s.compute.rented)) n += v ?? 0;
  for (const dc of s.datacenters?.list ?? []) for (const v of Object.values(dc.gpus)) n += v ?? 0;
  return n;
}

/** Доля мощности, занятая работой, шагами по 0,1 (чтобы залы не перерисовывались от каждой сотой). */
function loadOf(s: GameState): number {
  const total = totalH100e(s);
  if (!(total > 0)) return 0;
  const idle = idleCompute(s).reduce((a, i) => a + i.h100e, 0);
  return Math.round(Math.max(0, Math.min(1, 1 - idle / total)) * 10) / 10;
}

export function SceneLive({ s }: { s: GameState }) {
  const speed = useSpeed();
  const prev = useRef<Snap | null>(null);

  useEffect(() => {
    setLive({ running: speed !== 0 && !s.outcome });
  }, [speed, s.outcome]);

  useEffect(() => {
    const now: Snap = {
      state: s,
      day: s.day,
      trainings: s.trainings.length,
      released: s.models.filter((m) => m.releasedDay !== null).length,
      negative: s.finance.negativeDays > 0,
      cards: cardsOf(s),
      staff: s.staff?.people.filter((e) => e.startDay <= s.day).length ?? 0,
    };
    const p = prev.current;
    prev.current = now;
    setLive({ load: loadOf(s), trouble: now.negative });
    // Новая партия, загрузка или откат: сравнивать не с чем.
    if (!p || p.state !== s || s.day < p.day) return;
    if (now.released > p.released) fireSceneEvent('release');
    else if (now.trainings < p.trainings) fireSceneEvent('trainDone');
    else if (now.trainings > p.trainings) fireSceneEvent('trainStart');
    else if (!p.negative && now.negative) fireSceneEvent('trouble');
    else if (now.staff > p.staff) fireSceneEvent('hire');
    else if (now.cards > p.cards) fireSceneEvent('hardware');
  });

  useEffect(() => () => resetLive(), []);
  return null;
}
