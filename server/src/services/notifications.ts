import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import type { Role } from '@shared/types.js';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';

type Db = Prisma.TransactionClient;

export interface NotifyInput {
  kind: string;
  title: string;
  body: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  entityType?: string;
  entityId?: string;
  /** Deliver to one person. */
  userId?: string;
  /** Deliver to everyone holding a role. Exactly one of the two is used. */
  role?: Role;
}

/**
 * Persist a notification inside the caller's transaction.
 *
 * A notification is a record, not a toast: it survives the refresh, it is
 * addressed to a person or a role rather than to a browser tab, and it is
 * written with the change that caused it so the two cannot disagree.
 */
export async function notify(db: Db, input: NotifyInput, organisationId = DEMO_ORGANISATION_ID) {
  await db.notification.create({
    data: {
      id: `ntf-${randomUUID()}`,
      organisationId,
      userId: input.userId ?? null,
      role: input.role ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      severity: input.severity ?? 'INFO',
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  });
}

/** Notify the person a change was made about, when their account exists. */
export async function notifyEmployee(db: Db, employeeId: string, input: Omit<NotifyInput, 'userId' | 'role'>) {
  const user = await db.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (!user) return;
  await notify(db, { ...input, userId: user.id });
}
