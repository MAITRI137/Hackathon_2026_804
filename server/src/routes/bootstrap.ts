import { Router } from 'express';

import { roleHasPermission } from '../core/rbac/matrix.js';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

export const bootstrapRouter = Router();

/** How much of the largest tables the browser keeps resident. */
const ATTENDANCE_WORKING_SET = 4000;
const ALLOCATION_WORKING_SET = 4000;
/** Recent-activity window for the shared attendance list. */
const WORKING_SET_FROM = new Date('2026-09-01T00:00:00.000Z');

const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const isoInstant = (value: Date | null) => value?.toISOString() ?? null;
const withoutTimestamps = <T extends { createdAt: unknown; updatedAt: unknown }>(value: T) => {
  const { createdAt, updatedAt, ...rest } = value;
  void createdAt;
  void updatedAt;
  return rest;
};
const withoutUpdatedAt = <T extends { updatedAt: unknown }>(value: T) => {
  const { updatedAt, ...rest } = value;
  void updatedAt;
  return rest;
};

bootstrapRouter.get('/bootstrap', requireAuth, async (request, response) => {
  const user = request.currentUser!;
  const selfWhere = user.role === 'EMPLOYEE' ? { employeeId: user.employeeId ?? '__none__' } : {};
  const canReadSalary = roleHasPermission(user.role, 'salary.structure.read');
  const canReadPayruns = roleHasPermission(user.role, 'payrun.read');
  const canReadAllPayslips = roleHasPermission(user.role, 'payslip.read.all');
  const canReadAudit = roleHasPermission(user.role, 'audit.read');

  // A person is entitled to the rules that computed their own pay — that is
  // what the payslip explanation shows them line by line. Callers without
  // salary-configuration access therefore receive the rules for the structures
  // their own contracts reference, and nothing else.
  const ownStructureIds = canReadSalary
    ? undefined
    : (
        await prisma.contract.findMany({
          where: { employeeId: user.employeeId ?? '__none__' },
          select: { salaryStructureId: true },
          distinct: ['salaryStructureId'],
        })
      ).map((row) => row.salaryStructureId);

  const [
    departments,
    jobPositions,
    schedules,
    holidays,
    leaveTypes,
    employees,
    contracts,
    attendance,
    leaveAllocations,
    leaveRequests,
    salaryStructures,
    salaryRules,
    payruns,
    decisionReceipts,
    payslips,
    documents,
    audit,
  ] = await prisma.$transaction([
    prisma.department.findMany({ orderBy: { name: 'asc' } }),
    prisma.jobPosition.findMany({ orderBy: [{ departmentId: 'asc' }, { title: 'asc' }] }),
    prisma.workingSchedule.findMany({ include: { lines: { orderBy: { dayOfWeek: 'asc' } } } }),
    prisma.holiday.findMany({ orderBy: { date: 'asc' } }),
    prisma.leaveType.findMany({ orderBy: { name: 'asc' } }),
    prisma.employee.findMany({
      where: user.role === 'EMPLOYEE' ? { id: user.employeeId ?? '__none__' } : {},
      include: { bank: true },
      orderBy: [{ lastName: 'asc' }, { id: 'asc' }],
    }),
    prisma.contract.findMany({ where: selfWhere, orderBy: { startDate: 'desc' } }),
    // At 5,000 employees the punch log is the largest table in the product.
    // The client receives a bounded working set — every open check-in (those
    // are payroll exceptions), the signed-in person's own record, and the most
    // recent activity — while totals come from the aggregates below.
    prisma.attendance.findMany({
      where:
        user.role === 'EMPLOYEE'
          ? selfWhere
          : {
              OR: [{ checkIn: { not: null }, checkOut: null }, { date: { gte: WORKING_SET_FROM } }],
            },
      orderBy: [{ date: 'desc' }, { employeeId: 'asc' }],
      take: ATTENDANCE_WORKING_SET,
    }),
    prisma.leaveAllocation.findMany({
      where: selfWhere,
      orderBy: { validFrom: 'desc' },
      take: user.role === 'EMPLOYEE' ? 50 : ALLOCATION_WORKING_SET,
    }),
    prisma.leaveRequest.findMany({ where: selfWhere, orderBy: { createdAt: 'desc' } }),
    prisma.salaryStructure.findMany({
      where: canReadSalary ? {} : { id: { in: ownStructureIds ?? [] } },
      orderBy: { name: 'asc' },
    }),
    prisma.salaryRule.findMany({
      where: canReadSalary ? {} : { structureId: { in: ownStructureIds ?? [] } },
      orderBy: [{ sequence: 'asc' }, { code: 'asc' }],
    }),
    // A period is not confidential; what it paid other people is. Callers
    // without payrun administration receive every payrun they themselves were
    // part of, with the membership list scoped to them alone — enough to see
    // their own pay history, and nothing about anyone else's.
    prisma.payrun.findMany({
      where: canReadPayruns
        ? {}
        : { employees: { some: { employeeId: user.employeeId ?? '__none__' } } },
      include: {
        employees: canReadPayruns ? true : { where: { employeeId: user.employeeId ?? '__none__' } },
      },
      orderBy: { periodStart: 'asc' },
    }),
    prisma.payrollDecisionReceipt.findMany({
      where: canReadPayruns ? {} : { payrunId: '__none__' },
      orderBy: { preparedAt: 'desc' },
    }),
    prisma.payslip.findMany({
      where: canReadAllPayslips ? {} : { employeeId: user.employeeId ?? '__none__' },
      include: { lines: { orderBy: { sequence: 'asc' } } },
      orderBy: { periodStart: 'desc' },
    }),
    prisma.document.findMany({
      where:
        user.role === 'EMPLOYEE'
          ? { OR: [{ employeeId: user.employeeId }, { employeeId: null }] }
          : {},
      orderBy: { uploadedAt: 'desc' },
    }),
    canReadAudit
      ? prisma.auditEvent.findMany({ orderBy: { at: 'desc' }, take: 500 })
      : prisma.auditEvent.findMany({ where: { id: '__none__' } }),
  ]);

  // Totals and per-status counts are aggregated in SQL. A screen never loads a
  // collection in order to count or chart it.
  const [
    employeeCount,
    contractCount,
    bankDetailCount,
    attendanceCount,
    allocationCount,
    leaveRequestCount,
    leaveTypeCount,
    payrunCount,
    payrunMemberCount,
    decisionReceiptCount,
    payslipCount,
    documentCount,
    auditCount,
    departmentCount,
    jobPositionCount,
    scheduleCount,
    scheduleLineCount,
    holidayCount,
    structureCount,
    ruleCount,
    userCount,
    attendanceByStatus,
  ] = await prisma.$transaction([
    prisma.employee.count(),
    prisma.contract.count(),
    prisma.employeeBankDetail.count(),
    prisma.attendance.count(),
    prisma.leaveAllocation.count(),
    prisma.leaveRequest.count(),
    prisma.leaveType.count(),
    prisma.payrun.count(),
    prisma.payrunEmployee.count(),
    prisma.payrollDecisionReceipt.count(),
    prisma.payslip.count(),
    prisma.document.count(),
    prisma.auditEvent.count(),
    prisma.department.count(),
    prisma.jobPosition.count(),
    prisma.workingSchedule.count(),
    prisma.scheduleLine.count(),
    prisma.holiday.count(),
    prisma.salaryStructure.count(),
    prisma.salaryRule.count(),
    prisma.user.count(),
    prisma.attendance.groupBy({
      by: ['status'],
      _count: true,
      orderBy: { status: 'asc' },
      where: { date: { gte: WORKING_SET_FROM } },
    }),
  ]);
  // Report what this request actually read, so the operations console shows
  // live read volume measured at the boundary rather than an estimate.
  response.locals.recordsRead =
    departments.length +
    jobPositions.length +
    schedules.length +
    holidays.length +
    leaveTypes.length +
    employees.length +
    contracts.length +
    attendance.length +
    leaveAllocations.length +
    leaveRequests.length +
    salaryStructures.length +
    salaryRules.length +
    payruns.length +
    decisionReceipts.length +
    payslips.length +
    documents.length +
    audit.length;

  response.json({
    data: {
      session: { user },
      counts: {
        employees: employeeCount,
        contracts: contractCount,
        bankDetails: bankDetailCount,
        attendance: attendanceCount,
        leaveAllocations: allocationCount,
        leaveRequests: leaveRequestCount,
        leaveTypes: leaveTypeCount,
        payruns: payrunCount,
        payrunMemberships: payrunMemberCount,
        payrollDecisionReceipts: decisionReceiptCount,
        payslips: payslipCount,
        documents: documentCount,
        auditEvents: auditCount,
        departments: departmentCount,
        jobPositions: jobPositionCount,
        workingSchedules: scheduleCount,
        scheduleLines: scheduleLineCount,
        holidays: holidayCount,
        salaryStructures: structureCount,
        salaryRules: ruleCount,
        users: userCount,
        // "Total" means every persisted row, so the figure a screen shows is
        // the dataset size and not a subset that happens to be interesting.
        total:
          employeeCount +
          contractCount +
          bankDetailCount +
          attendanceCount +
          allocationCount +
          leaveRequestCount +
          leaveTypeCount +
          payrunCount +
          payrunMemberCount +
          decisionReceiptCount +
          payslipCount +
          documentCount +
          auditCount +
          departmentCount +
          jobPositionCount +
          scheduleCount +
          scheduleLineCount +
          holidayCount +
          structureCount +
          ruleCount +
          userCount,
      },
      attendanceSummary: Object.fromEntries(
        attendanceByStatus.map((row) => [row.status, row._count]),
      ),
      departments: departments.map((item) => ({
        ...item,
        monthlyBudget: item.monthlyBudget.toFixed(2),
      })),
      jobPositions,
      schedules: schedules.map(({ lines, ...schedule }) => ({
        ...schedule,
        hoursPerWeek: schedule.hoursPerWeek.toNumber(),
        createdAt: schedule.createdAt.toISOString(),
        updatedAt: schedule.updatedAt.toISOString(),
        lines: lines.map((line) => ({
          dayOfWeek: line.dayOfWeek,
          start: line.startTime,
          end: line.endTime,
          breakMinutes: line.breakMinutes,
        })),
      })),
      holidays: holidays.map((item) => ({ ...item, date: isoDate(item.date) })),
      leaveTypes: leaveTypes.map((item) => ({
        ...item,
        carryForwardMax: item.carryForwardMax.toNumber(),
        accrualPerMonth: item.accrualPerMonth.toNumber(),
      })),
      employees: employees.map((employee) => {
        const { bank, ...item } = withoutTimestamps(employee);
        return {
          ...item,
          joinDate: isoDate(item.joinDate),
          exitDate: item.exitDate ? isoDate(item.exitDate) : null,
          probationEndDate: item.probationEndDate ? isoDate(item.probationEndDate) : null,
          bank: bank
            ? {
                accountName: bank.accountName,
                accountNumberMasked: bank.accountNumberMasked,
                ifsc: bank.ifsc,
                bankName: bank.bankName,
                verifiedAt: isoInstant(bank.verifiedAt),
              }
            : null,
        };
      }),
      contracts: contracts.map((contract) => {
        const item = withoutTimestamps(contract);
        return {
          ...item,
          startDate: isoDate(item.startDate),
          endDate: item.endDate ? isoDate(item.endDate) : null,
          wage: item.wage.toFixed(2),
        };
      }),
      attendance: attendance.map((record) => {
        const item = withoutTimestamps(record);
        return { ...item, date: isoDate(item.date), correctedAt: isoInstant(item.correctedAt) };
      }),
      leaveAllocations: leaveAllocations.map((allocation) => {
        const item = withoutTimestamps(allocation);
        return {
          ...item,
          allocated: item.allocated.toNumber(),
          used: item.used.toNumber(),
          carriedForward: item.carriedForward.toNumber(),
          validFrom: isoDate(item.validFrom),
          validTo: isoDate(item.validTo),
        };
      }),
      leaveRequests: leaveRequests.map((request) => {
        const item = withoutUpdatedAt(request);
        return {
          ...item,
          fromDate: isoDate(item.fromDate),
          toDate: isoDate(item.toDate),
          days: item.days.toNumber(),
          decidedAt: isoInstant(item.decidedAt),
          createdAt: item.createdAt.toISOString(),
        };
      }),
      salaryStructures: salaryStructures.map(withoutTimestamps),
      salaryRules: salaryRules.map((rule) => {
        const item = withoutTimestamps(rule);
        return {
          ...item,
          amount: item.amount?.toFixed(2) ?? null,
          percentage: item.percentage?.toString() ?? null,
        };
      }),
      payruns: payruns.map((payrun) => {
        const { employees: selected, ...item } = withoutTimestamps(payrun);
        return {
          ...item,
          periodStart: isoDate(item.periodStart),
          periodEnd: isoDate(item.periodEnd),
          frozenAt: isoInstant(item.frozenAt),
          computedAt: isoInstant(item.computedAt),
          validatedAt: isoInstant(item.validatedAt),
          paidAt: isoInstant(item.paidAt),
          employeeIds: selected
            .filter((entry) => !entry.excludedAt)
            .map((entry) => entry.employeeId),
        };
      }),
      decisionReceipts: decisionReceipts.map((item) => ({
        payrunId: item.payrunId,
        status: item.paidAt ? 'PAID' : 'VALIDATED',
        snapshotHash: item.snapshotHash,
        readinessScore: item.readinessScore,
        blockingExceptionCount: item.blockingExceptionCount,
        employeeCount: item.employeeCount,
        netTotal: item.netTotal.toFixed(2),
        preparedById: item.preparedById,
        preparedByName: item.preparedByName,
        preparedAt: item.preparedAt.toISOString(),
        validatedById: item.validatedById,
        validatedByName: item.validatedByName,
        validatedAt: isoInstant(item.validatedAt),
        paidById: item.paidById,
        paidByName: item.paidByName,
        paidAt: isoInstant(item.paidAt),
      })),
      payslips: payslips.map(({ lines, ...item }) => ({
        ...item,
        periodStart: isoDate(item.periodStart),
        periodEnd: isoDate(item.periodEnd),
        workedDays: item.workedDays.toNumber(),
        paidLeaveDays: item.paidLeaveDays.toNumber(),
        unpaidLeaveDays: item.unpaidLeaveDays.toNumber(),
        gross: item.gross.toFixed(2),
        totalDeductions: item.totalDeductions.toFixed(2),
        net: item.net.toFixed(2),
        computedAt: item.computedAt.toISOString(),
        deliveredAt: isoInstant(item.deliveredAt),
        delivery: item.deliveryStatus,
        lines: lines.map((line) => ({ ...line, amount: line.amount.toFixed(2) })),
      })),
      documents: documents.map((item) => ({
        ...item,
        uploadedAt: item.uploadedAt.toISOString(),
        acknowledgedAt: isoInstant(item.acknowledgedAt),
      })),
      audit: audit.map((item) => ({ ...item, at: item.at.toISOString() })),
    },
  });
});
