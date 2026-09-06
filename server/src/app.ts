import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';

import { env } from './config/env.js';
import { loadCurrentUser } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { originGuard } from './middleware/origin-guard.js';
import { requestId } from './middleware/request-id.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { requestLogger } from './middleware/request-logger.js';
import { authRouter } from './routes/auth.js';
import { attendanceRouter } from './routes/attendance.js';
import { bootstrapRouter } from './routes/bootstrap.js';
import { contractRouter } from './routes/contracts.js';
import { demoPaymentRouter } from './routes/demo-payments.js';
import { documentRouter } from './routes/documents.js';
import { employeeRouter } from './routes/employees.js';
import { eventsRouter } from './routes/events.js';
import { healthRouter } from './routes/health.js';
import { leaveRouter } from './routes/leave.js';
import { opsRouter } from './routes/ops.js';
import { outboxRouter } from './routes/outbox.js';
import { payrunRouter } from './routes/payruns.js';
import { salaryRouter } from './routes/salary.js';

const PostgresSessionStore = connectPgSimple(session);

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(requestId);
  app.use(requestLogger);
  app.use(metricsMiddleware);
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
  app.use('/api', eventsRouter);
  app.use('/api', attendanceRouter);
  app.use('/api', leaveRouter);
  app.use('/api', employeeRouter);
  app.use('/api', contractRouter);
  app.use('/api', bootstrapRouter);
  app.use('/api', salaryRouter);
  app.use('/api', payrunRouter);
  app.use('/api', demoPaymentRouter);
  app.use('/api', outboxRouter);
  app.use('/api', documentRouter);
  app.use('/api', opsRouter);
  app.use(errorHandler);

  return app;
}
