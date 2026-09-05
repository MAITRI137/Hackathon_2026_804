# PeoplePay360 — Master Implementation Plan

> **Status:** authoritative build contract. Supersedes ad-hoc task lists.
> **Governing docs:** `SKILL.md` (doctrine), `references/requirements.md` (scope catalog), `checklists/release-gates.md` (exit criteria).
> **Target:** Odoo Hackathon win — 100% official scope + every good-to-have + 10 automation multipliers + an operations dashboard that proves the engineering.

---

## 0. How to use this plan

| Section | Purpose | Primary consumer |
|---|---|---|
| 1 | Product thesis, win condition | Everyone |
| 2 | Architecture, repo layout, stack | Backend + frontend leads |
| 3 | Scale & concurrency design (5,000 records, many users) | Backend lead |
| 4 | Complete data model | Backend lead |
| 5 | Payroll engine specification | Backend lead |
| 6 | Security, RBAC, privacy matrix | Backend lead |
| 7 | Full API catalog | Both |
| 8 | Frontend architecture & design system | Frontend lead |
| 9 | Feature backlog — every requirement, mapped | Everyone |
| 10 | Y01–Y10 automation multipliers | Product + both leads |
| 11 | Live Ops Dashboard (server / DB / network / client) | Platform |
| 12 | Testing, seeding, determinism | QA |
| 13 | Execution timeline by gate | PM |
| 14 | Demo script | Presenter |
| 15 | Risk register | PM |

**Status vocabulary** (use in `plan/feature-matrix.csv`, nothing else):
`NOT_STARTED` → `PARTIAL` → `IMPLEMENTED` → `VERIFIED`.
`VERIFIED` requires an automated test **and** a manual exercise against seeded persisted data.

**Definition of done for any ticket**

1. Server-side validation (Zod) and an authorization check at the route.
2. Prisma access with explicit `select`, no N+1.
3. Unit or integration test.
4. UI surface with loading / empty / error / permission-denied states.
5. Audit entry when the action is privileged or salary-affecting.
6. No dead control, no fake toast, no hardcoded business number.

---

## 1. Product thesis

> Turn employee, contract, attendance, leave and salary-policy data into correct payroll with minimal operator effort, block invalid payroll before money moves, and explain every rupee from source record to final payslip.

Three claims the demo must physically prove:

1. **Correctness you can audit** — decimal money, ordered rules, provenance per line, immutable paid history.
2. **Operator speed** — exception-first payroll control room, next-best-action, command launcher, batch review, one-action approvals.
3. **Engineering credibility** — a 5,000-employee dataset computing in seconds, and a live ops dashboard showing the system actually working under load.

Anti-goals (do not build): microservices, Kafka, Redis, blockchain, face recognition, an accounting suite, native mobile, a generic AI chatbot, a custom expression compiler, a generalized workflow engine, a multi-country tax engine, Kubernetes.

---

## 2. Architecture

### 2.1 Shape

A **modular monolith**: one deployable Node process serving a JSON API plus an in-process job worker, and one static Vite/React bundle. Modules are enforced by folder boundaries and a lint rule, not by network hops.

```
Browser (React SPA)
   |  HTTPS, HttpOnly session cookie, SameSite=Lax
   v
Express API  -> metrics middleware -> Zod validation -> RBAC guard -> service layer
   |                                                        |
   |                                                        +-- payroll engine (decimal.js + restricted mathjs)
   |                                                        +-- pdf service (pdf-lib)
   |                                                        +-- mail service (nodemailer -> outbox fallback)
   |                                                        +-- job worker (pg queue, FOR UPDATE SKIP LOCKED)
   v
Prisma -> PostgreSQL 16   (NUMERIC(18,2) money, rollup tables, advisory locks)
```

### 2.2 Repository layout

```
peoplepay360/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed/
│     ├─ seed.ts              # deterministic, --size=demo|scale
│     ├─ factories.ts         # seeded RNG (mulberry32), never Math.random
│     └─ datasets/            # names, departments, holiday calendar
├─ server/
│  ├─ index.ts                # bootstrap, graceful shutdown
│  ├─ app.ts                  # express wiring
│  ├─ env.ts                  # Zod-validated process env
│  ├─ core/
│  │  ├─ auth/                # session, argon2, csrf, rate limit
│  │  ├─ rbac/                # permission matrix + guard middleware
│  │  ├─ money/               # Money value object (decimal.js)
│  │  ├─ audit/               # audit writer
│  │  ├─ idempotency/         # Idempotency-Key store
│  │  ├─ jobs/                # queue, worker loop, handler registry
│  │  ├─ metrics/             # registry, histograms, ring buffers
│  │  ├─ errors/              # AppError taxonomy -> HTTP mapping
│  │  └─ http/                # asyncHandler, pagination, etag helpers
│  ├─ modules/
│  │  ├─ employees/ contracts/ schedules/ attendance/ timeoff/
│  │  ├─ salary/ payruns/ payslips/ documents/
│  │  ├─ approvals/ reports/ notifications/ admin/ ops/
│  │  └─ each: router.ts, service.ts, repo.ts, schema.ts, policy.ts, *.test.ts
│  └─ payroll/
│     ├─ engine.ts            # rule evaluation
│     ├─ formula.ts           # restricted AST evaluator
│     ├─ context.ts           # input snapshot builder
│     ├─ readiness.ts         # blockers + score
│     └─ engine.test.ts
├─ web/
│  ├─ src/
│  │  ├─ app/                 # router, providers, layout shell
│  │  ├─ design/              # tokens.css, primitives (Button, Select, ...)
│  │  ├─ features/            # one folder per module, mirrors server
│  │  ├─ lib/                 # api client, query keys, formatters, hooks
│  │  └─ ops/                 # live ops dashboard
│  └─ vite.config.ts
├─ e2e/                       # Playwright specs per gate
├─ docker-compose.yml
└─ package.json               # npm workspaces: server, web
```

**Boundary rule:** `modules/a` may import `core/*` and `payroll/*`, never `modules/b/service`. Cross-module reads go through a thin published interface in `modules/b/index.ts`. Enforced by `eslint-plugin-boundaries`.

### 2.3 Pinned stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 20.19+ (24 OK), TypeScript strict | Matches the environment already installed |
| API | Express 4 + Zod | Simple, boring, testable |
| ORM | Prisma 5 | Migrations, type-safety, `$queryRaw` escape hatch |
| DB | PostgreSQL 16 (Docker) | NUMERIC, CTEs, advisory locks, SKIP LOCKED |
| Money | decimal.js + `NUMERIC(18,2)` | Zero float in the money path |
| Formula | mathjs `limitedEvaluate` + allowlisted scope | No arbitrary code, no custom compiler |
| Auth | express-session + connect-pg-simple, argon2id | HttpOnly server session |
| PDF | pdf-lib | Deterministic, no headless browser |
| Mail | nodemailer + persisted outbox fallback | Works with the internet off |
| Frontend | React 18, Vite, React Router 6, TanStack Query 5 | Standard |
| Tables | TanStack Table + TanStack Virtual (>200 rows only) | Dense data |
| Forms | React Hook Form + Zod resolver (schemas shared with server) | One source of truth |
| Charts | Recharts (reports) + hand-rolled canvas sparklines (ops) | Recharts is too heavy at 1 Hz |
| Motion | Framer Motion, purposeful only | Per doctrine |
| Icons | lucide-react | Mandated |
| Toasts | Sonner | Mandated |
| Tests | Vitest + Supertest + Playwright | Mandated |

### 2.4 Shared types

Prisma types plus Zod schemas live in `server/modules/*/schema.ts` and are re-exported through `server/contracts.ts`, consumed by `web` via a TypeScript path alias. No code-generation step and no OpenAPI ceremony — one import boundary.

### 2.5 Money on the wire

Money is **always** a decimal string in JSON (`"55000.00"`), never a number. `web/lib/money.ts` wraps it in a `Money` type with `format(locale)`, `add`, `sub`. A lint rule bans `parseFloat` on any field matching `amount|wage|net|gross|salary`.
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
# 4. Data model

All money is `Decimal @db.Decimal(18,2)`. All dates that represent a calendar day are `@db.Date`. All instants are `DateTime @db.Timestamptz(3)`. Every mutable business entity carries `createdAt`, `updatedAt`, and where noted `version Int @default(0)` for optimistic concurrency.

## 4.1 Entity catalog

### Identity and access

| Model | Key fields | Notes |
|---|---|---|
| `User` | `id, email @unique, passwordHash, role, employeeId?, isActive, lastLoginAt, failedAttempts, lockedUntil` | argon2id hash. `employeeId` links a login to a person; Admin may have none. |
| `Session` | managed by `connect-pg-simple` | HttpOnly cookie, 8 h idle / 12 h absolute. |
| `Role` | enum `EMPLOYEE \| HR_MANAGER \| HR_PAYROLL_USER \| HR_PAYROLL_MANAGER \| ADMIN` | Server-side matrix in §6. |
| `AuditEvent` | `id, actorId, actorRole, action, entityType, entityId, summary, before Json?, after Json?, ip, createdAt` | Append-only. No deletes, no updates. |
| `IdempotencyKey` | `userId, key, requestHash, responseStatus, responseBody Json, createdAt` `@@unique([userId,key])` | 24 h TTL sweep. |

### Organization

| Model | Key fields | Notes |
|---|---|---|
| `Department` | `id, name @unique, code, colorToken, managerId?, parentId?, monthlyBudget Decimal?` | `parentId` gives the org hierarchy (F: organization hierarchy). |
| `JobPosition` | `id, title, departmentId?, level` | |
| `WorkingSchedule` | `id, name, timezone, hoursPerWeek (computed, stored), isActive` | |
| `ScheduleLine` | `scheduleId, dayOfWeek 0-6, startTime, endTime, breakMinutes` | Weekly hours = sum of (end-start-break); recomputed on write, never trusted from the client. |
| `HolidayCalendar` / `Holiday` | `id, name, date, isOptional, appliesToDepartmentIds[]` | Feeds expected-days and leave-day counting. |

### People

| Model | Key fields | Notes |
|---|---|---|
| `Employee` | `id, employeeCode @unique, firstName, lastName, email @unique, phone, dateOfBirth, joinDate, exitDate?, status (ACTIVE\|PROBATION\|NOTICE\|EXITED\|ARCHIVED), employeeType (FULL_TIME\|PART_TIME\|CONTRACT\|INTERN), departmentId, jobPositionId, managerId?, probationEndDate?, version` | `status` is derived-assisted but stored; transitions audited. |
| `EmployeeBankDetail` | `employeeId @unique, accountName, accountNumberEnc, ifsc, bankName, verifiedAt?, verifiedById?` | Account number encrypted at rest (AES-256-GCM, key from env); API returns a masked value only. Powers the "missing bank details" blocker. |
| `EmployeeIdentity` | `employeeId, panMasked, uanMasked, ...` | Optional, drives onboarding completeness. |
| `EmployeeTimelineEvent` | `employeeId, type, occurredAt, title, detail, sourceEntityType, sourceEntityId` | Materialized from audit + domain events for the F "employee timeline". |
| `ProfileChangeRequest` | `id, employeeId, field, currentValue, requestedValue, status, requestedById, decidedById?, decidedAt?, reason?` | Self-service change flow, routes to Approval Inbox. |
| `Document` | `id, employeeId?, contractId?, category, fileName, mimeType, sizeBytes, storagePath, visibility (SELF\|HR\|PAYROLL\|ADMIN), uploadedById, acknowledgedAt?` | Local disk in `/data/documents`, never web-root. Access checked per request. |
| `ChecklistTemplate` / `ChecklistInstance` / `ChecklistItem` | `type (ONBOARDING\|OFFBOARDING), items[], ownerRole, dueOffsetDays, blocksPayroll bool` | Y10. |

### Contracts

| Model | Key fields |
|---|---|
| `Contract` | `id, contractRef @unique, employeeId, startDate, endDate?, departmentId, jobPositionId, employeeType, wage Decimal, salaryStructureId, workingScheduleId, status (DRAFT\|ACTIVE\|EXPIRED\|TERMINATED), notes, version` |

