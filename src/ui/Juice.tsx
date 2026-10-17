// Отдача на события партии: летящие суммы у денег на верхней панели, звуки, карточка выхода модели.
// Симуляцию не трогает: сравнивает состояние до и после шага и слушает движение денег (setMoneyListener).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { setMoneyListener } from '../sim/finance';
import type { ExpenseKind, GameState, IncomeKind } from '../sim/types';
import { fmtMoney } from './format';
import { celebrate, reducedMotion } from './feel';
import { playSound } from './sound';
import { store } from './store';

// ---------- Летящие суммы ----------

export interface Fly {
  key: number;
  amount: number; // со знаком
  label: string;
}

const FLY_MS = 1800;
const MAX_FLIES = 4;
/** Какие деньги показываем летящими: разовые поступления и траты, а не ежедневная выручка и аренда. */
const FLY_LABEL: Partial<Record<IncomeKind | ExpenseKind, string>> = {
  contracts: 'Оплата',
  investors: 'Поступление',
  penalties: 'Штраф',
  capex: 'Вложения',
  review: 'Проверка',
};
/** Крупное поступление: звук «касса» вместо «монетки». */
const BIG_INCOME = 1_000_000;

let flyKey = 0;
let flies: Fly[] = [];
const flyListeners = new Set<() => void>();

function pushFly(amount: number, label: string): void {
  const f: Fly = { key: ++flyKey, amount, label };
  flies = [...flies, f].slice(-MAX_FLIES);
  for (const l of flyListeners) l();
  window.setTimeout(() => {
    flies = flies.filter((x) => x.key !== f.key);
    for (const l of flyListeners) l();
  }, FLY_MS);
}

/** Летящие суммы под деньгами на верхней панели. */
export function MoneyFlies() {
  const [, setN] = useState(0);
  useEffect(() => {
    const l = () => setN((n) => n + 1);
    flyListeners.add(l);
    return () => {
      flyListeners.delete(l);
    };
  }, []);
  return (
    <div className="flies" aria-hidden="true">
      {flies.map((f, i) => (
        <span key={f.key} className={`fly ${f.amount >= 0 ? 'plus' : 'minus'}`} style={{ ['--i' as string]: i } as React.CSSProperties}>
          {f.amount >= 0 ? '+' : '−'}
          {fmtMoney(Math.abs(f.amount))}
          <small>{f.label}</small>
        </span>
      ))}
    </div>
  );
}

/** Число, которое за 0,5 с плавно доходит до нового значения (деньги на верхней панели). */
export function useCountUp(value: number, ms = 500): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const shownRef = useRef(value);
  shownRef.current = shown;
  useEffect(() => {
    from.current = shownRef.current;
    const start = performance.now();
    const delta = value - from.current;
    // Мелкие ежедневные изменения не анимируем: иначе число всё время «плывёт».
    if (Math.abs(delta) < Math.max(1, Math.abs(value)) * 0.01 || reducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - (1 - k) ** 3;
      setShown(from.current + delta * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

// ---------- Детектор событий ----------

interface Snap {
  state: GameState;
  day: number;
  models: number;
  released: number;
  research: number;
  goals: number;
  tasks: number;
  mailNum: number;
  negative: boolean;
}

function snap(s: GameState): Snap {
  return {
    state: s,
    day: s.day,
    models: s.models.length,
    released: s.models.filter((m) => m.releasedDay !== null).length,
    research: s.research.done.length + s.research.algoLevel + s.research.contextLevel,
    goals: s.yearly.year * 100 + s.yearly.goals.filter((g) => g.done).length,
    tasks: s.quests.done,
    mailNum: s.nextMailNum,
    negative: s.finance.negativeDays > 0,
  };
}

/** Новый выпуск модели игрока: id модели, чью карточку открыть. */
export type ReleaseHandler = (modelId: string) => void;

/** Невидимый компонент: следит за партией, запускает звуки и летящие суммы, сообщает о выпуске модели. */
export function Juice({ s, onRelease }: { s: GameState; onRelease: ReleaseHandler }) {
  const prev = useRef<Snap | null>(null);
  const pending = useRef(new Map<string, number>());
  const version = useSyncExternalStore(store.subscribe, store.getVersion); // любое действие или шаг игры

  // Деньги копятся между перерисовками и показываются одной суммой на статью.
  useEffect(() => {
    setMoneyListener((kind, amount, tag) => {
      const label = tag ?? FLY_LABEL[kind];
      if (!label) return;
      pending.current.set(label, (pending.current.get(label) ?? 0) + amount);
    });
    return () => setMoneyListener(null);
  }, []);

  useEffect(() => {
    const p = prev.current;
    const now = snap(s);
    prev.current = now;
    const money = pending.current;
    pending.current = new Map();
    // Новая партия, загрузка или откат: сравнивать не с чем.
    if (!p || p.state !== s || s.day < p.day) return;

    const sounds: Parameters<typeof playSound>[0][] = [];
    for (const [label, amount] of money) {
      if (Math.abs(amount) < 1) continue;
      pushFly(amount, label);
      if (label === 'Оплата' && amount > 0) celebrate('contract');
      sounds.push(amount < 0 ? 'spend' : amount >= BIG_INCOME ? 'cash' : 'coin');
    }

    if (now.released > p.released) {
      const m = [...s.models].filter((x) => x.releasedDay !== null).sort((a, b) => (b.releasedDay ?? 0) - (a.releasedDay ?? 0))[0];
      if (m) onRelease(m.id);
      sounds.unshift('release');
    }
    if (now.models > p.models) {
      sounds.unshift('ready');
      celebrate('ready');
    }
    if ((now.goals > p.goals && now.goals % 100 > 0) || now.tasks > p.tasks) {
      sounds.push('goal');
      celebrate('goal');
    }
    if (now.research > p.research) {
      sounds.push('research');
      celebrate('research');
    }
    if (!p.negative && now.negative) sounds.unshift('alert');
    else if (sounds.length === 0) {
      const fresh = s.mail.some((m) => m.important && Number(m.id.slice(1)) >= p.mailNum);
      if (fresh) sounds.push('alert');
    }
    // Не больше двух звуков за шаг, второй - с небольшой задержкой.
    const uniq = [...new Set(sounds)].slice(0, 2);
    uniq.forEach((id, i) => (i === 0 ? playSound(id) : window.setTimeout(() => playSound(id), 260)));
  }, [s, version, onRelease]);

  return null;
}
