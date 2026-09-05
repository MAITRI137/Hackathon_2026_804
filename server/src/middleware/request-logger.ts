import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env.js';

export function requestLogger(request: Request, response: Response, next: NextFunction) {
  const startedAt = performance.now();

  response.on('finish', () => {
    if (env.NODE_ENV !== 'development') return;

    console.info(
      JSON.stringify({
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
  });

  next();
}
