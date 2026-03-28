import { defineConfig } from 'vite';

export default defineConfig({
  base: '/games/chick-flap/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

