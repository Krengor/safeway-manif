import { z } from 'zod';

const secret = z
  .string()
  .min(32, 'secret trop court (32 caractères minimum)')
  .refine((s) => !s.startsWith('CHANGE_ME'), 'secret par défaut non remplacé');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4380),
  API_HOST: z.string().default('127.0.0.1'),
  PUBLIC_ORIGIN: z.url(),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().default('SafeWay'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  VOTE_TOKEN_SECRET: secret,
  RATE_LIMIT_SECRET: secret,
  /** Nombre de reverse proxies de confiance devant l'API (Caddy, LB…). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // On n'affiche que les noms de variables fautives, jamais leurs valeurs.
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuration invalide :\n  ${fields}`);
  }
  return parsed.data;
}
