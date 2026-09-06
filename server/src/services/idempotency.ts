import { createHash } from 'node:crypto';

import type { Request } from 'express';

import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';

/**
 * Replay protection for commands that must not run twice.
 *
 * A payroll compute, a validation, a payment simulation and a delivery
 * simulation are all commands where a double-submit — an impatient second
 * click, a retried request after a dropped response — must not produce a second
 * effect. The caller supplies an `Idempotency-Key` header; the first request
 * under that key runs and stores its response, and every later request under
 * the same key returns that stored response without touching the database.
 *
 * Reusing a key with a different body is a client bug, and returning the first
 * response would hide it, so that case is rejected with 409.
 */
export interface IdempotentOutcome<T> {
  replayed: boolean;
  value: T;
}

const hashOf = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');

export function idempotencyKeyFrom(request: Request): string | undefined {
  const header = request.get('idempotency-key');
  const key = header?.trim();
  if (!key) return undefined;
  if (key.length > 200) {
    throw new AppError('IDEMPOTENCY_KEY_TOO_LONG', 400, 'The idempotency key is too long.');
  }
  return key;
}

/**
 * Run `command` at most once per (scope, key). Without a key the command runs
 * normally — idempotency is opt-in, so an exploratory request is not forced to
 * invent one.
 */
export async function runOnce<T>(
  scope: string,
  key: string | undefined,
  userId: string,
  requestBody: unknown,
  command: () => Promise<T>,
): Promise<IdempotentOutcome<T>> {
  if (!key) return { replayed: false, value: await command() };

  const requestHash = hashOf(requestBody);
  const existing = await prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        409,
        'This idempotency key was already used for a different request.',
        'Use a new key for a new request, or resend the original request unchanged.',
      );
    }
    return { replayed: true, value: existing.response as T };
  }

  const value = await command();
  // A concurrent duplicate can win the race between the lookup and this write;
  // the unique key makes that a no-op rather than a second stored response.
  await prisma.idempotencyKey
    .create({
      data: {
        scope,
        key,
        userId,
        requestHash,
        response: JSON.parse(JSON.stringify(value ?? null)) as object,
      },
    })
    .catch(() => undefined);
  return { replayed: false, value };
}
