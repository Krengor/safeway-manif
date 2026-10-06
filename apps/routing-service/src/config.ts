import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ROUTING_PORT: z.coerce.number().int().positive().default(4382),
  ROUTING_HOST: z.string().default('127.0.0.1'),
  PUBLIC_ORIGIN: z.url(),
  /** Moteur Valhalla (réseau interne uniquement). */
  VALHALLA_URL: z.url().default('http://127.0.0.1:8002'),
  /** API publique SafeWay : source des signalements, exactement comme pour un client. */
  MAP_API_URL: z.url().default('http://127.0.0.1:4380'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'silent']).default('info'),
});

export type RoutingConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RoutingConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuration invalide :\n  ${fields}`);
  }
  return parsed.data;
}
