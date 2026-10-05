import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const developmentNonce = 'taskpilot-development';
const developmentPort = Number(process.env.TASKPILOT_DESKTOP_DEV_SERVER_PORT ?? 5173);
if (!Number.isInteger(developmentPort) || developmentPort < 1 || developmentPort > 65_535) {
  throw new Error('TASKPILOT_DESKTOP_DEV_SERVER_PORT must be an integer between 1 and 65535.');
}

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
              .replace("connect-src 'none'", `connect-src 'self' ws://127.0.0.1:${developmentPort}`);
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
