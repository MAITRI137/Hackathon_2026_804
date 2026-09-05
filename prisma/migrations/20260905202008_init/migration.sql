-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'HR_MANAGER', 'HR_PAYROLL_USER', 'HR_PAYROLL_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'PROBATION', 'NOTICE', 'EXITED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'EARLY_EXIT', 'MISSING_CHECKOUT', 'OVERTIME', 'ABSENT', 'HOLIDAY', 'WEEKLY_OFF', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REFUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('BASIC', 'ALLOWANCES', 'GROSS', 'DEDUCTIONS', 'NET');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('FIXED', 'PERCENTAGE', 'FORMULA');

-- CreateEnum
CREATE TYPE "PayrunStatus" AS ENUM ('DRAFT', 'COMPUTED', 'VALIDATED', 'PAID');

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('DRAFT', 'COMPUTED', 'VALIDATED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "employeeId" TEXT,
    "displayName" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,
    "managerId" TEXT,
    "monthlyBudget" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "departmentId" TEXT,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "hoursPerWeek" DECIMAL(6,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkingSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleLine" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "breakMinutes" INTEGER NOT NULL,

    CONSTRAINT "ScheduleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "jobPositionId" TEXT NOT NULL,
    "managerId" TEXT,
    "employeeType" "EmployeeType" NOT NULL,
    "status" "EmployeeStatus" NOT NULL,
    "joinDate" DATE NOT NULL,
    "exitDate" DATE,
    "probationEndDate" DATE,
    "workingScheduleId" TEXT NOT NULL,
    "panMasked" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeBankDetail" (
    "employeeId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumberMasked" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EmployeeBankDetail_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "contractRef" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "departmentId" TEXT NOT NULL,
    "jobPositionId" TEXT NOT NULL,
    "employeeType" "EmployeeType" NOT NULL,
    "wage" DECIMAL(18,2) NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "workingScheduleId" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" TEXT,
    "checkOut" TEXT,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" "AttendanceStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "correctionReason" TEXT,
    "correctedById" TEXT,
    "correctedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isPaid" BOOLEAN NOT NULL,
    "requiresAllocation" BOOLEAN NOT NULL,
    "allowNegativeBalance" BOOLEAN NOT NULL,
    "carryForwardMax" DECIMAL(6,2) NOT NULL,
    "accrualPerMonth" DECIMAL(6,2) NOT NULL,
    "colorToken" TEXT NOT NULL,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveAllocation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "allocated" DECIMAL(6,2) NOT NULL,
    "used" DECIMAL(6,2) NOT NULL,
    "carriedForward" DECIMAL(6,2) NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LeaveAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "leaveTypeId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "halfDayStart" BOOLEAN NOT NULL DEFAULT false,
    "halfDayEnd" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(5,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "approverId" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "autoDecidedBy" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryStructure" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalaryStructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRule" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "RuleType" NOT NULL,
    "amount" DECIMAL(18,2),
    "percentage" DECIMAL(8,4),
    "baseCode" TEXT,
    "formula" TEXT,
    "conditionFormula" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalaryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payrun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "salaryStructureId" TEXT NOT NULL,
    "status" "PayrunStatus" NOT NULL,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMPTZ(3),
    "reopenReason" TEXT,
    "expectedWorkDays" INTEGER NOT NULL,
    "computedAt" TIMESTAMPTZ(3),
    "validatedAt" TIMESTAMPTZ(3),
    "paidAt" TIMESTAMPTZ(3),
    "inputSnapshotHash" TEXT,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payrun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrunEmployee" (
    "payrunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "includedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excludedAt" TIMESTAMPTZ(3),
    "exclusionReason" TEXT,

    CONSTRAINT "PayrunEmployee_pkey" PRIMARY KEY ("payrunId","employeeId")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "payslipRef" TEXT NOT NULL,
    "payrunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "structureId" TEXT NOT NULL,
    "status" "PayslipStatus" NOT NULL,
    "expectedDays" INTEGER NOT NULL,
    "workedDays" DECIMAL(6,2) NOT NULL,
    "paidLeaveDays" DECIMAL(6,2) NOT NULL,
    "unpaidLeaveDays" DECIMAL(6,2) NOT NULL,
    "overtimeMinutes" INTEGER NOT NULL,
    "gross" DECIMAL(18,2) NOT NULL,
    "totalDeductions" DECIMAL(18,2) NOT NULL,
    "net" DECIMAL(18,2) NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryError" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayslipLine" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "formulaSnapshot" TEXT NOT NULL,
    "inputsSnapshot" JSONB NOT NULL,
    "sourceRefs" JSONB NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "PayslipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "contractId" TEXT,
    "category" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "visibility" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");

-- CreateIndex
CREATE INDEX "Department_managerId_idx" ON "Department"("managerId");

-- CreateIndex
CREATE INDEX "JobPosition_departmentId_idx" ON "JobPosition"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingSchedule_name_key" ON "WorkingSchedule"("name");

-- CreateIndex
CREATE INDEX "ScheduleLine_scheduleId_dayOfWeek_idx" ON "ScheduleLine"("scheduleId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleLine_scheduleId_dayOfWeek_startTime_key" ON "ScheduleLine"("scheduleId", "dayOfWeek", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_name_key" ON "Holiday"("date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Employee_departmentId_status_idx" ON "Employee"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Employee_managerId_idx" ON "Employee"("managerId");

-- CreateIndex
CREATE INDEX "Employee_lastName_id_idx" ON "Employee"("lastName", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_contractRef_key" ON "Contract"("contractRef");

-- CreateIndex
CREATE INDEX "Contract_employeeId_startDate_endDate_idx" ON "Contract"("employeeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "Contract_status_endDate_idx" ON "Contract"("status", "endDate");

-- CreateIndex
CREATE INDEX "Attendance_date_status_idx" ON "Attendance"("date", "status");

-- CreateIndex
CREATE INDEX "Attendance_employeeId_date_idx" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_name_key" ON "LeaveType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "LeaveType"("code");

-- CreateIndex
CREATE INDEX "LeaveAllocation_employeeId_leaveTypeId_idx" ON "LeaveAllocation"("employeeId", "leaveTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveAllocation_employeeId_leaveTypeId_validFrom_key" ON "LeaveAllocation"("employeeId", "leaveTypeId", "validFrom");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_status_idx" ON "LeaveRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_fromDate_idx" ON "LeaveRequest"("status", "fromDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_approverId_status_idx" ON "LeaveRequest"("approverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryStructure_code_key" ON "SalaryStructure"("code");

-- CreateIndex
CREATE INDEX "SalaryRule_structureId_sequence_idx" ON "SalaryRule"("structureId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRule_structureId_code_ruleVersion_key" ON "SalaryRule"("structureId", "code", "ruleVersion");

-- CreateIndex
CREATE INDEX "Payrun_status_periodStart_idx" ON "Payrun"("status", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Payrun_periodStart_salaryStructureId_key" ON "Payrun"("periodStart", "salaryStructureId");

-- CreateIndex
CREATE INDEX "PayrunEmployee_employeeId_idx" ON "PayrunEmployee"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payslipRef_key" ON "Payslip"("payslipRef");

-- CreateIndex
CREATE INDEX "Payslip_employeeId_periodStart_idx" ON "Payslip"("employeeId", "periodStart");

-- CreateIndex
CREATE INDEX "Payslip_payrunId_status_idx" ON "Payslip"("payrunId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_payrunId_employeeId_key" ON "Payslip"("payrunId", "employeeId");

-- CreateIndex
CREATE INDEX "PayslipLine_payslipId_sequence_idx" ON "PayslipLine"("payslipId", "sequence");

-- CreateIndex
CREATE INDEX "Document_employeeId_category_idx" ON "Document"("employeeId", "category");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_at_idx" ON "AuditEvent"("entityType", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_at_idx" ON "AuditEvent"("actorId", "at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosition" ADD CONSTRAINT "JobPosition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleLine" ADD CONSTRAINT "ScheduleLine_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkingSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_jobPositionId_fkey" FOREIGN KEY ("jobPositionId") REFERENCES "JobPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_workingScheduleId_fkey" FOREIGN KEY ("workingScheduleId") REFERENCES "WorkingSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeBankDetail" ADD CONSTRAINT "EmployeeBankDetail_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_jobPositionId_fkey" FOREIGN KEY ("jobPositionId") REFERENCES "JobPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_workingScheduleId_fkey" FOREIGN KEY ("workingScheduleId") REFERENCES "WorkingSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRule" ADD CONSTRAINT "SalaryRule_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payrun" ADD CONSTRAINT "Payrun_salaryStructureId_fkey" FOREIGN KEY ("salaryStructureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payrun" ADD CONSTRAINT "Payrun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrunEmployee" ADD CONSTRAINT "PayrunEmployee_payrunId_fkey" FOREIGN KEY ("payrunId") REFERENCES "Payrun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrunEmployee" ADD CONSTRAINT "PayrunEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_payrunId_fkey" FOREIGN KEY ("payrunId") REFERENCES "Payrun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "SalaryStructure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayslipLine" ADD CONSTRAINT "PayslipLine_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
