import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';
import { AppError } from '../lib/app-error.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Origins this server will accept a state-changing request from.
 *
 * Exactly one in production. In development the loopback aliases are treated as
 * the same origin, because `http://localhost:5174` and `http://127.0.0.1:5174`
 * are the same server to a developer but different strings to `URL.origin` —
 * a mismatch that reads as a mysterious "could not be verified" error rather
 * than as the configuration problem it is.
 */
function allowedOrigins(): Set<string> {
  const configured = new URL(env.APP_ORIGIN);
  const origins = new Set([configured.origin]);

  if (env.NODE_ENV !== 'production') {
    const aliases: Record<string, string> = {
      localhost: '127.0.0.1',
      '127.0.0.1': 'localhost',
      '[::1]': 'localhost',
    };
    const alias = aliases[configured.hostname];
    if (alias) {
      const mirrored = new URL(configured.toString());
      mirrored.hostname = alias;
      origins.add(mirrored.origin);
    }
  }

  return origins;
}

const ALLOWED = allowedOrigins();

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

  if (!sourceOrigin || !ALLOWED.has(sourceOrigin)) {
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
