import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyComposeProject, parseComposePs } from './compose-manager.mjs';
import { childCommands, localConfiguration } from './dev-config.mjs';
import { parseCli } from './dev.mjs';
import { parseMajorVersion, parsePnpmVersion, portConflictMessage, supportsNodeVersion } from './preflight.mjs';
import {
  emptyState,
  inspectRecordedService,
  isOwnedProcess,
  recordService,
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

test('local ports use defaults and validate overrides', () => {
  assert.deepEqual(localConfiguration({}), {
    postgresPort: 5432,
    smtpPort: 1025,
    mailpitHttpPort: 8025,
    coreApiPort: 8080,
    coreApiUrl: 'http://127.0.0.1:8080',
    mailpitUrl: 'http://127.0.0.1:8025',
  });
  assert.throws(() => localConfiguration({ TASKPILOT_SMTP_PORT: '0' }), /between 1 and 65535/);
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

test('stale state is classified and removed without killing anything', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-dev-stale-'));
  const file = path.join(directory, 'state.json');
  try {
    recordService('coreApi', { pid: 98765, startedAt: new Date().toISOString() }, file, root);
    assert.equal(inspectRecordedService('coreApi', { stateFile: file, repositoryRoot: root, isAlive: () => false }).status, 'stale');
    const result = stopRecordedService('coreApi', {
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

test('stop refuses to kill a live process when ownership cannot be proven', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-dev-unowned-'));
  const file = path.join(directory, 'state.json');
  try {
    recordService('coreApi', { pid: 321, startedAt: new Date().toISOString() }, file, root);
    const result = stopRecordedService('coreApi', {
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

test('version and port diagnostics are deterministic', () => {
  assert.equal(parseMajorVersion('v22.14.0'), 22);
  assert.equal(parseMajorVersion('openjdk version "21.0.8" 2025-07-15'), 21);
  assert.equal(parsePnpmVersion('11.9.0\n'), '11.9.0');
  assert.equal(supportsNodeVersion('v22.12.0'), true);
  assert.equal(supportsNodeVersion('v22.11.0'), false);
  assert.equal(supportsNodeVersion('v24.10.0'), true);
  assert.match(portConflictMessage(8080, 'Core API'), /will not stop or reuse it/);
});
