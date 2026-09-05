import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';

import { env } from './config/env.js';
import { loadCurrentUser } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { originGuard } from './middleware/origin-guard.js';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { authRouter } from './routes/auth.js';
import { bootstrapRouter } from './routes/bootstrap.js';
import { healthRouter } from './routes/health.js';

const PostgresSessionStore = connectPgSimple(session);

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(requestId);
  app.use(requestLogger);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(
    session({
      name: 'peoplepay.sid',
      secret: env.SESSION_SECRET,
      store: new PostgresSessionStore({
        conString: env.DATABASE_URL,
        tableName: 'user_session',
        createTableIfMissing: false,
      }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.use(originGuard);
  app.use(loadCurrentUser);
  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', bootstrapRouter);
  app.use(errorHandler);

  return app;
}
