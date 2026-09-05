process.env.DATABASE_URL ??=
  'postgresql://peoplepay:peoplepay@localhost:5432/peoplepay?schema=public';
process.env.PORT ??= '3000';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-at-least-32-characters';
process.env.APP_ORIGIN ??= 'http://localhost:5173';
