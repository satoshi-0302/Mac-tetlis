import { defineConfig } from 'vite';

export default defineConfig({
  // The platform serves Snake60 from /games/snake60/.
  base: '/games/snake60/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
