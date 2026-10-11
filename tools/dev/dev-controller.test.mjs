import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyComposeProject, parseComposePs } from './compose-manager.mjs';
import { childCommands, defaultLocalSettings, localConfiguration } from './dev-config.mjs';
import { assertDesktopCoreApi, assertDesktopPortReplaceable, childExitedUnexpectedly, doctorHasBlockingProblems, isolatedSmokeEnvironment, parseCli, replaceRecordedHostServices, reserveLoopbackPort, stopHostServices, stopIsolatedSmokeCoreApi, waitForChild, waitForSpawn } from './dev.mjs';
import { parseMajorVersion, parsePnpmVersion, portConflictMessage, supportsNodeVersion } from './preflight.mjs';
import {
  emptyState,
  forgetServiceIfPid,
  inspectRecordedService,
  isOwnedProcess,
  recordService,
  stopProcessAndWait,
  stopRecordedService,
  writeState,
} from './process-manager.mjs';

const root = path.resolve('/tmp/taskpilot-checkout');

test('CLI parses supported lifecycle commands and log options', () => {
  assert.deepEqual(parseCli([]), { command: 'start', service: 'core-api', follow: false });
  assert.deepEqual(parseCli(['logs', '--service', 'postgres', '--follow']), { command: 'logs', service: 'postgres', follow: true });
  assert.throws(() => parseCli(['logs', '--service', 'mailpit']), /service must be/i);
  assert.throws(() => parseCli(['logs', '--service', 'unknown']), /service must be/);
  assert.throws(() => parseCli(['explode']), /Unknown command/);
});

test('smoke isolates disabled GitHub configuration without mutating the source environment', async () => {
  const source = {
    TASKPILOT_POSTGRES_PASSWORD: 'database-secret',
    TASKPILOT_REDIS_PASSWORD: 'redis-secret',
    TASKPILOT_GITHUB_CLIENT_ID: 'real-client-id',
    TASKPILOT_GITHUB_CLIENT_SECRET: 'real-client-secret',
    TASKPILOT_GITHUB_CALLBACK_URI: 'http://127.0.0.1:8080/desktop/v1/auth/federated/github/callback',
    TASKPILOT_FEDERATED_HMAC_KEY_BASE64: 'hmac',
    TASKPILOT_FEDERATED_AEAD_KEY_BASE64: 'aead',
    TASKPILOT_CORE_API_PORT: '8080',
    TASKPILOT_CORE_API_URL: 'http://127.0.0.1:8080',
    SERVER_PORT: '8080',
  };

  const port = await reserveLoopbackPort();
  const isolated = isolatedSmokeEnvironment(source, port);

  assert.equal(source.TASKPILOT_GITHUB_CLIENT_ID, 'real-client-id');
  assert.equal(isolated.TASKPILOT_GITHUB_CLIENT_ID, '');
  assert.equal(isolated.TASKPILOT_GITHUB_CLIENT_SECRET, '');
  assert.equal(isolated.TASKPILOT_GITHUB_CALLBACK_URI, '');
  assert.equal(isolated.TASKPILOT_FEDERATED_HMAC_KEY_BASE64, '');
  assert.equal(isolated.TASKPILOT_FEDERATED_AEAD_KEY_BASE64, '');
  assert.equal(isolated.TASKPILOT_POSTGRES_PASSWORD, 'database-secret');
  assert.equal(isolated.TASKPILOT_REDIS_PASSWORD, 'redis-secret');
  assert.equal(isolated.TASKPILOT_CORE_API_PORT, String(port));
  assert.equal(isolated.TASKPILOT_CORE_API_URL, `http://127.0.0.1:${port}`);
  assert.equal(isolated.SERVER_PORT, String(port));
});

test('smoke reports a temporary Core API that cannot be stopped', async () => {
  await assert.rejects(
    stopIsolatedSmokeCoreApi(
      { child: { pid: 4242 }, logPath: '/tmp/taskpilot-core-api-smoke.log' },
      async () => false,
    ),
    /Failed to stop isolated fail-closed Core API PID 4242/,
  );
});

test('doctor fails when prerequisites, environment, or project dependencies are invalid', () => {
  const passing = [{ ok: true }];
  assert.equal(doctorHasBlockingProblems(passing, 'valid, mode 600', passing), false);
  assert.equal(doctorHasBlockingProblems([{ ok: false }], 'valid, mode 600', passing), true);
  assert.equal(doctorHasBlockingProblems(passing, 'invalid: missing secret', passing), true);
  assert.equal(doctorHasBlockingProblems(passing, 'valid, mode 644 (must not be readable by group/others)', passing), true);
  assert.equal(doctorHasBlockingProblems(passing, 'valid, mode 600', [{ ok: false }]), true);
});

