import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '@shared/types.js';

import { DEMO_ORGANISATION_ID } from '../config/tenant.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { realtime } from '../realtime/events.js';
import { recordAudit } from '../services/audit.js';
import { readSettings, settingsSchema, writeSettings } from '../services/settings.js';

export const adminRouter = Router();

const idParam = z.object({ id: z.string().min(1) });
const roleEnum = z.enum(ROLES);

/**
 * Users and roles.
 *
 * The screen used to show the signed-in person and call that a user list.
 * Administration means acting on everyone, so this returns the real user table
 * — never the password hash, and never a field the caller cannot act on.
 */
adminRouter.get('/users', requirePermission('admin.users'), async (_request, response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      employeeId: true,
      displayName: true,
      initials: true,
      isActive: true,
      lastLoginAt: true,
      failedAttempts: true,
      lockedUntil: true,
      createdAt: true,
    },
    orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
  });
  response.locals.recordsRead = users.length;
  response.json({
    data: users.map((user) => ({
      ...user,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    })),
  });
});

adminRouter.patch('/users/:id', requirePermission('admin.users'), async (request, response) => {
  const { id } = idParam.parse(request.params);
  const patch = z
    .object({
      role: roleEnum.optional(),
      isActive: z.boolean().optional(),
      reason: z.string().trim().min(3).max(500),
    })
    .parse(request.body);
  const actor = request.currentUser!;

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id } });
    if (!current) throw new AppError('USER_NOT_FOUND', 404, 'User account not found.');
    // An administrator who removes their own last administrator role locks the
    // organisation out of its own settings, so that specific change is refused.
    if (current.id === actor.id && patch.isActive === false) {
      throw new AppError('CANNOT_DISABLE_SELF', 409, 'You cannot disable your own account.');
    }
    if (current.role === 'ADMIN' && patch.role && patch.role !== 'ADMIN') {
      const admins = await tx.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (admins <= 1) {
        throw new AppError(
          'LAST_ADMIN',
          409,
          'This is the last active administrator.',
          'Promote another account to administrator first.',
        );
      }
    }

    const user = await tx.user.update({
      where: { id },
      data: {
        ...(patch.role ? { role: patch.role } : {}),
        ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
      },
    });
    if (patch.role) {
      await tx.organisationMembership.updateMany({
        where: { userId: id, organisationId: DEMO_ORGANISATION_ID },
        data: { role: patch.role },
      });
    }
    await recordAudit(tx, actor, {
      action: patch.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      entityType: 'User',
      entityId: id,
      summary: `${current.displayName}: ${patch.role ? `role ${current.role} → ${patch.role}` : ''}${
        patch.isActive === undefined ? '' : `${patch.role ? ', ' : ''}${patch.isActive ? 'reactivated' : 'deactivated'}`
      }.`,
      before: { role: current.role, isActive: current.isActive },
      after: { role: user.role, isActive: user.isActive },
      reason: patch.reason,
      correlationId: request.requestId,
    });
    return user;
  });

  // A deactivated account is rejected on its next request because
  // `loadCurrentUser` re-reads the row every time; the event just makes the
  // other open sessions notice sooner.
  realtime.publish({ type: 'user.updated', entityId: id, affectedEmployeeIds: [] });
  response.json({
    data: {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      employeeId: updated.employeeId,
      displayName: updated.displayName,
      initials: updated.initials,
      isActive: updated.isActive,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
    },
  });
});

/* ── settings ────────────────────────────────────────────────────────────── */

adminRouter.get('/settings', requireAuth, async (_request, response) => {
  response.json({ data: await readSettings() });
});

