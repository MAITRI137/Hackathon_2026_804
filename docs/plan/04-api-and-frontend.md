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
