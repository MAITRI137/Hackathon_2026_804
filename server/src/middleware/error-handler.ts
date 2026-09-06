import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env.js';
import { AppError } from '../lib/app-error.js';

export const errorHandler: ErrorRequestHandler = (error, request, response, next) => {
  void next;
  const isBodySyntaxError = error instanceof SyntaxError && 'body' in error;
  const status =
    error instanceof AppError
      ? error.httpStatus
      : isBodySyntaxError || error instanceof ZodError
        ? 400
        : 500;
  const code =
    error instanceof AppError ? error.code : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
  const message =
    error instanceof AppError
      ? error.userMessage
      : status === 400
        ? 'Invalid request.'
        : 'Internal server error.';
  const recovery = error instanceof AppError ? error.recovery : undefined;
  const details = error instanceof AppError ? error.details : undefined;

  if (env.NODE_ENV !== 'test') {
    console.error({ requestId: request.requestId, status, error });
  }

  response
    .status(status)
    .json({ error: { code, message, recovery, details, requestId: request.requestId } });
};
