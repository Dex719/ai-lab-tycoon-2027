// В исходниках игры нет длинных тире и знака минус U+2212: везде обычный дефис «-».
// Знаки похожи на дефис, но в текстах игрока владелец разрешил только дефис.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(__dirname, '..');
const BAD_DASH = /[—–−]/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('знаки тире', () => {
  it('в исходниках игры (не тестах) нет длинного тире и знака минус U+2212, только дефис', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const rel = file.slice(SRC_DIR.length + 1).replace(/\\/g, '/');
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (BAD_DASH.test(line)) offenders.push(`src/${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders, 'заменить на дефис «-»').toEqual([]);
  });
});
