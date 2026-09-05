# 3. Scale, concurrency and performance design

The requirement is **5,000 records across multiple users, many users simultaneously**. Fix that into concrete numbers before designing anything.

## 3.1 Design envelope

| Dimension | Demo dataset | Scale dataset (`--size=scale`) | Notes |
|---|---|---|---|
| Employees | 42 | **5,000** | Primary "5,000 records" target |
| Contracts (incl. history) | 60 | 7,500 | ~1.5 per employee |
| Attendance rows | 900 | **1,320,000 / year** | 5,000 x 22 x 12 |
| Leave requests | 40 | 25,000 / year | 5 per employee |
| Leave allocations | 120 | 20,000 | 4 types per employee |
| Payslips | 84 | **60,000 / year** | 5,000 x 12 |
| Payslip lines | 600 | **480,000 / year** | ~8 rules per payslip |
| Audit events | 200 | 250,000 | |
| Documents | 30 | 15,000 | |
| Concurrent authenticated users | 5 | **100** | 20 rps steady, 200 rps burst |

**Performance budgets** (p95, scale dataset, on a laptop-class Docker Postgres):

| Operation | Budget |
|---|---|
| Any list page (25 rows, filtered, sorted) | < 150 ms server |
| Employee detail hub with related counts | < 200 ms |
| Dashboard / report screen (all KPIs + 4 charts) | < 300 ms |
| Compute payrun, 5,000 employees | < 25 s, streamed progress |
| Single payslip PDF | < 400 ms |
| Bulk payslip delivery, 5,000 | background job, > 40/s |
| Interaction to Next Paint on hot paths | < 200 ms |

These go into `e2e/perf.spec.ts` and fail the build if regressed by more than 30%.

## 3.2 The nine rules that make it hold

### R1 — Never load a collection to count or sum it

Every aggregate is SQL. Examples:

```ts
// department headcount
prisma.employee.groupBy({ by: ['departmentId'], _count: { _all: true }, where: { status: 'ACTIVE' } })

// salary cost by department for a payrun — one query, not 5,000
prisma.$queryRaw`
  SELECT c."departmentId", SUM(p."net")::numeric(18,2) AS net, COUNT(*) AS slips
  FROM "Payslip" p
  JOIN "Contract" c ON c.id = p."contractId"
  WHERE p."payrunId" = ${payrunId} AND p."isDuplicate" = false
  GROUP BY c."departmentId"`
```

Ban list enforced by review: `findMany()` without `take`, `.length` on a Prisma result used as a KPI, `reduce` over a full table.

### R2 — Keyset pagination for anything that can exceed 1,000 rows

Offset pagination degrades linearly. Use a stable composite cursor.

```ts
// GET /api/employees?limit=25&cursor=<base64 of {sortValue,id}>
where: { ...filters, OR: [{ lastName: { gt: c.sortValue } },
                          { lastName: c.sortValue, id: { gt: c.id } }] },
orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
take: limit + 1        // +1 tells us hasNextPage without a count query
```

Total counts are expensive at scale: return an **estimated** total from `pg_class.reltuples` when unfiltered, an exact `count` only when filters are selective (< 10k estimated). The UI shows "about 5,000" vs "312" accordingly — honest, not fake.

### R3 — Indexes are part of every migration

Minimum index set (all in `schema.prisma`):

```
Employee        @@index([departmentId, status]) @@index([managerId]) @@index([lastName, id])
                @@unique([employeeCode])  @@unique([email])
Contract        @@index([employeeId, startDate, endDate]) @@index([status, endDate])
Attendance      @@unique([employeeId, date])  @@index([date, status]) @@index([employeeId, date])
LeaveRequest    @@index([employeeId, status]) @@index([status, fromDate]) @@index([approverId, status])
LeaveAllocation @@unique([employeeId, leaveTypeId, validFrom])
Payslip         @@unique([payrunId, employeeId])   // duplicate prevention, DB-level
                @@index([employeeId, periodStart]) @@index([payrunId, status])
PayslipLine     @@index([payslipId, sequence])
Payrun          @@unique([periodStart, structureId]) @@index([status, periodStart])
AuditEvent      @@index([entityType, entityId, createdAt]) @@index([actorId, createdAt])
Job             @@index([status, runAfter])
Notification    @@index([userId, readAt, createdAt])
```

Partial index for the hot path (raw SQL migration):

```sql
CREATE INDEX attendance_open_checkin ON "Attendance" ("employeeId", "date")
  WHERE "checkOut" IS NULL;
CREATE INDEX payrun_open ON "Payrun" ("periodStart") WHERE "status" <> 'PAID';
```

### R4 — Reports read rollups, not fact tables

A dashboard that scans 480,000 payslip lines per page-load will die. After any payrun status transition, and nightly, a job refreshes:

```
PayrollRollup(periodStart, departmentId, employeeType,
              headcount, grossTotal, deductionTotal, netTotal,
              payslipCount, avgNet, computedAt)
AttendanceRollup(date, departmentId, present, late, absent,
                 missingCheckout, overtimeMinutes)
LeaveRollup(periodStart, departmentId, leaveTypeId, daysApproved, daysPending)
```

Cardinality: 12 periods x 8 departments x 3 employee types = ~288 rows/year. Every report KPI and chart is then a sub-10 ms indexed read. Drill-down ("show me the contributing payslips") queries the fact tables **with a filter and a limit**, on demand only.

