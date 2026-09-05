# PeoplePay360 Complete Requirement Catalog

This file is the execution catalog for the skill. Everything marked **Required by this skill** is current scope, including items that were formerly “good-to-have”. The historical “do not prioritize” infrastructure list remains excluded.

## A. Official problem-statement coverage — required

### A1. Employees
- Employee CRUD.
- Kanban view.
- List view.
- Form/detail hub.
- Department.
- Manager.
- Job position.
- Employment status.
- Employee type.
- Working-schedule assignment.
- Linked Contracts.
- Linked Attendance.
- Linked Time Off.
- Related-record counts.
- Employment history.

### A2. Contracts
- Contract CRUD.
- Historical contracts.
- Start/end dates.
- Wage.
- Department.
- Position.
- Status.
- Salary structure.
- Working schedule.
- Active/current indication.
- Period-specific contract resolution.
- Reject ambiguous concurrent applicable contracts.
- Historical payroll uses historical contract.
- Employee role sees only own contract data.

### A3. Working schedules
- Schedule CRUD.
- List/form.
- Day/start/end/break rows.
- Computed weekly hours.
- Employee/contract assignment.
- Payroll/work-context integration.

### A4. Attendance
- Check-in.
- Check-out.
- Worked hours derived from timestamps.
- Status.
- List/form.
- Permitted employee creation.
- Authorized corrections.
- Exceptions such as missing checkout.
- Reporting integration.
- Payroll context.

### A5. Time Off
- Types.
- Requests.
- Allocations.
- Days/hours policies.
- Allocation requirement.
- Approval/refusal.
- Allocation validity.
- Taken/remaining balance.
- Atomic consumption.
- Payroll integration.
- Unpaid leave.

### A6. Salary structures
- CRUD.
- List/form.
- Active state.
- Ordered rules.
- Rule count/usage references where useful.
- Explicit Payrun structure selection.

### A7. Salary rules
- CRUD.
- Name/code/category/sequence.
- BASIC/ALLOWANCES/GROSS/DEDUCTIONS/NET.
- FIXED.
- PERCENTAGE.
- FORMULA.
- Sequence-driven dependencies.
- Rules actually drive Payslips.

### A8. Payrun creation
- Two-step wizard.
- Step 1 period + structure.
- Step 2 employee selection.
- Payrun exists only after final Create.
- Only selected eligible employees included.

### A9. Payrun lifecycle
- DRAFT → COMPUTED → VALIDATED → PAID.
- Compute.
- Recompute before finalization.
- Validate.
- Mark Paid.
- Send Payslips.
- Missing payroll data warning.
- Duplicate Payslip warning.
- Invalid contract/context blocker.
- Invalid rule/input blocker.
- Historical preservation.

### A10. Payslips
- Payslip list.
- Payrun relationship.
- Employee.
- Structure.
- Period.
- Status.
- Worked-day/input context.
- Rule-line breakdown.
- Gross.
- Deductions.
- Net.
- Historical period context.

### A11. PDF and delivery
- Real Payslip PDF.
- Correct employee/payroll details.
- Robust layout and pagination.
- Individual download.
- Bulk delivery from Payrun.
- SMTP when configured.
- Persisted local outbox fallback.
- Delivery status.
- Email failure cannot corrupt payroll.

### A12. Dashboard / reports
- Live DB-derived metrics.
- Period/Department/Employee Type filters.
- Total Net Salary Paid.
- Payslips Generated.
- Average Salary.
- Approved Time Off.
- Attendance Health.
- Salary Cost by Department.
- Monthly Net Salary Trend.
- Department Headcount.
- Department Salary Spend.
- Attendance overview.
- Time-off overview.
- Operational alerts.
- Missing-info alerts.
- Payroll blockers.
- Contract attention alerts.
- Hover/focus inspection on graphs.
- No unnecessary graph-click navigation.

### A13. Roles
- Employee.
- HR Manager.
- HR Payroll User.
- HR Payroll Manager.
- Admin.
- Server-side permission matrix.
- Employee privacy.
- HR Manager has no Payrun administration.
- Admin manages users/roles.

---

# B. Engineering integrity — required by this skill

- Real authentication.
- HTTP-only server session.
- Password hashing.
- CSRF/origin mitigation appropriate to session model.
- Zod/API validation.
- IDOR protection.
- DB money precision.
- decimal.js calculation path.
- API money strings.
- Restricted formula AST/scope.
- Unknown symbol rejection.
- Duplicate Payslip DB constraint.
- Contract-overlap validation.
- Payrun state machine.
- Paid payroll immutability.
- Atomic leave consumption.
- Audit trail.
- Deterministic calculation snapshot/hash.
- Calculation provenance.
- PDF failure isolation.
- Delivery failure isolation.
- deterministic seed/reset.
- automated tests.
- Docker/local runtime.
- core demo works without internet.

