// Выбор видеокарты: слева список вышедших карт (название, мощность полосой, цена), справа 3D-превью
// выбранной карты (статичный ракурс 3/4, поворот мышью) и короткие факты под ним. Общий для аренды («Мощности») и покупки («Дата-центры»).
// Мощность сравнивается с самой мощной из показанных карт: будущие карты не упоминаются.

import type { CSSProperties, ReactNode } from 'react';
import { NewBadge } from '../components/common';
import { dateToDay } from '../../sim/time';
import type { GpuDef, GpuId } from '../../sim/types';
import { View3D } from './View3D';
import './gpuChooser.css';

export interface ChooserItem {
  gpu: GpuDef;
  /** Строка под полосой: цена, сколько уже есть. */
  meta: ReactNode;
  /** Короткая пометка справа от названия («Выгоднее всего»). */
  tag?: string | null;
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
  /** Блок под списком (деньги на счёте и т. п.). */
  aside?: ReactNode;
  /** Факты под превью: подпись и значение. */
  facts: { label: string; value: ReactNode }[];
}) {
  const { items, value } = props;
  const gpus = items.map((i) => i.gpu);
  const best = gpus.reduce((b, g) => (g.h100e > b.h100e ? g : b), gpus[0]);
  const current = gpus.find((g) => g.id === value) ?? gpus[0];
  return (
    <div className="gch">
      <div className="gch-left">
        <div className="gch-list" role="radiogroup" aria-label="Видеокарта">
          {items.map(({ gpu: x, meta, tag }) => (
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
              <span className={`gch-tag${tag ? '' : ' gch-hide'}`}>{tag ?? '-'}</span>
              <span className="gch-bar" title={`Мощность одной карты по сравнению с ${best?.name ?? ''}`}>
                <i style={{ width: `${Math.max(3, best ? (x.h100e / best.h100e) * 100 : 100)}%` } as CSSProperties} />
              </span>
              <span className="gch-meta">{meta}</span>
            </button>
          ))}
        </div>
        {props.aside}
      </div>
      <div className="gch-stage">
        {current && <View3D spec={{ kind: 'gpu', gpu: current.id }} label={`Видеокарта ${current.name}, потяните мышью, чтобы повернуть`} className="gch-view" />}
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
