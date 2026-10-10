// Ускорители Fermi Systems (прототип — Nvidia). Коды моделей совпадают с реальными.
// Мощность: плотные FP16/BF16 TFLOPS / 989 (H100 = 1). Цены — типичная аренда в облаке, $ за GPU-час.
// Уточняются по research/catalog/meta.json (задача TSK-003).

import type { GpuDef } from '../sim/types';

export const GPUS: GpuDef[] = [
  {
    id: 'p100',
    name: 'Fermi P100',
    availableFrom: '2016-06-20',
    h100e: 0.019,
    rentPerGpuHour: { 2016: 1.6, 2017: 1.5, 2018: 1.46, 2019: 1.3, 2020: 1.2, 2021: 1.0, 2022: 0.9, 2023: 0.8, 2024: 0.7 },
  },
  {
    id: 'v100',
    name: 'Fermi V100',
    availableFrom: '2017-10-25',
    h100e: 0.126,
    rentPerGpuHour: { 2017: 3.06, 2018: 3.06, 2019: 2.5, 2020: 2.2, 2021: 2.0, 2022: 1.5, 2023: 1.0, 2024: 0.8 },
  },
  {
    id: 'a100',
    name: 'Fermi A100',
    availableFrom: '2020-11-02',
    h100e: 0.316,
    rentPerGpuHour: { 2020: 3.9, 2021: 3.0, 2022: 2.5, 2023: 2.0, 2024: 1.3 },
  },
  {
    id: 'h100',
    name: 'Fermi H100',
    availableFrom: '2023-03-21',
    h100e: 1.0,
    rentPerGpuHour: { 2023: 4.5, 2024: 2.8 },
  },
  {
    id: 'h200',
    name: 'Fermi H200',
    availableFrom: '2024-08-01',
    h100e: 1.15,
    rentPerGpuHour: { 2024: 3.8 },
  },
];