Rules enforced in the DB and the service:
- GiST exclusion constraint prevents overlapping `ACTIVE` contracts per employee (§3.2 R7).
- `resolveContract(employeeId, periodStart, periodEnd)` returns exactly one contract or throws `AmbiguousContractError` / `NoContractError` — both surface as payroll blockers, never as silent defaults.
- Historical payroll always reads the contract that was applicable to the historical period, not the current one.

### Time

| Model | Key fields | Notes |
|---|---|---|
| `Attendance` | `id, employeeId, date, checkIn?, checkOut?, workedMinutes (derived, stored), status (PRESENT\|LATE\|EARLY_EXIT\|ABSENT\|MISSING_CHECKOUT\|OVERTIME\|HOLIDAY\|WEEKLY_OFF), source (SELF\|MANAGER\|IMPORT\|SYSTEM), correctionReason?, correctedById?` `@@unique([employeeId,date])` | `workedMinutes` recomputed server-side from timestamps on every write. |
| `LeaveType` | `id, name, code, unit (DAY\|HALF_DAY\|HOUR), isPaid, requiresAllocation, allowNegativeBalance, carryForwardMax, accrualPerMonth, color` | |
| `LeaveAllocation` | `id, employeeId, leaveTypeId, allocated Decimal(6,2), used Decimal(6,2), validFrom, validTo, carriedForward Decimal(6,2)` `@@unique([employeeId,leaveTypeId,validFrom])` | `used` mutated only by the atomic statement in §3.2 R7. |
| `LeaveRequest` | `id, employeeId, leaveTypeId, fromDate, toDate, halfDayStart bool, halfDayEnd bool, days Decimal(5,2) (computed server-side), reason, status (DRAFT\|PENDING\|APPROVED\|REFUSED\|CANCELLED), approverId?, decidedAt?, decisionNote?, allocationId?, version` | `days` excludes weekly-offs and holidays from the employee's schedule + calendar. |

### Salary configuration

| Model | Key fields |
|---|---|
| `SalaryStructure` | `id, name, code @unique, isActive, description, version Int` |
| `SalaryRule` | `id, structureId, code, name, category (BASIC\|ALLOWANCES\|GROSS\|DEDUCTIONS\|NET), sequence Int, type (FIXED\|PERCENTAGE\|FORMULA), amount Decimal?, percentage Decimal?, baseCode?, formula String?, conditionFormula String?, isActive, ruleVersion Int` `@@unique([structureId, code, ruleVersion])` |

Rules are **versioned, never mutated in place** once used by a computed payslip: editing an active rule creates `ruleVersion + 1` and leaves history intact. This is what makes the Explainable Payslip honest a month later.

### Payroll

| Model | Key fields |
|---|---|
| `Payrun` | `id, name, periodStart, periodEnd, salaryStructureId, status (DRAFT\|COMPUTED\|VALIDATED\|PAID), isFrozen, frozenAt?, reopenReason?, reopenedById?, expectedWorkDays Int, computedAt?, validatedAt?, paidAt?, inputSnapshotHash, createdById, version` `@@unique([periodStart, salaryStructureId])` |
| `PayrunEmployee` | `payrunId, employeeId, contractId?, includedAt, excludedAt?, exclusionReason?` `@@unique([payrunId,employeeId])` — the explicit Step-2 selection from the wizard |
| `Payslip` | `id, payslipRef @unique, payrunId, employeeId, contractId, periodStart, periodEnd, structureId, status (DRAFT\|COMPUTED\|VALIDATED\|PAID\|CANCELLED), expectedDays, workedDays Decimal, paidLeaveDays Decimal, unpaidLeaveDays Decimal, overtimeMinutes, gross Decimal, totalDeductions Decimal, net Decimal, inputSnapshot Json, snapshotHash, computedAt` `@@unique([payrunId, employeeId])` |
| `PayslipLine` | `id, payslipId, ruleId, ruleCode, ruleName, ruleVersion, category, sequence, formulaSnapshot, inputsSnapshot Json, sourceRefs Json, amount Decimal` `@@index([payslipId, sequence])` |
| `PayslipDelivery` | `id, payslipId, channel (EMAIL), toAddress, status (PENDING\|QUEUED\|SENT\|FAILED\|BOUNCED), attempts, lastError?, queuedAt, sentAt?` |
| `OutboxMessage` | `id, to, subject, bodyHtml, attachmentPath?, status, error?, createdAt, sentAt?` | Persisted fallback when SMTP is unavailable; viewable in the UI so an offline demo still "sends". |
| `PayrollRollup` / `AttendanceRollup` / `LeaveRollup` | see §3.2 R4 | |
| `BankAdviceFile` | `id, payrunId, generatedAt, rowCount, totalAmount, checksum, storagePath` | Y09. |

### Platform

| Model | Key fields |
|---|---|
| `Job` | `id, type, payload Json, dedupeKey?, status (QUEUED\|RUNNING\|DONE\|FAILED), priority, attempts, maxAttempts, runAfter, progress Int, total Int, error?, startedAt?, finishedAt?` `@@unique([type, dedupeKey])` |
| `Notification` | `id, userId, kind, title, body, entityType?, entityId?, severity, readAt?, createdAt` |
| `SavedView` | `id, ownerId, module, name, filters Json, columns Json, isShared, sharedWithRole?` |
| `ReportSubscription` | `id, savedViewId, ownerId, cadence (MONTHLY\|WEEKLY\|ON_PAYRUN_PAID), format (CSV\|PDF), lastSentAt?` |
| `AppSetting` | `key @unique, value Json, updatedById, updatedAt` | Only settings that genuinely change behaviour exist here. |
| `AutomationPolicy` | `id, kind (LEAVE_AUTO_APPROVE \| ATTENDANCE_AUTO_REGULARIZE \| PAYROLL_AUTO_FREEZE), conditions Json, isActive, createdById` | Y03/Y06/Y07. |
| `MetricSample` | `id, capturedAt, payload Json` | 1-minute ops rollups retained 24 h; live data stays in memory. |

## 4.2 Seeding

`npm run db:seed -- --size=demo` (default) and `--size=scale`.

- Deterministic: `mulberry32(20260905)`; the same command always produces byte-identical data. `Math.random` is banned in `prisma/seed`.
- Demo dataset is the **story dataset**: 42 employees, 8 departments, a September 2026 payrun in `COMPUTED` with exactly three seeded blockers (missing bank details, missing checkout, duplicate payslip), three prior `PAID` payruns for trend and month-over-month comparison, one contract expiring in 25 days, one probation ending, one pending salary-change approval.
- Scale dataset layers 5,000 employees and 12 months of attendance on top using `createMany` in 5,000-row chunks; target seed time < 90 s.
- `npm run db:reset` = drop, migrate, seed. The demo is repeatable from zero at any moment.
- Fixed logins, one per role, printed by the seed and shown on the login screen in dev only.
# 5. Payroll engine specification

The engine is a **pure function**. It takes a snapshot, returns lines. It never reads the database and never writes. That is what makes it testable, replayable and honest.

```ts
computePayslip(ctx: PayrollContext): PayslipResult
```

## 5.1 The input snapshot

`buildContext()` (impure, in `payroll/context.ts`) assembles everything the engine may see. Nothing else is in scope.

```ts
type PayrollContext = {
  employee:  { id, code, name, type, departmentId, joinDate, exitDate }
  contract:  { id, ref, wage: Decimal, structureId, scheduleId, startDate, endDate }
  period:    { start, end, expectedDays, calendarDays }
  schedule:  { hoursPerWeek, workingDays: number[] }
  attendance:{ presentDays, lateDays, absentDays, workedMinutes, overtimeMinutes }
  leave:     { paidDays, unpaidDays, halfDays, byType: Record<code, days> }
  rules:     RuleSnapshot[]        // ordered by sequence, version-pinned
  constants: { HOLIDAYS, PERIOD_WORKING_DAYS }
}
```

`snapshotHash = sha256(canonicalJson(ctx))` is stored on the payslip. Recomputing with the same inputs must produce the same hash and the same money — asserted by a test. If the hash changes between compute and validate, the UI says *"inputs changed since compute — recompute required"* instead of silently paying a stale number.

## 5.2 Rule evaluation

```
result = {}
for rule of rules.sortBy(sequence):          # ascending, deterministic tie-break on code
    if rule.conditionFormula and not evalBool(rule.conditionFormula, scope): continue
    amount = switch rule.type:
        FIXED      -> D(rule.amount)
        PERCENTAGE -> D(result[rule.baseCode]).times(rule.percentage).div(100)
        FORMULA    -> evalFormula(rule.formula, scope)
    amount = amount.toDecimalPlaces(2, ROUND_HALF_UP)
    result[rule.code] = amount
    lines.push({ ...provenance(rule, scope, amount) })
```

- **Ordering is sequence-driven** (Odoo semantics). Earlier results feed later rules through `scope`. No dependency graph, no compiler.
- **Rounding** is half-up to 2 dp at each rule boundary, once. `GROSS`/`NET` are sums of already-rounded lines, so the payslip always foots exactly. A test asserts `sum(EARNINGS) - sum(DEDUCTIONS) === NET` for every generated payslip in the scale dataset.
- **Categories** map to the payslip layout: `BASIC`/`ALLOWANCES` render as earnings, `DEDUCTIONS` as deductions, `GROSS`/`NET` as totals.

### Restricted formula evaluator

```ts
const limited = mathjs.create(mathjs.all)
limited.import({ import: forbidden, createUnit: forbidden, evaluate: forbidden,
                 parse: forbidden, simplify: forbidden, derivative: forbidden }, { override: true })

const ALLOWED = /^[A-Z_][A-Z0-9_]*$/         // symbols must be rule codes or context constants
evalFormula(src, scope):
  node = limited.parse(src)
  node.traverse(n => {
    if (n.isSymbolNode && !(n.name in scope)) throw new UnknownSymbolError(n.name)
    if (n.isFunctionNode && !FN_ALLOWLIST.has(n.fn.name)) throw new ForbiddenFunctionError()
    if (n.isAssignmentNode || n.isFunctionAssignmentNode) throw new ForbiddenSyntaxError()
  })
  return D(node.evaluate(scope))     // scope is a frozen plain object of Decimals->numbers
```

`FN_ALLOWLIST = { min, max, round, floor, ceil, abs }`. Formula length capped at 500 chars, evaluation wrapped in a 50 ms timeout. Unknown symbols are a **validation error at rule-save time**, surfaced in the Salary Rule Sandbox before the rule can ever touch a payslip.

## 5.3 Provenance — the Explainable Payslip

Every `PayslipLine` persists what the reviewer will ask about:

| Field | Example |
|---|---|
| `ruleCode` / `ruleName` / `ruleVersion` | `HRA` / House Rent Allowance / v2 |
| `sequence` / `category` | 20 / ALLOWANCES |
| `formulaSnapshot` | `BASIC * 0.20` |
| `inputsSnapshot` | `{ "BASIC": "55000.00" }` |
| `sourceRefs` | `[{type:'CONTRACT', id:'ct_…', label:'CT-202'}, {type:'RULE', id:'sr_…', label:'HRA v2'}]` |
| `amount` | `11000.00` |

The UI renders this as **result → rule → formula → inputs → source**, with each source ref clickable into the Contextual Sidecar. The snapshot hash lives in a collapsed "technical details" row, not in the business surface.

## 5.4 Payrun state machine

```
DRAFT ──compute──▶ COMPUTED ──validate──▶ VALIDATED ──markPaid──▶ PAID
  ▲                    │                                              │
  └──── recompute ─────┘                                              │
                       └──── reopen(reason, ADMIN|PAYROLL_MANAGER) ◀──┘  (audited, only if enabled)
```

Guards, enforced server-side inside the transaction:

| Transition | Preconditions |
|---|---|
| `compute` / `recompute` | status ∈ {DRAFT, COMPUTED}; not frozen (or caller confirms unfreeze); ≥1 selected employee |
| `validate` | status = COMPUTED; **zero blocking exceptions**; snapshot hash unchanged since compute; role has `payrun.validate` |
| `markPaid` | status = VALIDATED; role has `payrun.pay` |
| `sendPayslips` | status ∈ {VALIDATED, PAID}; enqueues delivery jobs only |
| `reopen` | status = PAID; requires a non-empty reason; creates a correction audit chain; blocked entirely when `payroll.allowReopen = false` |

