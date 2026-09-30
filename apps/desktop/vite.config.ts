import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
