import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // Les tests partagent la même base : exécution séquentielle.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
