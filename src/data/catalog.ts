// Полный каталог моделей соперников: сгенерированный rivalModels.ts и модели промежуточных лабораторий.

import type { RivalModelDef } from '../sim/types';
import { MINOR_MODELS } from './minorModels';
import { RIVAL_MODELS as GENERATED } from './rivalModels';

export const RIVAL_MODELS: RivalModelDef[] = [...GENERATED, ...MINOR_MODELS].sort((a, b) => (a.released < b.released ? -1 : a.released > b.released ? 1 : 0));
