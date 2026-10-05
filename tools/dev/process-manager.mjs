import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repositoryRoot, stateDirectory, statePath } from './dev-config.mjs';

const serviceMarkers = {
  coreApi: ':services:core-api:bootRun',
  desktop: '@taskpilot/desktop',
};

export function emptyState(root = repositoryRoot) {
  return { version: 1, repositoryRoot: path.resolve(root), services: {} };
}

export function readState(file = statePath, root = repositoryRoot) {
  if (!existsSync(file)) return emptyState(root);
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (state.version !== 1 || path.resolve(state.repositoryRoot ?? '') !== path.resolve(root) || typeof state.services !== 'object') {
      return emptyState(root);
    }
    return state;
  } catch {
    return emptyState(root);
  }
}

export function writeState(state, file = statePath) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true });
  const safe = {
    version: 1,
    repositoryRoot: path.resolve(state.repositoryRoot),
    services: Object.fromEntries(Object.entries(state.services ?? {}).flatMap(([name, service]) => {
      if (!Number.isInteger(service?.pid) || service.pid <= 0) return [];
      return [[name, {
        pid: service.pid,
        startedAt: String(service.startedAt ?? new Date().toISOString()),
        ...(service.logPath ? { logPath: path.resolve(service.logPath) } : {}),
      }]];
    })),
  };
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
}

export function recordService(name, service, file = statePath, root = repositoryRoot) {
  const state = readState(file, root);
  state.services[name] = service;
  writeState(state, file);
}

export function forgetService(name, file = statePath, root = repositoryRoot) {
  const state = readState(file, root);
  delete state.services[name];
  if (Object.keys(state.services).length === 0) {
    rmSync(file, { force: true });
    return;
  }
  writeState(state, file);
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function getProcessCommandLine(pid, platform = process.platform) {
  try {
    if (platform === 'win32') {
      const escaped = String(pid).replaceAll("'", "''");
      return execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${escaped}\").CommandLine`,
      ], { encoding: 'utf8', windowsHide: true }).trim();
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function isOwnedProcess(serviceName, commandLine, root = repositoryRoot) {
  const marker = serviceMarkers[serviceName];
  if (!marker || !commandLine) return false;
  const normalizedCommand = commandLine.replaceAll('\\', '/').toLowerCase();
  const normalizedRoot = path.resolve(root).replaceAll('\\', '/').toLowerCase();
  if (!normalizedCommand.includes(normalizedRoot) || !normalizedCommand.includes(marker.toLowerCase())) return false;
  return serviceName !== 'desktop' || normalizedCommand.includes(' dev');
}

export function stopProcessTree(pid, { platform = process.platform, signal = 'SIGTERM' } = {}) {
  if (!isProcessAlive(pid)) return;
  if (platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    if (result.error) throw result.error;
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    try {
      process.kill(pid, signal);
    } catch (fallbackError) {
      if (fallbackError?.code !== 'ESRCH') throw fallbackError;
    }
  }
}

export function inspectRecordedService(name, options = {}) {
  const file = options.stateFile ?? statePath;
  const root = options.repositoryRoot ?? repositoryRoot;
  const state = readState(file, root);
  const service = state.services[name];
  if (!service) return { status: 'not-recorded' };
  const alive = (options.isAlive ?? isProcessAlive)(service.pid);
  if (!alive) return { status: 'stale', ...service };
  const commandLine = (options.commandLine ?? getProcessCommandLine)(service.pid, options.platform);
  return {
    status: isOwnedProcess(name, commandLine, root) ? 'owned' : 'unowned',
    commandLine,
    ...service,
  };
}

export async function waitForProcessExit(pid, options = {}) {
  const isAlive = options.isAlive ?? isProcessAlive;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 50;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await sleep(intervalMs);
  return !isAlive(pid);
}

export async function stopProcessAndWait(pid, options = {}) {
  const isAlive = options.isAlive ?? isProcessAlive;
  const stopTree = options.stopTree ?? stopProcessTree;
  if (!isAlive(pid)) return true;
  stopTree(pid, { platform: options.platform, signal: 'SIGTERM' });
  if (await waitForProcessExit(pid, { ...options, isAlive, timeoutMs: options.gracefulTimeoutMs ?? 5_000 })) return true;
  stopTree(pid, { platform: options.platform, signal: 'SIGKILL' });
  return waitForProcessExit(pid, { ...options, isAlive, timeoutMs: options.forceTimeoutMs ?? 2_000 });
}

export async function stopRecordedService(name, options = {}) {
  const file = options.stateFile ?? statePath;
  const root = options.repositoryRoot ?? repositoryRoot;
  const inspected = inspectRecordedService(name, options);
  if (inspected.status === 'not-recorded') return inspected;
  if (inspected.status === 'stale') {
    forgetService(name, file, root);
    return inspected;
  }
  if (inspected.status !== 'owned') return inspected;
  const stopped = await stopProcessAndWait(inspected.pid, options);
  if (!stopped) return { ...inspected, status: 'stop-failed' };
  forgetService(name, file, root);
  return { ...inspected, status: 'stopped' };
}

export function ensureStateDirectory(directory = stateDirectory) {
  mkdirSync(directory, { recursive: true });
  return directory;
}
