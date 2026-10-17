// Выбор видеокарты: слева список вышедших карт (название, мощность полосой, цена), справа 3D-превью
// выбранной карты (статичный ракурс 3/4, поворот мышью) и короткие факты под ним. Общий для аренды («Мощности») и покупки («Дата-центры»).
// Мощность сравнивается с самой мощной из показанных карт: будущие карты не упоминаются.

import type { CSSProperties, ReactNode } from 'react';
import { NewBadge } from '../components/common';
import { dateToDay } from '../../sim/time';
import type { GpuDef, GpuId } from '../../sim/types';
import { GpuBadge } from '../GpuBadge';
import './gpuChooser.css';

export interface ChooserItem {
  gpu: GpuDef;
  /** Цена справа от названия. */
  price: ReactNode;
  /** Пометка под полосой («Выгоднее всего»), зелёным. */
  tag?: string | null;
  /** Сколько таких карт уже есть («в аренде 96»), синим. */
  note?: ReactNode;
}

/** Мощность карты по сравнению с самой мощной из списка: «17 % от Fermi V100», «больше всех на рынке». */
export function powerFact(gpu: GpuDef, list: readonly GpuDef[]): string {
  const best = list.reduce((b, g) => (g.h100e > b.h100e ? g : b), list[0] ?? gpu);
  if (gpu.id === best.id) return list.length > 1 ? 'больше всех на рынке' : 'единственная карта на рынке';
  const p = (gpu.h100e / best.h100e) * 100;
  const text = p < 10 ? String(Math.round(p * 10) / 10).replace('.', ',') : String(Math.round(p));
  return `${text} % от ${best.name}`;
}

export function GpuChooser(props: {
  day: number;
  items: ChooserItem[];
  value: GpuId;
  onPick: (id: GpuId) => void;
  /** Факты под превью: подпись и значение. */
  facts: { label: string; value: ReactNode }[];
}) {
  const { items, value } = props;
  const gpus = items.map((i) => i.gpu);
  const best = gpus.reduce((b, g) => (g.h100e > b.h100e ? g : b), gpus[0]);
  const current = gpus.find((g) => g.id === value) ?? gpus[0];
  return (
    <div className="gch">
      <div className="gch-list" role="radiogroup" aria-label="Видеокарта">
          {items.map(({ gpu: x, price, tag, note }) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={x.id === value}
              className={`gch-pick${x.id === value ? ' is-selected' : ''}`}
              onClick={() => props.onPick(x.id)}
            >
              <span className="gch-name">
                {x.name}
                <NewBadge day={props.day} since={dateToDay(x.availableFrom)} />
              </span>
              <span className="gch-price">{price}</span>
              <span className="gch-bar" title={`Мощность одной карты по сравнению с ${best?.name ?? ''}`}>
                <i style={{ width: `${Math.max(3, best ? (x.h100e / best.h100e) * 100 : 100)}%` } as CSSProperties} />
              </span>
              {(tag || note) && (
                <span className="gch-meta">
                  {tag && <span className="gch-tag">{tag}</span>}
                  {note && <span className="gch-note">{note}</span>}
                </span>
              )}
            </button>
          ))}
      </div>
      <div className="gch-stage">
        {current && <GpuBadge id={current.id} size="l" />}
        <div className="gch-cap">
          <div className="gch-title">{current?.name}</div>
          <dl className="gch-facts">
            {props.facts.map((f) => (
              <div key={f.label} className="gch-fact">
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
