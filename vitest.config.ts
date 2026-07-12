import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.svelte-kit/**',
      '**/.sst/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', '**/*.config.*', '**/*.d.ts', '**/types/**'],
    },
  },
  resolve: {
    alias: {
      '@sst-monorepo/core': path.resolve(__dirname, './packages/core/src'),
      '@sst-monorepo/functions': path.resolve(__dirname, './packages/functions/src'),
    },
  },
});
