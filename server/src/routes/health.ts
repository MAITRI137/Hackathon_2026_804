import { Router } from 'express';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: 'healthy', database: 'connected', environment: env.NODE_ENV });
  } catch {
    response
      .status(503)
      .json({ status: 'degraded', database: 'unavailable', environment: env.NODE_ENV });
  }
});
