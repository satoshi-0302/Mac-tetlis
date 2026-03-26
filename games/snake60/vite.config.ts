import { defineConfig } from 'vite';

export default defineConfig({
  base: '/games/snake60/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