**Paid immutability:** a Prisma middleware rejects any `update`/`delete` on `Payslip`, `PayslipLine` or `Payrun` where the persisted status is `PAID`, except the delivery fields and an explicit reopen path. A test attempts a direct service-level mutation and asserts it throws.

## 5.5 Blockers and readiness

`payroll/readiness.ts` derives everything; nothing is stored as a magic number.

| Blocker | Detection | Severity | Blocking? |
|---|---|---|---|
| `MISSING_BANK` | employee in payrun without verified bank detail | 5 | yes |
| `NO_CONTRACT` | no contract covering the period | 6 | yes |
| `AMBIGUOUS_CONTRACT` | >1 applicable contract | 6 | yes |
| `MISSING_CHECKOUT` | attendance in period with `checkIn` and no `checkOut` | 4 | yes |
| `DUPLICATE_PAYSLIP` | >1 payslip for (employee, period) across payruns | 4 | yes |
| `INVALID_RULE` | rule fails to evaluate for this context | 6 | yes |
| `NEGATIVE_NET` | computed net < 0 | 6 | yes |
| `UNAPPROVED_LEAVE_IN_PERIOD` | pending leave overlapping the period | 2 | warn |
| `CONTRACT_EXPIRING` | contract ends within the period + 30 days | 1 | warn |
| `SALARY_VARIANCE` | net differs from prior period by > threshold (Y02) | 3 | warn |

```
readinessScore = 100 - sum(severity of open BLOCKING exceptions)   # floor 0
categoryScore[c] = passingEmployees(c) / totalEmployees            # for the breakdown bars
```

Both are derived on read from the same query. Resolving a blocker mutates the underlying record (bank detail verified, attendance checkout written, duplicate payslip cancelled) — never a `resolved = true` flag. The next readiness read then simply does not find it. A test asserts that after resolving all three seeded blockers the score is exactly 100, `validate` becomes permitted, and the next-best action changes.

## 5.6 Next-Best-Action engine (X05)

A pure, ordered rule list evaluated against a small state summary. First match wins; each carries `reason` and `deepLink`.

```
1. blocking exceptions > 0            -> "Resolve N payroll exceptions"        /payroll/exceptions
2. payrun DRAFT, employees selected   -> "Compute September payroll"           /payroll/:id
3. payrun COMPUTED, 0 blockers        -> "Validate September payroll"          /payroll/:id
4. payrun VALIDATED                   -> "Mark payroll paid"                   /payroll/:id
5. payrun PAID, undelivered payslips  -> "Send N payslips"                     /payroll/:id/delivery
6. no payrun for the open period      -> "Create October payroll from September" (X07)
7. pending approvals > 0              -> "Review N approvals"                  /approvals
8. contracts expiring <= 30d          -> "Renew N contracts"                   /contracts?filter=expiring
9. onboarding items overdue           -> "Complete N onboarding tasks"         /employees?filter=onboarding
10. otherwise                          -> "Payroll is on track" + period summary
```

Role-scoped: an HR Manager never receives payrun actions; an Employee's list is `check in/out`, `submit pending timesheet correction`, `acknowledge document`, `request leave`.

---

# 6. Security, RBAC and privacy

## 6.1 Authentication

- Email + password, argon2id (`m=19456, t=2, p=1`).
- `express-session` with `connect-pg-simple`; cookie `httpOnly, sameSite:'lax', secure` in production, rolling 8 h idle expiry, absolute 12 h.
- Login throttling: 5 attempts per account and per IP per 5 minutes, then a 15 minute lock, audited.
- CSRF: `SameSite=Lax` plus an `Origin`/`Referer` check on every state-changing verb; mismatch is a 403 before any handler runs.
- Session fixation prevented by regenerating the session id on login and on role change.
- Logout destroys the server session, not just the cookie.

## 6.2 Permission matrix — the single source of truth

`server/core/rbac/matrix.ts` exports one frozen object. Routers declare `requirePermission('payrun.validate')`. Nothing is authorized by hiding navigation.

| Permission | EMPLOYEE | HR_MANAGER | HR_PAYROLL_USER | HR_PAYROLL_MANAGER | ADMIN |
|---|---|---|---|---|---|
| `employee.read.self` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `employee.read.all` | — | ✔ | ✔ | ✔ | ✔ |
| `employee.write` | — | ✔ | ✔ | ✔ | ✔ |
| `employee.archive` | — | ✔ | — | ✔ | ✔ |
| `contract.read.self` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `contract.read.all` | — | ✔ | ✔ | ✔ | ✔ |
| `contract.write` | — | ✔ | — | ✔ | ✔ |
| `schedule.read` | ✔ (own) | ✔ | ✔ | ✔ | ✔ |
| `schedule.write` | — | ✔ | — | ✔ | ✔ |
| `attendance.read.self` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `attendance.read.all` | — | ✔ | ✔ | ✔ | ✔ |
| `attendance.self.punch` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `attendance.correct` | — | ✔ | ✔ | ✔ | ✔ |
| `timeoff.request.self` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `timeoff.read.all` | — | ✔ | ✔ | ✔ | ✔ |
| `timeoff.approve` | — | ✔ | ✔ | ✔ | ✔ |
| `timeoff.allocate` | — | ✔ | — | ✔ | ✔ |
| `salary.structure.read` | — | — | ✔ | ✔ | ✔ |
| `salary.structure.write` | — | — | — | ✔ | ✔ |
| `salary.rule.write` | — | — | — | ✔ | ✔ |
| `payrun.read` | — | — | ✔ | ✔ | ✔ |
| `payrun.create` | — | — | ✔ | ✔ | ✔ |
| `payrun.compute` | — | — | ✔ | ✔ | ✔ |
| `payrun.validate` | — | — | — | ✔ | ✔ |
| `payrun.pay` | — | — | — | ✔ | ✔ |
| `payrun.reopen` | — | — | — | ✔ | ✔ |
| `payrun.freeze` | — | — | — | ✔ | ✔ |
| `payslip.read.self` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `payslip.read.all` | — | — | ✔ | ✔ | ✔ |
| `payslip.send` | — | — | ✔ | ✔ | ✔ |
| `simulation.run` | — | — | — | ✔ | ✔ |
| `report.hr` (headcount, attendance, leave) | — | ✔ | ✔ | ✔ | ✔ |
| `report.payroll` (salary cost, variance, budget) | — | **—** | ✔ | ✔ | ✔ |
| `report.self` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `document.read.self` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `document.read.all` | — | ✔ | ✔ | ✔ | ✔ |
| `audit.read` | — | — | — | ✔ | ✔ |
| `admin.users` | — | — | — | — | ✔ |
| `admin.settings` | — | — | — | — | ✔ |
| `ops.dashboard` | — | — | — | — | ✔ |

Two entries carry the reviewer's eye and must be tested explicitly: **HR Manager has no payrun administration** and **HR Manager has no confidential payroll analytics**.

## 6.3 Data scoping (IDOR defence)

Permission answers *"may this role do this verb?"*. Scoping answers *"on which rows?"*. Both run, always.

```ts
// every list query passes through this
function scope(user, model) {
  if (user.role === 'EMPLOYEE') return { employeeId: user.employeeId }
  if (user.role === 'HR_MANAGER' && model === 'Payslip') throw new ForbiddenError()
  return {}   // org-wide, for roles that carry the permission
}
// every by-id read re-checks ownership after fetch, before serialization
assertVisible(user, record)
```

A Playwright + Supertest suite (`e2e/privacy.spec.ts`) logs in as the Employee and issues direct API requests for another employee's contract, payslip, attendance, documents and the org report endpoints, asserting `403` on every one. Zero organization-wide salary values may appear in any Employee-role response body — asserted by scanning the JSON, not by looking at the screen.

## 6.4 Other engineering integrity items

- **Zod at every boundary**, including query strings and route params; unknown keys stripped, not ignored.
- **Error taxonomy** → `AppError { code, httpStatus, userMessage, recovery }`. The client renders `userMessage` + `recovery`; stack traces never cross the wire.
- **Audit** written in the same transaction as the mutation for: contract changes, wage changes, rule changes, payrun transitions, approvals, role changes, blocker resolutions, reopen, bulk imports, document access to another employee's file.
- **Uploads**: extension + magic-byte check, 10 MB cap, stored outside web root with a random filename, served through an authorized streaming route.
- **Secrets** from env only, validated at boot by Zod; the process refuses to start with a default session secret in production.
- **Rate limits and idempotency** as specified in §3.2 R8/R7.
# 7. API catalog

Conventions: base `/api`, JSON only, money as decimal strings, list responses `{ data, pageInfo: { nextCursor, hasMore, total?, totalIsEstimate } }`, mutations accept `Idempotency-Key`, every route declares a permission.

## 7.1 Auth and session
```
POST   /auth/login                      {email,password} -> user + permissions[]
POST   /auth/logout
GET    /auth/me                         current user, role, permissions, employeeId
POST   /auth/password                   change own password
```

## 7.2 Employees
```
GET    /employees                       ?q&departmentId&status&employeeType&managerId&sort&cursor&limit&view=list|kanban
POST   /employees                       employee.write
GET    /employees/:id                   detail hub + relatedCounts{contracts,attendance,leave,payslips,documents}
PATCH  /employees/:id                   optimistic concurrency via If-Match version
POST   /employees/:id/archive           soft archive, undoable for 10s (X06)
GET    /employees/:id/timeline          merged domain + audit events
GET    /employees/:id/org-chart         ancestors + direct reports
POST   /employees/bulk/preview          dry-run diff for CSV import (Y04)
POST   /employees/bulk/commit           atomic apply of a previewed import
PATCH  /employees/bulk                  batch field update with preview token (X04)
GET    /employees/:id/checklists        onboarding/offboarding instances (Y10)
```

## 7.3 Contracts
```
GET    /contracts                       ?q&employeeId&status&expiringWithinDays&cursor
POST   /contracts                       overlap-validated; 409 names the conflicting contract
GET    /contracts/:id
PATCH  /contracts/:id
POST   /contracts/:id/terminate         {endDate, reason}
GET    /employees/:id/contracts         full history incl. past/current/upcoming flags
GET    /contracts/resolve               ?employeeId&periodStart&periodEnd -> the applicable contract or a typed conflict error
```

## 7.4 Working schedules
```
GET    /schedules                       includes computed hoursPerWeek and assignedEmployeeCount
POST   /schedules                       lines validated (no overlap, end>start)
GET    /schedules/:id
PATCH  /schedules/:id                   returns consequence preview when employees are assigned (X08)
POST   /schedules/:id/assign            {employeeIds[]} batch assign with preview (X04)
```

## 7.5 Attendance
```
GET    /attendance                      ?employeeId&from&to&status&departmentId&cursor
POST   /attendance/check-in             self; idempotent per (employee, date)
POST   /attendance/check-out            self; computes workedMinutes
POST   /attendance                      manager-created record
PATCH  /attendance/:id                  correction; requires reason; audited
POST   /attendance/bulk-correct         preview + commit (G: bulk corrections)
GET    /attendance/anomalies            ?payrunId|from&to -> late, early exit, missing checkout, excessive hours
GET    /attendance/calendar             ?employeeId|departmentId&month -> per-day status matrix
GET    /attendance/regularization       Y06 proposals
POST   /attendance/regularization/apply Y06 accept one or many
```

## 7.6 Time off
```
GET    /leave-types            POST /leave-types            PATCH /leave-types/:id
GET    /leave-allocations      ?employeeId&leaveTypeId       POST /leave-allocations
POST   /leave-allocations/bulk grant to a department/type with preview
GET    /leave-requests         ?employeeId&status&from&to&departmentId&cursor
POST   /leave-requests         self or on behalf; validates balance, overlap, holidays, half-days
POST   /leave-requests/:id/approve      atomic allocation consumption
POST   /leave-requests/:id/refuse       {note}
POST   /leave-requests/:id/cancel
GET    /leave-requests/:id/preview      X08: balance after, payroll effect, team conflicts
GET    /leave/calendar                  ?departmentId&month -> team calendar + conflict flags
GET    /leave/forecast                  ?employeeId -> projected balance with accrual and carry-forward
GET    /holidays               POST /holidays
```

## 7.7 Salary configuration
```
GET    /salary-structures      POST /salary-structures      PATCH /salary-structures/:id
GET    /salary-structures/:id/rules
POST   /salary-rules           PATCH /salary-rules/:id      (creates ruleVersion+1 when in use)
POST   /salary-rules/validate  parse + symbol check, no persistence
POST   /salary-rules/sandbox   evaluate against a chosen employee, read-only (E: sandbox, X08)
```

