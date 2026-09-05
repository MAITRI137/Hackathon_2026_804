import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['server/src/tests/setup.ts'],
    include: ['server/src/tests/**/*.test.ts'],
  },
});
