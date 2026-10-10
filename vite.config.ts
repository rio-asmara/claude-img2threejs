import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // three.js alone is ~700 kB minified; a single chunk is fine for a local review viewer.
  build: { chunkSizeWarningLimit: 1500 },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
});
