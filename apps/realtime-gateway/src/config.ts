import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  GATEWAY_PORT: z.coerce.number().int().positive().default(4381),
  GATEWAY_HOST: z.string().default('127.0.0.1'),
  /** Origine autorisée pour l'ouverture des WebSockets (le front). */
  PUBLIC_ORIGIN: z.url(),
  REDIS_URL: z.string().min(1),
  /** Plafond de connexions par instance : au-delà, refus propre → le LB en choisit une autre. */
  MAX_CONNECTIONS: z.coerce.number().int().positive().default(50_000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'silent']).default('info'),
});

export type GatewayConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuration invalide :\n  ${fields}`);
  }
  return parsed.data;
}
