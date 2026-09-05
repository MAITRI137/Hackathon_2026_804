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
