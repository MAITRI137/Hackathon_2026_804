/**
 * Live operations console (Administrator).
 *
 * Every number here is measured: table counts and round-trip time come from
 * PostgreSQL, request rate and latency percentiles from the API's own metrics
 * registry, and loaded-record volume from what this browser actually holds.
 *
 * Nothing on this screen identifies a person. It answers "what is the system
 * doing", never "what is this employee doing".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Layers,
  RefreshCw,
  Server,
} from 'lucide-react';
import { Page } from '@/app/Page';
import { useStore } from '@/store/store';
import { fetchOpsMetrics, type OpsMetrics } from '@/lib/api';
import { Banner, Button, Card, Chip, EmptyState, Metric } from '@/ui/primitives';
import { HBars, LineChart } from '@/ui/charts';
import { NodeGraph, type GraphSignal } from './NodeGraph';

const POLL_MS = 2000;
const TREND_POINTS = 30;

export function OpsPage() {
  const state = useStore();
  const [metrics, setMetrics] = useState<OpsMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probeMs, setProbeMs] = useState(0);
  const [trend, setTrend] = useState<{ id: string; label: string; value: number }[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      const started = performance.now();
      try {
        const next = await fetchOpsMetrics();
        if (!active) return;
        seq.current += 1;
        setProbeMs(Math.max(1, Math.round(performance.now() - started)));
        setMetrics(next);
        setError(null);
        setTrend((rows) =>
          [
            ...rows,
            {
              id: `t-${seq.current}`,
              label: seq.current % 5 === 0 ? `${seq.current * (POLL_MS / 1000)}s` : '',
              value: Math.round(next.requests.perSecond * 60),
            },
          ].slice(-TREND_POINTS),
        );
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Telemetry unavailable');
      }
    };

    void poll();
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  /** What this browser currently holds resident, counted from the store. */
  const recordsLoaded = useMemo(
    () =>
      state.employees.length +
      state.contracts.length +
      state.attendance.length +
      state.leaveAllocations.length +
      state.leaveRequests.length +
      state.payslips.length +
      state.documents.length +
      state.audit.length +
      state.departments.length +
      state.jobPositions.length,
    [state],
  );

  const totalRecords = metrics?.database.totalRecords ?? state.counts?.total ?? 0;
  const online = Boolean(metrics && !error);
  const databaseOnline = metrics?.database.online ?? false;

  const signal: GraphSignal = {
    requestsPerSecond: metrics?.requests.perSecond ?? 0,
    readsPerSecond: metrics ? metrics.reads.series.slice(-10).reduce((a, b) => a + b, 0) / 10 : 0,
    databaseMs: metrics?.database.roundTripMs ?? 0,
    latencyMs: metrics?.latency.p95 ?? 0,
    online,
    databaseOnline,
    tables: metrics?.database.tables ?? [],
    totalRecords,
    recordsLoaded,
  };

  const coverage = totalRecords > 0 ? Math.round((recordsLoaded / totalRecords) * 100) : 0;

  return (
    <Page
      title="Live operations"
      crumbs={['System', 'Operations']}
      actions={
        <>
          <Chip tone={online ? 'success' : 'danger'} dot>
            {online ? 'Live telemetry' : 'Telemetry offline'}
          </Chip>
          <Button
            size="sm"
            icon={RefreshCw}
            onClick={() => {
              void fetchOpsMetrics()
                .then(setMetrics)
                .catch(() => undefined);
            }}
          >
            Refresh
          </Button>
        </>
      }
    >
      {error ? (
        <Banner tone="danger" icon={CircleAlert} title="Telemetry is unavailable">
          {error}. The API or database is not reachable from this browser — the console keeps the
          last good reading rather than inventing one.
        </Banner>
      ) : (
        <Banner tone="info" icon={Activity} title="Everything on this screen is measured">
          Table counts and round-trip time come from PostgreSQL, request rate and latency from the
          API&apos;s own registry, and loaded volume from this browser. No names, addresses or
          identifiers appear in this payload.
        </Banner>
      )}

      <div className="grid grid-4">
        <Metric
          icon={Server}
          label="API"
          value={online ? 'Online' : 'Unreachable'}
          tone={online ? 'success' : 'danger'}
          sub={`p95 ${metrics?.latency.p95 ?? 0} ms · p50 ${metrics?.latency.p50 ?? 0} ms`}
        />
        <Metric
          icon={Database}
          label="PostgreSQL"
          value={databaseOnline ? `${metrics?.database.roundTripMs ?? 0} ms` : 'Down'}
          tone={databaseOnline ? 'brand' : 'danger'}
          sub={`${totalRecords.toLocaleString('en-IN')} records across ${metrics?.database.tables.length ?? 0} tables`}
        />
        <Metric
          icon={Gauge}
          label="Throughput"
          value={`${Math.round((metrics?.requests.perSecond ?? 0) * 60)}/min`}
          sub={`${metrics?.requests.total.toLocaleString('en-IN') ?? 0} requests since start`}
        />
        <Metric
          icon={Layers}
          label="Records read"
          value={(metrics?.reads.total ?? 0).toLocaleString('en-IN')}
          tone="success"
          sub={`${recordsLoaded.toLocaleString('en-IN')} resident in this browser (${coverage}% of the dataset)`}
        />
      </div>

      <Card
        title="Live system graph"
        subtitle="Packets follow the real request path; a node flashes when one reaches it"
        padding="flush"
      >
        <NodeGraph signal={signal} />
        <div className="graph-legend">
          <span>
            <i style={{ background: 'var(--brand)' }} aria-hidden /> API request
          </span>
          <span>
            <i style={{ background: 'var(--accent)' }} aria-hidden /> Database read
          </span>
          <span>
            <i style={{ background: 'var(--success)' }} aria-hidden /> Service healthy
          </span>
          <span className="muted">
            Rate is capped for legibility; exact figures are in the tiles above.
          </span>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Request rate" subtitle={`Sampled every ${POLL_MS / 1000}s`}>
          {trend.length < 2 ? (
            <EmptyState
              icon={Activity}
              title="Collecting samples"
              description="The first points appear within a few seconds."
            />
          ) : (
            <LineChart data={trend} unit="requests/min" />
          )}
        </Card>

        <Card title="Dataset composition" subtitle="Row counts straight from PostgreSQL">
          {!metrics || metrics.database.tables.length === 0 ? (
            <EmptyState icon={Database} title="No table statistics yet" />
          ) : (
            <HBars
              rows={metrics.database.tables.slice(0, 8).map((t) => ({
                id: t.table,
                label: t.table,
                percent: (t.rows / Math.max(1, metrics.database.tables[0].rows)) * 100,
                caption: t.rows.toLocaleString('en-IN'),
              }))}
            />
          )}
        </Card>

        <Card title="Busiest endpoints" subtitle="Normalised paths, this process">
          {!metrics || metrics.routes.length === 0 ? (
            <EmptyState icon={Activity} title="No traffic recorded yet" />
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Route</th>
                    <th className="cell-num">Calls</th>
                    <th className="cell-num">Avg</th>
                    <th className="cell-num">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.routes.map((r) => (
                    <tr key={r.route}>
                      <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                        {r.route}
                      </td>
                      <td className="cell-num">{r.count}</td>
                      <td className="cell-num">{r.averageMs} ms</td>
                      <td className="cell-num">{r.maxMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Runtime" subtitle="Node process hosting the API">
          <div className="col gap3">
            <Row icon={Cpu} label="Node" value={metrics?.process.nodeVersion ?? '—'} />
            <Row
              icon={Activity}
              label="Uptime"
              value={metrics ? formatUptime(metrics.process.uptimeSeconds) : '—'}
            />
            <Row
              icon={HardDrive}
              label="Heap in use"
              value={
                metrics ? `${metrics.process.heapUsedMb} of ${metrics.process.heapTotalMb} MB` : '—'
              }
            />
            <Row
              icon={Database}
              label="Database queries"
              value={
                metrics
                  ? `${metrics.queryActivity.queries.toLocaleString('en-IN')} · avg ${metrics.queryActivity.averageMs} ms`
                  : '—'
              }
            />
            <Row icon={Gauge} label="Browser round trip" value={`${probeMs} ms`} />
            <Row
              icon={metrics && metrics.requests.errors === 0 ? CircleCheck : CircleAlert}
              label="Server errors"
              value={metrics ? String(metrics.requests.errors) : '—'}
              tone={metrics && metrics.requests.errors > 0 ? 'danger' : 'success'}
            />
          </div>
        </Card>
      </div>
    </Page>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="row between">
      <span className="row gap2 muted">
        <Icon
          size={15}
          aria-hidden
          color={
            tone === 'danger' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : undefined
          }
        />
        {label}
      </span>
      <strong className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
        {value}
      </strong>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
