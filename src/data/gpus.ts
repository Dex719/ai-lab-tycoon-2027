// Ускорители Fermi Systems (прототип - Nvidia). Коды моделей совпадают с реальными.
// Мощность: плотные FP16/BF16 TFLOPS / 989 (H100 = 1). Цены - типичная аренда в облаке, $ за GPU-час,
// по research/catalog/meta.json. Дата - когда GPU реально можно было арендовать в облаке.

import type { GpuDef } from '../sim/types';

export const GPUS: GpuDef[] = [
  {
    id: 'p100',
    name: 'Fermi P100',
    availableFrom: '2016-06-20',
    h100e: 0.0214,
    rentPerGpuHour: { 2016: 2.0, 2017: 1.9, 2018: 1.46, 2019: 1.3, 2020: 1.15, 2021: 1.0, 2022: 0.85, 2023: 0.75, 2024: 0.65 },
  },
  {
    id: 'v100',
    name: 'Fermi V100',
    availableFrom: '2017-10-25', // облачные инстансы с 8×V100
    h100e: 0.1264,
    rentPerGpuHour: { 2017: 3.06, 2018: 2.6, 2019: 2.4, 2020: 1.8, 2021: 1.7, 2022: 1.6, 2023: 1.5, 2024: 1.4 },
  },
  {
    id: 'a100',
    name: 'Fermi A100',
    availableFrom: '2020-11-02',
    h100e: 0.3155,
    rentPerGpuHour: { 2020: 3.7, 2021: 2.6, 2022: 2.5, 2023: 2.4, 2024: 2.0 },
  },
  {
    id: 'h100',
    name: 'Fermi H100',
    availableFrom: '2023-03-21',
    h100e: 1.0,
    rentPerGpuHour: { 2023: 4.7, 2024: 3.0 },
  },
  {
    // Плотные FLOPS как у H100, но больше и быстрее память: на языковых моделях ≈1,4× H100 (игровое упрощение).
    id: 'h200',
    name: 'Fermi H200',
    availableFrom: '2024-06-01',
    h100e: 1.4,
    rentPerGpuHour: { 2024: 4.2 },
  },
];
