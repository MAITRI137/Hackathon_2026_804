import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import {
  assertNoBlockingIssues,
  assertStatus,
  evaluatePayrun,
  writeAudit,
} from '../services/payrun-decision.js';

export const payrunRouter = Router();

const payrunParams = z.object({ id: z.string().min(1) });
const bankInput = z.object({
  employeeId: z.string().min(1),
  accountName: z.string().trim().min(1).max(120),
  accountNumber: z.string().regex(/^\d{9,18}$/),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  bankName: z.string().trim().min(1).max(120),
});
const attendanceInput = z.object({
  attendanceId: z.string().min(1),
  checkOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  reason: z.string().trim().min(3).max(500),
});

const receipt = (item: {
  payrunId: string;
  snapshotHash: string;
  readinessScore: number;
  blockingExceptionCount: number;
  employeeCount: number;
  netTotal: { toFixed: (digits: number) => string };
  preparedById: string;
  preparedByName: string;
  preparedAt: Date;
  validatedById: string | null;
  validatedByName: string | null;
  validatedAt: Date | null;
  paidById: string | null;
  paidByName: string | null;
  paidAt: Date | null;
}) => ({
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
  validatedAt: item.validatedAt?.toISOString() ?? null,
  paidById: item.paidById,
  paidByName: item.paidByName,
  paidAt: item.paidAt?.toISOString() ?? null,
});

payrunRouter.post('/payruns/:id/compute', requirePermission('payrun.compute'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const actor = request.currentUser!;
  const result = await prisma.$transaction(async (tx) => {
    const evaluation = await evaluatePayrun(tx, id);
    if (!['DRAFT', 'COMPUTED'].includes(evaluation.payrun.status)) {
      throw new AppError('INVALID_PAYRUN_STATE', 409, 'Paid or validated payroll cannot be recomputed.');
    }
    const now = new Date();
    const updated = await tx.payrun.update({
      where: { id },
      data: {
        status: 'COMPUTED',
        computedAt: now,
        inputSnapshotHash: evaluation.snapshotHash,
        version: { increment: 1 },
      },
    });
    await writeAudit(
      tx,
      actor,
      'PAYRUN_COMPUTED',
      'Payrun',
      id,
      `${updated.name} computed from ${evaluation.employeeCount} employees; readiness ${evaluation.readinessScore}%.`,
    );
    return { updated, evaluation };
  });
  response.json({
    data: {
      payrunId: result.updated.id,
      status: result.updated.status,
      snapshotHash: result.evaluation.snapshotHash,
      readinessScore: result.evaluation.readinessScore,
      blockingExceptionCount: result.evaluation.issues.length,
      employeeCount: result.evaluation.employeeCount,
      netTotal: result.evaluation.netTotal,
    },
  });
});

payrunRouter.post(
  '/payruns/:id/blockers/bank/resolve',
  requirePermission('payrun.validate'),
  async (request, response) => {
    const { id } = payrunParams.parse(request.params);
    const input = bankInput.parse(request.body);
    const actor = request.currentUser!;
    await prisma.$transaction(async (tx) => {
      const payrun = await tx.payrun.findUnique({ where: { id } });
      if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
      if (payrun.status === 'PAID' || payrun.status === 'VALIDATED') {
        throw new AppError('PAYRUN_LOCKED', 409, 'Payroll inputs are locked after validation.');
      }
      const member = await tx.payrunEmployee.findUnique({
        where: { payrunId_employeeId: { payrunId: id, employeeId: input.employeeId } },
      });
      if (!member || member.excludedAt) {
        throw new AppError('EMPLOYEE_NOT_IN_PAYRUN', 409, 'This employee is not included in the payroll run.');
      }
      await tx.employeeBankDetail.upsert({
        where: { employeeId: input.employeeId },
        create: {
          employeeId: input.employeeId,
          accountName: input.accountName,
          accountNumberMasked: `••••${input.accountNumber.slice(-4)}`,
          ifsc: input.ifsc,
          bankName: input.bankName,
          verifiedAt: new Date(),
        },
        update: {
          accountName: input.accountName,
          accountNumberMasked: `••••${input.accountNumber.slice(-4)}`,
          ifsc: input.ifsc,
          bankName: input.bankName,
          verifiedAt: new Date(),
        },
      });
      await writeAudit(tx, actor, 'BANK_VERIFIED', 'Employee', input.employeeId, 'Bank details saved and verified for payroll.');
    });
    response.json({ data: { payrunId: id, employeeId: input.employeeId, resolved: 'MISSING_BANK' } });
  },
);

