import '@testing-library/cypress/add-commands';
import { mount } from 'cypress/react';
import '@fontsource-variable/inter';
import '../../src/renderer/styles/index.css';

declare module 'cypress' {
  interface Chainable {
    mount: typeof mount;
  }
}

Cypress.Commands.add('mount', mount);
