import { defineConfig } from '@playwright/test';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://peoplepay:peoplepay@localhost:5432/peoplepay?schema=public';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run dev:server',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
      PORT: '3000',
      SESSION_SECRET: 'test-session-secret-that-is-at-least-32-characters',
      APP_ORIGIN: 'http://localhost:5173',
    },
  },
});
