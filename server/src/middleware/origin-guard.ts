import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { AppError } from '../lib/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originGuard(request: Request, _response: Response, next: NextFunction) {
  if (SAFE_METHODS.has(request.method)) {
    next();
    return;
  }

  const source = request.get('origin') ?? request.get('referer');
  let sourceOrigin: string | undefined;
  try {
    sourceOrigin = source ? new URL(source).origin : undefined;
  } catch {
    sourceOrigin = undefined;
  }

  if (sourceOrigin !== new URL(env.APP_ORIGIN).origin) {
    next(
      new AppError(
        'ORIGIN_MISMATCH',
        403,
        'This request could not be verified.',
        'Refresh the page and try again.',
      ),
    );
    return;
  }

  next();
}
