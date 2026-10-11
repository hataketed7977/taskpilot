import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { closeSync, existsSync, openSync, readFileSync, statSync, watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  childCommands,
  coreApiLogPath,
  localConfiguration,
  repositoryRoot,
} from './dev-config.mjs';
import {
  ensureLocalEnvironment,
  localEnvironmentPath,
  federatedAuthenticationEnvironment,
  readLocalEnvironment,
} from './local-environment.mjs';
import { classifyComposeProject, parseComposePs } from './compose-manager.mjs';
import {
  classifyLocalPostgresVolume,
  isRecoverableLocalDatabaseIncompatibility,
  postgresVolumeName,
  startupUsedExpectedLocalDatabase,
  withOneDatabaseRecovery,
} from './database-recovery.mjs';
import { coreApiHealth, waitForHealth } from './health-checks.mjs';
import {
  ensureStateDirectory,
  forgetService,
  forgetServiceIfPid,
  getParentProcessId,
  getProcessCommandLine,
  inspectRecordedService,
  isDevControllerProcess,
  isProcessAlive,
  recordService,
  stopProcessAndWait,
  stopRecordedService,
  waitForProcessExit,
} from './process-manager.mjs';
import {
  assertPrerequisites,
  isPortOpen,
  portConflictMessage,
  prerequisiteChecks,
} from './preflight.mjs';

const supportedCommands = new Set(['start', 'api', 'desktop', 'stop', 'restart', 'status', 'logs', 'doctor', 'smoke', 'help']);
const logServices = new Set(['core-api', 'postgres', 'redis']);

