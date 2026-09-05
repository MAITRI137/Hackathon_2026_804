import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://peoplepay:peoplepay@localhost:5432/peoplepay?schema=public';
const localBrave = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    launchOptions: existsSync(localBrave) ? { executablePath: localBrave } : undefined,
  },
  webServer: [
    {
      command: 'npm run dev:server',
      port: 3100,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'test',
        PORT: '3100',
        SESSION_SECRET: 'test-session-secret-that-is-at-least-32-characters',
        APP_ORIGIN: 'http://localhost:5174',
      },
    },
    {
      command: 'npm run dev -- --port 5174',
      port: 5174,
      reuseExistingServer: false,
      env: { VITE_API_TARGET: 'http://localhost:3100' },
    },
  ],
});
