import { app } from 'electron';
import { bootstrapDesktopApp } from './app/bootstrap.js';

app.whenReady().then(bootstrapDesktopApp);
app.on('window-all-closed', () => app.quit());
