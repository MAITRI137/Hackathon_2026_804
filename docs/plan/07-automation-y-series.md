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
