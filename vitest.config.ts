import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/test/**/*.test.ts'],
    exclude: ['src/test/extension.test.ts', '**/node_modules/**'],
    environment: 'node',
    environmentMatchGlobs: [['src/test/components/**', 'jsdom']],
    globals: false,
    reporters: 'default',
    passWithNoTests: true,
  },
});