payrunRouter.post(
  '/payruns/:id/blockers/attendance/resolve',
  requirePermission('attendance.correct'),
  async (request, response) => {
    const { id } = payrunParams.parse(request.params);
    const input = attendanceInput.parse(request.body);
    const actor = request.currentUser!;
    await prisma.$transaction(async (tx) => {
      const [payrun, attendance] = await Promise.all([
        tx.payrun.findUnique({ where: { id } }),
        tx.attendance.findUnique({ where: { id: input.attendanceId } }),
      ]);
      if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
      if (!attendance) throw new AppError('ATTENDANCE_NOT_FOUND', 404, 'Attendance record not found.');
      if (payrun.status === 'PAID' || payrun.status === 'VALIDATED') {
        throw new AppError('PAYRUN_LOCKED', 409, 'Payroll inputs are locked after validation.');
      }
      const member = await tx.payrunEmployee.findUnique({
        where: { payrunId_employeeId: { payrunId: id, employeeId: attendance.employeeId } },
      });
      if (!member || member.excludedAt || !attendance.checkIn) {
        throw new AppError('ATTENDANCE_NOT_ELIGIBLE', 409, 'This attendance record cannot resolve this payroll run.');
      }
      const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      if (minutes(input.checkOut) <= minutes(attendance.checkIn)) {
        throw new AppError('INVALID_CHECKOUT', 400, 'Checkout must be after check-in.');
      }
      await tx.attendance.update({
        where: { id: attendance.id },
        data: {
          checkOut: input.checkOut,
          workedMinutes: minutes(input.checkOut) - minutes(attendance.checkIn) - 60,
          status: 'PRESENT',
          source: 'MANAGER',
          correctionReason: input.reason,
          correctedById: actor.id,
          correctedAt: new Date(),
        },
      });
      await writeAudit(tx, actor, 'ATTENDANCE_CORRECTED', 'Attendance', attendance.id, `Checkout set to ${input.checkOut}: ${input.reason}`);
    });
    response.json({ data: { payrunId: id, attendanceId: input.attendanceId, resolved: 'MISSING_CHECKOUT' } });
  },
);

payrunRouter.post('/payruns/:id/validate', requirePermission('payrun.validate'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const actor = request.currentUser!;
  const created = await prisma.$transaction(async (tx) => {
    const evaluation = await evaluatePayrun(tx, id);
    assertStatus(evaluation.payrun, 'COMPUTED');
    assertNoBlockingIssues(evaluation);
    if (evaluation.payrun.inputSnapshotHash !== evaluation.snapshotHash) {
      throw new AppError(
        'PAYRUN_INPUTS_CHANGED',
        409,
        'Payroll inputs changed since the last compute.',
        'Recompute this payroll run before validating it.',
      );
    }
    const now = new Date();
    await tx.payrun.update({
      where: { id },
      data: { status: 'VALIDATED', validatedAt: now, version: { increment: 1 } },
    });
    const item = await tx.payrollDecisionReceipt.upsert({
      where: { payrunId: id },
      create: {
        payrunId: id,
        snapshotHash: evaluation.snapshotHash,
        readinessScore: evaluation.readinessScore,
        blockingExceptionCount: 0,
        employeeCount: evaluation.employeeCount,
        netTotal: evaluation.netTotal,
        preparedById: evaluation.payrun.createdById,
        preparedByName: actor.displayName,
        preparedAt: evaluation.payrun.computedAt ?? now,
        validatedById: actor.id,
        validatedByName: actor.displayName,
        validatedAt: now,
      },
      update: {
        snapshotHash: evaluation.snapshotHash,
        readinessScore: evaluation.readinessScore,
        blockingExceptionCount: 0,
        employeeCount: evaluation.employeeCount,
        netTotal: evaluation.netTotal,
        validatedById: actor.id,
        validatedByName: actor.displayName,
        validatedAt: now,
      },
    });
    await writeAudit(tx, actor, 'PAYRUN_VALIDATED', 'Payrun', id, `${evaluation.payrun.name} validated with a 100% readiness score.`);
    return item;
  });
  response.json({ data: { receipt: receipt(created) } });
});

payrunRouter.post('/payruns/:id/mark-paid', requirePermission('payrun.pay'), async (request, response) => {
  const { id } = payrunParams.parse(request.params);
  const actor = request.currentUser!;
  const updated = await prisma.$transaction(async (tx) => {
    const evaluation = await evaluatePayrun(tx, id);
    assertStatus(evaluation.payrun, 'VALIDATED');
    assertNoBlockingIssues(evaluation);
    const existing = await tx.payrollDecisionReceipt.findUnique({ where: { payrunId: id } });
    if (!existing || existing.snapshotHash !== evaluation.snapshotHash) {
      throw new AppError('PAYRUN_INPUTS_CHANGED', 409, 'The validated evidence is no longer current.', 'Recompute and validate before payment.');
    }
    const now = new Date();
    await tx.payrun.update({
      where: { id },
      data: { status: 'PAID', paidAt: now, isFrozen: true, frozenAt: now, version: { increment: 1 } },
    });
    const item = await tx.payrollDecisionReceipt.update({
      where: { payrunId: id },
      data: { paidById: actor.id, paidByName: actor.displayName, paidAt: now },
    });
    await writeAudit(tx, actor, 'PAYRUN_PAID', 'Payrun', id, `${evaluation.payrun.name} marked paid with immutable decision evidence.`);
    return item;
  });
  response.json({ data: { receipt: receipt(updated) } });
});
