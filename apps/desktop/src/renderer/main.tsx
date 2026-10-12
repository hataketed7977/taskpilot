import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LocaleProvider } from './i18n/locale-context';
import './styles.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider>
      <App api={window.taskpilot} />
    </LocaleProvider>
  </React.StrictMode>,
);
