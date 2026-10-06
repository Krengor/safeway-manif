import { Redis } from 'ioredis';

export type { Redis };

export function createRedis(url: string): Redis {
  return new Redis(url, {
    // Pas de file d'attente infinie si Redis tombe : on échoue vite (§58).
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 1000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}
