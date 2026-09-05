import http from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { disconnectDatabase } from './db/prisma.js';

const server = http.createServer(createApp());

server.listen(env.PORT, () => {
  console.info(`PeoplePay360 API listening on port ${env.PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down.`);

  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
