import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export function requestId(request: Request, response: Response, next: NextFunction) {
  request.requestId = randomUUID();
  response.setHeader('X-Request-Id', request.requestId);
  next();
}
