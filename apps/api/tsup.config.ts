import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/migrate-cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Le paquet partagé est publié en TypeScript : on l'intègre au bundle.
  noExternal: ['@safeway/shared'],
});
