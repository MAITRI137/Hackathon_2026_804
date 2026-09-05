import type { ErrorRequestHandler } from 'express';

import { env } from '../config/env.js';

export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  void next;
  const status = error instanceof SyntaxError && 'body' in error ? 400 : 500;
  const message = status === 400 ? 'Invalid request body.' : 'Internal server error.';

  if (env.NODE_ENV !== 'test') {
    console.error({ requestId: request.requestId, status, error });
  }

  response.status(status).json({ error: { message, requestId: request.requestId } });
};
