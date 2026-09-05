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