## 7.8 Payruns and payslips
```
GET    /payruns                         ?status&periodFrom&periodTo
POST   /payruns/wizard/step1            {periodStart,periodEnd,structureId} -> eligibility preview, NOT persisted
POST   /payruns/wizard/step2            {…step1, employeeIds[]} -> exception preview, NOT persisted
POST   /payruns                         final create; only here does a payrun exist
POST   /payruns/from-previous           X07 clone + diff (added/removed/changed, no old money copied)
GET    /payruns/:id                     header, status, totals, readiness, next action
GET    /payruns/:id/employees           selection with per-employee eligibility
PATCH  /payruns/:id/employees           add/remove before validation (X06 undoable)
POST   /payruns/:id/compute             -> jobId; progress over SSE
POST   /payruns/:id/validate
POST   /payruns/:id/mark-paid
POST   /payruns/:id/freeze              POST /payruns/:id/unfreeze
POST   /payruns/:id/reopen              {reason} audited
GET    /payruns/:id/blockers            grouped, with resolve deep-links
GET    /payruns/:id/readiness           score + category breakdown
GET    /payruns/:id/reconciliation      E: expected vs computed vs paid, variance list
POST   /payruns/:id/send-payslips       enqueues delivery; returns queued count
GET    /payruns/:id/bank-advice         Y09 CSV, checksummed
GET    /payslips                        ?payrunId&employeeId&departmentId&period&cursor
GET    /payslips/:id                    lines with full provenance
GET    /payslips/:id/pdf                streams application/pdf
GET    /payslips/:id/explain/:ruleCode  rule, formula, inputs, source refs
GET    /payslips/:id/compare            vs previous period, reconciled line-by-line
POST   /payslips/:id/cancel             duplicate resolution path
```

## 7.9 Simulation
```
POST   /simulation/run                  {employeeIds|departmentId, adjustments[]} read-only,
                                        reuses the production engine, never persists
POST   /simulation/what-if/increment    across a department/type, returns cost delta + employer cost
```

## 7.10 Approvals, notifications, documents, reports, admin, ops
```
GET    /approvals                       ?type=all|leave|profile|salary&status ; unified inbox
POST   /approvals/:id/decide            {decision, note} single primary action
POST   /approvals/bulk-decide           with affected-record preview (X04)
GET    /notifications                   ?unreadOnly    POST /notifications/read-all
GET    /documents                       ?employeeId&category    POST /documents (multipart)
GET    /documents/:id/download          authorized stream
POST   /documents/generate              Y05 template merge -> PDF -> Document
POST   /documents/:id/acknowledge       employee e-acknowledgement
GET    /reports/summary                 ?period&departmentId&employeeType -> all KPIs in one call
GET    /reports/salary-cost-by-department
GET    /reports/net-salary-trend        ?months=12
GET    /reports/headcount               GET /reports/attendance-health
GET    /reports/leave-summary           GET /reports/salary-distribution
GET    /reports/budget-vs-actual        GET /reports/variance
GET    /reports/:kpi/explain            X05/C: definition, formula, filters, contributing-record count
GET    /reports/:kpi/drilldown          authorized contributing rows, paginated
GET    /reports/export                  ?format=csv|pdf -> job for large exports
GET    /saved-views  POST /saved-views  PATCH/DELETE /saved-views/:id
POST   /report-subscriptions            Y08
GET    /search                          ?q -> role-scoped employees, contracts, payruns, payslips, actions (X01)
GET    /admin/users  POST  PATCH        role assignment, activation
GET    /admin/settings  PATCH           only settings that change behaviour
GET    /audit                           ?entityType&entityId&actorId&from&to&cursor
GET    /ops/snapshot                    admin only
GET    /ops/stream                      admin only, SSE 1 Hz
GET    /health                          liveness + dependency probes
GET    /metrics                         Prometheus text format
```

---

# 8. Frontend architecture

## 8.1 Shell and routing

```
<AuthProvider> <QueryProvider> <PermissionProvider> <ToastProvider>
  AppShell = Sidebar (role-filtered nav) + Topbar (launcher, period, notifications, settings, user)
           + Outlet (workspace) + Sidecar (context panel) + CommandLauncher + Toaster
```

Routes mirror the modules. Every route is wrapped in `<RequirePermission perm="…">` which renders a real **Permission Denied** panel — with the reason and a link to what the user *can* do — rather than a redirect that hides the boundary. Navigation is filtered by the same permission list, so hiding and enforcing come from one source, but hiding is never the enforcement.

## 8.2 Data layer

- **Query keys**: `qk.employees.list(filters)`, `qk.payrun.detail(id)`, `qk.payrun.blockers(id)` … all in `lib/queryKeys.ts`. Nothing constructs a key inline.
- **Invalidation map**: `lib/invalidation.ts` maps mutation → the exact keys it affects. `computePayrun` invalidates `payrun.detail`, `payrun.blockers`, `payslips.list(payrunId)`, `reports.summary(period)` — not the world.
- **SSE hook** `useLiveJob(jobId)` for compute/import/export progress; `useOpsStream()` for the ops dashboard.
- **Offline resilience**: TanStack Query `retry: 2` with exponential backoff; a global banner when `/health` fails; the app remains readable from cache.

## 8.3 Design system

Tokens already established and non-negotiable: light-only, Brand `#2274A5`, Accent `#6DA2C2`, gold warning, restrained green/red, one subtle brand-family background gradient, Lucide icons, tabular numerals for money.

Primitives to build once in `web/src/design/` and use everywhere — no raw `<select>`, no browser-default control:

| Primitive | Notes |
|---|---|
| `Button` | variants primary/secondary/ghost/danger/success, `pending` prop that disables and shows a spinner (double-click protection is a prop, not a per-screen habit) |
| `Select`, `Combobox`, `MultiSelect` | Radix Select/Popover + custom chrome, keyboard-complete, native semantics preserved |
| `DateField`, `DateRangeField` | typed input + calendar popover |
| `Checkbox`, `Radio`, `Switch` | custom visual, real input underneath; radio = outer ring + inner dot |
| `DataTable` | TanStack Table: search, sort, keyset pagination, selection, sticky identity column, row actions ≤3 inline else overflow menu, empty/loading/error slots, virtualized above 200 rows |
| `Chip`, `StatusBadge` | status never conveyed by colour alone — always icon or text too |
| `Sidecar` | the X02 context panel; stacks with the overlay manager |
| `Drawer`, `Modal`, `BottomSheet` | one `OverlayManager` owns the stack; Escape closes the top layer only and restores focus to the trigger |
| `Stepper` | past = check + completed, current = active, future = neutral. Never label a future state complete |
| `ReadinessRing`, `CategoryBars` | animate only on genuine value change |
| `KpiTile` | optional explicit `Why?` control; the tile itself is never a hidden link |
| `Chart` (`BarChart`, `LineChart`, `DonutChart`) | Recharts wrapper: responsive container, hover **and** keyboard-focus tooltips, accessible `<table>` fallback, real units in tooltips (`Engineering — ₹9.80L payroll cost`), empty-state panel at zero data |
| `ConsequencePreview` | the X08 surface: before → after with per-record deltas |
| `ExplainPanel` | result → rule → formula → inputs → source chain |
| `EmptyState`, `ErrorState`, `Skeleton`, `PermissionDenied` | every list and chart wires all four |

## 8.4 Responsive and input model

One design system, three intentional layouts, driven by content and pointer capability rather than device names.

| Width | Shell | Sidecar | Tables |
|---|---|---|---|
| ≥1440 | sidebar 240 + workspace (max 1280) + sidecar 420 | inline | full |
| 1024–1439 | sidebar 240 + workspace + sidecar 380 | inline | full, local h-scroll if needed |
| 768–1023 | icon rail + workspace | **overlay**, never squeezes the workspace | full with secondary columns collapsed into expandable rows |
| <768 | top app bar + nav drawer | **bottom sheet / full-screen sheet** | structured rows for operational lists; bounded h-scroll with a sticky identity column where comparison matters |

- `@media (hover:hover) and (pointer:fine)` gates hover affordances; `@media (pointer:coarse)` raises hit areas to ~44 px without inflating glyphs.
- Nothing is hover-only: every chart value is reachable by focus and by tap; every row action has a visible affordance on touch.
- Overlays respect `env(safe-area-inset-*)`, cap at `max-height` with internal scroll and a sticky footer so Submit is never pushed off a 500 px-tall landscape viewport.
- Verified at 320/360/390/430/768/1024/1280/1440/1920, portrait and landscape, and at 200% browser zoom.
- `prefers-reduced-motion` disables transitions and the ops dashboard's particle flow.

## 8.5 Fonts and offline

System font stack is authoritative (`ui-sans-serif, -apple-system, Segoe UI, Roboto, …`) with the webfont as a progressive enhancement using `font-display: swap`. Fonts are also vendored locally so the demo is identical with the network off. Nothing about the layout depends on a font loading.
# 9. Feature backlog

Organised by the requirement catalog so coverage is traceable. Every row is a ticket. `AC` = acceptance criterion; each AC must be provable by a test or a demo step, not by an opinion.

Legend for **Surface**: `P` page, `D` drawer, `S` sidecar, `M` modal, `T` table, `W` wizard, `C` chart.

---

## A1 — Employees

| # | Ticket | API | Surface | AC |
|---|---|---|---|---|
| A1.1 | Employee CRUD | `GET/POST/PATCH /employees` | P + M | Create with required fields persists and appears in list without a manual refresh; invalid submit preserves input and focuses the first invalid field |
| A1.2 | List view | `GET /employees` | P/T | Search, sort (name, department, position, wage, status), department + status + type filters, keyset pagination — all compose; 0 results shows "No employees match these filters" with a Clear filters action |
| A1.3 | Kanban view | same | P | Grouped by department; drag to another column issues a real `PATCH` and rolls back visually on failure; counts update from state |
| A1.4 | Form / detail hub | `GET /employees/:id` | P | One page with tabs: Overview, Contracts, Attendance, Time Off, Payslips, Documents, Timeline, Checklists |
| A1.5 | Department | — | field | FK to `Department`; changing it updates headcount everywhere on next read |
| A1.6 | Manager | `managerId` | field | Self-reference guarded against cycles; manager's team appears on their dashboard |
| A1.7 | Job position | FK | field | |
| A1.8 | Employment status | enum | chip | Status change is audited; EXITED triggers the offboarding checklist |
| A1.9 | Employee type | enum | field + filter | Drives report segmentation |
| A1.10 | Working-schedule assignment | `POST /schedules/:id/assign` | S + batch | Batch assign shows affected count and conflicts before commit |
| A1.11 | Linked contracts | `GET /employees/:id/contracts` | tab | Shows current, historical and upcoming with distinct visual states |
| A1.12 | Linked attendance | tab | Filtered to that employee, date-range default = current period |
| A1.13 | Linked time off | tab | Requests + allocations + balances |
| A1.14 | Related-record counts | `relatedCounts` on detail | header | Counts come from SQL aggregates, not from loading the collections |
| A1.15 | Employment history | `GET /employees/:id/timeline` | tab | Joins, promotions, contract changes, status changes, payroll milestones in one chronology |

## A2 — Contracts

| # | Ticket | AC |
|---|---|---|
| A2.1 | Contract CRUD | Create/edit/terminate all persist; the New Contract button is never a stub |
| A2.2 | Historical contracts | Past contracts remain readable and are used for historical payroll |
| A2.3 | Start/end dates | End optional (open-ended); end < start rejected with a field error |
| A2.4 | Wage, department, position, employment type, salary structure, working schedule | All persisted on the contract, not the employee; the payslip reads the contract |
| A2.5 | Status | DRAFT / ACTIVE / EXPIRED / TERMINATED, derived-assisted and audited |
| A2.6 | Active/current indication | Timeline strip showing past / current / upcoming; the current one is unambiguous |
| A2.7 | Period-specific resolution | `GET /contracts/resolve` returns exactly the contract applicable to the payrun period |
| A2.8 | Reject ambiguous concurrent contracts | Creating an overlap returns 409 with the exact message *"This contract overlaps CT-204 from 01 Jan 2026 to 31 Dec 2026"*; DB exclusion constraint proves it even if the service is bypassed |
| A2.9 | Historical payroll uses historical contract | Test: change the wage today, recompute an old payrun → the old payslip's basic is unchanged |
| A2.10 | Employee sees only own contract | `GET /contracts` as EMPLOYEE returns only their rows; direct `GET /contracts/:otherId` returns 403 |