test('Desktop accepts only a healthy Core API owned by this checkout', () => {
  assert.doesNotThrow(() => assertDesktopCoreApi({ status: 'owned', pid: 42 }, true, 'http://127.0.0.1:48080'));
  assert.throws(
    () => assertDesktopCoreApi({ status: 'not-recorded' }, true, 'http://127.0.0.1:48080'),
    /ownership is not recorded/,
  );
  assert.throws(
    () => assertDesktopCoreApi({ status: 'owned', pid: 42 }, false, 'http://127.0.0.1:48080'),
    /not healthy/,
  );
});

test('an occupied Desktop port is replaceable only when its recorded process is owned', () => {
  assert.doesNotThrow(() => assertDesktopPortReplaceable(true, { status: 'owned', pid: 42 }, 5173));
  assert.doesNotThrow(() => assertDesktopPortReplaceable(false, { status: 'not-recorded' }, 5173));
  assert.throws(
    () => assertDesktopPortReplaceable(true, { status: 'not-recorded' }, 5173),
    /will not stop or reuse it/i,
  );
  assert.throws(
    () => assertDesktopPortReplaceable(true, { status: 'unowned', pid: 42 }, 5173),
    /will not stop or reuse it/i,
  );
});

test('child startup and exit helpers preserve spawn failures and signal exits', async () => {
  const started = new EventEmitter();
  started.pid = 42;
  const startedPromise = waitForSpawn(started, 'Desktop');
  started.emit('spawn');
  assert.equal(await startedPromise, started);

  const failed = new EventEmitter();
  failed.pid = undefined;
  const failedPromise = waitForSpawn(failed, 'Core API');
  failed.emit('error', new Error('ENOENT'));
  await assert.rejects(failedPromise, /Core API failed to start: ENOENT/);

  const exited = new EventEmitter();
  exited.exitCode = null;
  exited.signalCode = null;
  const exitPromise = waitForChild(exited);
  exited.emit('exit', null, 'SIGKILL');
  const exit = await exitPromise;
  assert.deepEqual(exit, { code: null, signal: 'SIGKILL' });
  assert.equal(childExitedUnexpectedly(exit), true);
  assert.equal(childExitedUnexpectedly(exit, true), false);
  assert.equal(childExitedUnexpectedly({ code: 0, signal: null }), false);
});

test('local settings are stable per checkout and validate distinct overrides', () => {
  const settings = defaultLocalSettings(root);
  assert.deepEqual(defaultLocalSettings(root), settings);
  assert.notDeepEqual(defaultLocalSettings('/tmp/another-checkout'), settings);
  const config = localConfiguration(settings, root);
  assert.equal(config.composeProject, settings.TASKPILOT_COMPOSE_PROJECT);
  assert.equal(config.coreApiUrl, `http://127.0.0.1:${settings.TASKPILOT_CORE_API_PORT}`);
  assert.equal(config.desktopDevServerUrl, `http://127.0.0.1:${settings.TASKPILOT_DESKTOP_DEV_SERVER_PORT}`);
  assert.equal(new Set([
    config.postgresPort,
    config.redisPort,
    config.coreApiPort,
    config.desktopDevServerPort,
  ]).size, 4);
  assert.equal('smtpPort' in config, false);
  assert.equal('mailpitHttpPort' in config, false);
  assert.throws(() => localConfiguration({ ...settings, TASKPILOT_CORE_API_PORT: '0' }, root), /between 1 and 65535/);
  assert.throws(() => localConfiguration({ ...settings, TASKPILOT_CORE_API_PORT: settings.TASKPILOT_POSTGRES_PORT }, root), /distinct ports/);
  assert.throws(() => localConfiguration({ ...settings, TASKPILOT_COMPOSE_PROJECT: 'INVALID NAME' }, root), /Compose project name/);
});

test('child commands carry checkout identity on macOS and Windows', () => {
  const unix = childCommands('darwin', root);
  const windows = childCommands('win32', root);
  assert.equal(unix.gradle.command, path.join(root, 'gradlew'));
  assert.deepEqual(unix.gradle.args.slice(0, 2), ['--project-dir', root]);
  assert.equal(windows.gradle.command, path.join(root, 'gradlew.bat'));
  assert.equal(windows.desktopDev.command, 'pnpm.cmd');
  assert.ok(windows.desktopDev.args.includes(root));
});

test('Compose project ownership is bound to this checkout', () => {
  const output = JSON.stringify({
    Service: 'postgres',
    State: 'running',
    Labels: `com.docker.compose.project=taskpilot-local,com.docker.compose.project.working_dir=${root}`,
  });
  const records = parseComposePs(`${output}
`);
  assert.deepEqual(parseComposePs(`[${output}]`), records);
  assert.deepEqual(parseComposePs(''), []);
  assert.equal(classifyComposeProject(records, root).status, 'owned');
  assert.equal(classifyComposeProject(records, '/tmp/another-checkout').status, 'unowned');
  assert.equal(classifyComposeProject([], root).status, 'absent');
});

