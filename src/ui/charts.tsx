/**
 * Charts.
 *
 * Rules applied here, deliberately:
 *  - Magnitude is carried by ONE hue. Colour is spent on state, not decoration.
 *  - Every data point is reachable by hover, by keyboard focus AND by tap.
 *  - Charts are informational. They are never hidden navigation — no chart
 *    surface is a link, and the cursor never lies about being clickable.
 *  - Every chart ships an accessible table of the same numbers, which also
 *    satisfies the contrast-relief rule for lighter ramp steps.
 *  - Zero data renders a labelled panel, never a collapsed axis or NaN.
 */
import { useId, useState, type ReactNode } from 'react';
import { BarChart3 } from 'lucide-react';
import { EmptyState } from './primitives';

export interface Datum {
  id: string;
  label: string;
  value: number;
  /** Rendered in the tooltip and the table; carries the unit. */
  display?: string;
  color?: string;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

function AccessibleTable({ data, unit }: { data: Datum[]; unit: string }) {
  return (
    <details className="chart-table">
      <summary>View as table</summary>
      <table>
        <caption className="sr-only">{unit}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.id}>
              <td>{d.label}</td>
              <td>{d.display ?? d.value.toLocaleString('en-IN')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/* ── Bar chart ─────────────────────────────────────────────── */

export function BarChart({
  data,
  unit,
  emptyLabel = 'No data for this selection',
}: {
  data: Datum[];
  /** Named in the tooltip, e.g. "payroll cost" → "Engineering — ₹9.80L payroll cost". */
  unit: string;
  emptyLabel?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const labelId = useId();

  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <>
        <EmptyState
          icon={BarChart3}
          title={emptyLabel}
          description="Adjust the filters to see values here."
        />
        {data.length > 0 && <AccessibleTable data={data} unit={unit} />}
      </>
    );
  }

  const max = niceMax(Math.max(...data.map((d) => d.value)));

  return (
    <div className="chart">
      <div
        className="chart-plot"
        role="img"
        aria-labelledby={labelId}
        onMouseLeave={() => setActive(null)}
      >
        {data.map((d) => {
          const pct = max > 0 ? Math.max(1, (d.value / max) * 100) : 1;
          const text = `${d.label} — ${d.display ?? d.value.toLocaleString('en-IN')} ${unit}`;
          const isActive = active === d.id;
          return (
            <div className="chart-col" key={d.id}>
              <button
                type="button"
                className="chart-bar"
                style={{ height: `${pct}%`, background: d.color ?? 'var(--mark-1)' }}
                data-active={isActive || undefined}
                aria-label={text}
                onFocus={() => setActive(d.id)}
                onBlur={() => setActive(null)}
                onMouseEnter={() => setActive(d.id)}
                onClick={() => setActive((cur) => (cur === d.id ? null : d.id))}
              >
                {isActive && (
                  <span className="chart-tip" role="tooltip">
                    <b>{d.label}</b>
                    {d.display ?? d.value.toLocaleString('en-IN')} {unit}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      <div className="chart-xlabels" aria-hidden>
        {data.map((d) => (
          <span key={d.id} title={d.label}>
            {d.label}
          </span>
        ))}
      </div>
      <p id={labelId} className="sr-only">
        Bar chart of {unit}. {data.map((d) => `${d.label}: ${d.display ?? d.value}`).join('. ')}
      </p>
      <AccessibleTable data={data} unit={unit} />
    </div>
  );
}

/* ── Grouped bars (budget vs actual) ───────────────────────── */

export function GroupedBarChart({
  data,
  seriesA,
  seriesB,
  unit,
}: {
  data: { id: string; label: string; a: number; b: number; aDisplay: string; bDisplay: string }[];
  seriesA: string;
  seriesB: string;
  unit: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  if (data.length === 0) {
    return <EmptyState icon={BarChart3} title="No data for this selection" />;
  }
  const max = niceMax(Math.max(...data.flatMap((d) => [d.a, d.b])));

  return (
    <div className="chart">
      <div className="chart-plot" onMouseLeave={() => setActive(null)}>
        {data.map((d) => (
          <div
            className="chart-col"
            key={d.id}
            style={{ gap: 2, display: 'flex', alignItems: 'flex-end' }}
          >
            {(
              [
                { k: 'a', v: d.a, disp: d.aDisplay, name: seriesA, color: 'var(--mark-ramp-2)' },
                { k: 'b', v: d.b, disp: d.bDisplay, name: seriesB, color: 'var(--mark-1)' },
              ] as const
            ).map((s) => {
              const id = `${d.id}-${s.k}`;
              const isActive = active === id;
              return (
                <button
                  key={s.k}
                  type="button"
                  className="chart-bar"
                  style={{
                    height: `${Math.max(1, (s.v / max) * 100)}%`,
                    width: 18,
                    background: s.color,
                  }}
                  data-active={isActive || undefined}
                  aria-label={`${d.label} ${s.name} — ${s.disp} ${unit}`}
                  onFocus={() => setActive(id)}
                  onBlur={() => setActive(null)}
                  onMouseEnter={() => setActive(id)}
                  onClick={() => setActive((c) => (c === id ? null : id))}
                >
                  {isActive && (
                    <span className="chart-tip" role="tooltip">
                      <b>
                        {d.label} · {s.name}
                      </b>
                      {s.disp} {unit}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="chart-xlabels" aria-hidden>
        {data.map((d) => (
          <span key={d.id} title={d.label}>
            {d.label}
          </span>
        ))}
      </div>
      <div className="chart-legend">
        <span>
          <i style={{ background: 'var(--mark-ramp-2)' }} aria-hidden />
          {seriesA}
        </span>
        <span>
          <i style={{ background: 'var(--mark-1)' }} aria-hidden />
          {seriesB}
        </span>
      </div>
      <details className="chart-table">
        <summary>View as table</summary>
        <table>
          <tbody>
            {data.map((d) => (
              <tr key={d.id}>
                <td>{d.label}</td>
                <td>
                  {seriesA} {d.aDisplay} · {seriesB} {d.bDisplay}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/* ── Line chart (trend) ────────────────────────────────────── */

export function LineChart({ data, unit }: { data: Datum[]; unit: string }) {
  const [active, setActive] = useState<number | null>(null);
  const labelId = useId();

  if (data.length === 0) return <EmptyState icon={BarChart3} title="No periods to compare yet" />;
  if (data.length === 1) {
    return (
      <div className="col gap2">
        <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>
          {data[0].display ?? data[0].value}
        </div>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
          {data[0].label} — one period only, a trend needs at least two.
        </p>
        <AccessibleTable data={data} unit={unit} />
      </div>
    );
  }

  // A trend of large, similar values says nothing against a zero baseline: a
  // 4% move becomes two pixels. Bars must start at zero, but a line may use a
  // fitted range — provided the range is stated, which it is, below the plot.
  const values = data.map((d) => d.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin;
  const pad = spread === 0 ? Math.max(1, rawMax * 0.05) : spread * 0.35;
  const lo = Math.max(0, rawMin - pad);
  const hi = rawMax + pad;
  const span = hi - lo || 1;
  const fitted = lo > 0;

  const W = 100;
  const H = 40;
  const padY = 4;
  const x = (i: number) => 3 + (i / (data.length - 1)) * (W - 6);
  const y = (v: number) => H - padY - ((v - lo) / span) * (H - padY * 2);
  const path = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(d.value).toFixed(2)}`)
    .join(' ');
  const area = `${path} L${x(data.length - 1).toFixed(2)},${H - padY} L${x(0).toFixed(2)},${H - padY} Z`;
  const loLabel = data.find((d) => d.value === rawMin);
  const hiLabel = data.find((d) => d.value === rawMax);

  return (
    <div className="chart">
      <svg
        className="chart-line"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={labelId}
      >
        <path d={area} fill="var(--brand-light)" stroke="none" />
        <path
          d={path}
          fill="none"
          stroke="var(--mark-1)"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => (
          <circle
            key={d.id}
            cx={x(i)}
            cy={y(d.value)}
            r={active === i ? 1.6 : 1}
            fill="var(--mark-1)"
            stroke="var(--surface)"
            strokeWidth="0.5"
          />
        ))}
      </svg>
      <div className="chart-xlabels" style={{ marginTop: -8 }}>
        {data.map((d, i) => (
          <button
            key={d.id}
            type="button"
            style={{
              flex: '1 1 0',
              minWidth: 0,
              fontSize: 10,
              color: active === i ? 'var(--brand)' : 'var(--text-muted)',
              fontWeight: active === i ? 700 : 400,
              padding: '4px 0',
            }}
            aria-label={`${d.label} — ${d.display ?? d.value} ${unit}`}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onClick={() => setActive((c) => (c === i ? null : i))}
          >
            {d.label}
          </button>
        ))}
      </div>
      {active !== null ? (
        <p style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, textAlign: 'center' }}>
          {data[active].label}: {data[active].display ?? data[active].value} {unit}
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>
          {fitted ? 'Scale fitted to the range: ' : 'Range: '}
          {loLabel?.display ?? rawMin.toLocaleString('en-IN')} –{' '}
          {hiLabel?.display ?? rawMax.toLocaleString('en-IN')} {unit}
        </p>
      )}
      <p id={labelId} className="sr-only">
        Trend of {unit}. {data.map((d) => `${d.label}: ${d.display ?? d.value}`).join('. ')}
      </p>
      <AccessibleTable data={data} unit={unit} />
    </div>
  );
}

/* ── Horizontal comparison bars ────────────────────────────── */

export function HBars({
  rows,
}: {
  rows: { id: string; label: string; percent: number; caption: ReactNode; color?: string }[];
}) {
  return (
    <div className="col gap2">
      {rows.map((r) => (
        <div className="bar-row" key={r.id}>
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${Math.max(0, Math.min(100, r.percent))}%`,
                background: r.color ?? 'var(--mark-1)',
              }}
            />
          </span>
          <span className="bar-val">{r.caption}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Donut (composition of one total) ──────────────────────── */

/**
 * A donut answers "what is this total made of", never "how do these compare".
 * Identity is carried by the legend, which always prints the value beside the
 * swatch, so the reading never depends on colour alone.
 */
export function DonutChart({
  data,
  total,
  totalLabel,
  unit,
}: {
  data: Datum[];
  total: string;
  totalLabel: string;
  unit: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const sum = data.reduce((a, d) => a + d.value, 0);

  if (data.length === 0 || sum <= 0) {
    return <EmptyState icon={BarChart3} title="Nothing to break down yet" />;
  }

  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="donut">
      <div className="donut-plot">
        <svg viewBox="0 0 140 140" role="img" aria-label={`${totalLabel}: ${total}`}>
          <g transform="translate(70,70) rotate(-90)">
            {data.map((d) => {
              const share = d.value / sum;
              const dash = share * C;
              const el = (
                <circle
                  key={d.id}
                  r={R}
                  fill="none"
                  stroke={d.color ?? 'var(--mark-1)'}
                  strokeWidth={active === d.id ? 20 : 16}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  style={{ transition: 'stroke-width 140ms ease' }}
                />
              );
              offset += dash;
              return el;
            })}
          </g>
        </svg>
        <div className="donut-center">
          <span className="eyebrow">{totalLabel}</span>
          <strong>{total}</strong>
        </div>
      </div>
      <ul className="donut-legend">
        {data.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onMouseEnter={() => setActive(d.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(d.id)}
              onBlur={() => setActive(null)}
              aria-label={`${d.label}: ${d.display ?? d.value} ${unit}, ${Math.round((d.value / sum) * 100)} percent`}
            >
              <i style={{ background: d.color ?? 'var(--mark-1)' }} aria-hidden />
              <span className="grow truncate">{d.label}</span>
              <span className="mono">{d.display ?? d.value.toLocaleString('en-IN')}</span>
              <span className="muted donut-share">{Math.round((d.value / sum) * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Sparkline ─────────────────────────────────────────────── */

/**
 * A trend at tile size. It carries no axis, so it says "direction", never
 * "how much" — the number beside it does that. Fitted to its own range, since
 * a zero baseline would flatten every real movement at this height.
 */
export function Sparkline({
  values,
  label,
  tone = 'brand',
}: {
  values: number[];
  label: string;
  tone?: 'brand' | 'success' | 'warning' | 'danger';
}) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const W = 100;
  const H = 26;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ');
  const stroke =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warning'
        ? 'var(--warning-strong)'
        : tone === 'danger'
          ? 'var(--danger)'
          : 'var(--mark-1)';

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d={`${path} L${W},${H} L0,${H} Z`} fill={stroke} opacity=".08" />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2" fill={stroke} />
    </svg>
  );
}
