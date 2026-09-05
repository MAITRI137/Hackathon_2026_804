import type { NextFunction, Request, Response } from 'express';

import { metrics } from '../core/metrics.js';

/**
 * Records one line of telemetry per request.
 *
 * Routes are normalised (ids collapsed) so the table stays bounded, and
 * handlers may report how many database records they served through
 * `response.locals.recordsRead`, which is what the operations console shows as
 * live read volume.
 */
export function metricsMiddleware(request: Request, response: Response, next: NextFunction) {
  const started = process.hrtime.bigint();

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    const route = normalise(request.baseUrl + (request.route?.path ?? request.path));
    const records = Number(response.locals.recordsRead ?? 0);
    metrics.recordRequest(`${request.method} ${route}`, response.statusCode, durationMs, records);
  });

  next();
}

/** Collapse identifiers so `/api/employees/EMP-004` and `/api/employees/EMP-231` agree. */
function normalise(path: string): string {
  return path
    .replace(/\/(EMP|CT|LR|PR|PS)-[\w-]+/gi, '/:id')
    .replace(/\/[0-9a-f]{8,}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}
