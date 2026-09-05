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
