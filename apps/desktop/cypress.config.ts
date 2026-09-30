import { defineConfig } from 'cypress';
import { defineConfig as defineViteConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  video: false,
  screenshotOnRunFailure: true,
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
      viteConfig: defineViteConfig({ plugins: [react()] }),
    },
    specPattern: 'cypress/component/**/*.cy.tsx',
    supportFile: 'cypress/support/component.tsx',
  },
});
