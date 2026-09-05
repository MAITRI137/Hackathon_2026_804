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
