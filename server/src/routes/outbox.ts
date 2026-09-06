import { createHash, randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';
import { requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { recordAudit } from '../services/audit.js';
import { idempotencyKeyFrom, runOnce } from '../services/idempotency.js';

export const outboxRouter = Router();

const idParam = z.object({ id: z.string().min(1) });

/**
 * SIMULATION BOUNDARY — nothing in this file sends email.
 *
 * No SMTP transport is configured and none is used. The outbox itself is real:
 * a queued message, a delivery status, a deterministic failure reason and a
 * retry count are persisted rows an operator can act on, and an employee can
 * see the delivery state of their own payslip. Only the transport is missing.
 */
const DEMO_NOTICE = 'Demo delivery simulation — no email was sent.';

/** Deterministic, so a demo repeats and a retry resolves. */
function simulateDelivery(recipient: string, attempts: number) {
  const digest = createHash('sha256').update(`${recipient}:${attempts}`).digest();
  const fails = attempts === 0 && digest[0]! % 11 === 0;
  return fails
    ? {
        status: 'SIMULATED_FAILED' as const,
        failureReason: 'Recipient mailbox rejected the message in the simulated transport.',
      }
    : { status: 'SIMULATED_SENT' as const, failureReason: null };
}

const serialize = (message: {
  id: string;
  recipientEmail: string;
  recipientEmployeeId: string | null;
  subject: string;
  template: string;
  payslipId: string | null;
  payrunId: string | null;
  status: string;
  failureReason: string | null;
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}) => ({
  ...message,
  lastAttemptAt: message.lastAttemptAt?.toISOString() ?? null,
  createdAt: message.createdAt.toISOString(),
  simulated: true,
  notice: DEMO_NOTICE,
});

outboxRouter.post(
  '/payruns/:id/demo-deliver-payslips',
  requirePermission('payslip.send'),
  async (request, response) => {
    const { id } = idParam.parse(request.params);
    const actor = request.currentUser!;

    const outcome = await runOnce('demo.delivery', idempotencyKeyFrom(request), actor.id, { id }, async () =>
      prisma.$transaction(
        async (tx) => {
          const payrun = await tx.payrun.findUnique({ where: { id } });
          if (!payrun) throw new AppError('PAYRUN_NOT_FOUND', 404, 'Payroll period not found.');
          if (payrun.status !== 'VALIDATED' && payrun.status !== 'PAID') {
            throw new AppError(
              'INVALID_PAYRUN_STATE',
              409,
              'Payslips can only be delivered after the payroll run is validated.',
              'Validate the run first.',
            );
          }
          const payslips = await tx.payslip.findMany({
            where: { payrunId: id, status: { in: ['VALIDATED', 'PAID'] } },
            include: { employee: { select: { email: true, fullName: true } } },
          });
          if (payslips.length === 0) {
            throw new AppError('NO_PAYSLIPS', 409, 'This payroll run has no validated payslips to deliver.');
          }

          let sent = 0;
          let failed = 0;
          for (const payslip of payslips) {
            const result = simulateDelivery(payslip.employee.email, 0);
            if (result.status === 'SIMULATED_SENT') sent += 1;
            else failed += 1;
            const now = new Date();
            const data = {
              organisationId: DEMO_ORGANISATION_ID,
              recipientEmail: payslip.employee.email,
              recipientEmployeeId: payslip.employeeId,
              subject: `Your ${payrun.name} payslip`,
              template: 'payslip',
              payslipId: payslip.id,
              payrunId: id,
              status: result.status,
              failureReason: result.failureReason,
              attempts: 1,
              lastAttemptAt: now,
              createdById: actor.id,
            };
            await tx.outboxMessage.upsert({
              where: {
                payrunId_recipientEmail_template: {
                  payrunId: id,
                  recipientEmail: payslip.employee.email,
                  template: 'payslip',
                },
              },
              create: { id: `out-${randomUUID()}`, ...data },
              update: data,
            });
            // The payslip carries its own delivery state so an employee sees it
            // on their own document without being able to read the outbox.
            await tx.payslip.update({
              where: { id: payslip.id },
              data: {
                deliveryStatus: result.status === 'SIMULATED_SENT' ? 'SENT' : 'FAILED',
                deliveryError: result.failureReason,
                deliveredAt: result.status === 'SIMULATED_SENT' ? now : null,
              },
            });
          }

          await recordAudit(tx, actor, {
            action: 'DEMO_PAYSLIP_DELIVERY',
            entityType: 'Payrun',
            entityId: id,
            summary: `${DEMO_NOTICE} ${payslips.length} payslip${payslips.length === 1 ? '' : 's'} queued for ${payrun.name}: ${sent} sent, ${failed} failed.`,
            after: { queued: payslips.length, sent, failed, simulated: true, emailSent: false },
            correlationId: request.requestId,
          });
          return { queued: payslips.length, sent, failed, simulated: true, notice: DEMO_NOTICE };
        },
        { timeout: 120_000, maxWait: 20_000 },
      ),
    );

    if (!outcome.replayed) {
      realtime.publish({ type: 'delivery.updated', entityId: id, affectedEmployeeIds: [] });
      realtime.publish({ type: 'payslip.updated', entityId: id, affectedEmployeeIds: [] });
    }
    response.status(201).json({ data: outcome.value });
  },
);

outboxRouter.post('/outbox/:id/retry', requirePermission('payslip.send'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const actor = request.currentUser!;

  const message = await prisma.$transaction(async (tx) => {
    const current = await tx.outboxMessage.findUnique({ where: { id } });
    if (!current) throw new AppError('MESSAGE_NOT_FOUND', 404, 'That queued message was not found.');
    if (current.status !== 'SIMULATED_FAILED') {
      throw new AppError('NOT_FAILED', 409, 'Only a failed delivery can be retried.');
    }
    const attempts = current.attempts;
    const result = simulateDelivery(current.recipientEmail, attempts);
    const now = new Date();
    const updated = await tx.outboxMessage.update({
      where: { id },
      data: {
        status: result.status,
        failureReason: result.failureReason,
        attempts: attempts + 1,
        lastAttemptAt: now,
      },
    });
    if (current.payslipId) {
      await tx.payslip.update({
        where: { id: current.payslipId },
        data: {
          deliveryStatus: result.status === 'SIMULATED_SENT' ? 'SENT' : 'FAILED',
          deliveryError: result.failureReason,
          deliveredAt: result.status === 'SIMULATED_SENT' ? now : null,
        },
      });
    }
    await recordAudit(tx, actor, {
      action: 'DEMO_DELIVERY_RETRIED',
      entityType: 'OutboxMessage',
      entityId: id,
      summary: `${DEMO_NOTICE} Retry ${attempts + 1} to ${current.recipientEmail} resolved as ${result.status.toLowerCase().replace('simulated_', '')}.`,
      before: { status: current.status, attempts },
      after: { status: result.status, attempts: attempts + 1, simulated: true },
      correlationId: request.requestId,
    });
    return updated;
  });

  realtime.publish({
    type: 'delivery.updated',
    entityId: id,
    affectedEmployeeIds: message.recipientEmployeeId ? [message.recipientEmployeeId] : [],
  });
  response.json({ data: serialize(message) });
});

outboxRouter.get('/outbox', requirePermission('payslip.send'), async (request, response) => {
  const query = z
    .object({ payrunId: z.string().min(1).optional(), status: z.string().min(1).optional() })
    .parse(request.query);
  const rows = await prisma.outboxMessage.findMany({
    where: {
      organisationId: DEMO_ORGANISATION_ID,
      ...(query.payrunId ? { payrunId: query.payrunId } : {}),
      ...(query.status ? { status: query.status as never } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  response.locals.recordsRead = rows.length;
  response.json({ data: rows.map(serialize) });
});
