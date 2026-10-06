import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../api/test/setup.ts'],
    testTimeout: 10_000,
  },
});
