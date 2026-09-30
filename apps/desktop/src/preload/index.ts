import { contextBridge, ipcRenderer } from 'electron';
import type { SessionView } from '../shared/contracts.js';
import { CHANNELS } from '../main/ipc.js';
import { createTaskPilotDesktopApi } from './api.js';

const api = createTaskPilotDesktopApi(
  (channel, input) => ipcRenderer.invoke(channel, input),
  listener => {
    const handler = (_event: Electron.IpcRendererEvent, view: SessionView) => listener(view);
    ipcRenderer.on(CHANNELS.sessionChanged, handler);
    return () => ipcRenderer.removeListener(CHANNELS.sessionChanged, handler);
  },
);
contextBridge.exposeInMainWorld('taskpilot', api);
