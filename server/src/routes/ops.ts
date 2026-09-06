import { Router } from 'express';

import { metrics } from '../core/metrics.js';
import { prisma } from '../db/prisma.js';
import { requirePermission } from '../middleware/auth.js';
import { evaluatePayrun } from '../services/payrun-decision.js';

export const opsRouter = Router();

/**
 * A deliberate, operator-triggered payroll preflight. Unlike the background
 * telemetry poll, this runs the same server-side readiness evaluation that
 * guards validation and reports its measured duration.
 */
opsRouter.post('/ops/readiness-scan', requirePermission('ops.dashboard'), async (_request, response) => {
  const startedAt = process.hrtime.bigint();
  const [payruns, employees, totalRecords] = await prisma.$transaction([
    prisma.payrun.findMany({ select: { id: true } }),
    prisma.employee.count(),
    prisma.$queryRaw<[{ total: bigint }]>`
      SELECT
        (SELECT COUNT(*) FROM "User") +
        (SELECT COUNT(*) FROM "Department") +
        (SELECT COUNT(*) FROM "JobPosition") +
        (SELECT COUNT(*) FROM "WorkingSchedule") +
        (SELECT COUNT(*) FROM "ScheduleLine") +
        (SELECT COUNT(*) FROM "Holiday") +
        (SELECT COUNT(*) FROM "Employee") +
        (SELECT COUNT(*) FROM "EmployeeBankDetail") +
        (SELECT COUNT(*) FROM "Contract") +
        (SELECT COUNT(*) FROM "Attendance") +
        (SELECT COUNT(*) FROM "LeaveType") +
        (SELECT COUNT(*) FROM "LeaveAllocation") +
        (SELECT COUNT(*) FROM "LeaveRequest") +
        (SELECT COUNT(*) FROM "SalaryStructure") +
        (SELECT COUNT(*) FROM "SalaryRule") +
        (SELECT COUNT(*) FROM "Payrun") +
        (SELECT COUNT(*) FROM "PayrunEmployee") +
        (SELECT COUNT(*) FROM "Payslip") +
        (SELECT COUNT(*) FROM "Document") +
        (SELECT COUNT(*) FROM "AuditEvent") AS total
    `,
  ]);
  const evaluations = await prisma.$transaction((tx) =>
    Promise.all(payruns.map((payrun) => evaluatePayrun(tx, payrun.id))),
  );
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  metrics.recordQuery(durationMs);
  response.locals.recordsRead = employees + payruns.length;
  response.json({
    data: {
      totalRecords: Number(totalRecords[0]?.total ?? 0),
      payrunsScanned: evaluations.length,
      employeesScanned: employees,
      readyPayruns: evaluations.filter((evaluation) => evaluation.issues.length === 0).length,
      blockingExceptions: evaluations.reduce((sum, evaluation) => sum + evaluation.issues.length, 0),
      durationMs: Number(durationMs.toFixed(1)),
      scannedAt: new Date().toISOString(),
    },
  });
});

/**
 * Live operations telemetry for the administration console.
 *
 * Everything here is measured, never simulated: table counts come from the
 * database, latency is timed around a real query, and request rates come from
 * the in-process registry that observes every call.
 *
 * The payload is deliberately anonymous. It answers "what is the system doing",
 * never "what is this person doing" — no names, no emails, no addresses.
 */
opsRouter.get('/ops/metrics', requirePermission('ops.dashboard'), async (_request, response) => {
  const startedAt = process.hrtime.bigint();

  let databaseOnline = true;
  let tables: { table: string; rows: number }[] = [];

  try {
    const [
      users,
      departments,
      jobPositions,
      workingSchedules,
      scheduleLines,
      holidays,
      employees,
      bankDetails,
      contracts,
      attendance,
      leaveTypes,
      leaveAllocations,
      leaveRequests,
      salaryStructures,
      salaryRules,
      payruns,
      payrunMemberships,
      payslips,
      documents,
      auditEvents,
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.department.count(),
      prisma.jobPosition.count(),
      prisma.workingSchedule.count(),
      prisma.scheduleLine.count(),
      prisma.holiday.count(),
      prisma.employee.count(),
      prisma.employeeBankDetail.count(),
      prisma.contract.count(),
      prisma.attendance.count(),
      prisma.leaveType.count(),
      prisma.leaveAllocation.count(),
      prisma.leaveRequest.count(),
      prisma.salaryStructure.count(),
      prisma.salaryRule.count(),
      prisma.payrun.count(),
      prisma.payrunEmployee.count(),
      prisma.payslip.count(),
      prisma.document.count(),
      prisma.auditEvent.count(),
    ]);

    tables = [
      { table: 'attendance', rows: attendance },
      { table: 'payrunMemberships', rows: payrunMemberships },
      { table: 'leaveAllocations', rows: leaveAllocations },
      { table: 'contracts', rows: contracts },
      { table: 'employees', rows: employees },
      { table: 'bankDetails', rows: bankDetails },
      { table: 'leaveRequests', rows: leaveRequests },
      { table: 'jobPositions', rows: jobPositions },
      { table: 'scheduleLines', rows: scheduleLines },
      { table: 'departments', rows: departments },
      { table: 'salaryRules', rows: salaryRules },
      { table: 'users', rows: users },
      { table: 'holidays', rows: holidays },
      { table: 'leaveTypes', rows: leaveTypes },
      { table: 'payruns', rows: payruns },
      { table: 'workingSchedules', rows: workingSchedules },
      { table: 'salaryStructures', rows: salaryStructures },
      { table: 'payslips', rows: payslips },
      { table: 'documents', rows: documents },
      { table: 'auditEvents', rows: auditEvents },
    ];
  } catch {
    databaseOnline = false;
  }

  const databaseMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const totalRecords = tables.reduce((sum, row) => sum + row.rows, 0);
  const memory = process.memoryUsage();

  metrics.recordQuery(databaseMs);
  response.locals.recordsRead = tables.length;

  const { database: queryActivity, ...snapshot } = metrics.snapshot(60);

  response.json({
    data: {
      capturedAt: new Date().toISOString(),
      database: {
        online: databaseOnline,
        roundTripMs: Number(databaseMs.toFixed(1)),
        totalRecords,
        tables: tables.sort((a, b) => b.rows - a.rows),
      },
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
        heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(1)),
        nodeVersion: process.version,
      },
      queryActivity,
      ...snapshot,
    },
  });
});
