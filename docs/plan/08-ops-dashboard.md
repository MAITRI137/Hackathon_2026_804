# 11. Live Operations Dashboard

**Route:** `/ops` · **Permission:** `ops.dashboard` (Admin only) · **Refresh:** SSE at 1 Hz

The goal is a screen that makes the engineering *visible* — server, database, network and client activity moving in real time — while staying calm enough to read at a glance. The design rule is **three tiers**: four vitals you can read in one second, one motion element that shows the system is alive, and everything else collapsed behind explicit disclosure.

## 11.1 What "not overwhelming" means concretely

| Rule | Consequence |
|---|---|
| At most **4 numbers** are always visible | Everything else is one click away |
| At most **one** animated element on screen | The request-flow ribbon. Nothing else moves unless its value changes |
| **One hue** carries magnitude | Brand blue. Colour is only spent on state, never on decoration |
| **No dual-axis charts, ever** | Two measures of different scale become two sparklines |
| Panels are **collapsed by default** below the fold | The default view is Pulse + Flow + Database + Clients |
| Numbers **update in place** | No layout shift, no re-mount, no flashing |
| `prefers-reduced-motion` | Particles stop; the ribbon becomes a static width-encoded bar; sparklines still update |

## 11.2 Layout

```
┌─ SYSTEM PULSE ────────────────────────────────────────────────────────┐
│  API p95        Requests/s      DB pool          Active clients        │
│  84 ms ▁▂▂▃▂▁   18.4 ▁▃▅▄▃▂     6/15 ▂▂▃▃▂▂      23 ▃▃▄▄▄▅            │
│  ● healthy      ● healthy       ● healthy        4 roles               │
└───────────────────────────────────────────────────────────────────────┘
┌─ REQUEST FLOW ────────────────────────────────────────────────────────┐
│   Client ──▶ API ──▶ Prisma ──▶ Postgres                              │
│      ·  ·  ·   ·· ·    ·  ·  ·     ·                                  │
│   18.4 rp/s · 99.1% 2xx · 0.4% 4xx · 0.0% 5xx · p99 210 ms            │
└───────────────────────────────────────────────────────────────────────┘
┌─ DATABASE ──────────────────┐ ┌─ CLIENT ACTIVITY ────────────────────┐
│ pool  ▓▓▓▓▓▓░░░░░░░░░  6/15 │ │ 23 active sessions                   │
│ cache hit ratio      99.4%  │ │ ├ Payroll Manager  /payroll      2s  │
│ longest txn           41ms  │ │ ├ HR Manager       /employees    9s  │
│ slow queries (>200ms)     2 │ │ ├ Employee         /payslips    14s  │
│ rows: employees 5,000       │ │ └ …19 more                           │
│       payslips  60,000      │ │ concurrent ▁▂▃▄▄▅▅▄▃  peak 31        │
└─────────────────────────────┘ └──────────────────────────────────────┘
▸ Endpoints   ▸ Jobs & queue   ▸ Network   ▸ Payroll engine   ▸ Dependencies
```

On tablet the two mid panels stack; on phone the Pulse becomes a 2×2 grid and the flow ribbon collapses to a single throughput bar with the same numbers below it. Nothing is removed — the ops dashboard is admin-only but still fully operable on a phone.

## 11.3 Panels

### Tier 1 — System Pulse (always visible)

Four stat tiles. Each: a hero number with unit, a 60-second sparkline, and a status dot with a **text label** (never colour alone).

| Tile | Source | Healthy / Warn / Critical |
|---|---|---|
| API p95 latency | histogram over the last 60 s | < 200 ms / < 500 ms / above |
| Requests per second | counter delta | informational; warn on a 3× spike |
| DB pool utilisation | `pool.totalCount / idleCount / waitingCount` | < 60% / < 85% / waiting > 0 |
| Active clients | distinct sessions seen in the last 60 s | informational |

### Tier 2 — Request Flow ribbon (the one animated element)

A four-node horizontal pipeline: **Client → API → Prisma → Postgres**. Particles travel left to right; **particle emission rate is proportional to actual requests per second**, capped at 60 on screen. Each particle is coloured by its response class and carries an icon shape, so the encoding is not colour-alone. A particle that would be a 5xx enters the ribbon as a slightly larger mark and leaves a brief mark on the timeline strip beneath.

Under the ribbon: `rp/s · %2xx · %4xx · %5xx · p99`, as text. **If the animation is off, every number is still there** — the ribbon is an ornament on data, not the data.

Implementation: one `<canvas>`, one `requestAnimationFrame` loop, particle array capped and recycled, data read from a ref that the SSE handler writes. **Zero React re-renders per frame.** Paused when the tab is hidden (`document.visibilityState`) and when `prefers-reduced-motion` is set.

### Tier 3 — collapsible detail

**Database.** Pool gauge (a single stacked bar: active / idle / waiting, one hue at three lightness steps, with direct labels). Cache hit ratio, index hit ratio, longest running transaction, deadlock count, and a **slow-query list** (statement shape, duration, count) captured from a Prisma `$on('query')` hook above a 200 ms threshold. Table row counts come from `pg_class.reltuples` — an estimate, labelled as one.

**Client activity.** A live presence list: role, current route, seconds since last action. **Never a name, never an IP, never a location** — the ops view answers "what is the system doing", not "what is Priya doing". Plus a concurrent-sessions line for the last 15 minutes with the peak marked, and a rolling activity stream of the last 20 audit-visible business events (*"Payrun computed · 5,000 payslips · 21.4 s"*).

