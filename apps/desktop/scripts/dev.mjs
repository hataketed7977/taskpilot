import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import electronPath from 'electron';
import { build as viteBuild, createServer } from 'vite';

const appRoot = path.resolve(import.meta.dirname, '..');
const devServerUrl = 'http://127.0.0.1:5173';
const electronSources = [
  path.join(appRoot, 'src/main'),
  path.join(appRoot, 'src/preload'),
  path.join(appRoot, 'src/shared'),
  path.join(appRoot, 'tsconfig.main.json'),
  path.join(appRoot, 'vite.preload.config.ts'),
];

function compileMain() {
  const compiler = path.join(appRoot, 'node_modules/typescript/bin/tsc');
  const result = spawnSync(process.execPath, [compiler, '-p', path.join(appRoot, 'tsconfig.main.json')], {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Main compilation failed with code ${result.status}.`);
}

async function compileElectron() {
  compileMain();
  const nodeEnvironment = process.env.NODE_ENV;
  try {
    await viteBuild({
      configFile: path.join(appRoot, 'vite.preload.config.ts'),
      logLevel: 'warn',
    });
  } finally {
    if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvironment;
  }
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

process.env.NODE_ENV = 'development';
await compileElectron();

const server = await createServer({
  configFile: path.join(appRoot, 'vite.config.ts'),
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
await server.listen();
server.printUrls();

let electron;
let expectedElectronExit = false;
let stopping = false;
let rebuilding = false;
let rebuildQueued = false;
let rebuildTimer;

function launchElectron() {
  expectedElectronExit = false;
  electron = spawn(electronPath, ['.'], {
    cwd: appRoot,
    env: { ...process.env, TASKPILOT_DESKTOP_DEV_SERVER_URL: devServerUrl },
    stdio: 'inherit',
    windowsHide: true,
  });
  electron.once('error', error => {
    console.error(`Electron failed to start: ${error.message}`);
    void shutdown(1);
  });
  electron.once('exit', (code, signal) => {
    if (stopping || expectedElectronExit) return;
    if (code === 0) {
      void shutdown(0);
      return;
    }
    console.error(`Electron exited unexpectedly with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`);
    void shutdown(1);
  });
}

async function restartElectron() {
  const previous = electron;
  if (previous && previous.exitCode === null && previous.signalCode === null) {
    expectedElectronExit = true;
    stopProcessTree(previous);
    await once(previous, 'exit');
  }
  if (!stopping) launchElectron();
}

async function rebuildElectron() {
  if (rebuilding) {
    rebuildQueued = true;
    return;
  }
  rebuilding = true;
  try {
    do {
      rebuildQueued = false;
      console.log('\nElectron source changed; rebuilding Main and Preload...');
      try {
        await compileElectron();
        await restartElectron();
        console.log('Electron restarted.');
      } catch (error) {
        console.error(`Electron rebuild failed; keeping the current window open.\n${error instanceof Error ? error.message : String(error)}`);
      }
    } while (rebuildQueued && !stopping);
  } finally {
    rebuilding = false;
  }
}

function scheduleElectronRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => void rebuildElectron(), 180);
}

server.watcher.add(electronSources);
server.watcher.on('all', (event, changedPath) => {
  if (!['add', 'change', 'unlink'].includes(event)) return;
  const absolute = path.resolve(changedPath);
  if (electronSources.some(source => absolute === source || absolute.startsWith(`${source}${path.sep}`))) {
    scheduleElectronRebuild();
  }
});

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  clearTimeout(rebuildTimer);
  stopProcessTree(electron);
  await server.close();
  process.exitCode = exitCode;
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

launchElectron();
