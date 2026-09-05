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