**Endpoints.** Top 12 routes by traffic: method, path, count, p50, p95, error rate, and a 60-second sparkline per row. Sortable. A table, not a chart — twelve series on one plot would violate the categorical cap and be unreadable.

**Jobs and queue.** Queued / running / failed by job type, throughput per minute, oldest queued age, and the retry backlog. A failed job is expandable to its error and a **Retry** action.

**Network.** Open SSE connections, bytes in/out per second, average response size, compression ratio, 304 rate, and rate-limit rejections.

**Payroll engine** (the domain panel that makes the scale claim visible). Live compute progress `3,412 / 5,000 payslips · 214 slips/s · ~7 s remaining`, last compute duration, payslips per second, and decimal operations per compute. During the demo this panel is what proves 5,000 employees is real rather than asserted.

**Dependencies.** Postgres, SMTP, PDF worker, disk: up/down with last probe latency, from `GET /health`. A degraded dependency raises a banner on the main app too, so the failure mode is honest.

## 11.4 Data pipeline

```
Express middleware ─┐
Prisma $on(query)  ─┼─▶ MetricsRegistry (in-process)
Job worker hooks   ─┤     · counters, gauges
Session tracker    ─┘     · fixed-bucket histograms (p50/p95/p99)
                          · 300-slot ring buffers (5 min @ 1 Hz)
                                    │
                          1 Hz snapshot (ONE object)
                                    │
                    ┌───────────────┴───────────────┐
              GET /ops/stream (SSE)          MetricSample table
              broadcast to N subscribers      (1-min rollup, 24 h)
```

- **One snapshot serves all subscribers.** A single `setInterval` builds the object; every connected client receives the same serialized payload. Adding viewers costs a `res.write`, not a computation.
- **Self-limiting:** if subscribers exceed 10, the interval drops to 0.5 Hz. The ops dashboard must never become the load.
- **Bounded memory:** ring buffers are pre-allocated typed arrays; the slow-query list keeps the worst 20; the presence map evicts after 90 s idle.
- **Overhead budget:** < 1% CPU and < 8 MB. Asserted by a benchmark comparing throughput with metrics on and off; if collection costs more than 2%, buckets get coarser.
- `GET /metrics` also exposes the same registry in Prometheus text format — free credibility, zero extra infrastructure.

## 11.5 Colour and chart specification

The dashboard inherits the product's light-only token system. Encoding rules:

| Job | Encoding |
|---|---|
| Magnitude (latency, throughput, counts) | **One hue** — brand `#2274A5`. Sparklines are 2 px lines, no fill, no gradient |
| Parts of one quantity (pool active/idle/waiting) | **Sequential ramp**, one hue at three monotonic lightness steps: `#2274A5` → `#6DA2C2` → `#B7D3E4`. Direct labels required — the two lighter steps sit below 3:1 against the surface |
| State (healthy / warn / critical) | **Reserved status palette**, always with an icon **and** a text label |
| Identity (≤ 4 series) | `#2274A5` · `#0F7B3D` · `#D97706` · `#B91C1C`, assigned in fixed order, never cycled. A fifth series folds into "Other" or becomes small multiples |

**Validated finding — act on this.** The status trio was run through the palette validator. The product's existing `--warning #D97706` and `--danger #DC2626` fail the normal-vision separation floor when used as **adjacent chart marks** (ΔE 14.4, floor 15) — full-colour readers cannot reliably tell a gold bar from a red bar. Fix: introduce a chart-only token **`--danger-mark: #B91C1C`**. With it the set passes every check (worst adjacent CVD ΔE 16.2, normal-vision 18.8, all ≥ 3:1 contrast). `#DC2626` stays as-is for text, chips and borders, where it is never adjacent to gold as a mark. The four-slot identity set above also passes as a set; the green↔gold pair sits at the CVD floor, so those two always carry icon and direct label.

Chart mechanics, applied everywhere on this screen and in the product's reports:

- Sparklines: 2 px stroke, no axis, no grid, last value direct-labelled, hover and keyboard focus both reveal a crosshair with the timestamp and exact value.
- Bars: 4 px rounded data-end anchored to the baseline, 2 px surface gap between adjacent fills.
- Every chart has a **table view** toggle exposing the same numbers, which also satisfies the contrast relief rule for the light ramp steps.
- Zero-data renders a labelled empty panel (*"No requests in the last 60 s"*), never a collapsed axis or `NaN`.
- Tooltips carry units and are clamped inside the viewport.

## 11.6 Demo instrumentation

`npm run demo:load` starts a small Node load generator against the API with a realistic mix (60% list reads, 20% detail reads, 10% reports, 5% mutations, 5% search) at a configurable rate, with `--spike` and `--fail` modes.

This is the highest-leverage 60 seconds of the presentation: open `/ops`, start the generator, and the reviewer watches the flow ribbon thicken, p95 rise, the pool fill, and concurrent sessions climb — then trigger a payrun compute of 5,000 employees and watch the engine panel stream through it. The architecture stops being a slide and becomes something visibly happening.

## 11.7 Acceptance criteria

1. Every number on the screen traces to a real measurement; there is no synthetic data path in the ops module.
2. With 10 concurrent dashboard viewers, added server CPU is under 2% and the snapshot is computed once per tick.
3. The ops route returns 403 for all four non-Admin roles (test).
4. No employee name, email, IP or geographic location appears in any ops payload (asserted by scanning the SSE payload schema in a test).
5. With `prefers-reduced-motion` set, no element animates and every value is still legible and updating.
6. Killing Postgres turns the dependency tile critical, raises the degraded banner in the main app, and the dashboard keeps rendering from its last snapshot rather than crashing.
7. The palette validator passes for every colour set used on the screen, and the check runs in CI.
