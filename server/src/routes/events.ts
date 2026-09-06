import { Router } from 'express';

import { realtime } from '../realtime/events.js';
import { requireAuth } from '../middleware/auth.js';

export const eventsRouter = Router();

/**
 * Metadata-only, authenticated server-sent events. Records are deliberately
 * never sent here: clients refetch their own RBAC-scoped bootstrap payload.
 */
eventsRouter.get('/events', requireAuth, (request, response) => {
  response.status(200);
  response.set({
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  response.write(`event: connected\ndata: ${JSON.stringify({ occurredAt: new Date().toISOString() })}\n\n`);

  const unsubscribe = realtime.subscribe((event) => {
    // A future organisation-aware adapter filters by membership here. This
    // single-organisation hackathon build only emits safe metadata.
    response.write(`event: domain\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 25_000);

  request.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
