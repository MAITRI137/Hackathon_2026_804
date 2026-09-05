/**
 * In-process metrics registry.
 *
 * Counters, a fixed-bucket latency histogram and a one-second ring buffer, all
 * pre-allocated. Nothing here allocates per request beyond a couple of numbers,
 * and the whole registry is bounded — observability must never become the load
 * it is measuring.
 */

const WINDOW_SECONDS = 120;

/** Latency buckets in milliseconds. */
const BUCKETS = [5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, Infinity];

interface RouteStat {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

class Registry {
  readonly startedAt = Date.now();

  totalRequests = 0;
  totalErrors = 0;
  dbQueries = 0;
  dbTotalMs = 0;
  recordsRead = 0;

  private readonly buckets = new Array<number>(BUCKETS.length).fill(0);
  private readonly samples: number[] = [];
  private readonly routes = new Map<string, RouteStat>();

  /** Requests and record reads observed in each of the last WINDOW_SECONDS. */
  private readonly reqPerSecond = new Array<number>(WINDOW_SECONDS).fill(0);
  private readonly readsPerSecond = new Array<number>(WINDOW_SECONDS).fill(0);
  private cursor = 0;
  private cursorSecond = Math.floor(Date.now() / 1000);

  private rollTo(second: number): void {
    if (second === this.cursorSecond) return;
    const steps = Math.min(WINDOW_SECONDS, second - this.cursorSecond);
    for (let i = 0; i < steps; i += 1) {
      this.cursor = (this.cursor + 1) % WINDOW_SECONDS;
      this.reqPerSecond[this.cursor] = 0;
      this.readsPerSecond[this.cursor] = 0;
    }
    this.cursorSecond = second;
  }

  recordRequest(route: string, status: number, durationMs: number, records = 0): void {
    this.rollTo(Math.floor(Date.now() / 1000));
    this.totalRequests += 1;
    if (status >= 500) this.totalErrors += 1;
    this.reqPerSecond[this.cursor] += 1;
    this.readsPerSecond[this.cursor] += records;
    this.recordsRead += records;

    for (let i = 0; i < BUCKETS.length; i += 1) {
      if (durationMs <= BUCKETS[i]) {
        this.buckets[i] += 1;
        break;
      }
    }
    // A bounded reservoir is enough for p50/p95 on a demo-scale service.
    if (this.samples.length < 512) this.samples.push(durationMs);
    else this.samples[this.totalRequests % 512] = durationMs;

    const stat = this.routes.get(route) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    stat.count += 1;
    stat.totalMs += durationMs;
    stat.maxMs = Math.max(stat.maxMs, durationMs);
    if (status >= 400) stat.errors += 1;
    this.routes.set(route, stat);
    // Keep the route table bounded even if a client probes random paths.
    if (this.routes.size > 64) {
      const oldest = this.routes.keys().next().value;
      if (oldest) this.routes.delete(oldest);
    }
  }

  recordQuery(durationMs: number): void {
    this.dbQueries += 1;
    this.dbTotalMs += durationMs;
  }

  private percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round(sorted[index]);
  }

  /** Newest-last series of the last `seconds` whole seconds. */
  private series(source: number[], seconds: number): number[] {
    this.rollTo(Math.floor(Date.now() / 1000));
    const out: number[] = [];
    for (let i = seconds - 1; i >= 0; i -= 1) {
      out.push(source[(this.cursor - i + WINDOW_SECONDS * 2) % WINDOW_SECONDS]);
    }
    return out;
  }

  snapshot(seconds = 60) {
    const requestSeries = this.series(this.reqPerSecond, seconds);
    const readSeries = this.series(this.readsPerSecond, seconds);
    const recent = requestSeries.slice(-10);
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      requests: {
        total: this.totalRequests,
        errors: this.totalErrors,
        perSecond: recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length),
        series: requestSeries,
      },
      reads: {
        total: this.recordsRead,
        series: readSeries,
      },
      latency: {
        p50: this.percentile(50),
        p95: this.percentile(95),
        p99: this.percentile(99),
      },
      database: {
        queries: this.dbQueries,
        averageMs: this.dbQueries ? Number((this.dbTotalMs / this.dbQueries).toFixed(2)) : 0,
      },
      routes: [...this.routes.entries()]
        .map(([route, stat]) => ({
          route,
          count: stat.count,
          errors: stat.errors,
          averageMs: Math.round(stat.totalMs / stat.count),
          maxMs: Math.round(stat.maxMs),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }
}

export type MetricsSnapshot = ReturnType<Registry['snapshot']>;

export const metrics = new Registry();
