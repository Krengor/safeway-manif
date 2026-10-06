/**
 * Dégradation contrôlée (cahier §56) : sous la charge, SafeWay ralentit au lieu de tomber.
 *
 * Priorités (§56) : 1. lire la carte ; 2. voir les dangers récents ; 3. signaler ;
 * 4. valider ; 5. itinéraire ; 6. le reste. Chaque niveau sacrifie d'abord le bas de la liste.
 *
 * Le niveau est calculé par l'API à partir de mesures du SYSTÈME (latence, boucle
 * d'événements, erreurs), jamais de données sur les personnes (§64). L'administrateur
 * peut le forcer temporairement.
 */
export type DegradationLevel = 0 | 1 | 2 | 3;

export const DEGRADATION_LEVELS: readonly DegradationLevel[] = [0, 1, 2, 3];

export interface DegradationPolicy {
  /** Polling REST des zones quand le temps réel est connecté (s) — resynchronisation. */
  pollLiveSeconds: number;
  /** Polling REST des zones quand le temps réel est coupé (s). */
  pollFallbackSeconds: number;
  /** Regroupement des messages temps réel par le gateway (ms). */
  realtimeBatchMs: number;
  /** Durée de cache public des zones (s) : plus long = moins de requêtes à l'origine. */
  zoneCacheSeconds: number;
  /** Itinéraire disponible (priorité 5). */
  routing: boolean;
  /** Délai minimal entre deux recalculs d'itinéraire (s). */
  routeRecomputeSeconds: number;
  /** Animations de l'interface. */
  animations: boolean;
  /** Fonctions secondaires : changement de pseudo, préparation d'une carte hors ligne… */
  secondary: boolean;
}

export const DEGRADATION_POLICIES: Record<DegradationLevel, DegradationPolicy> = {
  // Normal : temps réel complet, votes instantanés, routage dynamique, animations.
  0: {
    pollLiveSeconds: 30,
    pollFallbackSeconds: 10,
    realtimeBatchMs: 250,
    zoneCacheSeconds: 5,
    routing: true,
    routeRecomputeSeconds: 5,
    animations: true,
    secondary: true,
  },
  // Forte charge : regroupement plus agressif, cache plus long, moins d'animations.
  1: {
    pollLiveSeconds: 45,
    pollFallbackSeconds: 15,
    realtimeBatchMs: 1000,
    zoneCacheSeconds: 10,
    routing: true,
    routeRecomputeSeconds: 15,
    animations: false,
    secondary: true,
  },
  // Charge critique : temps réel limité, lecture prioritaire, écritures toujours disponibles,
  // itinéraire recalculé moins souvent, fonctions secondaires coupées.
  2: {
    pollLiveSeconds: 60,
    pollFallbackSeconds: 20,
    realtimeBatchMs: 2500,
    zoneCacheSeconds: 20,
    routing: true,
    routeRecomputeSeconds: 30,
    animations: false,
    secondary: false,
  },
  // Survie : carte + événements actifs + signalement essentiel, rien d'autre.
  3: {
    pollLiveSeconds: 60,
    pollFallbackSeconds: 30,
    realtimeBatchMs: 5000,
    zoneCacheSeconds: 30,
    routing: false,
    routeRecomputeSeconds: 60,
    animations: false,
    secondary: false,
  },
};

export const degradationPolicy = (level: DegradationLevel): DegradationPolicy => DEGRADATION_POLICIES[level];

export const isDegradationLevel = (value: unknown): value is DegradationLevel =>
  value === 0 || value === 1 || value === 2 || value === 3;

// --- Mesure de la pression d'une instance ----------------------------------------------

/** Mesures agrégées d'une instance sur une fenêtre glissante courte. */
export interface LoadSample {
  /** Retard de la boucle d'événements, p99 (ms). */
  eventLoopP99Ms: number;
  /** Latence des requêtes, p95 (ms). */
  latencyP95Ms: number;
  /** Part de réponses 5xx (0-1). */
  errorRate: number;
  /** Requêtes en cours de traitement. */
  inFlight: number;
}

/** Seuils d'entrée dans chaque niveau (1, 2, 3). Volontairement prudents. */
export const LOAD_THRESHOLDS = {
  eventLoopP99Ms: [100, 250, 600],
  latencyP95Ms: [300, 800, 2000],
  errorRate: [0.02, 0.05, 0.2],
  inFlight: [200, 500, 1500],
} as const satisfies Record<keyof LoadSample, readonly [number, number, number]>;

/** Niveau correspondant à une mesure : le pire indicateur l'emporte. */
export function levelForSample(sample: LoadSample): DegradationLevel {
  let level = 0;
  for (const key of Object.keys(LOAD_THRESHOLDS) as (keyof LoadSample)[]) {
    const thresholds = LOAD_THRESHOLDS[key];
    const value = sample[key];
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (value >= thresholds[i]!) {
        level = Math.max(level, i + 1);
        break;
      }
    }
  }
  return level as DegradationLevel;
}

/**
 * Hystérésis : on monte immédiatement, on ne redescend que d'un cran à la fois et après
 * `calmMs` de mesures plus basses — pas de clignotement entre deux niveaux.
 */
export class LevelGovernor {
  private level: DegradationLevel = 0;
  private calmSince: number | null = null;

  constructor(private readonly calmMs = 30_000) {}

  get current(): DegradationLevel {
    return this.level;
  }

  update(measured: DegradationLevel, now: number): DegradationLevel {
    if (measured >= this.level) {
      this.level = measured;
      this.calmSince = null;
    } else if (this.calmSince === null) {
      this.calmSince = now;
    } else if (now - this.calmSince >= this.calmMs) {
      this.level = (this.level - 1) as DegradationLevel;
      this.calmSince = this.level > measured ? now : null;
    }
    return this.level;
  }
}

// --- Agrégation à l'échelle du cluster -------------------------------------------------

/** Clé Redis (hash) : instance → `niveau|horodatage ms`. */
export const LOAD_INSTANCES_KEY = 'load:instances';
/** Clé Redis : niveau forcé par l'administrateur (expire seule). */
export const LOAD_OVERRIDE_KEY = 'load:override';
/** Canal de bus par lequel les gateways apprennent le niveau courant. */
export const LOAD_CHANNEL = 'load:level';
/** Une instance silencieuse depuis plus longtemps est ignorée (arrêtée ou bloquée). */
export const LOAD_INSTANCE_STALE_MS = 20_000;

/**
 * Niveau du cluster : le forçage administrateur s'il existe, sinon la PIRE instance encore
 * vivante. Prudent : une seule instance saturée suffit à alléger le trafic de tout le monde.
 */
export function clusterLevel(
  instances: Record<string, string>,
  override: string | null,
  now: number,
): { level: DegradationLevel; auto: DegradationLevel; forced: boolean } {
  let auto = 0;
  for (const raw of Object.values(instances)) {
    const [levelText, atText] = raw.split('|');
    const level = Number(levelText);
    const at = Number(atText);
    if (!isDegradationLevel(level) || !Number.isFinite(at) || now - at > LOAD_INSTANCE_STALE_MS) continue;
    auto = Math.max(auto, level);
  }
  const forcedLevel = override === null ? null : Number(override);
  if (isDegradationLevel(forcedLevel)) return { level: forcedLevel, auto: auto as DegradationLevel, forced: true };
  return { level: auto as DegradationLevel, auto: auto as DegradationLevel, forced: false };
}
