import { createHash, randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { addMoney, money, toMoneyString } from '@shared/money.js';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { recordAudit } from '../services/audit.js';
import { idempotencyKeyFrom, runOnce } from '../services/idempotency.js';
import { notifyEmployee } from '../services/notifications.js';

export const demoPaymentRouter = Router();

const idParam = z.object({ id: z.string().min(1) });

/**
 * SIMULATION BOUNDARY — nothing in this file moves money.
 *
 * There is no payment gateway and no bank connection. What is real is the
 * workflow around one: the batch, the per-payslip item, the status, the
 * failure reason and the retry count are persisted rows that survive a refresh,
 * respect RBAC, and appear to every signed-in operator. Only the outcome is
 * invented, and it is invented deterministically so a demo can be repeated.
 */
const DEMO_NOTICE = 'Demo payment simulation — no money is transferred.';

/**
 * Decide a simulated outcome from stable inputs.
 *
 * A random failure would be untestable and would make a demo unrepeatable. The
 * outcome is a hash of the payslip id, so the same payroll always fails on the
 * same two or three people; and because the retry count is part of the hash
 * input, a retry resolves, which is what makes the retry workflow worth showing.
 */
function simulateOutcome(payslipId: string, retryCount: number) {
  const digest = createHash('sha256').update(`${payslipId}:${retryCount}`).digest();
  const fails = retryCount === 0 && digest[0]! % 17 === 0;
  return fails
    ? {
        status: 'SIMULATED_FAILURE' as const,
        failureReason: 'Beneficiary account name mismatch reported by the simulated bank.',
      }
    : { status: 'SIMULATED_SUCCESS' as const, failureReason: null };
}

const serializeBatch = (batch: {
  id: string;
  payrunId: string;
  reference: string;
  status: string;
  totalAmount: Prisma.Decimal;
  itemCount: number;
  successCount: number;
  failureCount: number;
  createdByName: string;
  createdAt: Date;
  items?: {
    id: string;
    payslipId: string;
    employeeId: string;
    amount: Prisma.Decimal;
    accountMasked: string;
    status: string;
    failureReason: string | null;
    retryCount: number;
  }[];
}) => ({
  id: batch.id,
  payrunId: batch.payrunId,
  reference: batch.reference,
  status: batch.status,
  totalAmount: batch.totalAmount.toFixed(2),
  itemCount: batch.itemCount,
  successCount: batch.successCount,
  failureCount: batch.failureCount,
  createdByName: batch.createdByName,
  createdAt: batch.createdAt.toISOString(),
  simulated: true,
  notice: DEMO_NOTICE,
  items: (batch.items ?? []).map((item) => ({
    ...item,
    amount: item.amount.toFixed(2),
  })),
});

/* ── run a simulated payout ──────────────────────────────────────────────── */

demoPaymentRouter.post(
  '/payruns/:id/demo-payment-run',
  requirePermission('payrun.pay'),
  async (request, response) => {
    const { id } = idParam.parse(request.params);
    const actor = request.currentUser!;

    const outcome = await runOnce('demo.payment', idempotencyKeyFrom(request), actor.id, { id }, async () =>
      prisma.$transaction(
        async (tx) => {
          const payrun = await tx.payrun.findUnique({ where: { id } });
          if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
          if (payrun.status !== 'VALIDATED' && payrun.status !== 'PAID') {
            throw new AppError(
              'INVALID_PAYRUN_STATE',
              409,
              'Only a validated payroll run can be sent to the payment simulation.',
              'Validate the run first.',
            );
          }
          const payslips = await tx.payslip.findMany({
            where: { payrunId: id, status: { in: ['VALIDATED', 'PAID'] } },
            include: { employee: { select: { fullName: true, bank: true } } },
          });
          if (payslips.length === 0) {
            throw new AppError('NO_PAYSLIPS', 409, 'This payroll run has no validated payslips to pay.');
          }

          const batchId = `dpb-${randomUUID()}`;
          let total = money(0);
          let success = 0;
          let failure = 0;
          const items = payslips.map((payslip) => {
            const result = simulateOutcome(payslip.id, 0);
            if (result.status === 'SIMULATED_SUCCESS') success += 1;
            else failure += 1;
            total = addMoney(total, payslip.net.toFixed(2));
            return {
              batchId,
              payslipId: payslip.id,
              employeeId: payslip.employeeId,
              amount: payslip.net,
              // Only the masked tail is ever stored or shown; the product never
              // holds an account number that could be used to move money.
              accountMasked: payslip.employee.bank?.accountNumberMasked ?? '••••????',
              status: result.status,
              failureReason: result.failureReason,
            };
          });

          const batch = await tx.demoPaymentBatch.create({
            data: {
              id: batchId,
              organisationId: DEMO_ORGANISATION_ID,
              payrunId: id,
              reference: `DEMO-${payrun.id.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
              status: failure > 0 ? 'SIMULATED_FAILURE' : 'SIMULATED_SUCCESS',
              totalAmount: toMoneyString(total),
              itemCount: items.length,
              successCount: success,
              failureCount: failure,
              createdById: actor.id,
              createdByName: actor.displayName,
              items: { create: items },
            },
            include: { items: true },
          });

          for (const item of batch.items) {
            if (item.status !== 'SIMULATED_SUCCESS') continue;
            await notifyEmployee(tx, item.employeeId, {
              kind: 'DEMO_PAYMENT',
              title: 'Salary payment simulated',
              body: `${DEMO_NOTICE} Your ${payrun.name} payslip shows ${item.amount.toFixed(2)} as settled in the demo.`,
              entityType: 'DemoPaymentBatch',
              entityId: batch.id,
            });
          }

          await recordAudit(tx, actor, {
            action: 'DEMO_PAYMENT_RUN',
            entityType: 'DemoPaymentBatch',
            entityId: batch.id,
            summary: `${DEMO_NOTICE} ${items.length} payment${items.length === 1 ? '' : 's'} simulated for ${payrun.name}: ${success} succeeded, ${failure} failed.`,
            after: {
              reference: batch.reference,
              totalAmount: batch.totalAmount.toFixed(2),
              successCount: success,
              failureCount: failure,
              simulated: true,
              fundsMoved: false,
            },
            correlationId: request.requestId,
          });
          return serializeBatch(batch);
        },
        { timeout: 120_000, maxWait: 20_000 },
      ),
    );

    if (!outcome.replayed) realtime.publish({ type: 'delivery.updated', entityId: id, affectedEmployeeIds: [] });
    response.status(201).json({ data: outcome.value });
  },
);

/* ── retry one failed item ───────────────────────────────────────────────── */

demoPaymentRouter.post('/demo-payments/:id/retry', requirePermission('payrun.pay'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const actor = request.currentUser!;

  const item = await prisma.$transaction(async (tx) => {
    const current = await tx.demoPaymentItem.findUnique({ where: { id }, include: { batch: true } });
    if (!current) throw new AppError('PAYMENT_ITEM_NOT_FOUND', 404, 'That simulated payment was not found.');
    if (current.status !== 'SIMULATED_FAILURE') {
      throw new AppError('NOT_FAILED', 409, 'Only a failed simulated payment can be retried.');
    }
    const retryCount = current.retryCount + 1;
    const result = simulateOutcome(current.payslipId, retryCount);
    const updated = await tx.demoPaymentItem.update({
      where: { id },
      data: { status: result.status, failureReason: result.failureReason, retryCount },
    });

    const counts = await tx.demoPaymentItem.groupBy({
      by: ['status'],
      where: { batchId: current.batchId },
      _count: true,
    });
    const success = counts.find((row) => row.status === 'SIMULATED_SUCCESS')?._count ?? 0;
    const failure = counts.find((row) => row.status === 'SIMULATED_FAILURE')?._count ?? 0;
    await tx.demoPaymentBatch.update({
      where: { id: current.batchId },
      data: {
        successCount: success,
        failureCount: failure,
        status: failure > 0 ? 'SIMULATED_FAILURE' : 'SIMULATED_SUCCESS',
      },
    });

    await recordAudit(tx, actor, {
      action: 'DEMO_PAYMENT_RETRIED',
      entityType: 'DemoPaymentItem',
      entityId: id,
      summary: `${DEMO_NOTICE} Retry ${retryCount} for ${current.employeeId} resolved as ${result.status.toLowerCase().replace('simulated_', '')}.`,
      before: { status: 'SIMULATED_FAILURE', retryCount: current.retryCount },
      after: { status: result.status, retryCount, simulated: true },
      correlationId: request.requestId,
    });
    return updated;
  });

  realtime.publish({ type: 'delivery.updated', entityId: item.batchId, affectedEmployeeIds: [item.employeeId] });
  response.json({ data: { ...item, amount: item.amount.toFixed(2), simulated: true, notice: DEMO_NOTICE } });
});

/* ── read ────────────────────────────────────────────────────────────────── */

demoPaymentRouter.get('/demo-payments', requirePermission('payslip.read.self'), async (request, response) => {
  const query = z.object({ payrunId: z.string().min(1).optional() }).parse(request.query);
  const actor = request.currentUser!;
  const selfOnly = actor.role === 'EMPLOYEE';

  const batches = await prisma.demoPaymentBatch.findMany({
    where: {
      organisationId: DEMO_ORGANISATION_ID,
      ...(query.payrunId ? { payrunId: query.payrunId } : {}),
      // An employee sees a batch only because their own payment is in it, and
      // only ever their own line of it.
      ...(selfOnly ? { items: { some: { employeeId: actor.employeeId ?? '__none__' } } } : {}),
    },
    include: {
      items: selfOnly ? { where: { employeeId: actor.employeeId ?? '__none__' } } : true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  response.locals.recordsRead = batches.reduce((sum, batch) => sum + batch.items.length + 1, 0);
  response.json({ data: batches.map(serializeBatch) });
});
