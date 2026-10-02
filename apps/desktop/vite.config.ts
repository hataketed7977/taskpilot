import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const developmentNonce = 'taskpilot-development';

export default defineConfig(({ command }) => {
  const development = command === 'serve';
  return {
    root: 'src/renderer',
    plugins: [
      react(),
      ...(development ? [{
        name: 'taskpilot-development-csp',
        transformIndexHtml: {
          order: 'pre' as const,
          handler(html: string) {
            return html
              .replace("script-src 'self'", `script-src 'self' 'nonce-${developmentNonce}'`)
              .replace("connect-src 'none'", "connect-src 'self' ws://127.0.0.1:5173");
          },
        },
      }] : []),
    ],
    html: development ? { cspNonce: developmentNonce } : undefined,
    base: './',
    build: {
      outDir: '../../dist/renderer',
      emptyOutDir: true,
    },
  };
});
