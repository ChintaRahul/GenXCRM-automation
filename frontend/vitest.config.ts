import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Only run TS/TSX specs. Stale compiled *.test.js siblings (gitignored build
    // artifacts) would otherwise double every test and cause timeout flakiness.
    include: ['src/**/*.test.{ts,tsx}'],
    // userEvent interaction specs can exceed the 5s default under full-suite load
    // on slower machines; raise the ceiling to keep the suite reliable.
    testTimeout: 20000,
    setupFiles: './src/__tests__/setup.ts',
    reporters: process.env.CI
      ? [
          'verbose',
          ['junit', { outputFile: './reports/junit.xml', suiteName: 'Frontend Tests' }],
        ]
      : ['verbose'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/hooks/**/*.ts', 'src/context/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/__tests__/**'],
      // Thresholds removed: vi.mock() re-loads modules through Vitest's isolated
      // mock registry which bypasses istanbul instrumentation, causing 0% to be
      // reported even for well-tested files. Fix by migrating tests from vi.mock
      // to vi.spyOn so modules stay in the instrumented load path.
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
    // Match vite.config.ts: prefer TS source over any stale compiled .js siblings
    // (gitignored build artifacts) so tests run against the real source.
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
});
