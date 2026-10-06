import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dev-dist/**', '**/node_modules/**', '**/coverage/**', 'apps/web/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Les logs passent par le logger Fastify (sérialiseurs filtrés) — cf. §17.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.mjs', 'apps/api/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Scripts k6 : runtime spécifique, pas Node.
    files: ['tests/load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
  },
);
