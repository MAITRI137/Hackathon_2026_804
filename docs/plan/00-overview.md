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