export function parseCli(argv) {
  const args = [...argv];
  const command = args[0]?.startsWith('-') || !args[0] ? 'start' : args.shift();
  if (!supportedCommands.has(command)) throw new Error(`Unknown command: ${command}. Run pnpm dev:help.`);
  let service = 'core-api';
  let follow = false;
  while (args.length) {
    const argument = args.shift();
    if (argument === '--follow' || argument === '-f') follow = true;
    else if (argument === '--service') service = args.shift();
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!logServices.has(service)) throw new Error('Log service must be core-api, postgres, or redis.');
  return { command, service, follow };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: options.encoding ?? 'utf8',
    env: options.env,
    stdio: options.stdio,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

function composeArgs(...args) {
  return ['compose', '--env-file', localEnvironmentPath, ...args];
}

function environmentAndConfig({ create = false } = {}) {
  if (!create && !existsSync(localEnvironmentPath)) {
    throw new Error('Missing .env.local. Run pnpm bootstrap before starting TaskPilot.');
  }
  const values = create ? ensureLocalEnvironment() : readLocalEnvironment(localEnvironmentPath);
  const config = localConfiguration(values);
  const federated = federatedAuthenticationEnvironment(values);
  return {
    values,
    config,
    federated,
    environment: {
      ...process.env,
      ...values,
      ...federated.environment,
      TASKPILOT_COMPOSE_PROJECT: config.composeProject,
      TASKPILOT_POSTGRES_PORT: String(config.postgresPort),
      TASKPILOT_CORE_API_PORT: String(config.coreApiPort),
      TASKPILOT_DESKTOP_DEV_SERVER_PORT: String(config.desktopDevServerPort),
      SPRING_PROFILES_ACTIVE: 'local',
      SERVER_PORT: String(config.coreApiPort),
      TASKPILOT_CORE_API_URL: config.coreApiUrl,
      TASKPILOT_DESKTOP_DEV_SERVER_URL: config.desktopDevServerUrl,
    },
  };
}

function inspectComposeProject(environment) {
  try {
    const result = run('docker', composeArgs('ps', '-a', '--format', 'json'), {
      env: environment,
      allowFailure: true,
    });
    if (result.status !== 0) return { status: 'unavailable', services: new Set() };
    return classifyComposeProject(parseComposePs(result.stdout), repositoryRoot);
  } catch {
    return { status: 'unavailable', services: new Set() };
  }
}

function assertComposeOwnership(environment) {
  const project = inspectComposeProject(environment);
  if (project.status === 'unowned') {
    throw new Error(`Docker Compose project ${environment.TASKPILOT_COMPOSE_PROJECT} belongs to another checkout. TaskPilot will not reuse or stop it.`);
  }
  if (project.status === 'unavailable') {
    throw new Error('Docker Compose project ownership could not be inspected. TaskPilot will not start or stop infrastructure without proving ownership.');
  }
  return project;
}

async function assertInfrastructurePortsAvailable(config, environment) {
  const running = assertComposeOwnership(environment).services;
  const checks = [
    { service: 'postgres', port: config.postgresPort, purpose: 'PostgreSQL' },
    { service: 'redis', port: config.redisPort, purpose: 'Redis' },
  ];
  for (const check of checks) {
    if (!running.has(check.service) && await isPortOpen(check.port)) {
      throw new Error(portConflictMessage(check.port, check.purpose));
    }
  }
}

export function projectDependencyChecks(root = repositoryRoot) {
  const required = [
    ['pnpm workspace dependencies', path.join(root, 'node_modules', '.modules.yaml')],
    ['Desktop Vite', path.join(root, 'apps', 'desktop', 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')],
    ['Desktop Electron', path.join(root, 'apps', 'desktop', 'node_modules', 'electron')],
  ];
  const checks = required.map(([name, target]) => ({ name, target, ok: existsSync(target) }));
  const lockfile = path.join(root, 'pnpm-lock.yaml');
  const installedLockfile = path.join(root, 'node_modules', '.pnpm', 'lock.yaml');
  checks.push({
    name: 'pnpm lockfile state',
    target: installedLockfile,
    ok: existsSync(lockfile) && existsSync(installedLockfile) && readFileSync(lockfile).equals(readFileSync(installedLockfile)),
  });
  return checks;
}

function assertProjectDependencies() {
  const missing = projectDependencyChecks().filter(check => !check.ok);
  if (missing.length) throw new Error(`Project dependencies are missing (${missing.map(check => check.name).join(', ')}). Run pnpm bootstrap.`);
}

async function startInfrastructure(config, environment) {
  await assertInfrastructurePortsAvailable(config, environment);
  run('docker', composeArgs('up', '-d', '--wait', '--pull', 'never', '--remove-orphans'), { env: environment, stdio: 'inherit' });
}

function inspectCoreApi() {
  return inspectRecordedService('coreApi');
}

async function assertCoreApiPortAvailable(config) {
  if (!await isPortOpen(config.coreApiPort)) return;
  const recorded = inspectCoreApi();
  if (recorded.status === 'owned' && await coreApiHealth(config.coreApiUrl)) return;
  throw new Error(portConflictMessage(config.coreApiPort, 'Core API'));
}

export function waitForSpawn(child, label = 'Child process') {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
    };
    const onSpawn = () => {
      cleanup();
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        reject(new Error(`${label} started without a valid PID.`));
        return;
      }
      resolve(child);
    };
    const onError = error => {
      cleanup();
      reject(new Error(`${label} failed to start: ${error.message}`, { cause: error }));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

async function recordStartedProcess(name, child, service, label) {
  await waitForSpawn(child, label);
  child.once('error', error => console.error(`${label} process error: ${error.message}`));
  try {
    recordService(name, { ...service, pid: child.pid, startedAt: new Date().toISOString() });
  } catch (error) {
    await stopProcessAndWait(child.pid);
    throw error;
  }
  return child;
}

function readLogSince(file, offset = 0) {
  if (!existsSync(file)) return '';
  return readFileSync(file).subarray(offset).toString('utf8');
}

async function startCoreApi(environment, config) {
  const existing = inspectCoreApi();
  if (existing.status === 'owned') return { process: null, started: false, pid: existing.pid };
  if (existing.status === 'stale') forgetService('coreApi');
  if (existing.status === 'unowned') {
    throw new Error(`Recorded Core API PID ${existing.pid} is alive but does not belong to this checkout. Refusing to replace or stop it.`);
  }
  ensureStateDirectory();
  const logStart = existsSync(coreApiLogPath) ? statSync(coreApiLogPath).size : 0;
  const logFd = openSync(coreApiLogPath, 'a', 0o600);
  const command = childCommands().gradle;
  let child;
  try {
    child = spawn(command.command, command.args, {
      cwd: repositoryRoot,
      env: environment,
      detached: process.platform !== 'win32',
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
  } finally {
    closeSync(logFd);
  }
  await recordStartedProcess('coreApi', child, { logPath: coreApiLogPath }, 'Core API');
  return { process: child, started: true, pid: child.pid, config, logStart };
}

async function ensureCoreApiAttempt(environment, config, lifecycle = {}) {
  await assertCoreApiPortAvailable(config);
  const started = await startCoreApi(environment, config);
  lifecycle.onStarted?.(started);
  try {
    if (lifecycle.isStopping?.()) throw new Error('Core API startup was interrupted');
    if (!await coreApiHealth(config.coreApiUrl)) {
      await waitForHealth(() => coreApiHealth(config.coreApiUrl), {
        isAlive: () => !lifecycle.isStopping?.() && (!started.process || isProcessAlive(started.pid)),
      });
    }
    return started;
  } catch (error) {
    if (started.started) {
      if (lifecycle.cleanupOnFailure !== false) await stopOwnedChild('coreApi', started.process);
      error.taskpilotCoreApiStartup = started;
      error.taskpilotCoreApiLog = readLogSince(coreApiLogPath, started.logStart);
      error.message = `${error.message}. See ${coreApiLogPath}`;
    }
    throw error;
  }
}

function inspectPostgresVolume(composeProject, environment) {
  const volume = postgresVolumeName(composeProject);
  const result = run('docker', ['volume', 'inspect', volume], { env: environment, allowFailure: true });
  if (result.status !== 0) return null;
  try {
    const inspected = JSON.parse(result.stdout);
    return Array.isArray(inspected) && inspected.length === 1 ? inspected[0] : null;
  } catch {
    return null;
  }
}

function canRecoverLocalDatabase(error, config) {
  const log = error?.taskpilotCoreApiLog ?? '';
  return isRecoverableLocalDatabaseIncompatibility(log)
    && startupUsedExpectedLocalDatabase(log, config.postgresPort);
}

async function rebuildOwnedLocalDatabase(error, environment, config) {
  const started = error.taskpilotCoreApiStartup;
  if (started?.started) await stopOwnedChild('coreApi', started.process);

  const project = assertComposeOwnership(environment);
  if (project.status !== 'owned' || !project.services.has('postgres')) {
    throw new Error('Refusing automatic database recovery because the running PostgreSQL Compose project is not proven to belong to this checkout.');
  }
  const volume = postgresVolumeName(config.composeProject);
  const inspected = inspectPostgresVolume(config.composeProject, environment);
  if (classifyLocalPostgresVolume(inspected, config.composeProject) !== 'owned-disposable-local') {
    throw new Error(`Refusing automatic database recovery because ownership of Docker volume ${volume} could not be proven.`);
  }

  console.warn('Detected an incompatible schema history in the checkout-owned disposable local database.');
  console.warn(`Rebuilding ${volume} once; no external or unowned database will be modified.`);
  run('docker', composeArgs('down', '--remove-orphans'), { env: environment, stdio: 'inherit' });
  run('docker', ['volume', 'rm', volume], { env: environment, stdio: 'inherit' });
  await startInfrastructure(config, environment);
}

async function ensureCoreApi(environment, config, lifecycle = {}) {
  if (!lifecycle.autoRecoverDatabase) return ensureCoreApiAttempt(environment, config, lifecycle);
  return withOneDatabaseRecovery(
    () => ensureCoreApiAttempt(environment, config, lifecycle),
    error => canRecoverLocalDatabase(error, config),
    error => rebuildOwnedLocalDatabase(error, environment, config),
  );
}

async function assertDesktopPortAvailable(config) {
  if (await isPortOpen(config.desktopDevServerPort)) {
    throw new Error(portConflictMessage(config.desktopDevServerPort, 'Desktop Vite'));
  }
}

export function assertDesktopPortReplaceable(portInUse, recordedDesktop, port) {
  if (portInUse && recordedDesktop.status !== 'owned') {
    throw new Error(portConflictMessage(port, 'Desktop Vite'));
  }
}

export async function replaceRecordedHostServices(
  serviceNames,
  {
    inspectService = inspectRecordedService,
    stopService = stopRecordedService,
    parentProcessId = getParentProcessId,
    processCommandLine = getProcessCommandLine,
    signalController = pid => process.kill(pid, 'SIGTERM'),
    waitForController = waitForProcessExit,
    forceController = pid => process.kill(pid, 'SIGKILL'),
  } = {},
) {
  const inspections = serviceNames.map(name => ({ name, result: inspectService(name) }));
  const unsafe = inspections.filter(({ result }) => result.status === 'unowned');
  if (unsafe.length) {
    throw new Error(`Refusing to replace host processes because ownership could not be proven for ${unsafe.map(({ name, result }) => `${name} PID ${result.pid}`).join(', ')}.`);
  }

  const controllerPids = new Set(inspections.flatMap(({ result }) => {
    if (result.status !== 'owned') return [];
    const controllerPid = parentProcessId(result.pid);
    if (!Number.isInteger(controllerPid) || controllerPid <= 0 || controllerPid === process.pid) return [];
    return isDevControllerProcess(processCommandLine(controllerPid)) ? [controllerPid] : [];
  }));

  for (const controllerPid of controllerPids) {
    if (!isDevControllerProcess(processCommandLine(controllerPid))) {
      throw new Error(`Previous TaskPilot launcher PID ${controllerPid} changed identity before it could be stopped.`);
    }
    console.log(`Stopping previous TaskPilot launcher (PID ${controllerPid}).`);
    try {
      signalController(controllerPid);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    await waitForController(controllerPid, { timeoutMs: 5_000 });
  }

  for (const { name, result } of inspections) {
    if (result.status === 'not-recorded') continue;
    const stopped = await stopService(name);
    if (stopped.status === 'unowned') {
      throw new Error(`Refusing to replace ${name} PID ${stopped.pid}: ownership changed before it could be stopped.`);
    }
    if (stopped.status === 'stop-failed') {
      throw new Error(`Failed to stop ${name} PID ${stopped.pid}; state was preserved.`);
    }
    if (stopped.status === 'stopped') console.log(`Stopped previous ${name} (PID ${stopped.pid}).`);
    else if (stopped.status === 'stale') console.log(`Removed stale ${name} state (PID ${stopped.pid}).`);
  }

  for (const controllerPid of controllerPids) {
    if (await waitForController(controllerPid, { timeoutMs: 500 })) continue;
    if (!isDevControllerProcess(processCommandLine(controllerPid))) {
      throw new Error(`Previous TaskPilot launcher PID ${controllerPid} changed identity while cleanup was finishing; refusing to force-stop it.`);
    }
    try {
      forceController(controllerPid);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    if (!await waitForController(controllerPid, { timeoutMs: 2_000 })) {
      throw new Error(`Failed to stop previous TaskPilot launcher PID ${controllerPid}.`);
    }
  }
}

async function startDesktop(environment, lifecycle = {}) {
  const existing = inspectRecordedService('desktop');
  if (existing.status === 'owned') {
    throw new Error(`Desktop is already running for this checkout with PID ${existing.pid}.`);
  }
  if (existing.status === 'stale') forgetService('desktop');
  if (existing.status === 'unowned') {
    throw new Error(`Recorded Desktop PID ${existing.pid} is alive but ownership cannot be proven.`);
  }
  const command = childCommands().desktopDev;
  const desktop = spawn(command.command, command.args, {
    cwd: repositoryRoot,
    env: environment,
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    windowsHide: true,
  });
  await recordStartedProcess('desktop', desktop, {}, 'Desktop');
  lifecycle.onStarted?.(desktop);
  if (lifecycle.isStopping?.()) throw new Error('Desktop startup was interrupted');
  return desktop;
}

async function stopOwnedChild(name, child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    forgetServiceIfPid(name, child.pid);
    return;
  }
  const stopped = await stopProcessAndWait(child.pid);
  if (!stopped) throw new Error(`Failed to stop ${name} process tree (PID ${child.pid}); state was preserved.`);
  forgetServiceIfPid(name, child.pid);
}

export function waitForChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

export function childExitedUnexpectedly(exit, stopping = false) {
  return !stopping && (exit.signal !== null || exit.code !== 0);
}

function exitDescription(exit) {
  return exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? 'unknown'}`;
}

async function commandApi() {
  assertPrerequisites();
  const { config, environment } = environmentAndConfig();
  await startInfrastructure(config, environment);
  let core;
  let stopping = false;
  let cleanupPromise;
  const cleanup = () => {
    stopping = true;
    if (!core?.started || !core.process) return Promise.resolve();
    return cleanupPromise ??= stopOwnedChild('coreApi', core.process);
  };
  const onSignal = signal => {
    if (stopping) return;
    console.log(`\nReceived ${signal}; stopping Core API. PostgreSQL remains running.`);
    void cleanup().catch(error => console.error(`Core API cleanup failed: ${error.message}`));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    core = await ensureCoreApi(environment, config, {
      isStopping: () => stopping,
      onStarted: started => { core = started; },
      cleanupOnFailure: false,
      autoRecoverDatabase: true,
    });
    console.log(`Core API is healthy: ${config.coreApiUrl}`);
    console.log(`Core API log: ${coreApiLogPath}`);
    if (!core.started) {
      console.log('Core API was already running for this checkout.');
      return;
    }
    const exit = await waitForChild(core.process);
    if (childExitedUnexpectedly(exit, stopping)) throw new Error(`Core API exited unexpectedly with ${exitDescription(exit)}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (core?.started) await cleanup();
  }
}

export function assertDesktopCoreApi(recorded, healthy, coreApiUrl) {
  if (recorded.status !== 'owned') {
    throw new Error(`Core API ownership is not recorded for this checkout at ${coreApiUrl}. Run pnpm dev:api or pnpm dev.`);
  }
  if (!healthy) {
    throw new Error(`Core API is not healthy at ${coreApiUrl}. Run pnpm dev:api or pnpm dev.`);
  }
}

async function commandDesktop() {
  assertProjectDependencies();
  const { config, environment } = environmentAndConfig();
  const recordedCoreApi = inspectCoreApi();
  assertDesktopCoreApi(recordedCoreApi, await coreApiHealth(config.coreApiUrl), config.coreApiUrl);
  await assertDesktopPortAvailable(config);
  let desktop;
  let stopping = false;
  let cleanupPromise;
  const cleanup = () => {
    stopping = true;
    if (!desktop) return Promise.resolve();
    return cleanupPromise ??= stopOwnedChild('desktop', desktop);
  };
  const onSignal = signal => {
    if (stopping) return;
    console.log(`\nReceived ${signal}; stopping Desktop.`);
    void cleanup().catch(error => console.error(`Desktop cleanup failed: ${error.message}`));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    desktop = await startDesktop(environment, {
      isStopping: () => stopping,
      onStarted: started => { desktop = started; },
    });
    const exit = await waitForChild(desktop);
    if (childExitedUnexpectedly(exit, stopping)) throw new Error(`Desktop exited unexpectedly with ${exitDescription(exit)}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (desktop) await cleanup();
  }
}

async function commandStart() {
  assertPrerequisites();
  assertProjectDependencies();
  const { config, environment } = environmentAndConfig();
  assertDesktopPortReplaceable(
    await isPortOpen(config.desktopDevServerPort),
    inspectRecordedService('desktop'),
    config.desktopDevServerPort,
  );
  await replaceRecordedHostServices(['desktop', 'coreApi']);
  await assertDesktopPortAvailable(config);
  await startInfrastructure(config, environment);
  let core;
  let desktop;
  let stopping = false;
  let desktopCleanupPromise;
  let coreCleanupPromise;
  const cleanup = async () => {
    stopping = true;
    const stops = [];
    if (desktop) stops.push(desktopCleanupPromise ??= stopOwnedChild('desktop', desktop));
    if (core?.started && core.process) stops.push(coreCleanupPromise ??= stopOwnedChild('coreApi', core.process));
    const results = await Promise.allSettled(stops);
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'One or more TaskPilot host processes failed to stop.');
  };
  const onSignal = signal => {
    if (stopping) return;
    console.log(`\nReceived ${signal}; stopping TaskPilot host processes. PostgreSQL remains running.`);
    void cleanup().catch(error => console.error(`Host-process cleanup failed: ${error.message}`));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    core = await ensureCoreApi(environment, config, {
      isStopping: () => stopping,
      onStarted: started => { core = started; },
      cleanupOnFailure: false,
      autoRecoverDatabase: true,
    });
    console.log(`Core API is healthy: ${config.coreApiUrl}`);
    console.log(`Core API log: ${coreApiLogPath}`);
    desktop = await startDesktop(environment, {
      isStopping: () => stopping,
      onStarted: started => { desktop = started; },
    });
    const exit = await waitForChild(desktop);
    if (childExitedUnexpectedly(exit, stopping)) throw new Error(`Desktop exited unexpectedly with ${exitDescription(exit)}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

function stopResult(name, result) {
  if (result.status === 'stopped') console.log(`Stopped ${name} (PID ${result.pid}).`);
  else if (result.status === 'stale') console.log(`Removed stale ${name} state (PID ${result.pid}).`);
  else if (result.status === 'unowned') console.warn(`Refused to stop ${name} PID ${result.pid}: ownership could not be proven.`);
  else if (result.status === 'stop-failed') console.warn(`Failed to stop ${name} PID ${result.pid}; state was preserved.`);
  else console.log(`${name} was not recorded as running.`);
}

export function stopHostServices(stopService = stopRecordedService) {
  return Promise.allSettled([
    Promise.resolve().then(() => stopService('desktop')).then(result => ({ label: 'Desktop', result })),
    Promise.resolve().then(() => stopService('coreApi')).then(result => ({ label: 'Core API', result })),
  ]);
}

async function commandStop({ stopInfrastructure = true } = {}) {
  const inspections = {
    desktop: inspectRecordedService('desktop'),
    coreApi: inspectRecordedService('coreApi'),
  };
  const unsafe = Object.entries(inspections).filter(([, result]) => result.status === 'unowned');
  if (unsafe.length) {
    throw new Error(`Refusing to stop host processes because ownership could not be proven for ${unsafe.map(([name, result]) => `${name} PID ${result.pid}`).join(', ')}.`);
  }
  const stops = await stopHostServices();
  const failures = [];
  for (const stop of stops) {
    if (stop.status === 'rejected') {
      failures.push(stop.reason);
      console.warn(`Host-process stop failed: ${stop.reason.message}`);
      continue;
    }
    stopResult(stop.value.label, stop.value.result);
    if (stop.value.result.status === 'stop-failed') failures.push(new Error(`${stop.value.label} did not stop`));
  }
  if (failures.length) throw new AggregateError(failures, 'One or more host processes did not stop; infrastructure was left running and process state was preserved.');
  if (!stopInfrastructure) return;
  if (!existsSync(localEnvironmentPath)) {
    console.log('No .env.local exists; infrastructure stop was skipped.');
    return;
  }
  const { environment } = environmentAndConfig({ create: false });
  const project = inspectComposeProject(environment);
  if (project.status === 'unavailable') {
    console.warn('Docker is unavailable; host processes were stopped but PostgreSQL and Redis could not be stopped.');
    return;
  }
  if (project.status === 'unowned') throw new Error('Refusing to stop a Docker Compose project whose checkout ownership cannot be proven.');
  run('docker', composeArgs('down'), { env: environment, stdio: 'inherit' });
  console.log('Stopped the PostgreSQL and Redis containers; checkout-scoped volumes were kept.');
}

async function composeStatus(environment) {
  const project = inspectComposeProject(environment);
  return {
    ownership: project.status,
    postgres: project.status === 'owned' && project.services.has('postgres'),
    redis: project.status === 'owned' && project.services.has('redis'),
  };
}

function serviceLabel(result) {
  if (result.status === 'owned') return `running (PID ${result.pid}, owned by this checkout)`;
  if (result.status === 'stale') return `stale state (PID ${result.pid} is not running)`;
  if (result.status === 'unowned') return `unsafe state (PID ${result.pid} ownership not proven)`;
  return 'not running';
}

async function commandStatus() {
  if (!existsSync(localEnvironmentPath)) {
    console.log('Local environment: missing (.env.local); run pnpm bootstrap.');
    return;
  }
  let local;
  try {
    local = environmentAndConfig({ create: false });
  } catch (error) {
    console.log(`Local environment: invalid (${error.message})`);
    return;
  }
  const compose = composeStatus(local.environment);
  const core = inspectCoreApi();
  const desktop = inspectRecordedService('desktop');
  const [infrastructure, coreHealthy] = await Promise.all([
    compose,
    coreApiHealth(local.config.coreApiUrl),
  ]);
  console.log(`TaskPilot local status (${local.config.composeProject})`);
  if (infrastructure.ownership === 'unowned') {
    console.log('- Compose ownership: CONFLICT (project belongs to another checkout)');
  } else if (infrastructure.ownership === 'unavailable') {
    console.log('- Compose ownership: unavailable (Docker daemon could not be queried)');
  }
  console.log(`- PostgreSQL: ${infrastructure.postgres ? 'container running' : 'not running'} (127.0.0.1:${local.config.postgresPort})`);
  console.log(`- Redis: ${infrastructure.redis ? 'container running' : 'not running'} (127.0.0.1:${local.config.redisPort})`);
  console.log(`- Core API: ${serviceLabel(core)}; HTTP ${coreHealthy ? 'UP' : 'not ready'} (${local.config.coreApiUrl})`);
  console.log(`- GitHub login configuration: ${local.federated.enabled ? 'enabled' : 'disabled (fail closed)'}`);
  console.log(`- Desktop: ${serviceLabel(desktop)}; Vite ${local.config.desktopDevServerUrl}`);
}

function environmentPermission() {
  if (process.platform === 'win32') return { ok: true, detail: 'Windows ACLs apply' };
  const mode = statSync(localEnvironmentPath).mode & 0o777;
  return { ok: (mode & 0o077) === 0, detail: `mode ${mode.toString(8).padStart(3, '0')}` };
}

function describePortOwner(port) {
  try {
    if (process.platform === 'win32') {
      const result = run('netstat.exe', ['-ano', '-p', 'tcp'], { allowFailure: true });
      const line = String(result.stdout).split(/\r?\n/).find(item => item.includes(`:${port} `) && /LISTENING/i.test(item));
      return line?.trim() ?? 'unknown process';
    }
    const result = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { allowFailure: true });
    return String(result.stdout).split(/\r?\n/).filter(Boolean).slice(1, 3).join(' | ') || 'unknown process';
  } catch {
    return 'unknown process';
  }
}

export function doctorHasBlockingProblems(prerequisites, environmentState, dependencies) {
  return prerequisites.some(check => !check.ok)
    || dependencies.some(check => !check.ok)
    || environmentState.startsWith('invalid')
    || environmentState.includes('must not');
}

async function commandDoctor() {
  console.log('TaskPilot local doctor');
  const checks = prerequisiteChecks();
  for (const check of checks) console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  let config = localConfiguration({});
  let composeEnvironment = { ...process.env, TASKPILOT_COMPOSE_PROJECT: config.composeProject };
  let environmentValid = true;
  let envState = 'missing; pnpm bootstrap will create it';
  if (existsSync(localEnvironmentPath)) {
    try {
      const values = readLocalEnvironment();
      config = localConfiguration(values);
      composeEnvironment = { ...process.env, ...values, TASKPILOT_COMPOSE_PROJECT: config.composeProject };
      const permission = environmentPermission();
      envState = `valid, ${permission.detail}${permission.ok ? '' : ' (must not be readable by group/others)'}`;
    } catch (error) {
      environmentValid = false;
      envState = `invalid: ${error.message}`;
    }
  }
  console.log(`- ${envState.startsWith('valid') || envState.startsWith('missing') ? 'PASS' : 'FAIL'} .env.local: ${envState}`);
  if (environmentValid) {
    const ports = [
      [config.postgresPort, 'PostgreSQL'],
      [config.redisPort, 'Redis'],
      [config.coreApiPort, 'Core API'],
      [config.desktopDevServerPort, 'Desktop Vite'],
    ];
    for (const [port, purpose] of ports) {
      const open = await isPortOpen(port);
      console.log(`- INFO port ${port} (${purpose}): ${open ? `in use — ${describePortOwner(port)}` : 'available'}`);
    }
    const compose = existsSync(localEnvironmentPath)
      ? inspectComposeProject(composeEnvironment)
      : { status: 'absent', services: new Set() };
    const composeDetail = compose.status === 'owned'
      ? `owned by this checkout; running: ${[...compose.services].join(', ') || 'none'}`
      : compose.status;
    console.log(`- INFO Compose project ${config.composeProject}: ${composeDetail}`);
  } else {
    console.log('- INFO ports and Compose: skipped until .env.local is valid');
  }
  const dependencies = projectDependencyChecks();
  for (const check of dependencies) console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.ok ? 'installed' : `missing (${check.target})`}`);
  const core = inspectCoreApi();
  const desktop = inspectRecordedService('desktop');
  console.log(`- INFO recorded Core API: ${serviceLabel(core)}`);
  console.log(`- INFO recorded Desktop: ${serviceLabel(desktop)}`);
  if (doctorHasBlockingProblems(checks, envState, dependencies)) {
    throw new Error('Doctor found one or more blocking problems.');
  }
}

function readLastLines(file, count = 200) {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').split(/\r?\n/).slice(-count).join('\n');
}

async function followFile(file) {
  let size = existsSync(file) ? statSync(file).size : 0;
  await new Promise(resolve => {
    const onSignal = () => resolve();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    watchFile(file, { interval: 500 }, current => {
      if (current.size < size) size = 0;
      if (current.size === size) return;
      const content = readFileSync(file).subarray(size);
      size = current.size;
      process.stdout.write(content);
    });
  });
  unwatchFile(file);
}

async function commandLogs(service, follow) {
  if (service === 'core-api') {
    if (!existsSync(coreApiLogPath)) throw new Error(`Core API log does not exist yet: ${coreApiLogPath}`);
    const tail = readLastLines(coreApiLogPath);
    if (tail) console.log(tail);
    if (follow) await followFile(coreApiLogPath);
    return;
  }
  if (!existsSync(localEnvironmentPath)) throw new Error('Missing .env.local; there is no local infrastructure log context.');
  const { environment } = environmentAndConfig({ create: false });
  const args = composeArgs('logs', '--tail', '200');
  if (follow) args.push('--follow');
  args.push(service);
  run('docker', args, { env: environment, stdio: 'inherit' });
}


export function isolatedSmokeEnvironment(environment, coreApiPort) {
  const coreApiUrl = `http://127.0.0.1:${coreApiPort}`;
  return {
    ...environment,
    TASKPILOT_GITHUB_CLIENT_ID: '',
    TASKPILOT_GITHUB_CLIENT_SECRET: '',
    TASKPILOT_GITHUB_CALLBACK_URI: '',
    TASKPILOT_FEDERATED_HMAC_KEY_BASE64: '',
    TASKPILOT_FEDERATED_AEAD_KEY_BASE64: '',
    TASKPILOT_CORE_API_PORT: String(coreApiPort),
    TASKPILOT_CORE_API_URL: coreApiUrl,
    SERVER_PORT: String(coreApiPort),
  };
}

export function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve an isolated Core API smoke port.'));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startIsolatedSmokeCoreApi(environment, coreApiUrl) {
  ensureStateDirectory();
  const logPath = path.join(path.dirname(coreApiLogPath), 'core-api-smoke.log');
  const logFd = openSync(logPath, 'w', 0o600);
  const command = childCommands().gradle;
  let child;
  try {
    child = spawn(command.command, command.args, {
      cwd: repositoryRoot,
      env: environment,
      detached: process.platform !== 'win32',
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
  } finally {
    closeSync(logFd);
  }
  await waitForSpawn(child, 'Isolated smoke Core API');
  try {
    await waitForHealth(() => coreApiHealth(coreApiUrl), {
      isAlive: () => isProcessAlive(child.pid),
    });
    return { child, logPath };
  } catch (error) {
    await stopProcessAndWait(child.pid);
    const detail = readLogSince(logPath).trim();
    throw new Error(`Isolated smoke Core API failed to start. See ${logPath}${detail ? `\n${detail}` : ''}`, { cause: error });
  }
}

export async function stopIsolatedSmokeCoreApi(core, stopProcess = stopProcessAndWait) {
  const stopped = await stopProcess(core.child.pid);
  if (!stopped) {
    throw new Error(`Failed to stop isolated fail-closed Core API PID ${core.child.pid}. See ${core.logPath}`);
  }
  console.log(`Stopped isolated fail-closed Core API; existing dev processes and .env.local were unchanged. Log: ${core.logPath}`);
}

async function commandSmoke() {
  assertPrerequisites();
  const { config, environment } = environmentAndConfig();
  await startInfrastructure(config, environment);
  const port = await reserveLoopbackPort();
  const smokeEnvironment = isolatedSmokeEnvironment(environment, port);
  const coreApiUrl = smokeEnvironment.TASKPILOT_CORE_API_URL;
  const core = await startIsolatedSmokeCoreApi(smokeEnvironment, coreApiUrl);
  let smokeError;
  try {
    const result = run(process.execPath, [path.join(repositoryRoot, 'tools/dev/local-federated-smoke.mjs')], {
      env: smokeEnvironment,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('Local federated capability smoke failed.');
  } catch (error) {
    smokeError = error;
  }
  try {
    await stopIsolatedSmokeCoreApi(core);
  } catch (cleanupError) {
    if (!smokeError) throw cleanupError;
    console.error(`Smoke cleanup also failed: ${cleanupError.message}`);
  }
  if (smokeError) throw smokeError;
}

function printHelp() {
  console.log(`TaskPilot local development\n\nCommands:\n  pnpm bootstrap        Install locked dependencies, compile Core API, and pull missing images\n  pnpm dev              Start infrastructure and Core API, then open Desktop\n  pnpm dev:api          Start infrastructure and Core API only\n  pnpm dev:desktop      Open Desktop against this checkout's running Core API\n  pnpm dev:stop         Stop this checkout's Desktop/Core API and Compose services\n  pnpm dev:restart      Stop and start the complete local stack\n  pnpm dev:status       Show state, ownership, health, and local URLs\n  pnpm dev:logs         Show Core API logs (add --follow)\n  pnpm dev:doctor       Diagnose tools, dependencies, ports, and stale state\n  pnpm dev:smoke        Verify PostgreSQL/Redis/Core API health and fail-closed GitHub capability without contacting GitHub\n  pnpm check            Run complete launcher, Desktop, and Core API quality gates\n\nLog options:\n  --service core-api|postgres|redis\n  --follow, -f`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.command === 'help') printHelp();
  else if (options.command === 'start') await commandStart();
  else if (options.command === 'api') await commandApi();
  else if (options.command === 'desktop') await commandDesktop();
  else if (options.command === 'stop') await commandStop();
  else if (options.command === 'restart') {
    await commandStop();
    await commandStart();
  } else if (options.command === 'status') await commandStatus();
  else if (options.command === 'doctor') await commandDoctor();
  else if (options.command === 'logs') await commandLogs(options.service, options.follow);
  else if (options.command === 'smoke') await commandSmoke();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    await runCli();
  } catch (error) {
    console.error(`TaskPilot local development failed: ${error.message}`);
    process.exitCode = 1;
  }
}
