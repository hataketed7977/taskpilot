import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrap } from './bootstrap.mjs';

function fakeCommands() {
  return {
    gradleCompile: { command: './gradlew', args: [':services:core-api:classes'] },
    desktopBuild: { command: 'pnpm', args: ['--filter', '@taskpilot/desktop', 'build'] },
  };
}

test('bootstrap installs checkout hooks before dependency and build commands', () => {
  const events = [];
  bootstrap({
    assertReady: () => events.push('preflight'),
    ensureEnvironment: () => ({ TASKPILOT_POSTGRES_PORT: '5432' }),
    commands: fakeCommands,
    hookInstaller: () => { events.push('hooks'); return 0; },
    spawn: (command, args) => { events.push([command, ...args].join(' ')); return { status: 0 }; },
    platform: 'darwin',
    environment: {},
  });
  assert.deepEqual(events, [
    'preflight',
    'hooks',
    'pnpm install --frozen-lockfile --prefer-offline',
    './gradlew :services:core-api:classes',
    'pnpm --filter @taskpilot/desktop build',
    'docker compose --env-file .env.local pull --policy missing',
  ]);
});

test('bootstrap propagates hook conflicts and runs no dependency or build commands', () => {
  const spawned = [];
  assert.throws(() => bootstrap({
    assertReady: () => {},
    ensureEnvironment: () => ({}),
    commands: fakeCommands,
    hookInstaller: () => 1,
    spawn: (...args) => { spawned.push(args); return { status: 0 }; },
  }), /Install repository Git hooks failed/);
  assert.deepEqual(spawned, []);
});