## A3 — Working schedules

| # | Ticket | AC |
|---|---|---|
| A3.1 | Schedule CRUD, list/form | Persisted; assigned-employee count shown |
| A3.2 | Day / start / end / break rows | Add, remove, reorder; overlapping lines on the same day rejected |
| A3.3 | Computed weekly hours | Server-computed and displayed live as lines are edited; client value never trusted |
| A3.4 | Employee / contract assignment | Assign from the schedule or from the employee; batch supported |
| A3.5 | Payroll / work-context integration | `expectedWorkDays` for a payrun derives from schedule + holiday calendar, not a constant |
| A3.6 | Schedule grid responsiveness | 8-column grid scrolls horizontally inside its container on small screens or stacks per-day; never crushed, never causes page-level h-scroll |

## A4 — Attendance

| # | Ticket | AC |
|---|---|---|
| A4.1 | Check-in / check-out | Real records; check-out without check-in rejected; duplicate check-in for the same day is idempotent |
| A4.2 | Worked hours from timestamps | `workedMinutes` derived server-side; never entered by hand |
| A4.3 | Status | Derived: PRESENT / LATE / EARLY_EXIT / MISSING_CHECKOUT / OVERTIME / ABSENT / HOLIDAY / WEEKLY_OFF |
| A4.4 | List / form | Records tab with employee, date-range, status, department filters |
| A4.5 | Permitted employee creation | Employees may create their own records where policy allows; scoped to self |
| A4.6 | Authorized corrections | Correction requires a reason, writes an audit event, and shows "corrected by X on Y" on the row |
| A4.7 | Missing-checkout exception | Detected, surfaced in Anomalies and in the payroll Exception Center, resolvable from either; resolving writes the real checkout time and recomputes worked minutes |
| A4.8 | Reporting integration | Attendance health chart derives from these records |
| A4.9 | Payroll context | Present/absent/overtime feed the payslip context snapshot |
| A4.10 | Calendar tab | Month grid per employee/department with per-day status colour + label |

## A5 — Time Off

| # | Ticket | AC |
|---|---|---|
| A5.1 | Leave types CRUD | Unit, paid flag, allocation requirement, negative-balance policy, carry-forward, accrual |
| A5.2 | Requests | Create for self or on behalf; overlapping request for the same dates rejected |
| A5.3 | Allocations | Grant per employee/type/validity; bulk grant with preview |
| A5.4 | Days / hours policies | Day, half-day and hour units all compute correct `days` |
| A5.5 | Allocation requirement | A type requiring allocation cannot be requested without one; the error names the missing allocation |
| A5.6 | Approval / refusal | One primary action from the Approval Inbox; refusal requires a note |
| A5.7 | Allocation validity | Requests outside the allocation validity window are rejected |
| A5.8 | Taken / remaining balance | Balance shown before submit and updated immediately after approval |
| A5.9 | **Atomic consumption** | 50 concurrent approvals of the same request → exactly 1 success, 49 conflicts, allocation decremented exactly once (integration test) |
| A5.10 | Payroll integration | Approved leave in the period changes the payslip on recompute; the payslip shows paid vs unpaid days |
| A5.11 | Unpaid leave | Produces the `UNPAID_LEAVE` deduction line via the rule engine, with the leave request as a source ref |

## A6 — Salary structures

| # | Ticket | AC |
|---|---|---|
| A6.1 | CRUD, list/form, active state | Persisted; inactive structures cannot be selected for a new payrun |
| A6.2 | Ordered rules | Rules listed in sequence order; reordering persists |
| A6.3 | Rule count / usage references | "Used by 3 payruns, 5,000 payslips" shown before edit |
| A6.4 | Explicit payrun structure selection | Step 1 of the wizard requires it; it is stored on the payrun and on every payslip |

## A7 — Salary rules

| # | Ticket | AC |
|---|---|---|
| A7.1 | CRUD, name/code/category/sequence | Code unique per structure+version; sequence drives order |
| A7.2 | Categories BASIC / ALLOWANCES / GROSS / DEDUCTIONS / NET | Drive payslip layout and report grouping |
| A7.3 | FIXED | Amount used verbatim |
| A7.4 | PERCENTAGE | `base × percentage`, base referenced by rule code |
| A7.5 | FORMULA | Restricted AST; unknown symbol rejected at save time with the symbol named |
| A7.6 | Sequence-driven dependencies | A rule referencing a later sequence fails validation |
| A7.7 | **Rules actually drive payslips** | Test: change HRA from 20% to 25%, recompute, every payslip's HRA line and gross change accordingly; no screen computes salary independently |

## A8 — Payrun creation (two-step wizard)

| # | Ticket | AC |
|---|---|---|
| A8.1 | Step 1: period + structure | Defaults to the next unprocessed period (X03); shows eligible-employee count live |
| A8.2 | Step 2: employee selection | Table with eligibility, per-employee exceptions, select-all-filtered vs select-all-results distinguished |
| A8.3 | **Payrun exists only after final Create** | Abandoning the wizard at step 2 leaves zero rows in `Payrun` (asserted by a DB query in the test) |
| A8.4 | Only selected eligible employees included | Excluded/ineligible employees produce no payslip; the reason is shown |

## A9 — Payrun lifecycle

| # | Ticket | AC |
|---|---|---|
| A9.1 | DRAFT → COMPUTED → VALIDATED → PAID | Illegal transitions rejected server-side with a typed error; the stepper reflects reality (past = check, current = active, future = neutral) |
| A9.2 | Compute | Chunked job, streamed progress, rebuilds payslips, blockers, readiness, notifications, audit |
| A9.3 | Recompute before finalization | Allowed in DRAFT/COMPUTED; blocked once VALIDATED without an explicit reopen |
| A9.4 | Validate | Available only at 0 blocking exceptions; updates status, actions, next-best-action and audit immediately |
| A9.5 | Mark Paid | Requires VALIDATED; preserves results; flips report semantics to "paid"; enables Send Payslips |
| A9.6 | Send Payslips | Enqueues real delivery jobs; per-payslip status QUEUED → SENT/FAILED; never mutates money |
| A9.7 | Missing payroll data warning | Surfaced as a typed blocker with a resolve deep-link |
| A9.8 | Duplicate payslip warning | Detected across payruns; DB unique constraint per (payrun, employee) plus a cross-payrun check |
| A9.9 | Invalid contract/context blocker | No contract / ambiguous contract both block, both explain |
| A9.10 | Invalid rule/input blocker | A rule that throws for an employee blocks that payrun and names the rule and the employee |
| A9.11 | Historical preservation | Paid payruns are immutable; a direct service mutation attempt throws (test) |
| A9.12 | Freeze inputs / controlled reopen | Freeze blocks attendance/leave edits for the period; reopen requires a reason and is audited |

## A10 — Payslips

| # | Ticket | AC |
|---|---|---|
| A10.1 | Payslip list | Filter by payrun, employee, department, period; money right-aligned, tabular |
| A10.2 | Payrun relationship, employee, structure, period, status | All shown and all real |
| A10.3 | Worked-day / input context | Expected, worked, paid leave, unpaid leave, overtime — from the snapshot |
| A10.4 | Rule-line breakdown | Every line from `PayslipLine`, in sequence, with a `Why?` control |
| A10.5 | Gross / deductions / net | Derived from lines; the document always foots |
| A10.6 | **Selected payslip drives the document** | Opening row N renders payslip N — employee, contract, period, days, lines, totals and both explanations all switch together (regression test for the current prototype bug) |
| A10.7 | Historical period context | Old payslips render with the contract, rules and calendar of their own period |

## A11 — PDF and delivery

| # | Ticket | AC |
|---|---|---|
| A11.1 | Real PDF | pdf-lib output; opens in a viewer; text is selectable; not a screenshot |
| A11.2 | Correct employee/payroll details | Generated from the persisted payslip, never from the DOM |
| A11.3 | Robust layout and pagination | 30+ rule lines paginate with a repeated header and a page footer `Page n of m` |
| A11.4 | Individual download | Filename `Payslip_<EmployeeCode>_<YYYY-MM>.pdf` |
| A11.5 | Bulk delivery from payrun | Background job, throughput ≥ 40/s, progress visible |
| A11.6 | SMTP when configured | Nodemailer transport from env |
| A11.7 | Persisted local outbox fallback | With SMTP unset or failing, messages land in `OutboxMessage` and are viewable in the UI; the demo "sends" with the internet off |
| A11.8 | Delivery status | PENDING/QUEUED/SENT/FAILED per payslip, with retry |
| A11.9 | **Email failure cannot corrupt payroll** | Test: force the transport to throw for 20% of recipients → payrun stays PAID, payslip money unchanged, only delivery rows are FAILED, and a notification lists them |

## A12 — Dashboard / reports

| # | Ticket | AC |
|---|---|---|
| A12.1 | Live DB-derived metrics | Every KPI traces to a query; no static arrays anywhere in the bundle (grep-asserted in CI) |
| A12.2 | Period / Department / Employee Type filters | Each filter recalculates KPIs and every chart with no Apply button |
| A12.3 | Total Net Salary Paid | **Label is state-aware**: "Estimated Net Payroll" while COMPUTED, "Total Net Salary Paid" only after PAID |
| A12.4 | Payslips Generated, Average Salary, Approved Time Off, Attendance Health | All derived; zero-data renders an empty-state panel, not `NaN` |
| A12.5 | Salary Cost by Department | From payslips joined to contracts, filtered |
| A12.6 | Monthly Net Salary Trend | From historical payruns; 12-month window |
| A12.7 | Department Headcount / Salary Spend | From employees and rollups |
| A12.8 | Attendance and time-off overviews | From records |
| A12.9 | Operational alerts, missing-info alerts, payroll blockers, contract attention | One alert rail, deduplicated, each with a resolve deep-link |
| A12.10 | **Hover/focus inspection on graphs** | Every data point has a tooltip on hover, on keyboard focus and on tap, with real units |
| A12.11 | **No unnecessary graph-click navigation** | Chart surfaces are not links. KPI tiles are not links. Drill-down happens through an explicit labelled control (`Why?` / `View records`) |

## A13 — Roles

| # | Ticket | AC |
|---|---|---|
| A13.1 | Five roles | Employee, HR Manager, HR Payroll User, HR Payroll Manager, Admin — each with a distinct home |
| A13.2 | **Server-side permission matrix** | §6.2; every route guarded; navigation filtering is cosmetic only |
| A13.3 | Employee privacy | §6.3 privacy suite passes with zero leaks |
| A13.4 | HR Manager has no payrun administration | No payrun routes, no payroll analytics, no salary config |
| A13.5 | Admin manages users/roles | Create user, assign role, deactivate, force logout; all audited |

---

## B — Engineering integrity

| # | Item | Where it is satisfied | AC |
|---|---|---|---|
| B1 | Real authentication | §6.1 | Login/logout/session lifecycle tested |
| B2 | HTTP-only server session | §6.1 | Cookie flags asserted in a test |
| B3 | Password hashing | argon2id | No plaintext or reversible storage anywhere |
| B4 | CSRF / origin mitigation | SameSite + Origin check | Cross-origin POST returns 403 |
| B5 | Zod / API validation | every boundary | Malformed body returns 400 with field errors |
| B6 | IDOR protection | §6.3 | Privacy suite |
| B7 | DB money precision | `NUMERIC(18,2)` | Migration asserts the column type |
| B8 | decimal.js calculation path | §5 | Lint bans float arithmetic on money |
| B9 | API money strings | §2.5 | Response schema test |
| B10 | Restricted formula AST/scope | §5.2 | `import(...)`, assignment and unknown symbols all rejected (tests) |
| B11 | Unknown symbol rejection | §5.2 | Named in the error |
| B12 | Duplicate payslip DB constraint | `@@unique([payrunId, employeeId])` | Constraint violation test |
| B13 | Contract-overlap validation | GiST exclusion + service check | 409 with the conflicting contract named |
| B14 | Payrun state machine | §5.4 | Illegal transition test per pair |
| B15 | Paid payroll immutability | Prisma middleware | Direct-mutation test throws |
| B16 | Atomic leave consumption | §3.2 R7 | 50-way concurrency test |
| B17 | Audit trail | §6.4 | Every privileged action produces exactly one event |
| B18 | Deterministic calculation snapshot/hash | §5.1 | Same inputs → same hash, twice |
| B19 | Calculation provenance | §5.3 | Every line has rule, formula, inputs, sources |
| B20 | PDF failure isolation | job handler | PDF error marks the job FAILED, payroll untouched |
| B21 | Delivery failure isolation | A11.9 | |
| B22 | Deterministic seed/reset | §4.2 | Two seeds produce identical checksums |
| B23 | Automated tests | §12 | Suite green in CI |
| B24 | Docker / local runtime | compose | `docker compose up` + `npm run dev` from clean clone |
| B25 | Core demo works without internet | fonts vendored, outbox fallback, no CDN at runtime | Demo rehearsed with the network disabled |

