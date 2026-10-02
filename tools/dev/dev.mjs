import { spawn, spawnSync } from 'node:child_process';
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
  readLocalEnvironment,
} from './local-environment.mjs';
import { classifyComposeProject, parseComposePs } from './compose-manager.mjs';
import { coreApiHealth, mailpitHealth, waitForHealth } from './health-checks.mjs';
import {
  ensureStateDirectory,
  forgetService,
  inspectRecordedService,
  isProcessAlive,
  recordService,
  stopProcessTree,
  stopRecordedService,
} from './process-manager.mjs';
import {
  assertPrerequisites,
  isPortOpen,
  portConflictMessage,
  prerequisiteChecks,
} from './preflight.mjs';

const supportedCommands = new Set(['start', 'stop', 'restart', 'status', 'logs', 'doctor', 'smoke', 'infra-up', 'infra-down', 'help']);
const logServices = new Set(['core-api', 'postgres', 'mailpit']);

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
  if (!logServices.has(service)) throw new Error('Log service must be core-api, postgres, or mailpit.');
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

function environmentAndConfig({ create = true } = {}) {
  const values = create ? ensureLocalEnvironment() : readLocalEnvironment(localEnvironmentPath);
  const config = localConfiguration(values);
  return {
    values,
    config,
    environment: {
      ...process.env,
      ...values,
      SPRING_PROFILES_ACTIVE: 'local',
      SERVER_PORT: String(config.coreApiPort),
      TASKPILOT_CORE_API_URL: config.coreApiUrl,
      TASKPILOT_MAILPIT_URL: config.mailpitUrl,
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
    throw new Error('Docker Compose project taskpilot-local belongs to another checkout. TaskPilot will not reuse or stop it; stop that checkout first.');
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
    { service: 'mailpit', port: config.smtpPort, purpose: 'Mailpit SMTP' },
    { service: 'mailpit', port: config.mailpitHttpPort, purpose: 'Mailpit HTTP' },
  ];
  for (const check of checks) {
    if (!running.has(check.service) && await isPortOpen(check.port)) {
      throw new Error(portConflictMessage(check.port, check.purpose));
    }
  }
}

async function startInfrastructure(config, environment) {
  await assertInfrastructurePortsAvailable(config, environment);
  run('docker', composeArgs('up', '-d', '--wait'), { env: environment, stdio: 'inherit' });
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

function startCoreApi(environment, config) {
  const existing = inspectCoreApi();
  if (existing.status === 'owned') return { process: null, started: false, pid: existing.pid };
  if (existing.status === 'stale') forgetService('coreApi');
  if (existing.status === 'unowned') {
    throw new Error(`Recorded Core API PID ${existing.pid} is alive but does not belong to this checkout. Refusing to replace or stop it.`);
  }
  ensureStateDirectory();
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
  child.once('error', error => console.error(`Core API process error: ${error.message}`));
  recordService('coreApi', {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    logPath: coreApiLogPath,
  });
  return { process: child, started: true, pid: child.pid, config };
}

async function ensureCoreApi(environment, config) {
  await assertCoreApiPortAvailable(config);
  const started = startCoreApi(environment, config);
  try {
    if (!await coreApiHealth(config.coreApiUrl)) {
      await waitForHealth(() => coreApiHealth(config.coreApiUrl), {
        isAlive: () => !started.process || isProcessAlive(started.pid),
      });
    }
    return started;
  } catch (error) {
    if (started.started) {
      stopOwnedChild('coreApi', started.process);
      error.message = `${error.message}. See ${coreApiLogPath}`;
    }
    throw error;
  }
}

function startDesktop(environment) {
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
  recordService('desktop', { pid: desktop.pid, startedAt: new Date().toISOString() });
  return desktop;
}

function stopOwnedChild(name, child) {
  if (!child) return;
  if (isProcessAlive(child.pid)) stopProcessTree(child.pid, { signal: 'SIGTERM' });
  forgetService(name);
}

async function commandStart() {
  assertPrerequisites();
  const { config, environment } = environmentAndConfig();
  await startInfrastructure(config, environment);
  let core;
  let desktop;
  let stopping = false;
  const cleanup = () => {
    if (stopping) return;
    stopping = true;
    stopOwnedChild('desktop', desktop);
    if (core?.started) stopOwnedChild('coreApi', core.process);
  };
  const onSignal = signal => {
    console.log(`\nReceived ${signal}; stopping TaskPilot host processes. PostgreSQL and Mailpit remain running.`);
    cleanup();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    core = await ensureCoreApi(environment, config);
    console.log(`Core API is healthy: ${config.coreApiUrl}`);
    console.log(`Mailpit inbox: ${config.mailpitUrl}`);
    console.log(`Core API log: ${coreApiLogPath}`);
    desktop = startDesktop(environment);
    const exit = await new Promise((resolve, reject) => {
      desktop.once('exit', (code, signal) => resolve({ code: code ?? 0, signal }));
      desktop.once('error', reject);
    });
    if (!stopping && exit.code !== 0) throw new Error(`Desktop exited with code ${exit.code}${exit.signal ? ` (${exit.signal})` : ''}`);
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
  }
}

function stopResult(name, result) {
  if (result.status === 'stopped') console.log(`Stopped ${name} (PID ${result.pid}).`);
  else if (result.status === 'stale') console.log(`Removed stale ${name} state (PID ${result.pid}).`);
  else if (result.status === 'unowned') console.warn(`Refused to stop ${name} PID ${result.pid}: ownership could not be proven.`);
  else console.log(`${name} was not recorded as running.`);
}

function commandStop({ stopInfrastructure = true } = {}) {
  let local = null;
  if (stopInfrastructure && existsSync(localEnvironmentPath)) {
    local = environmentAndConfig({ create: false });
    assertComposeOwnership(local.environment);
  }
  const inspections = {
    desktop: inspectRecordedService('desktop'),
    coreApi: inspectRecordedService('coreApi'),
  };
  const unsafe = Object.entries(inspections).filter(([, result]) => result.status === 'unowned');
  if (unsafe.length) {
    throw new Error(`Refusing a partial stop because ownership could not be proven for ${unsafe.map(([name, result]) => `${name} PID ${result.pid}`).join(', ')}. No process or container was stopped.`);
  }
  const desktop = stopRecordedService('desktop');
  const core = stopRecordedService('coreApi');
  stopResult('Desktop', desktop);
  stopResult('Core API', core);
  if (stopInfrastructure) {
    if (local) {
      run('docker', composeArgs('down'), { env: local.environment, stdio: 'inherit' });
      console.log('Stopped PostgreSQL and Mailpit containers; the PostgreSQL volume was kept.');
    } else {
      console.log('No .env.local exists; infrastructure stop was skipped.');
    }
  }
}

async function composeStatus(environment) {
  const project = inspectComposeProject(environment);
  return {
    ownership: project.status,
    postgres: project.status === 'owned' && project.services.has('postgres'),
    mailpit: project.status === 'owned' && project.services.has('mailpit'),
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
    console.log('Local environment: missing (.env.local); run pnpm dev or pnpm dev:setup.');
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
  const [infrastructure, coreHealthy, mailpitHealthy] = await Promise.all([
    compose,
    coreApiHealth(local.config.coreApiUrl),
    mailpitHealth(local.config.mailpitUrl),
  ]);
  console.log('TaskPilot local status');
  if (infrastructure.ownership === 'unowned') {
    console.log('- Compose ownership: CONFLICT (project belongs to another checkout)');
  } else if (infrastructure.ownership === 'unavailable') {
    console.log('- Compose ownership: unavailable (Docker daemon could not be queried)');
  }
  console.log(`- PostgreSQL: ${infrastructure.postgres ? 'container running' : 'not running'} (127.0.0.1:${local.config.postgresPort})`);
  console.log(`- Mailpit: ${infrastructure.mailpit ? 'container running' : 'not running'}; HTTP ${mailpitHealthy ? 'ready' : 'not ready'} (${local.config.mailpitUrl})`);
  console.log(`- Core API: ${serviceLabel(core)}; HTTP ${coreHealthy ? 'UP' : 'not ready'} (${local.config.coreApiUrl})`);
  console.log(`- Desktop: ${serviceLabel(desktop)}`);
}

function environmentPermission() {
  if (process.platform === 'win32') return { ok: true, detail: 'Windows ACLs apply' };
  const mode = statSync(localEnvironmentPath).mode & 0o777;
  return { ok: (mode & 0o077) === 0, detail: `mode ${mode.toString(8).padStart(3, '0')}` };
}

function describePortOwner(port) {
  if (process.platform === 'win32') {
    const result = run('netstat.exe', ['-ano', '-p', 'tcp'], { allowFailure: true });
    const line = String(result.stdout).split(/\r?\n/).find(item => item.includes(`:${port} `) && /LISTENING/i.test(item));
    return line?.trim() ?? 'unknown process';
  }
  const result = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { allowFailure: true });
  return String(result.stdout).split(/\r?\n/).filter(Boolean).slice(1, 3).join(' | ') || 'unknown process';
}

async function commandDoctor() {
  console.log('TaskPilot local doctor');
  const checks = prerequisiteChecks();
  for (const check of checks) console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
  let config = localConfiguration({});
  let envState = 'missing; pnpm dev will create it';
  if (existsSync(localEnvironmentPath)) {
    try {
      const values = readLocalEnvironment();
      config = localConfiguration(values);
      const permission = environmentPermission();
      envState = `valid, ${permission.detail}${permission.ok ? '' : ' (must not be readable by group/others)'}`;
    } catch (error) {
      envState = `invalid: ${error.message}`;
    }
  }
  console.log(`- ${envState.startsWith('valid') || envState.startsWith('missing') ? 'PASS' : 'FAIL'} .env.local: ${envState}`);
  const ports = [
    [config.postgresPort, 'PostgreSQL'],
    [config.smtpPort, 'Mailpit SMTP'],
    [config.mailpitHttpPort, 'Mailpit HTTP'],
    [config.coreApiPort, 'Core API'],
  ];
  for (const [port, purpose] of ports) {
    const open = await isPortOpen(port);
    console.log(`- INFO port ${port} (${purpose}): ${open ? `in use — ${describePortOwner(port)}` : 'available'}`);
  }
  const compose = inspectComposeProject({ ...process.env });
  const composeDetail = compose.status === 'owned'
    ? `owned by this checkout; running: ${[...compose.services].join(', ') || 'none'}`
    : compose.status;
  console.log(`- INFO Compose project: ${composeDetail}`);
  const core = inspectCoreApi();
  const desktop = inspectRecordedService('desktop');
  console.log(`- INFO recorded Core API: ${serviceLabel(core)}`);
  console.log(`- INFO recorded Desktop: ${serviceLabel(desktop)}`);
  if (checks.some(check => !check.ok) || envState.startsWith('invalid') || envState.includes('must not')) {
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

async function commandInfrastructureUp() {
  const { config, environment } = environmentAndConfig();
  await startInfrastructure(config, environment);
  console.log(`PostgreSQL is ready on 127.0.0.1:${config.postgresPort}.`);
  console.log(`Mailpit inbox: ${config.mailpitUrl}`);
}

function commandInfrastructureDown() {
  if (!existsSync(localEnvironmentPath)) {
    console.log('No .env.local exists; infrastructure stop was skipped.');
    return;
  }
  const { environment } = environmentAndConfig({ create: false });
  assertComposeOwnership(environment);
  run('docker', composeArgs('down'), { env: environment, stdio: 'inherit' });
  console.log('Stopped PostgreSQL and Mailpit containers; the PostgreSQL volume was kept.');
}

async function commandSmoke() {
  assertPrerequisites();
  const { config, environment } = environmentAndConfig();
  await startInfrastructure(config, environment);
  const core = await ensureCoreApi(environment, config);
  try {
    const result = run(process.execPath, [path.join(repositoryRoot, 'tools/dev/local-mail-smoke.mjs')], {
      env: environment,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('Local mail smoke failed.');
  } finally {
    if (core.started) {
      stopOwnedChild('coreApi', core.process);
      console.log('Stopped the Core API started only for this smoke run.');
    } else {
      console.log('Kept the pre-existing Core API running.');
    }
  }
}

function printHelp() {
  console.log(`TaskPilot local development\n\nCommands:\n  pnpm dev              Start infrastructure and Core API, then open Desktop\n  pnpm dev:stop         Stop this checkout's Desktop/Core API and Compose services\n  pnpm dev:restart      Stop and start the complete local stack\n  pnpm dev:status       Show state, ownership, health, and local URLs\n  pnpm dev:logs         Show Core API logs (add --follow)\n  pnpm dev:doctor       Diagnose tools, environment, ports, and stale state\n  pnpm dev:smoke        Run headless registration/login/reset mail smoke\n\nLog options:\n  --service core-api|postgres|mailpit\n  --follow, -f`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCli(argv);
  if (options.command === 'help') printHelp();
  else if (options.command === 'start') await commandStart();
  else if (options.command === 'stop') commandStop();
  else if (options.command === 'restart') {
    commandStop();
    await commandStart();
  } else if (options.command === 'status') await commandStatus();
  else if (options.command === 'doctor') await commandDoctor();
  else if (options.command === 'logs') await commandLogs(options.service, options.follow);
  else if (options.command === 'smoke') await commandSmoke();
  else if (options.command === 'infra-up') await commandInfrastructureUp();
  else if (options.command === 'infra-down') commandInfrastructureDown();
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
