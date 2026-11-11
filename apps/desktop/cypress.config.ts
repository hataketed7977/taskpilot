import { defineConfig } from 'cypress';
import { defineConfig as defineViteConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  video: false,
  screenshotOnRunFailure: true,
  component: {
    setupNodeEvents(on) {
      on('before:browser:launch', (browser, launchOptions) => {
        // Keep wide-window screenshots at their real size instead of clipping
        // the 1600px AUT to Cypress's smaller headless browser window.
        if (browser.name === 'electron' && browser.isHeadless) {
          launchOptions.preferences.width = 1920;
          launchOptions.preferences.height = 1080;
        } else if (browser.family === 'chromium' && browser.isHeadless) {
          launchOptions.args.push('--window-size=1920,1080');
        }
        return launchOptions;
      });
    },
    devServer: {
      framework: 'react',
      bundler: 'vite',
      viteConfig: defineViteConfig({ plugins: [react()] }),
    },
    specPattern: 'cypress/component/**/*.cy.tsx',
    supportFile: 'cypress/support/component.tsx',
  },
});