## C — Explainable Payslip (the differentiator)

| # | Ticket | AC |
|---|---|---|
| C1 | Persist rule ID/code/version, sequence/category, formula snapshot, input values, source references, result per line | Asserted per line for every payslip in the scale seed |
| C2 | `Why?` on every line | One interaction opens the explanation |
| C3 | Business-language chain | result → rule → formula → inputs → source, in that order |
| C4 | Source records clickable | Opens the Contextual Sidecar on the contract / leave request / attendance record |
| C5 | No technical hash noise in the primary UI | Snapshot hash lives in a collapsed "Technical details" row |
| C6 | **Explanation matches the selected payslip** | Opening Maitri's payslip shows Maitri's contract, wage and rule inputs; opening Aarav's switches everything. Never a hardcoded example |
# 9 (cont.) — Advanced scope D through L

## D — Operational productivity

| # | Feature | Build notes | AC |
|---|---|---|---|
| D1 | **Payroll Exception Center** | Grouped by type, then by employee. Each card: employee, what is wrong, why it blocks, and the resolve control that fixes the underlying record | Resolving mutates real data; the blocker disappears on recompute of readiness, not via a flag |
| D2 | **Payroll Readiness / Data Quality Score** | §5.5 | Score, category bars, and the validate button state all move together |
| D3 | **Unified Approval Inbox** | Leave + profile changes + salary changes in one list, tabs `All / Leave / Profile / Salary` | One primary action per item; counts on tabs, sidebar badge and HR dashboard all derive from the same query |
| D4 | Contract-expiry alerts | Job scans daily at `endDate - 30d` | Alert text and the contract table always agree on the date |
| D5 | Probation-ending alerts | `probationEndDate - 14d` | Appears in the alert rail and the manager's home |
| D6 | Missing-information center | Aggregates missing bank / identity / contract / schedule across employees | Each row deep-links to the exact field |
| D7 | Guided Payroll Checklist | Ordered steps for the open period with live completion state | Step completion derives from state, never from a local flag |
| D8 | Payroll Period Freeze | Blocks attendance/leave mutation for the frozen period | A frozen-period edit returns a typed error explaining who froze it and when |
| D9 | Controlled Reopen With Reason | §5.4 | Reason mandatory, audited, visible on the payrun header afterwards |
| D10 | Saved report/filter views | `SavedView` per module | Save, rename, pin, share-with-role; restoring a view restores filters, columns and sort |
| D11 | Global search | `GET /search`, role-scoped | Employees, contracts, payruns, payslips and actions; zero unauthorized results |
| D12 | Notification Center | Derived from state, not from strings | Notification text must match reality: 3 blockers ⇒ "has 3 blockers", never "ready to validate". Mark-all-read persists |

## E — Payroll intelligence

| # | Feature | AC |
|---|---|---|
| E1 | Payroll Simulation / Preview | Employee, adjustment type and value recompute the simulated column immediately using **the production engine**; production state is never mutated (asserted by a DB checksum before/after) |
| E2 | Salary Rule Sandbox | Edit a rule draft, evaluate against a chosen employee, see line-by-line output before saving |
| E3 | Month-over-month salary comparison | Current vs previous payslip, side by side on desktop, stacked vertically on mobile |
| E4 | **Why Did My Salary Change?** | Difference broken into causes (wage change, allowance change, unpaid leave, rule version, attendance effect). The sum of displayed causes equals `current.net − previous.net` **exactly** — asserted by a test over the whole scale dataset. No previous payslip ⇒ a useful empty state |
| E5 | Payroll Reconciliation | Expected vs computed vs paid per payrun, with a variance list and drill-down |
| E6 | Department budget vs actual | Budget is configured data; actual derives from payslips |
| E7 | What-if salary increase | Percentage or absolute, per employee/department/type, showing cost delta |
| E8 | What-if department/headcount cost | Add N of a position at wage W → monthly and annual cost |
| E9 | Employer cost calculation | Gross + configured employer contributions, shown on the payslip and in reports |
| E10 | Compensation history | Wage timeline per employee with the contract that caused each change |
| E11 | Payslip version comparison | Compare two computes of the same period, highlighting changed lines |

## F — HR expansion

| # | Feature | AC |
|---|---|---|
| F1 | Employee timeline | Merged domain + audit chronology |
| F2 | Bulk employee import | Y04 — mapping, dry-run diff, per-row errors, atomic commit |
| F3 | Bulk employee updates | Field-level batch with affected-count preview |
| F4 | Self-service profile-change requests | Employee submits → Approval Inbox → applied on approval, audited |
| F5 | Salary-change approval | Wage change on an active contract requires approval by a payroll manager before it affects payroll |
| F6 | Contract attachments | Documents linked to a contract, permission-checked |
| F7 | Employee documents | Category, visibility, upload, download, acknowledge |
| F8 | Department Manager limited view | A manager sees their team's attendance/leave, not org-wide salary |
| F9 | Organization hierarchy | Interactive org chart from `managerId` / `Department.parentId` |
| F10 | Onboarding checklist | Y10 — instantiated on hire, blocks first payroll on mandatory items |
| F11 | Offboarding workflow | Instantiated on exit; final-settlement checklist; excludes the employee from future payruns |

## G — Attendance expansion

| # | Feature | AC |
|---|---|---|
| G1 | Late detection | Compared to the schedule's start time + grace |
| G2 | Early-departure detection | Compared to the schedule's end time |
| G3 | Missing-checkout detection | Same canonical record everywhere — the blocker, the table and the calendar must never disagree on the date |
| G4 | Excessive-hours warning | Configurable threshold, warn-level exception |
| G5 | Overtime calculation | Minutes beyond scheduled hours; feeds an optional overtime rule |
| G6 | Attendance anomaly detection | Anomalies tab aggregating G1–G5 with batch resolution |
| G7 | Attendance calendar | Month grid, per-day status, keyboard navigable |
| G8 | Bulk attendance corrections | Preview affected rows and computed hour changes before commit |
| G9 | Correction reasons / audit | Reason mandatory; the row shows corrector and timestamp |

## H — Time Off expansion

| # | Feature | AC |
|---|---|---|
| H1 | Leave calendar | Team/department month view |
| H2 | Team conflict detection | Warns when overlapping absence exceeds a configured threshold for a department |
| H3 | Carry-forward rules | Applied at allocation rollover, capped by `carryForwardMax` |
| H4 | Accrual rules | Monthly accrual job credits allocations; visible in the forecast |
| H5 | Half-day leave | 0.5-day arithmetic through requests, balances and payroll |
| H6 | Holiday calendar | Drives working-day counts, leave-day counts and expected days |
| H7 | Manager approval chain | Route to the employee's manager, escalate to HR after a configured age |
| H8 | Leave forecast | Projected balance at year end including accrual and approved future leave |

## I — Reporting expansion

| # | Feature | AC |
|---|---|---|
| I1 | CSV export | Streamed, respects current filters and role scope |
| I2 | Report PDF export | Same numbers as the screen, generated server-side |
| I3 | Saved reports | D10 |
| I4 | Drill-down to authorized contributing records | Only rows the caller may see; the count matches the KPI |
| I5 | Explainable KPI | Definition, formula, filters applied, contributing-record count — behind an explicit `Why?` control, never a hidden click on the tile |
| I6 | Salary distribution | Histogram by band |
| I7 | Department comparison | Multi-metric compare |
| I8 | Employee-type comparison | Segment by type |
| I9 | Payroll variance | Period over period, by department, with outliers flagged |
| I10 | Attendance trend / leave trend | 12-month lines |
| I11 | **No confidential org payroll exposure to Employee** | Every report endpoint scoped; Employee gets only self-reports |

## J — UX / accessibility

| # | Requirement | How it is met |
|---|---|---|
| J1 | Role-specific home | Five distinct homes, each answering: what needs me, what is blocked, what is next, what changed |
| J2 | Exception-first payroll | Blockers and next action above totals |
| J3 | Searchable tables, useful sorting, pagination | `DataTable` primitive; filters + sort + pagination compose; select-all applies to the current filtered page unless explicitly "select all results" |
| J4 | Empty / loading / error states | Every list and chart wires `EmptyState`, `Skeleton`, `ErrorState`, `PermissionDenied` |
| J5 | Toast/inline mutation feedback | The toast confirms a completed mutation; a toast is never the action itself |
| J6 | Confirmation for high-consequence actions | Consequence preview (X08) rather than a generic "Are you sure?" |
| J7 | Pending/disabled state | `Button pending` prop; server idempotency behind it |
| J8 | Keyboard navigation, visible focus | Full keyboard path through nav, tables, dialogs, tabs, launcher; focus order follows visual order |
| J9 | Responsive layout | §8.4 breakpoint contract |
| J10 | Reduced motion | Honoured globally, including the ops dashboard |
| J11 | Styled dropdowns/controls | No browser-default control survives; native semantics preserved underneath |
| J12 | Lucide icons | No emoji in the interface; a lint rule fails the build on emoji in `web/src` |
| J13 | Dynamic graph hover/focus tooltips | §8.3 `Chart` |
| J14 | No dark theme | Light-only tokens; no `prefers-color-scheme` branch |
| J15 | Brand #2274A5 / Accent #6DA2C2 / gold warning | Token file is the only source of colour |

Additional accessibility floor: dialog semantics with focus trap and restoration, `role=tablist/tab` with `aria-selected` and `aria-controls`, `aria-label` on every icon button (never `title` alone), `aria-expanded/aria-controls` on the role switcher, status conveyed by icon or text as well as colour, focusable chart data points with accessible descriptions, and an overlay stack where Escape closes exactly one layer in the order launcher → modal → drawer → sidecar → notifications → dropdown → mobile nav.

## K — Resilience / performance

| # | Requirement | How it is met |
|---|---|---|
| K1 | Double-click protection | Pending state + `Idempotency-Key` |
| K2 | Idempotency where critical | Compute, validate, pay, send, approve, create |
| K3 | Transaction boundaries | One transaction per business operation, including its audit event |
| K4 | Zero-data report handling | Empty-state panels; no NaN, no divide-by-zero, no collapsed axis |
| K5 | External-service isolation | SMTP and PDF failures are contained in jobs |
| K6 | Useful errors | `what failed / why / how to recover / what is safe` |
| K7 | Retry-safe PDF | Regeneration is deterministic and overwrite-safe |
| K8 | Stale-data invalidation | Targeted query invalidation; snapshot-hash check before validate |
| K9 | Appropriate DB indexes | §3.2 R3, `EXPLAIN ANALYZE` snapshots committed |
| K10 | N+1 prevention | §3.2 R1/R6; a test asserts the query count for the payrun compute path stays constant as employee count grows |
| K11 | Responsive hot interactions | §3.1 budgets in `e2e/perf.spec.ts` |

## L — Eight productivity multipliers

