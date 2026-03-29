import { defineConfig } from 'vite';

export default defineConfig({
  base: '/games/stackfall/',
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
});
