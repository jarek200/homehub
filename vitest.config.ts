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
  },
  resolve: {
    alias: {
      '@sst-monorepo/core': path.resolve(__dirname, './packages/core/src'),
    },
  },
});