| # | Multiplier | AC |
|---|---|---|
| X01 | Universal Action Launcher | `Ctrl/Cmd+K`; role-aware; results generated from live data (employees, contracts, payruns, payslips, modules, actions); fuzzy matching; arrow-key navigation; Enter executes; Escape closes and restores focus; `role=dialog` + listbox semantics; zero unauthorized results (privacy test asserts an Employee search for another employee returns nothing) |
| X02 | Contextual Sidecar | Opens from a blocker, a payslip line, a report segment or a table row without losing the parent screen; always offers "Open full record"; on mobile it becomes a bottom sheet and never shifts the workspace |
| X03 | Smart Defaults & Prefill | Payrun defaults to the next unprocessed period; new employee suggests department schedule and structure; reports remember the current period; leave request defaults to self and the common unit. Every inferred value is visible and editable before commit |
| X04 | Batch Review + Exception Preview | Selected count, affected records, expected changes and conflicts shown before commit for schedule assign, structure assign, payrun add/remove, attendance correction, allocation grant and delivery |
| X05 | Deterministic Next-Best-Action | §5.6; every recommendation carries its reason and a working deep link; role-scoped |
| X06 | Safe Undo / Reversible Draft Mutations | 10-second undo on archive, notification dismiss, payrun member removal and bulk assignment; never on paid payroll |
| X07 | Recurring Payrun Clone + Diff | Copies structure and selection, advances the period, re-resolves contracts and inputs, shows added/removed/changed employees and blockers **before** creation, and copies no monetary result |
| X08 | Live Consequence Preview | Rule edit → preview on a test employee; wage change → next-period estimate; schedule change → weekly-hours delta; leave approval → balance and payroll effect. All read-only, all through the production engine |
# 10. Y01–Y10 — ten additional automation multipliers

These are **new**, beyond the catalog's X01–X08. Each one removes recurring manual work for a specific role. All are deterministic and auditable — no AI, no hidden magic, and every automatic action is reversible or requires a human confirmation where money or a person's record is affected.

The governing rule: **the system proposes, the human disposes — except where the action is provably safe and fully reversible.**

---

## Y01 — Payroll Autopilot (nightly pre-flight)

**Problem:** the payroll manager discovers problems on the last day of the period, under time pressure.

**Behaviour.** A scheduled job (`AUTOPILOT_PREFLIGHT`, nightly at 02:00 and on demand) runs against the open period:

1. Resolves contracts, builds contexts and performs a **dry-run compute** into memory — never persisting payslips.
2. Recomputes blockers and the readiness score; diffs against yesterday.
3. Classifies each finding as *auto-fixable*, *proposable* or *needs a human*.
4. Applies only the safe auto-fixes: recompute derived `workedMinutes`, refresh rollups, re-derive attendance status from timestamps, expire contracts past their end date, mark accruals due.
5. Writes one digest notification per owner: *"September payroll is 96% ready. 2 items need you: Rahul's bank details, Meera's missing checkout"* — each item a deep link to its resolve surface.
6. Records a `PreflightRun` row so the trend "readiness over the last 14 days" is real.

**Surfaces.** Payroll home hero shows *Readiness 96% · last checked 02:00 · 2 items*, with a sparkline of the last 14 days. Manual trigger: **Run pre-flight now**.

**Guardrails.** The dry run never writes payslips, never advances state, and never sends email. Auto-fixes are audited with `actor = SYSTEM` and are individually revertible.

**AC.** Seed a new blocker at 01:00; the 02:00 run detects it, the digest names it, and readiness drops by exactly its severity.

---

## Y02 — Variance Guard (anomaly radar before money moves)

**Problem:** a wrong wage or a bad attendance import silently pays someone 10× their salary.

**Checks**, run at compute and again before validate, each producing a typed exception with severity:

| Check | Rule | Severity |
|---|---|---|
| Net swing | `abs(net − prevNet) / prevNet > 25%` | warn, blocking above 60% |
| Negative or zero net | `net <= 0` | blocking |
| Net above band | net > 3× the department median | warn |
| New joiner full pay | joined mid-period but paid a full month | warn |
| Leaver still paid | `exitDate < periodStart` and a payslip exists | blocking |
| Duplicate bank account | the same account number on two employees | blocking |
| Unusual overtime | overtime > 40% of scheduled hours | warn |
| Missing rule line | a payslip missing a line the structure requires | blocking |
| Payrun total swing | payrun net differs from the previous period by > 15% | warn, prominent |

**Surface.** A "Variance Guard" panel in the Exception Center and a compact strip on the payrun header: *"3 anomalies — 1 blocking"*. Each row explains the comparison in business language: *"Aarav Patel: net ₹68,400 vs ₹52,300 last month (+30.8%) — cause: contract wage changed on 12 Sep (CT-231)"* with the causing record linked.

**AC.** Multiply one seeded employee's wage by 10, recompute → a blocking anomaly appears, validate is refused, and the explanation names the contract that changed.

---

## Y03 — Policy Automations (deterministic auto-approval and routing)

**Problem:** HR spends the day clicking Approve on one-day sick leaves.

**Behaviour.** `AutomationPolicy` records, editable by HR Manager and above, evaluated when a request is created:

- **Auto-approve** — e.g. *sick leave ≤ 1 day, balance sufficient, no team conflict → approve automatically*.
- **Auto-flag** — e.g. *any leave inside the payroll freeze window → flag as urgent and route to the payroll manager*.
- **Auto-route** — e.g. *leave longer than 5 days → require the department head, then HR*.
- **Auto-escalate** — *pending more than 48 h → notify the next approver in the chain*.

Every automatic decision writes an audit event with `actor = SYSTEM (policy: <name>)`, shows an "Auto-approved by policy" chip on the request, and remains reversible by a human for 24 h.

**Surface.** Settings → Automations: a compact policy list with a **live consequence preview** — *"This policy would have auto-approved 41 of the last 60 requests"* computed against real history before saving.

**AC.** Enable the sick-leave policy, submit a qualifying request as the Employee, and observe: instantly approved, allocation consumed atomically, audit event with the policy name, chip visible, Approval Inbox count unchanged.

---

## Y04 — Import Copilot (CSV/XLSX with mapping, dry run and diff)

**Problem:** onboarding 5,000 employees by hand is impossible; a bad import is worse.

**Flow.** Upload → auto column mapping (header similarity, remembered from the last import) → **dry run inside a transaction that is rolled back** → a per-row diff table: `create / update / skip / error`, each error naming the row, the column and the reason → download an annotated error CSV → fix and re-upload, or **commit** the valid rows atomically.

Works for employees, contracts, attendance, allocations and holidays. Streaming parse, 5,000-row chunks, progress over SSE, hard limits (50 MB, 100k rows).

**Guardrails.** Commit is a single transaction per chunk with an overall import record so a partial failure is visible and re-runnable. Idempotent by `employeeCode`, so re-uploading the same file updates rather than duplicates.

**AC.** Import 5,000 employees in under 60 s; introduce 12 bad rows and confirm the dry run reports exactly those 12, nothing is written, and the annotated CSV downloads.

---

## Y05 — Document Autogeneration and e-Acknowledgement

**Problem:** offer letters, salary-revision letters and experience letters are copy-pasted in Word.

**Behaviour.** Templates with merge fields (`{{employee.name}}`, `{{contract.wage}}`, `{{period}}`) render server-side to PDF through the same pdf-lib pipeline as payslips. Triggers: contract created → offer/appointment letter; wage changed → salary revision letter; exit → experience and relieving letters; payrun paid → optional payslip cover note.

Generated documents land in the employee's Documents tab with `visibility`, and the employee is asked to **acknowledge** in-app. Acknowledgement stores who, when and from where; HR sees an acknowledgement progress ring.

**AC.** Change a wage through the approval flow → a revision letter is generated with the correct old and new figures → the employee acknowledges → HR's ring moves and an audit event exists.

---

## Y06 — Attendance Auto-Regularization Proposals

**Problem:** missing checkouts are the single largest payroll blocker and each one is a manual edit.

**Behaviour.** For every anomaly the system proposes a correction with its evidence:

- Missing checkout → propose the schedule end time, or the median checkout of that employee's last 20 records, whichever is closer to the observed pattern; show both.
- Missing check-in with an approved leave → propose reclassifying the day as leave.
- Absent on a holiday → propose HOLIDAY.
- Absent with an approved leave → propose LEAVE and remove it from unpaid days.

Proposals are **never applied silently**. They appear as a batch list with checkboxes, a per-row rationale, and the resulting worked-hours delta. One click accepts a page of them; each acceptance writes the real record with `source = SYSTEM_PROPOSAL`, the reason and an audit event.

**AC.** Seed 40 missing checkouts, open Regularization, accept all → 40 attendance records updated, worked minutes recomputed, the payroll blocker count drops to zero, and each record shows its proposal rationale.

---

## Y07 — Payroll Calendar and Deadline Automation

**Problem:** the cutoff is tribal knowledge.

**Behaviour.** A configurable payroll calendar per period: input cutoff date, compute-by date, validate-by date, pay date. From it:

- A countdown on the payroll home: *"Inputs close in 2 days · Pay date 30 Sep"*.
- Escalating reminders at T-3, T-1 and T-0 to the owners of open blockers.
- **Auto-freeze at cutoff** when `payroll.autoFreezeAtCutoff` is enabled — announced 24 h in advance, audited, reversible by unfreeze with a reason.
- Holiday-aware pay-date shifting: if the pay date falls on a holiday or weekend, propose the previous working day.
- ICS export so the dates land in the team's calendar.

**AC.** Set the cutoff to today, enable auto-freeze, run the job → the period freezes, attendance edits return the frozen-period error, the audit shows `SYSTEM freeze (cutoff policy)`, and the countdown reflects the new state.

---

## Y08 — Saved Views plus Scheduled Report Subscriptions

**Problem:** the same three reports are rebuilt from filters every month.

**Behaviour.** Any filtered table or report is saveable as a named view (filters, columns, sort, chart selection), pinnable to the sidebar and shareable with a role. A view can then be **subscribed**: monthly, weekly, or event-driven on *payrun marked paid*. The scheduler renders CSV or PDF through the export job and delivers it by email, falling back to the persisted outbox so it still works offline.

Subscriptions respect the **recipient's** permissions at send time, not the creator's — a shared payroll view will not deliver salary data to an HR Manager.

**AC.** Save "Engineering payroll cost", subscribe on payrun-paid, mark the payrun paid → a job runs, a PDF appears in the outbox with the same numbers as the screen, and a subscription attempt for an unauthorized recipient is refused and logged.

---

## Y09 — Bank Advice Export and Payment Reconciliation

**Problem:** the last mile — actually paying people — is outside the product, and reconciliation is a spreadsheet.

**Behaviour.**

- For a `VALIDATED` or `PAID` payrun, generate a **bank advice file** (CSV, bank-neutral columns: account name, account number, IFSC, amount, reference) with a row count, total amount and SHA-256 checksum shown on screen and stored on `BankAdviceFile`. Employees with unverified bank details are excluded and listed explicitly — the file never silently omits anyone.
- Upload the bank's **returned status file** to reconcile: matched, amount mismatch, failed, unmatched. Mismatches become exceptions with the payslip linked; a failed payment sets that payslip's payment status to FAILED without touching the computed money.
- A reconciliation summary panel: *"4,998 of 5,000 paid · ₹28.4 Cr · 2 failed"*.

**AC.** Generate the advice for the demo payrun, check the total equals the sum of payslip nets exactly (decimal comparison), upload a return file with 2 failures, and confirm 2 exceptions appear while payrun totals stay unchanged.

---

## Y10 — Onboarding / Offboarding Orchestrator

**Problem:** a new joiner reaches payroll without a bank account, and payroll finds out at compute time.

**Behaviour.** Checklist templates per employee type with items, owner roles, due offsets from the join or exit date, and a `blocksPayroll` flag on mandatory items (contract signed, bank details verified, identity captured, schedule assigned).

- Creating an employee instantiates the onboarding checklist automatically; setting an exit date instantiates offboarding (asset return, access revocation, final settlement, experience letter via Y05).
- Progress ring on the employee record and a department-level onboarding board.
- **Items with `blocksPayroll` feed the payroll readiness engine directly** — so an incomplete onboarding is visible on the payroll manager's home weeks before it becomes a payroll emergency.
- Overdue items escalate to the owner role and appear in the Next-Best-Action list.

**AC.** Create an employee without bank details, include them in the payrun → a `MISSING_BANK` blocker appears sourced from the onboarding checklist item, resolving it from either surface completes the checklist item and clears the blocker.

---

### Y-series summary

