import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import type { Role } from '@shared/types.js';

type Db = Prisma.TransactionClient;

export interface AuditActor {
  id: string;
  displayName: string;
  role: Role | string;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  /** State before the change, already reduced to the fields that changed. */
  before?: unknown;
  /** State after the change, in the same shape as `before`. */
  after?: unknown;
  /** The operator-supplied justification, where the command requires one. */
  reason?: string;
  /** Request id, so one user action can be reassembled across several rows. */
  correlationId?: string;
}

const asJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

/**
 * Append one audit row inside the caller's transaction.
 *
 * Audit is evidence, so it is written in the same transaction as the change it
 * describes: a rolled-back command leaves no audit trail claiming it happened,
 * and a committed one can never be missing its record.
 */
export async function recordAudit(db: Db, actor: AuditActor, input: AuditInput) {
  await db.auditEvent.create({
    data: {
      id: randomUUID(),
      at: new Date(),
      actorId: actor.id,
      actorName: actor.displayName,
      actorRole: String(actor.role),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      before: asJson(input.before),
      after: asJson(
        input.after === undefined && (input.reason || input.correlationId)
          ? { reason: input.reason ?? null, correlationId: input.correlationId ?? null }
          : input.after === undefined
            ? undefined
            : {
                ...(input.after as Record<string, unknown>),
                ...(input.reason ? { reason: input.reason } : {}),
                ...(input.correlationId ? { correlationId: input.correlationId } : {}),
              },
      ),
    },
  });
}

/**
 * Narrow two records to only the fields that differ, so an audit row carries
 * the change rather than a copy of the whole entity.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const next = after[key];
    if (next === undefined) continue;
    if (String(before[key]) === String(next)) continue;
    changedBefore[key] = before[key];
    changedAfter[key] = next;
  }
  return { before: changedBefore, after: changedAfter };
}
