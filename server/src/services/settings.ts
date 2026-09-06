import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';

type Db = Prisma.TransactionClient;

/**
 * Operating policy, stored per organisation.
 *
 * Every one of these values changes what the server does — the cutoff day
 * gates payroll input edits, the grace window classifies a punch as late, the
 * auto-approval flag decides a leave request without a human. They therefore
 * live in PostgreSQL, not in a browser store: a policy that only exists in one
 * tab is not a policy.
 */
export const settingsSchema = z.object({
  autoFreezeAtCutoff: z.boolean(),
  requireReopenReason: z.boolean(),
  varianceThresholdPercent: z.number().int().min(0).max(100),
  autoApproveShortSickLeave: z.boolean(),
  lateGraceMinutes: z.number().int().min(0).max(180),
  excessiveHoursPerDay: z.number().int().min(1).max(24),
  inputCutoffDay: z.number().int().min(1).max(28),
  payDay: z.number().int().min(1).max(31),
});

export type AppSettingsValue = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettingsValue = Object.freeze({
  autoFreezeAtCutoff: false,
  requireReopenReason: true,
  varianceThresholdPercent: 25,
  autoApproveShortSickLeave: false,
  lateGraceMinutes: 15,
  excessiveHoursPerDay: 11,
  inputCutoffDay: 25,
  payDay: 30,
});

const SETTINGS_KEY = 'operating-policy';

/** Read the stored policy, falling back to the shipped defaults per field. */
export async function readSettings(
  db: Db | typeof prisma = prisma,
  organisationId = DEMO_ORGANISATION_ID,
): Promise<AppSettingsValue> {
  const row = await db.appSetting.findUnique({
    where: { organisationId_key: { organisationId, key: SETTINGS_KEY } },
  });
  const parsed = settingsSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

/** Write the policy back, merging over whatever is already stored. */
export async function writeSettings(
  db: Db,
  patch: Partial<AppSettingsValue>,
  updatedById: string,
  organisationId = DEMO_ORGANISATION_ID,
): Promise<{ before: AppSettingsValue; after: AppSettingsValue }> {
  const before = await readSettings(db, organisationId);
  const after = settingsSchema.parse({ ...before, ...patch });
  await db.appSetting.upsert({
    where: { organisationId_key: { organisationId, key: SETTINGS_KEY } },
    create: { organisationId, key: SETTINGS_KEY, value: after, updatedById },
    update: { value: after, updatedById },
  });
  return { before, after };
}