| ID | Saves | Primary role | Risk class |
|---|---|---|---|
| Y01 Payroll Autopilot | hours of last-day firefighting | Payroll Manager | read-only dry run |
| Y02 Variance Guard | catastrophic mispayment | Payroll Manager | blocks, never edits |
| Y03 Policy Automations | dozens of clicks/day | HR Manager | reversible, audited |
| Y04 Import Copilot | days of data entry | HR Manager | dry run before commit |
| Y05 Document Autogeneration | manual letter drafting | HR Manager | generates, human sends |
| Y06 Auto-Regularization | the #1 payroll blocker | HR / Payroll User | proposes, human accepts |
| Y07 Calendar Automation | missed cutoffs | Payroll Manager | announced, reversible |
| Y08 Saved Views + Subscriptions | repeated report building | All | permission-checked at send |
| Y09 Bank Advice + Reconciliation | the payment last mile | Payroll Manager | never mutates money |
| Y10 Onboarding Orchestrator | payroll surprises | HR Manager | feeds readiness |
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
# 12. Testing, determinism and CI

## 12.1 The pyramid

| Layer | Tool | What it covers | Count target |
|---|---|---|---|
| Unit | Vitest | Payroll engine, formula evaluator, money ops, readiness, next-best-action, date/working-day maths, leave-day counting | ~120 |
| Integration | Vitest + Supertest + a real Postgres (testcontainer or a compose service) | Every route: happy path, validation failure, permission denial, scoping, idempotency | ~150 |
| Concurrency | Vitest | Leave allocation race, double compute, double validate, optimistic-concurrency conflicts | ~10 |
| E2E | Playwright | The scenario suite below, per role | ~30 |
| Performance | autocannon + Vitest | §3.1 budgets against the scale seed | ~10 |
| Static | ESLint, tsc, palette validator, emoji/static-data greps | Boundary rules, float-money ban, emoji ban, hardcoded-KPI ban | CI gates |

## 12.2 The scenario suite (these are the acceptance tests that matter)

**S-A Blockers → paid.** Seeded state: September COMPUTED, readiness 87, three blockers. Resolve the bank detail → 92, two blockers. Resolve the missing checkout → 96, worked minutes recomputed. Cancel the duplicate payslip → 100, zero blockers, next-best-action becomes *Validate*. Validate → VALIDATED, Mark Paid enabled. Mark Paid → PAID, Send Payslips enabled, the report KPI label flips from *Estimated Net Payroll* to *Total Net Salary Paid*.

**S-B Employee privacy.** As Employee: My Contract, My Payslips, My Attendance, My Time Off and My Documents each return only Aarav's rows. The command launcher exposes no other employee, no payroll module, no salary config, no org reports, no audit, no simulation. Direct API calls for another employee's contract, payslip, attendance and documents all return 403. The response bodies contain zero org-wide salary figures.

**S-C Create employee.** Riya Verma, Engineering, Backend Engineer, ₹62,000 → the row appears, Engineering headcount increments, the headcount chart updates, the onboarding checklist instantiates, an audit event exists, and the payroll readiness picks up her missing bank detail.

**S-D Leave.** Employee requests leave → HR approves → request status, allocation used, remaining balance, calendar, approval-inbox count, sidebar badge, HR dashboard count and the payroll unpaid-day input all change together, with an audit event.

**S-E Payslip selection and explanation.** Open Maitri's payslip: the document, worked days, every rule line, the `Why?` provenance and the salary-change explanation are all Maitri's. Open Aarav's: everything switches. The change explanation's causes sum exactly to `current.net − previous.net`.

**S-F Report filters.** Select Engineering: every KPI and every chart reflects Engineering only. No chart surface navigates on click. Hover, keyboard focus and tap each reveal exact values with units.

**S-G Scale.** Seed 5,000 employees, compute the payrun: completes under 25 s, produces exactly 5,000 payslips, streams progress, and the totals equal the sum of the payslip nets to the paise.

**S-H Degradation.** Break SMTP: delivery rows go FAILED, the payrun stays PAID, money is unchanged, and the outbox holds the messages. Kill Postgres mid-session: the app shows a degraded banner with a recovery message rather than a white screen.

**S-I Duplicate submission.** Double-click Compute, Validate, Mark Paid, Approve and Create Employee: exactly one effect each, verified by row counts.

## 12.3 Determinism

- Seeded RNG, fixed clock in tests (`vi.setSystemTime('2026-09-05T09:00:00+05:30')`), fixed timezone `Asia/Kolkata`.
- `npm run db:reset` restores the exact demo state in under 30 s — rehearsed, and available as a keystroke during the presentation if anything goes wrong.
- Two consecutive seeds produce identical table checksums (test).

## 12.4 CI

`typecheck → lint → unit → integration → build → e2e (chromium) → perf smoke`. Any red gate blocks merge. The perf smoke runs on the demo dataset for speed; the full scale benchmark runs nightly and on demand.

---

# 13. Execution timeline

Calibrated to a 48-hour hackathon with two developers plus this agent. Compress or extend proportionally; **the gate order never changes**, because each gate is a dependency of the next.

| Gate | Hours | Content | Exit condition |
|---|---|---|---|
| **G0 Preserve the build** | 0–2 | Compose up, Prisma migrate, seed, baseline test run, feature matrix committed | `npm run dev` serves the app; `db:reset` works |
| **G1 Official spine** | 2–16 | Auth + RBAC skeleton → Employee → Contract → Schedule → Attendance → Time Off → Structure/Rules → **payroll engine** → Payrun wizard + lifecycle → Payslip + provenance → PDF + outbox → Dashboard v1 | S-A and S-G pass; no screen computes salary independently |
| **G2 Role and privacy** | 16–20 | Five roles end to end, scoping on every query, permission-denied surfaces | S-B passes with zero leaks |
| **G3 Explainability + exceptions** | 20–26 | Exception Center, readiness, blocker resolution that mutates real records, Explainable Payslip, Why Did My Salary Change | S-E passes; the causes reconcile exactly |
| **G4 Productivity layer** | 26–32 | Approval Inbox, command launcher (X01), sidecar (X02), smart defaults (X03), batch review (X04), next-best-action (X05), undo (X06), payrun clone+diff (X07), consequence preview (X08), saved views, notifications | Interaction budgets in `SKILL.md` §4 measured by Playwright |
| **G5 Intelligence + expansion** | 32–38 | Simulation, rule sandbox, comparison, reconciliation, budget vs actual, employer cost, timeline, documents, org chart, attendance and leave expansions, reporting expansions | Every D–L row is IMPLEMENTED or has a written, approved blocker |
| **G6 Automation + ops** | 38–43 | Y01–Y10, then the ops dashboard and the load generator | S-H and S-I pass; `/ops` moves under `demo:load` |
| **G7 Polish + proof** | 43–48 | Responsive pass at all nine widths, keyboard and a11y pass, motion pass, empty/error/zero states, production build, PDF inspection, internet-off rehearsal, demo rehearsal ×3 | Every release gate in `checklists/release-gates.md` is green |

**Parallelisation.** Backend owns G1's engine and the payrun lifecycle; frontend owns the design primitives and the shell in the same window so G1's UI lands as the API lands. Y-series items are independent of each other and are the natural place to add or drop scope if time moves.

**Scope-cut order if you fall behind** (cut from the bottom, never from the top): Y08 subscriptions → Y05 document autogeneration → E11 payslip version comparison → H8 leave forecast → F9 org chart → I6 salary distribution. **Never cut:** the engine, provenance, RBAC, the exception center, the payrun lifecycle, the PDF, or the ops dashboard — those are the demo.

---

# 14. Demo script (8 minutes)

The rule from the release gates: no demo time on signup, password recovery or generic CRUD.

| # | Time | Beat | What the reviewer sees |
|---|---|---|---|
| 1 | 0:00 | **Land as the Payroll Manager** | Not a KPI wall. A control room: *September payroll · COMPUTED · 87% ready · 3 blockers* and one primary action |
| 2 | 0:40 | **Resolve a blocker** | Open *Rahul — missing bank details*, save the real record. The card collapses, readiness animates 87 → 92, the badge decrements. Do the other two. Readiness hits 100, the next-best action **changes by itself** to *Validate September payroll* |
| 3 | 1:40 | **Try to break it** | Before resolving, Validate was refused with a specific reason. Now show the contract-overlap error naming CT-204, and a Variance Guard anomaly blocking a 10× wage |
| 4 | 2:30 | **Validate → Mark Paid** | The stepper advances honestly; the report KPI relabels from *Estimated Net Payroll* to *Total Net Salary Paid* in front of them |
| 5 | 3:10 | **Explainable Payslip** | Open a payslip, click `Why?` on HRA: *₹11,000 ← HRA v2 ← BASIC × 20% ← BASIC ₹55,000 ← Contract CT-202*. Click the contract — it opens in the sidecar without losing the payslip |
| 6 | 4:00 | **Why did my salary change?** | Current vs previous, with the difference decomposed into causes that **sum exactly** to the delta |
| 7 | 4:40 | **Real PDF** | Download it. Open it. Text selects. Thirty lines paginate with a repeated header |
| 8 | 5:10 | **Privacy proof** | Switch to Employee: only their own data. Then a `curl` for another employee's payslip → `403`. Authorization is on the server, not in the navigation |
| 9 | 5:50 | **Speed** | `Ctrl+K` → type three letters → open an employee. Approve a leave in one action. Clone last month's payrun and show the added/removed/changed diff before it is created |
| 10 | 6:30 | **Scale, live** | Open `/ops`, start the load generator: the flow ribbon thickens, p95 and the pool move, concurrent sessions climb. Then compute a **5,000-employee** payrun and watch the engine panel stream to completion in ~20 s |
| 11 | 7:20 | **Degrade on purpose** | Kill SMTP and send payslips: deliveries fail, the outbox catches them, payroll money is untouched. Then unplug the network — the demo keeps working |
| 12 | 7:50 | **Close** | One slide: modular monolith, the invariants enforced in the database, the test suite green, `db:reset` for the next run |

## 14.1 Demo hygiene

- Two browser profiles, pre-logged-in as Payroll Manager and Employee, so no beat is spent typing passwords.
- `npm run db:reset` bound to a terminal alias and rehearsed — a bad state costs 30 seconds, not the demo.
- Screen at 1440×900, 100% zoom. The responsive story gets one deliberate 15-second phone view during beat 8, not an unplanned reflow.
- Network cable pulled **before** beat 11, not during, so the failure is demonstrated rather than suffered.

---

# 15. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Scope breadth crowds out payroll correctness | High | Fatal | Gate order is non-negotiable; G1 cannot be left partial. Cut from the documented bottom of the list |
| R2 | Float or rounding drift makes payslips not foot | Medium | Fatal | decimal.js everywhere, round once per rule, a test asserting `earnings − deductions = net` across the entire scale dataset |
| R3 | 5,000-employee compute is too slow to demo | Medium | High | Batched input loading (4 queries, not 20,000), chunked writes, streamed progress; benchmarked at G1, not at G7 |
| R4 | A privacy leak is found on stage | Low | Fatal | The privacy suite runs in CI and asserts on response bodies, not on screens |
| R5 | PDF generation is left to the last hours | Medium | High | pdf-lib lands inside G1, not G6; it is a gate exit condition |
| R6 | The ops dashboard becomes the load | Low | Medium | One snapshot per tick for all subscribers, self-throttling above 10 viewers, a measured overhead budget |
| R7 | Chart colours are unreadable to a colourblind reviewer | Medium | Medium | Palette validator in CI; the `--danger-mark` fix already applied (§11.5) |
| R8 | Demo machine has no internet | Medium | Medium | Vendored fonts, no runtime CDN, outbox fallback — and the internet-off run is a rehearsed step, not a contingency |
| R9 | Two agents editing the same files conflict | Medium | Medium | Module ownership is assigned per gate; the boundary lint rule catches cross-imports |
| R10 | A late refactor breaks the demo | Medium | High | Feature freeze at G7 start; after it, only bug fixes with a passing test |

---

## Appendix — coverage ledger

Maintain `plan/feature-matrix.csv` with one row per requirement ID from `references/requirements.md` (A1.1 … L.X08) plus Y01–Y10 and the ops dashboard:

```csv
id,requirement,backend,db,frontend,validation,test,demo_evidence,status,owner,notes
```

The build is not finished when it compiles. It is finished when every row reads `VERIFIED` or carries a written, user-approved blocker — and when a reviewer watching the demo concludes the team built a payroll operating system rather than a set of HR screens.
