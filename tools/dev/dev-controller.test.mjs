import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyComposeProject, parseComposePs } from './compose-manager.mjs';
import { childCommands, defaultLocalSettings, localConfiguration } from './dev-config.mjs';
import { assertDesktopCoreApi, childExitedUnexpectedly, doctorHasBlockingProblems, parseCli, stopHostServices, waitForChild, waitForSpawn } from './dev.mjs';
import { parseMajorVersion, parsePnpmVersion, portConflictMessage, supportsNodeVersion } from './preflight.mjs';
import {
  emptyState,
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
  assert.deepEqual(parseCli(['logs', '--service', 'mailpit', '--follow']), { command: 'logs', service: 'mailpit', follow: true });
  assert.throws(() => parseCli(['logs', '--service', 'unknown']), /service must be/);
  assert.throws(() => parseCli(['explode']), /Unknown command/);
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
    config.smtpPort,
    config.mailpitHttpPort,
    config.coreApiPort,
    config.desktopDevServerPort,
  ]).size, 5);
  assert.throws(() => localConfiguration({ ...settings, TASKPILOT_SMTP_PORT: '0' }, root), /between 1 and 65535/);
  assert.throws(() => localConfiguration({ ...settings, TASKPILOT_SMTP_PORT: settings.TASKPILOT_POSTGRES_PORT }, root), /distinct ports/);
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
