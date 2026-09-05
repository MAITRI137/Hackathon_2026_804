import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '@shared/types.js';

import type { Permission } from '../core/rbac/matrix.js';
import { roleHasPermission } from '../core/rbac/matrix.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../lib/app-error.js';

const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000;

declare module 'express-session' {
  interface SessionData {
    userId: string;
    authenticatedAt: number;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    currentUser?: User;
  }
}

function serializeUser(user: {
  id: string;
  email: string;
  role: Role;
  employeeId: string | null;
  displayName: string;
  initials: string;
  isActive: boolean;
  lastLoginAt: Date | null;
}): User {
  return {
    ...user,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export async function loadCurrentUser(request: Request, _response: Response, next: NextFunction) {
  const { userId, authenticatedAt } = request.session;
  if (!userId) {
    next();
    return;
  }

  if (!authenticatedAt || Date.now() - authenticatedAt > ABSOLUTE_SESSION_MS) {
    request.session.destroy(() => undefined);
    next();
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      employeeId: true,
      displayName: true,
      initials: true,
      isActive: true,
      lastLoginAt: true,
    },
  });

  if (!user?.isActive) {
    request.session.destroy(() => undefined);
    next();
    return;
  }

  request.currentUser = serializeUser(user);
  next();
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  if (!request.currentUser) {
    next(new AppError('AUTH_REQUIRED', 401, 'Sign in to continue.', 'Return to the sign-in page.'));
    return;
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.currentUser) {
      next(
        new AppError('AUTH_REQUIRED', 401, 'Sign in to continue.', 'Return to the sign-in page.'),
      );
      return;
    }
    if (!roleHasPermission(request.currentUser.role, permission)) {
      next(
        new AppError(
          'PERMISSION_DENIED',
          403,
          'Your role does not allow this action.',
          'Switch to an authorized role or contact an administrator.',
        ),
      );
      return;
    }
    next();
  };
}
