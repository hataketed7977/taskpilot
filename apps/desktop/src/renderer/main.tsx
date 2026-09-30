import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App api={window.taskpilot} /></React.StrictMode>);
