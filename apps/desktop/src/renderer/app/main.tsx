import '@fontsource-variable/inter';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from '../i18n/locale-context';
import '../styles/index.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App api={window.taskpilot} />
    </LocaleProvider>
  </React.StrictMode>,
);
