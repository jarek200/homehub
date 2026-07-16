import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()], // Tailwind plugin must come before SvelteKit
  server: {
    host: true,
    port: 3000,
  },
  css: {
    devSourcemap: true,
  },
  build: {
    sourcemap: true,
  },
  ssr: {
    external: ['fsevents', 'lightningcss'],
  },
});
