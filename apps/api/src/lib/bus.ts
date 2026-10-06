/**
 * Bus d'événements vers les gateways temps réel (§13, §54).
 *
 * V0.2 : Redis Pub/Sub, un canal par zone H3. L'interface permet de passer à NATS
 * sans toucher au métier. La publication est « fire and forget » : une panne du bus
 * ne doit jamais faire échouer un signalement (§54) — les clients se resynchronisent
 * par le polling de secours.
 */
import { zoneChannel, type BusMessage } from '@safeway/shared';
import type { Redis } from 'ioredis';

export interface EventBus {
  publish(zone: string, message: BusMessage): void;
}

export const noopBus: EventBus = { publish: () => {} };

export class RedisBus implements EventBus {
  constructor(private readonly redis: Redis) {}

  publish(zone: string, message: BusMessage): void {
    this.redis.publish(zoneChannel(zone), JSON.stringify(message)).catch(() => {});
  }
}
