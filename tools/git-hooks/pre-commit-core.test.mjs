import assert from 'node:assert/strict';
import test from 'node:test';
import { findPollution, runPreCommit, spawnGate } from './pre-commit-core.mjs';

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

function record(status, ...paths) {
  return { status, rawStatus: status, paths };
}


test('spawnGate uses fixed argv without a shell and inherits gate output on POSIX', () => {
  let call;
  const result = spawnGate('pnpm', ['dev:test'], {
    root: '/repo',
    platform: 'darwin',
    environment: { TEST_ENV: '1' },
    spawn(command, args, options) {
      call = { command, args, options };
      return { status: 0, signal: null };
    },
  });
  assert.equal(result.status, 0);
  assert.equal(call.command, 'pnpm');
  assert.deepEqual(call.args, ['dev:test']);
  assert.equal(call.options.cwd, '/repo');
  assert.deepEqual(call.options.env, { TEST_ENV: '1' });
  assert.equal(call.options.stdio, 'inherit');
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.windowsVerbatimArguments, undefined);
});

test('spawnGate uses an escaped cmd adapter for Windows batch commands', () => {
  let call;
  const result = spawnGate('C:\\repo & tools\\gradlew.bat', ['--no-daemon', ':services:core-api:qualityCheck'], {
    root: 'C:\\repo & tools',
    platform: 'win32',
    environment: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    spawn(command, args, options) {
      call = { command, args, options };
      return { status: 0, signal: null };
    },
  });
  assert.equal(result.status, 0);
  assert.equal(call.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(call.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(call.args[3], /gradlew\.bat/);
  assert.match(call.args[3], /\^&/);
  assert.match(call.args[3], /qualityCheck/);
  assert.equal(call.options.cwd, 'C:\\repo & tools');
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsVerbatimArguments, true);
});

test('exempt-only changes skip module gates explicitly', () => {
  const out = capture();
  const code = runPreCommit({
    root: '/repo',
    readStaged: () => [record('M', 'README.md')],
    pollutionAdapters: { readUnstagedRecords: () => [], readUntrackedPaths: () => [] },
    runner: () => assert.fail('runner must not be called'),
    stdout: out.stream,
    stderr: capture().stream,
  });
  assert.equal(code, 0);
  assert.match(out.read(), /only explicitly exempt paths/);
});

test('unknown changes fail before any command runs', () => {
  const err = capture();
  const code = runPreCommit({
    root: '/repo',
    readStaged: () => [record('A', 'apps/new-module/index.ts')],
    runner: () => assert.fail('runner must not be called'),
    stdout: capture().stream,
    stderr: err.stream,
  });
  assert.equal(code, 1);
  assert.match(err.read(), /module mapping/);
  assert.match(err.read(), /apps\/new-module\/index\.ts/);
  assert.match(err.read(), /update tools\/git-hooks\/gates\.mjs/);
});

test('affected tracked and untracked pollution fails while unrelated dirt is ignored', () => {
  const selected = ['desktop'];
  const pollution = findPollution('/repo', selected, {
    readUnstagedRecords: () => [
      record('M', 'apps/desktop/src/App.tsx'),
      record('M', 'services/core-api/src/App.kt'),
    ],
    readUntrackedPaths: () => [
      'apps/desktop/src/new.ts',
      'services/core-api/src/new.kt',
    ],
  });
  assert.deepEqual(pollution, {
    tracked: ['apps/desktop/src/App.tsx'],
    untracked: ['apps/desktop/src/new.ts'],
  });
});

test('runs selected gates once in fixed order and prints command plus trigger paths', () => {
  const calls = [];
  const out = capture();
  const code = runPreCommit({
    root: '/repo',
    readStaged: () => [
      record('M', 'services/core-api/build.gradle.kts'),
      record('M', 'package.json'),
      record('M', 'tools/dev/dev.mjs'),
    ],
    pollutionAdapters: { readUnstagedRecords: () => [], readUntrackedPaths: () => [] },
    runner: (command, args, options) => {
      calls.push({ command, args, gate: options.gate });
      return { status: 0, signal: null };
    },
    stdout: out.stream,
    stderr: capture().stream,
  });
  assert.equal(code, 0);
  assert.deepEqual(calls.map(call => call.gate), ['hook-tooling', 'dev-tooling', 'desktop', 'core-api']);
  assert.equal(calls[0].command, 'pnpm');
  assert.deepEqual(calls[2].args, ['--filter', '@taskpilot/desktop', 'qualityCheck']);
  assert.match(out.read(), /Command:/);
  assert.match(out.read(), /Triggered by:/);
  assert.match(out.read(), /Passed: hook-tooling, dev-tooling, desktop, core-api/);
});

for (const failure of [
  { name: 'spawn failure', result: { error: new Error('ENOENT'), status: null, signal: null }, expected: /unable to start command: ENOENT/ },
  { name: 'non-zero exit', result: { status: 7, signal: null }, expected: /exited with code 7/ },
  { name: 'signal', result: { status: null, signal: 'SIGTERM' }, expected: /terminated by signal SIGTERM/ },
]) {
  test(`fails fast and summarizes ${failure.name}`, () => {
    const calls = [];
    const err = capture();
    const code = runPreCommit({
      root: '/repo',
      readStaged: () => [record('M', 'package.json')],
      pollutionAdapters: { readUnstagedRecords: () => [], readUntrackedPaths: () => [] },
      runner: (_command, _args, { gate }) => {
        calls.push(gate);
        return gate === 'dev-tooling' ? failure.result : { status: 0, signal: null };
      },
      stdout: capture().stream,
      stderr: err.stream,
    });
    assert.equal(code, 1);
    assert.deepEqual(calls, ['hook-tooling', 'dev-tooling']);
    assert.match(err.read(), failure.expected);
    assert.match(err.read(), /Passed: hook-tooling/);
    assert.match(err.read(), /Failed: dev-tooling/);
    assert.match(err.read(), /Not run: desktop/);
    assert.match(err.read(), /Command:/);
    assert.match(err.read(), /Triggered by:/);
  });
}
