/**
 * Dégradation contrôlée (§56) : mesure de la pression de l'instance et niveau du cluster.
 *
 * Toutes les 5 s, chaque instance :
 *   1. mesure sa pression (boucle d'événements p99, latence p95, erreurs 5xx, requêtes en cours) ;
 *   2. publie son niveau dans Redis (`load:instances`) ;
 *   3. lit le niveau du cluster (pire instance vivante, ou forçage administrateur) ;
 *   4. le diffuse aux gateways temps réel sur le bus.
 * Si Redis est indisponible, l'instance applique son propre niveau mesuré.
 */
import {
  LOAD_CHANNEL,
  LOAD_INSTANCES_KEY,
  LOAD_OVERRIDE_KEY,
  LevelGovernor,
  clusterLevel,
  levelForSample,
  type AdminLoadStatus,
  type DegradationLevel,
  type LoadSample,
} from '@safeway/shared';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

const TICK_MS = 5000;
const MAX_LATENCY_SAMPLES = 4096;
/** Instances muettes depuis plus longtemps : retirées du hash. */
const FORGET_INSTANCE_MS = 5 * 60_000;

export class LoadMonitor {
  readonly instanceId = randomUUID();
  private readonly governor = new LevelGovernor();
  private readonly loop: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
  private latencies: number[] = [];
  private requests = 0;
  private errors = 0;
  private inFlight = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cluster: AdminLoadStatus = { level: 0, auto: 0 };
  /** Dernière mesure (exposée dans les métriques). */
  lastSample: LoadSample = { eventLoopP99Ms: 0, latencyP95Ms: 0, errorRate: 0, inFlight: 0 };

  constructor(private readonly redis: Redis) {}

  /** Niveau appliqué par cette instance. */
  get level(): DegradationLevel {
    return this.cluster.level;
  }

  get localLevel(): DegradationLevel {
    return this.governor.current;
  }

  get status(): AdminLoadStatus {
    return this.cluster;
  }

  get pending(): number {
    return this.inFlight;
  }

  start(): void {
    this.loop.enable();
    this.timer ??= setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  /** Arrêt propre : l'instance quitte aussitôt le calcul du niveau du cluster. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loop.disable();
    await this.redis.hdel(LOAD_INSTANCES_KEY, this.instanceId).catch(() => {});
  }

  requestStarted(): void {
    this.inFlight += 1;
  }

  requestFinished(durationMs: number, status: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.requests += 1;
    if (status >= 500) this.errors += 1;
    if (this.latencies.length < MAX_LATENCY_SAMPLES) this.latencies.push(durationMs);
    else this.latencies[Math.floor(Math.random() * MAX_LATENCY_SAMPLES)] = durationMs; // échantillon
  }

  /** Mesure, publie et relit le niveau du cluster. Exposé pour les tests. */
  async tick(now = Date.now()): Promise<AdminLoadStatus> {
    this.lastSample = this.sample();
    const local = this.governor.update(levelForSample(this.lastSample), now);
    try {
      const [, instances, override, ttl] = (await this.redis
        .multi()
        .hset(LOAD_INSTANCES_KEY, this.instanceId, `${local}|${now}`)
        .hgetall(LOAD_INSTANCES_KEY)
        .get(LOAD_OVERRIDE_KEY)
        .pttl(LOAD_OVERRIDE_KEY)
        .exec())!.map(([err, value]) => {
        if (err) throw err;
        return value;
      }) as [unknown, Record<string, string>, string | null, number];

      const { level, auto, forced } = clusterLevel(instances, override, now);
      this.cluster = forced && ttl > 0 ? { level, auto, forcedUntil: Math.floor((now + ttl) / 1000) } : { level, auto };
      void this.redis.publish(LOAD_CHANNEL, String(level)).catch(() => {});
      void this.forgetStale(instances, now);
    } catch {
      this.cluster = { level: local, auto: local };
    }
    return this.cluster;
  }

  /** Force un niveau pour `minutes` (null : retour à l'automatique). */
  async force(level: DegradationLevel | null, minutes: number): Promise<AdminLoadStatus> {
    if (level === null) await this.redis.del(LOAD_OVERRIDE_KEY);
    else await this.redis.set(LOAD_OVERRIDE_KEY, String(level), 'EX', minutes * 60);
    return this.tick();
  }

  private sample(): LoadSample {
    const eventLoopP99Ms = this.loop.count > 0 ? this.loop.percentile(99) / 1e6 : 0;
    this.loop.reset();
    const sorted = this.latencies.sort((a, b) => a - b);
    const latencyP95Ms = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0;
    const errorRate = this.requests >= 20 ? this.errors / this.requests : 0; // pas de verdict sur 3 requêtes
    this.latencies = [];
    this.requests = 0;
    this.errors = 0;
    return { eventLoopP99Ms, latencyP95Ms, errorRate, inFlight: this.inFlight };
  }

  private async forgetStale(instances: Record<string, string>, now: number): Promise<void> {
    const stale = Object.entries(instances)
      .filter(([, raw]) => now - Number(raw.split('|')[1]) > FORGET_INSTANCE_MS)
      .map(([id]) => id);
    if (stale.length) await this.redis.hdel(LOAD_INSTANCES_KEY, ...stale).catch(() => {});
  }
}