adminRouter.patch('/settings', requirePermission('admin.settings'), async (request, response) => {
  const patch = settingsSchema.partial().parse(request.body);
  const actor = request.currentUser!;
  const result = await prisma.$transaction(async (tx) => {
    const { before, after } = await writeSettings(tx, patch, actor.id);
    const changedKeys = Object.keys(patch).filter(
      (key) => String(before[key as keyof typeof before]) !== String(after[key as keyof typeof after]),
    );
    await recordAudit(tx, actor, {
      action: 'SETTINGS_UPDATED',
      entityType: 'AppSetting',
      entityId: 'operating-policy',
      summary: `Operating policy updated: ${changedKeys.join(', ') || 'no change'}.`,
      before,
      after,
      correlationId: request.requestId,
    });
    return after;
  });
  realtime.publish({ type: 'settings.updated', entityId: 'operating-policy', affectedEmployeeIds: [] });
  response.json({ data: result });
});

/* ── notifications ───────────────────────────────────────────────────────── */

adminRouter.get('/notifications', requireAuth, async (request, response) => {
  const actor = request.currentUser!;
  const rows = await prisma.notification.findMany({
    where: {
      organisationId: DEMO_ORGANISATION_ID,
      dismissedAt: null,
      OR: [{ userId: actor.id }, { role: actor.role }],
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  response.locals.recordsRead = rows.length;
  response.json({
    data: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
      dismissedAt: row.dismissedAt?.toISOString() ?? null,
    })),
  });
});

adminRouter.post('/notifications/read', requireAuth, async (request, response) => {
  const { ids } = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }).parse(request.body);
  const actor = request.currentUser!;
  // Scoped by addressee: marking somebody else's notification read is not a
  // thing this endpoint can be persuaded to do.
  const changed = await prisma.notification.updateMany({
    where: { id: { in: ids }, readAt: null, OR: [{ userId: actor.id }, { role: actor.role }] },
    data: { readAt: new Date() },
  });
  response.json({ data: { updated: changed.count } });
});

adminRouter.post('/notifications/:id/dismiss', requireAuth, async (request, response) => {
  const { id } = idParam.parse(request.params);
  const actor = request.currentUser!;
  const changed = await prisma.notification.updateMany({
    where: { id, dismissedAt: null, OR: [{ userId: actor.id }, { role: actor.role }] },
    data: { dismissedAt: new Date() },
  });
  if (changed.count !== 1) throw new AppError('NOTIFICATION_NOT_FOUND', 404, 'That notification is not yours to dismiss.');
  response.json({ data: { dismissed: id } });
});

/* ── saved views ─────────────────────────────────────────────────────────── */

adminRouter.get('/saved-views', requireAuth, async (request, response) => {
  const actor = request.currentUser!;
  const rows = await prisma.savedView.findMany({
    where: { organisationId: DEMO_ORGANISATION_ID, OR: [{ ownerId: actor.id }, { isShared: true }] },
    orderBy: { createdAt: 'desc' },
  });
  response.json({ data: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) });
});

adminRouter.post('/saved-views', requireAuth, async (request, response) => {
  const input = z
    .object({
      view: z.string().trim().min(1).max(60),
      name: z.string().trim().min(1).max(60),
      config: z.record(z.string(), z.string()),
      isShared: z.boolean().default(false),
    })
    .parse(request.body);
  const actor = request.currentUser!;
  const created = await prisma.savedView.upsert({
    where: { ownerId_view_name: { ownerId: actor.id, view: input.view, name: input.name } },
    create: {
      id: `sv-${randomUUID()}`,
      organisationId: DEMO_ORGANISATION_ID,
      ownerId: actor.id,
      view: input.view,
      name: input.name,
      config: input.config,
      isShared: input.isShared,
    },
    update: { config: input.config, isShared: input.isShared },
  });
  response.status(201).json({ data: { ...created, createdAt: created.createdAt.toISOString() } });
});

adminRouter.delete('/saved-views/:id', requireAuth, async (request, response) => {
  const { id } = idParam.parse(request.params);
  const actor = request.currentUser!;
  const removed = await prisma.savedView.deleteMany({ where: { id, ownerId: actor.id } });
  if (removed.count !== 1) throw new AppError('VIEW_NOT_FOUND', 404, 'That saved view is not yours to delete.');
  response.status(204).end();
});
