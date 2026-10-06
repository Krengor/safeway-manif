/**
 * Métriques internes au format texte Prometheus (§64), sans dépendance.
 *
 * Monitorer le système, pas les personnes : les étiquettes se limitent à des valeurs
 * à cardinalité bornée (motif de route, méthode, classe de statut). Jamais d'IP, de
 * pseudo, de cellule, de zone ni d'identifiant d'événement.
 */
type Labels = Record<string, string>;

const labelKey = (labels: Labels): string =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k]!.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
    .join(',');

const series = (name: string, key: string): string => (key ? `${name}{${key}}` : name);

interface Metric {
  render(): string;
}

/** Garde-fou : une étiquette inattendue ne doit jamais faire exploser la mémoire. */
const MAX_SERIES = 500;

export class Counter implements Metric {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    private readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    if (!this.values.has(key) && this.values.size >= MAX_SERIES) return;
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) lines.push(`${series(this.name, key)} ${value}`);
    return lines.join('\n');
  }
}

export class Gauge implements Metric {
  private readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    private readonly help: string,
    /** Valeur lue au moment de l'export (facultatif). */
    private readonly collect?: () => number,
  ) {}

  set(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    if (!this.values.has(key) && this.values.size >= MAX_SERIES) return;
    this.values.set(key, value);
  }

  render(): string {
    if (this.collect) this.set(this.collect());
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) lines.push(`${series(this.name, key)} ${value}`);
    return lines.join('\n');
  }
}

export class Histogram implements Metric {
  private readonly data = new Map<string, { buckets: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    private readonly help: string,
    private readonly bounds: readonly number[],
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let entry = this.data.get(key);
    if (!entry) {
      if (this.data.size >= MAX_SERIES) return;
      entry = { buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.data.set(key, entry);
    }
    for (let i = 0; i < this.bounds.length; i++) if (value <= this.bounds[i]!) entry.buckets[i]! += 1;
    entry.sum += value;
    entry.count += 1;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, entry] of this.data) {
      const prefix = key ? `${key},` : '';
      this.bounds.forEach((bound, i) => lines.push(`${this.name}_bucket{${prefix}le="${bound}"} ${entry.buckets[i]}`));
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${entry.count}`);
      lines.push(`${series(`${this.name}_sum`, key)} ${entry.sum}`);
      lines.push(`${series(`${this.name}_count`, key)} ${entry.count}`);
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private readonly metrics: Metric[] = [];

  counter(name: string, help: string): Counter {
    return this.add(new Counter(name, help));
  }

  gauge(name: string, help: string, collect?: () => number): Gauge {
    return this.add(new Gauge(name, help, collect));
  }

  histogram(name: string, help: string, bounds: readonly number[]): Histogram {
    return this.add(new Histogram(name, help, bounds));
  }

  render(): string {
    return this.metrics.map((m) => m.render()).join('\n') + '\n';
  }

  private add<M extends Metric>(metric: M): M {
    this.metrics.push(metric);
    return metric;
  }
}

/** Bornes de latence HTTP (s). */
export const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] as const;
