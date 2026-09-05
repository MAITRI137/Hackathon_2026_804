import { randomUUID } from 'node:crypto';

import { hash, verify } from 'argon2';
import { Router } from 'express';
import { z } from 'zod';

import { permissionsForRole } from '../core/rbac/matrix.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';
import { requireAuth } from '../middleware/auth.js';

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(200),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(12).max(200),
});

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const dummyHash = hash('PeoplePay360 timing equalizer');
const attemptsByIp = new Map<string, number[]>();

export const authRouter = Router();

function publicUser(user: {
  id: string;
  email: string;
  role: 'EMPLOYEE' | 'HR_MANAGER' | 'HR_PAYROLL_USER' | 'HR_PAYROLL_MANAGER' | 'ADMIN';
  employeeId: string | null;
  displayName: string;
  initials: string;
  isActive: boolean;
  lastLoginAt: Date | null;
}) {
  return { ...user, lastLoginAt: user.lastLoginAt?.toISOString() ?? null };
}

function regenerateSession(request: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(request: Express.Request) {
  return new Promise<void>((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

authRouter.post('/auth/login', async (request, response) => {
  const credentials = loginSchema.parse(request.body);
  const now = Date.now();
  const recentIpAttempts = (attemptsByIp.get(request.ip ?? 'unknown') ?? []).filter(
    (attempt) => now - attempt < ATTEMPT_WINDOW_MS,
  );
  if (recentIpAttempts.length >= MAX_ATTEMPTS) {
    throw new AppError(
      'LOGIN_RATE_LIMITED',
      429,
      'Too many sign-in attempts.',
      'Wait a few minutes, then try again.',
    );
  }
  const user = await prisma.user.findUnique({ where: { email: credentials.email } });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      'ACCOUNT_LOCKED',
      429,
      'Sign-in is temporarily locked.',
      'Wait 15 minutes, then try again.',
    );
  }

  const passwordMatches = await verify(
    user?.passwordHash ?? (await dummyHash),
    credentials.password,
  );
  if (!user?.isActive || !passwordMatches) {
    recentIpAttempts.push(now);
    attemptsByIp.set(request.ip ?? 'unknown', recentIpAttempts);
    if (user?.isActive) {
      const failedAttempts = user.failedAttempts + 1;
      const lockedUntil = failedAttempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null;
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { failedAttempts, lockedUntil },
        }),
        ...(lockedUntil
          ? [
              prisma.auditEvent.create({
                data: {
                  id: randomUUID(),
                  at: new Date(),
                  actorId: user.id,
                  actorName: user.displayName,
                  actorRole: user.role,
                  action: 'LOGIN_LOCKED',
                  entityType: 'User',
                  entityId: user.id,
                  summary: 'Account locked after repeated sign-in failures',
                },
              }),
            ]
          : []),
      ]);
    }
    throw new AppError(
      'INVALID_CREDENTIALS',
      401,
      'Email or password is incorrect.',
      'Check your details and try again.',
    );
  }

  const signedInAt = new Date();
  attemptsByIp.delete(request.ip ?? 'unknown');
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: signedInAt },
  });
  await regenerateSession(request);
  request.session.userId = updatedUser.id;
  request.session.authenticatedAt = Date.now();
  await saveSession(request);

  response.json({
    data: {
      user: publicUser(updatedUser),
      permissions: permissionsForRole(updatedUser.role),
    },
  });
});

authRouter.get('/auth/me', requireAuth, (request, response) => {
  response.json({
    data: {
      user: request.currentUser,
      permissions: permissionsForRole(request.currentUser!.role),
    },
  });
});

authRouter.post('/auth/logout', requireAuth, async (request, response) => {
  await new Promise<void>((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  response.clearCookie('peoplepay.sid');
  response.status(204).end();
});

authRouter.post('/auth/password', requireAuth, async (request, response) => {
  const input = passwordSchema.parse(request.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: request.currentUser!.id } });
  if (!(await verify(user.passwordHash, input.currentPassword))) {
    throw new AppError('INVALID_PASSWORD', 400, 'Current password is incorrect.');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(input.newPassword), failedAttempts: 0, lockedUntil: null },
  });
  await regenerateSession(request);
  request.session.userId = user.id;
  request.session.authenticatedAt = Date.now();
  await saveSession(request);
  response.status(204).end();
});