Rollups carry `computedAt`; the UI shows "as of 14:32" and a Refresh action rather than pretending they are live. Payrun mutations invalidate synchronously for the affected period so the demo never shows a stale number.

### R5 — Heavy work leaves the request path

A Postgres-backed queue. No Redis (excluded by doctrine), no extra process.

```sql
-- claim loop, safe with N workers
UPDATE "Job" SET status='RUNNING', "startedAt"=now(), "attempts"="attempts"+1
WHERE id = (SELECT id FROM "Job"
            WHERE status='QUEUED' AND "runAfter" <= now()
            ORDER BY priority DESC, "runAfter"
            FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

Job types: `PAYRUN_COMPUTE`, `PAYSLIP_PDF`, `PAYSLIP_DELIVER`, `ROLLUP_REFRESH`, `BULK_IMPORT`, `REPORT_EXPORT`, `DOC_GENERATE`, `AUTOPILOT_PREFLIGHT`.
Guarantees: at-least-once, exponential backoff (`2^attempts` minutes, max 5 attempts), dead-letter status `FAILED` with the error retained, handlers idempotent by `(jobType, dedupeKey)`.

### R6 — Payrun compute is chunked, locked and observable

```
computePayrun(payrunId):
  pg_advisory_xact_lock(hashtext(payrunId))      # one computer at a time, cluster-wide
  load structure + rules once                     # not per employee
  load contracts for period in ONE query          # not per employee
  load attendance aggregates in ONE groupBy       # not per employee
  load approved leave overlapping period in ONE query
  for chunk of 500 employeeIds:
      build contexts in memory (pure)
      evaluate rules (pure, decimal.js)
      prisma.$transaction([deleteMany lines, createMany slips, createMany lines])
      job.progress = done/total  -> SSE to the UI progress bar
  recompute blockers + readiness
  refresh rollups for the period
  audit COMPUTE with input snapshot hash
```

Loading inputs in 4 queries instead of 4 x 5,000 is the entire difference between 25 seconds and 20 minutes. `createMany` batches at 1,000 rows. Progress streams so the operator sees `3,000 / 5,000 payslips — 41s remaining` rather than a frozen button.

### R7 — Correct under concurrent users

| Race | Defence |
|---|---|
| Two managers validate the same payrun | `pg_advisory_xact_lock` on payrunId + status precondition inside the transaction |
| Two approvers approve the same leave request | Single-statement conditional update; second gets 409 |
| Leave allocation over-consumption | `UPDATE "LeaveAllocation" SET used = used + $days WHERE id=$1 AND used + $days <= allocated RETURNING *` — zero rows means "insufficient balance", atomic, no read-modify-write |
| Stale edit overwrites a colleague | `version Int` optimistic-concurrency column on Employee, Contract, Payrun, SalaryRule. Mismatch returns 409 with the current record; UI shows a "changed by Priya 2 min ago — review differences" merge panel |
| Double-click / retried POST | `Idempotency-Key` header, unique constraint on `(userId, key)`, replay returns the stored response. Client sends a UUID per submit; buttons also disable while pending |
| Two overlapping active contracts created simultaneously | Overlap check inside a transaction plus an exclusion constraint |

```sql
ALTER TABLE "Contract" ADD CONSTRAINT contract_no_overlap
  EXCLUDE USING gist (
    "employeeId" WITH =,
    daterange("startDate", COALESCE("endDate",'infinity'::date), '[]') WITH &&
  ) WHERE (status = 'ACTIVE');
```

The database, not the service layer, is the last line of defence for every payroll invariant.

### R8 — Connections and back-pressure

- Prisma `connection_limit = 15` per instance (`num_cpus * 2 + 1`), `pool_timeout = 10`.
- Postgres `max_connections = 100`; PgBouncer is documented as the scale-out step but not run in the hackathon.
- Rate limits: 300 req/min per session on reads, 60/min on mutations, 5/min on login (per IP + per account), 2 concurrent compute jobs per instance.
- Request timeout 15 s; long operations must be jobs, not slow requests.
- Graceful shutdown drains in-flight requests and marks running jobs `QUEUED` again.

### R9 — The frontend does not undo the backend's work

- **Targeted invalidation.** Query keys are structured `['payrun', id, 'blockers']`; mutations invalidate the narrowest key that changed. Never `queryClient.invalidateQueries()` with no key.
- **Virtualize above 200 rows** only (TanStack Virtual). Below that, virtualization costs more than it saves.
- **Debounce server search** 250 ms; `keepPreviousData` so tables do not flash empty.
- **Charts memoized** on their data reference; the ops dashboard draws to canvas outside React.
- **Route-level code splitting**; reports, ops and PDF preview are lazy chunks.
- **Optimistic UI only where rollback is safe** (notification read, row selection, draft edits). Never for compute, validate, pay or approve.

## 3.3 Verification

`npm run bench` runs, against the scale seed:

1. `autocannon` on the 10 hottest endpoints at 100 concurrent connections, asserting p95 budgets from 3.1.
2. A Vitest integration test computing a 5,000-employee payrun and asserting wall-clock < 25 s and exactly 5,000 payslips.
3. A concurrency test firing 50 simultaneous approvals of the same leave request, asserting exactly one success and 49 conflicts, with the allocation decremented exactly once.
4. `EXPLAIN ANALYZE` snapshots for the 6 heaviest queries committed to `plan/perf/` so regressions are visible in review.
