import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5317, strictPort: true },
  // Зависимости ищем только от главной страницы: страницы-образцы в public/art (3D-арт) не должны сбивать сборку.
  optimizeDeps: { entries: ['index.html'] },
  // Игра локальная, один бандл с React и Recharts — нормально.
  build: { chunkSizeWarningLimit: 1500 },
  // Полный прогон параллельно: симуляции ботов под нагрузкой не должны падать по таймауту (TECH-1).
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 30000 },
});
