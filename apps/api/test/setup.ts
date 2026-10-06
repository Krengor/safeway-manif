import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// En local, on réutilise le .env racine ; en CI les variables sont fournies par le workflow.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
process.env.NODE_ENV = 'test';
