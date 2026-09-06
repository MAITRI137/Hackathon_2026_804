import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';

const origin = 'http://localhost:5173';
const payrunId = 'PR-2026-09';
const bankEmployeeId = 'EMP-003';
const attendanceIds = ['att-EMP-001-2026-09-05', 'att-EMP-004-2026-09-03'];

async function signedInAgent(email: string) {
  const agent = request.agent(createApp());
  await agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email, password: 'PeoplePay360!2026' })
    .expect(200);
  return agent;
}

describe('persisted payroll decision workflow', () => {
  let originalPayrun: Awaited<ReturnType<typeof prisma.payrun.findUniqueOrThrow>>;
  let originalAttendance: Awaited<ReturnType<typeof prisma.attendance.findMany>>;

  beforeAll(async () => {
    originalPayrun = await prisma.payrun.findUniqueOrThrow({ where: { id: payrunId } });
    originalAttendance = await prisma.attendance.findMany({ where: { id: { in: attendanceIds } } });
  });

  afterAll(async () => {
    await prisma.$transaction([
      prisma.payrollDecisionReceipt.deleteMany({ where: { payrunId } }),
      prisma.auditEvent.deleteMany({
        where: {
          entityId: { in: [payrunId, bankEmployeeId, ...attendanceIds] },
          action: { in: ['PAYRUN_COMPUTED', 'PAYRUN_VALIDATED', 'PAYRUN_PAID', 'BANK_VERIFIED', 'ATTENDANCE_CORRECTED'] },
        },
      }),
      prisma.employeeBankDetail.deleteMany({ where: { employeeId: bankEmployeeId } }),
      ...originalAttendance.map((attendance) =>
        prisma.attendance.update({
          where: { id: attendance.id },
          data: {
            checkOut: attendance.checkOut,
            workedMinutes: attendance.workedMinutes,
            status: attendance.status,
            source: attendance.source,
            correctionReason: attendance.correctionReason,
            correctedById: attendance.correctedById,
            correctedAt: attendance.correctedAt,
          },
        }),
      ),
      // Compute persists payslips, so restoring the payrun means removing the
      // rows it produced; leaving them would let the next run start validated.
      prisma.payslipLine.deleteMany({ where: { payslip: { payrunId } } }),
      prisma.payslip.deleteMany({ where: { payrunId } }),
      prisma.idempotencyKey.deleteMany({ where: { scope: { startsWith: 'payrun.' } } }),
      prisma.payrun.update({
        where: { id: payrunId },
        data: {
          status: originalPayrun.status,
          isFrozen: originalPayrun.isFrozen,
          frozenAt: originalPayrun.frozenAt,
          computedAt: originalPayrun.computedAt,
          validatedAt: originalPayrun.validatedAt,
          paidAt: originalPayrun.paidAt,
          inputSnapshotHash: originalPayrun.inputSnapshotHash,
          version: originalPayrun.version,
        },
      }),
    ]);
  });

  it('persists source corrections and creates a decision receipt before payment', { timeout: 120_000 }, async () => {
    const agent = await signedInAgent('maitri.shah@peoplepay360.com');

    await agent.post(`/api/payruns/${payrunId}/compute`).set('Origin', origin).expect(200);
    await agent.post(`/api/payruns/${payrunId}/validate`).set('Origin', origin).expect(409);

    await agent
      .post(`/api/payruns/${payrunId}/blockers/bank/resolve`)
      .set('Origin', origin)
      .send({
        employeeId: bankEmployeeId,
        accountName: 'Rahul Sharma',
        accountNumber: '987654321012',
        ifsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
      })
      .expect(200);
    for (const attendanceId of attendanceIds) {
      await agent
        .post(`/api/payruns/${payrunId}/blockers/attendance/resolve`)
        .set('Origin', origin)
        .send({ attendanceId, checkOut: '18:00', reason: 'Employee confirmed the checkout time.' })
        .expect(200);
    }

    await agent.post(`/api/payruns/${payrunId}/compute`).set('Origin', origin).expect(200);
    await agent.post(`/api/payruns/${payrunId}/validate`).set('Origin', origin).expect(200);
    const paid = await agent.post(`/api/payruns/${payrunId}/mark-paid`).set('Origin', origin).expect(200);

    expect(paid.body.data.receipt).toMatchObject({
      payrunId,
      status: 'PAID',
      readinessScore: 100,
      blockingExceptionCount: 0,
      employeeCount: 297,
      validatedByName: 'Maitri Shah',
      paidByName: 'Maitri Shah',
    });
    expect(paid.body.data.receipt.netTotal).toMatch(/^\d+\.\d{2}$/);

    const bootstrap = await agent.get('/api/bootstrap').expect(200);
    expect(bootstrap.body.data.payruns.find((payrun: { id: string }) => payrun.id === payrunId)).toMatchObject({
      status: 'PAID',
      isFrozen: true,
    });
    expect(bootstrap.body.data.decisionReceipts).toContainEqual(
      expect.objectContaining({ payrunId, status: 'PAID' }),
    );
  });

  it('measures a database-backed readiness scan for administrators', async () => {
    const agent = await signedInAgent('admin@peoplepay360.com');
    const response = await agent.post('/api/ops/readiness-scan').set('Origin', origin).expect(200);

    expect(response.body.data).toMatchObject({
      totalRecords: expect.any(Number),
      payrunsScanned: expect.any(Number),
      employeesScanned: expect.any(Number),
      durationMs: expect.any(Number),
    });
    expect(response.body.data.totalRecords).toBeGreaterThanOrEqual(5000);
    expect(response.body.data.employeesScanned).toBeGreaterThanOrEqual(297);
  });
});