test('state is checkout scoped and persists no environment or secret values', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-dev-state-'));
  const file = path.join(directory, 'state.json');
  try {
    const state = emptyState(root);
    state.services.coreApi = {
      pid: 123,
      startedAt: '2026-09-30T00:00:00.000Z',
      logPath: path.join(directory, 'core.log'),
      env: { TASKPILOT_POSTGRES_PASSWORD: 'must-not-leak' },
      command: 'contains-a-secret',
    };
    writeState(state, file);
    const serialized = readFileSync(file, 'utf8');
    assert.doesNotMatch(serialized, /must-not-leak|contains-a-secret|TASKPILOT_POSTGRES_PASSWORD/);
    assert.match(serialized, /taskpilot-checkout/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('ownership requires both the checkout and the expected service marker', () => {
  assert.equal(isOwnedProcess('coreApi', `java ${root}/gradlew --project-dir ${root} :services:core-api:bootRun`, root), true);
  assert.equal(isOwnedProcess('coreApi', 'java /another/checkout/gradlew :services:core-api:bootRun', root), false);
  assert.equal(isOwnedProcess('desktop', `pnpm --dir ${root} --filter @taskpilot/desktop dev`, root), true);
  assert.equal(isOwnedProcess('desktop', `pnpm --dir ${root} --filter @taskpilot/desktop build`, root), false);
});

test('stale state is classified and removed without killing anything', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-dev-stale-'));
  const file = path.join(directory, 'state.json');
  try {
    recordService('coreApi', { pid: 98765, startedAt: new Date().toISOString() }, file, root);
    assert.equal(inspectRecordedService('coreApi', { stateFile: file, repositoryRoot: root, isAlive: () => false }).status, 'stale');
    const result = await stopRecordedService('coreApi', {
      stateFile: file,
      repositoryRoot: root,
      isAlive: () => false,
      stopTree: () => assert.fail('stale processes must not be killed'),
    });
    assert.equal(result.status, 'stale');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('stop refuses to kill a live process when ownership cannot be proven', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-dev-unowned-'));
  const file = path.join(directory, 'state.json');
  try {
    recordService('coreApi', { pid: 321, startedAt: new Date().toISOString() }, file, root);
    const result = await stopRecordedService('coreApi', {
      stateFile: file,
      repositoryRoot: root,
      isAlive: () => true,
      commandLine: () => 'java /another/project application.jar',
      stopTree: () => assert.fail('unowned processes must not be killed'),
    });
    assert.equal(result.status, 'unowned');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('start replacement signals a proven previous launcher before cleaning residual service state', async () => {
  const events = [];
  let waitCount = 0;
  await replaceRecordedHostServices(['desktop', 'coreApi'], {
    inspectService: name => name === 'desktop'
      ? { status: 'owned', pid: 101 }
      : { status: 'stale', pid: 102 },
    stopService: async name => {
      events.push(`service:${name}`);
      return name === 'desktop'
        ? { status: 'not-recorded' }
        : { status: 'stale', pid: 102 };
    },
    parentProcessId: () => 99,
    processCommandLine: () => 'node tools/dev/dev.mjs start',
    signalController: pid => events.push(`signal:${pid}`),
    waitForController: async () => ++waitCount > 1,
    forceController: () => assert.fail('launcher exits after residual cleanup'),
  });
  assert.deepEqual(events, ['signal:99', 'service:desktop', 'service:coreApi']);
});

test('start replacement force-stops a proven launcher only after service cleanup', async () => {
  const events = [];
  let forced = false;
  await replaceRecordedHostServices(['desktop'], {
    inspectService: () => ({ status: 'owned', pid: 101 }),
    stopService: async () => {
      events.push('service');
      return { status: 'stopped', pid: 101 };
    },
    parentProcessId: () => 99,
    processCommandLine: () => 'node tools/dev/dev.mjs start',
    signalController: pid => events.push(`signal:${pid}`),
    waitForController: async () => forced,
    forceController: pid => {
      forced = true;
      events.push(`force:${pid}`);
    },
  });
  assert.deepEqual(events, ['signal:99', 'service', 'force:99']);
});

test('start replacement directly stops owned services when their launcher no longer exists', async () => {
  const stopped = [];
  await replaceRecordedHostServices(['desktop'], {
    inspectService: () => ({ status: 'owned', pid: 101 }),
    stopService: async name => {
      stopped.push(name);
      return { status: 'stopped', pid: 101 };
    },
    parentProcessId: () => null,
    signalController: () => assert.fail('there is no launcher to stop'),
  });
  assert.deepEqual(stopped, ['desktop']);
});

test('start replacement refuses to signal a launcher PID whose identity changed', async () => {
  let commandChecks = 0;
  await assert.rejects(
    replaceRecordedHostServices(['desktop'], {
      inspectService: () => ({ status: 'owned', pid: 101 }),
      stopService: async () => assert.fail('service cleanup must wait for launcher validation'),
      parentProcessId: () => 99,
      processCommandLine: () => ++commandChecks === 1
        ? 'node tools/dev/dev.mjs start'
        : 'node /another/project/server.mjs',
      signalController: () => assert.fail('a reused launcher PID must not be signalled'),
    }),
    /changed identity.*before it could be stopped/i,
  );
});

test('start replacement refuses all stops when any recorded host process is unowned', async () => {
  const stopped = [];
  await assert.rejects(
    replaceRecordedHostServices(['desktop', 'coreApi'], {
      inspectService: name => name === 'desktop'
        ? { status: 'owned', pid: 101 }
        : { status: 'unowned', pid: 102 },
      stopService: async name => {
        stopped.push(name);
        return { status: 'stopped', pid: 101 };
      },
    }),
    /ownership could not be proven.*coreApi PID 102/i,
  );
  assert.deepEqual(stopped, []);
});

test('PID-conditional cleanup cannot remove a replacement service record', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-dev-replacement-'));
  const file = path.join(directory, 'state.json');
  try {
    recordService('desktop', { pid: 202, startedAt: new Date().toISOString() }, file, root);
    assert.equal(forgetServiceIfPid('desktop', 101, file, root), false);
    const state = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(state.services.desktop.pid, 202);
    assert.equal(forgetServiceIfPid('desktop', 202, file, root), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('host shutdown attempts both services even when one stop throws', async () => {
  const attempts = [];
  const stops = await stopHostServices(async name => {
    attempts.push(name);
    if (name === 'desktop') throw new Error('desktop stop failed');
    return { status: 'stopped', pid: 42 };
  });
  assert.deepEqual(attempts.sort(), ['coreApi', 'desktop']);
  assert.equal(stops[0].status, 'rejected');
  assert.equal(stops[1].status, 'fulfilled');
  assert.equal(stops[1].value.result.status, 'stopped');
});

test('stop waits for graceful exit and escalates only after timeout', async () => {
  let alive = true;
  const signals = [];
  const graceful = await stopProcessAndWait(123, {
    isAlive: () => alive,
    stopTree: (_pid, options) => {
      signals.push(options.signal);
      alive = false;
    },
    sleep: async () => {},
  });
  assert.equal(graceful, true);
  assert.deepEqual(signals, ['SIGTERM']);

  alive = true;
  signals.length = 0;
  const forced = await stopProcessAndWait(123, {
    isAlive: () => alive,
    stopTree: (_pid, options) => {
      signals.push(options.signal);
      if (options.signal === 'SIGKILL') alive = false;
    },
    gracefulTimeoutMs: 0,
    forceTimeoutMs: 0,
    sleep: async () => {},
  });
  assert.equal(forced, true);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('failed stop preserves recorded ownership state', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-dev-stop-failed-'));
  const file = path.join(directory, 'state.json');
  try {
    recordService('coreApi', { pid: 321, startedAt: new Date().toISOString() }, file, root);
    const result = await stopRecordedService('coreApi', {
      stateFile: file,
      repositoryRoot: root,
      isAlive: () => true,
      commandLine: () => `java ${root}/gradlew --project-dir ${root} :services:core-api:bootRun`,
      stopTree: () => {},
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      sleep: async () => {},
    });
    assert.equal(result.status, 'stop-failed');
    assert.equal(inspectRecordedService('coreApi', {
      stateFile: file,
      repositoryRoot: root,
      isAlive: () => true,
      commandLine: () => `java ${root}/gradlew --project-dir ${root} :services:core-api:bootRun`,
    }).status, 'owned');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('version and port diagnostics are deterministic', () => {
  assert.equal(parseMajorVersion('v22.14.0'), 22);
  assert.equal(parseMajorVersion('openjdk version "21.0.8" 2025-07-15'), 21);
  assert.equal(parsePnpmVersion('11.9.0\n'), '11.9.0');
  assert.equal(supportsNodeVersion('v22.12.0'), true);
  assert.equal(supportsNodeVersion('v22.11.0'), false);
  assert.equal(supportsNodeVersion('v24.10.0'), true);
  assert.match(portConflictMessage(8080, 'Core API'), /will not stop or reuse it/);
});