---

# C. Existing differentiator — required

## Explainable Payslip
Each line persists:
- rule ID/code/version;
- sequence/category;
- formula snapshot;
- input values;
- source references;
- result.

UI exposes:
- Why?
- rule;
- formula;
- inputs;
- source records;
- result.

Normal business users should not have technical hash noise in primary UI.

---

# D. Operational productivity — required by this skill

- Payroll Exception Center.
- Payroll Readiness / Data Quality Score.
- Unified Approval Inbox.
- Contract-expiry alerts.
- Probation-ending alerts.
- Missing-information center.
- Guided Payroll Checklist.
- Payroll Period Freeze.
- Controlled Reopen With Reason.
- Saved report/filter views.
- Global search.
- Notification Center.

---

# E. Payroll intelligence — required by this skill

- Payroll Simulation / Preview.
- Salary Rule Sandbox.
- Month-over-month salary comparison.
- “Why Did My Salary Change?” explanation.
- Payroll Reconciliation.
- Department payroll budget vs actual.
- What-if salary increase.
- What-if department/headcount cost.
- Employer cost calculation.
- Compensation history.
- Payslip version comparison.

---

# F. HR expansion — required by this skill

- Employee timeline.
- Bulk employee import.
- Bulk employee updates.
- Employee self-service profile-change requests.
- Salary-change approval.
- Contract attachments.
- Employee documents.
- Department Manager limited view.
- Organization hierarchy.
- Onboarding checklist.
- Offboarding workflow.

---

# G. Attendance expansion — required by this skill

- Late detection.
- Early-departure detection.
- Missing-checkout detection.
- Excessive-hours warning.
- Overtime calculation.
- Attendance anomaly detection.
- Attendance calendar.
- Bulk attendance corrections.
- Correction reasons/audit.

---

# H. Time Off expansion — required by this skill

- Leave calendar.
- Team/department conflict detection.
- Carry-forward rules.
- Accrual rules.
- Half-day leave.
- Holiday calendar.
- Manager approval chain.
- Leave forecast.

---

# I. Reporting expansion — required by this skill

- CSV export.
- Report PDF export.
- Saved reports.
- Drill-down to authorized contributing records.
- Explainable KPI.
- Salary distribution.
- Department comparison.
- Employee-type comparison.
- Payroll variance.
- Attendance trend.
- Leave trend.
- No confidential organization payroll exposure to Employee role.

---

# J. UX / accessibility — required by this skill

- Role-specific home.
- Exception-first Payroll.
- Searchable tables.
- Useful sorting.
- Pagination where needed.
- Empty states.
- Loading/skeleton states.
- Actionable error states.
- Toast/inline mutation feedback.
- Confirmation for destructive/high-consequence actions.
- Pending/disabled state to prevent duplicates.
- Keyboard navigation.
- Visible focus.
- Responsive layout.
- Reduced-motion support.
- Styled dropdowns/controls.
- Lucide icons.
- Dynamic graph hover/focus tooltips.
- No dark theme unless scope explicitly changes.
- Light visual system: Brand #2274A5, Accent #6DA2C2, yellow warning semantics.

---

# K. Resilience / performance — required by this skill

- Double-click protection.
- Idempotency where critical.
- Transaction boundaries.
- Zero-data report handling.
- External-service isolation.
- Useful errors.
- Retry-safe PDF.
- Stale-data invalidation.
- Appropriate DB indexes.
- N+1 prevention.
- responsive hot interactions.

---

# L. Eight additional productivity multipliers — required

- X01 Universal Action Launcher.
- X02 Contextual Sidecar.
- X03 Smart Defaults & Prefill.
- X04 Batch Review + Exception Preview.
- X05 Deterministic Next-Best-Action Engine.
- X06 Safe Undo / Reversible Draft Mutations.
- X07 Recurring Payrun Clone + Diff.
- X08 Live Consequence Preview.

---

# M. Explicitly excluded anti-features

Do not interpret “implement everything” as permission to add:
- microservices;
- Kafka/event streaming;
- Redis infrastructure without proven need;
- blockchain payroll;
- facial-recognition attendance;
- a full accounting suite;
- native mobile apps during the hackathon;
- generic AI chatbot;
- custom expression compiler;
- generalized workflow engine;
- distributed payroll engine;
- multi-country tax/compliance engine;
- Kubernetes;
- service mesh.

These increase delivery risk without improving the judged PeoplePay workflow.
