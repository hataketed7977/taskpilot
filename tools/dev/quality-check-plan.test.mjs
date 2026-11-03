import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { qualityCheckPlan } from './quality-check-plan.mjs';

const root = path.resolve('/tmp/taskpilot-checkout');

test('complete quality plan runs dev, hooks, Desktop, canonical contract, Core, and Gateway serially', () => {
  const plan = qualityCheckPlan(root, 'darwin');
  assert.deepEqual(plan.map(step => step.label), [
    'Launcher tests',
    'Git hook tests',
    'Desktop quality gate',
    'Canonical API contract quality gate',
    'Core API quality gate',
    'Gateway quality gate',
  ]);
  assert.deepEqual(plan[1], {
    command: 'pnpm',
    args: ['--dir', root, 'hooks:test'],
    label: 'Git hook tests',
  });
  assert.deepEqual(plan.slice(3).map(step => step.args), [
    ['--project-dir', root, '--no-daemon', ':contracts:canonical-api:qualityCheck'],
    ['--project-dir', root, '--no-daemon', ':services:core-api:qualityCheck'],
    ['--project-dir', root, '--no-daemon', ':services:gateway:qualityCheck'],
  ]);
});

test('complete quality plan uses Windows launchers without changing gate order', () => {
  const plan = qualityCheckPlan(root, 'win32');
  assert.equal(plan[1].command, 'pnpm.cmd');
  assert.equal(plan[3].command, path.join(root, 'gradlew.bat'));
  assert.equal(plan[4].command, path.join(root, 'gradlew.bat'));
  assert.equal(plan[5].command, path.join(root, 'gradlew.bat'));
});
