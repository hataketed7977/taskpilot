import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyPath, planGates } from './gates.mjs';
import { runPreCommit } from './pre-commit-core.mjs';
import { readStagedRecords } from './staged-changes.mjs';

const currentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function command(cwd, executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: false,
  });
  if (options.expect === undefined) assert.equal(result.status, 0, result.stderr || result.stdout);
  else assert.equal(result.status, options.expect, result.stderr || result.stdout);
  return result;
}

function git(cwd, args, options) {
  return command(cwd, 'git', args, options).stdout.trim();
}

function repository(prefix = 'taskpilot-hooks-git-') {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  const globalConfig = path.join(root, 'global.gitconfig');
  writeFileSync(globalConfig, '');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  git(root, ['init', '-q'], { env });
  git(root, ['config', 'user.name', 'TaskPilot Test'], { env });
  git(root, ['config', 'user.email', 'test@example.com'], { env });
  return { root, env };
}


function capture() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

function snapshot(repo) {
  return {
    status: command(repo.root, 'git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { env: repo.env }).stdout,
    staged: command(repo.root, 'git', ['diff', '--cached', '--binary'], { env: repo.env }).stdout,
    unstaged: command(repo.root, 'git', ['diff', '--binary'], { env: repo.env }).stdout,
  };
}

function commitAll(repo, subject = 'chore: seed repository') {
  git(repo.root, ['add', '.'], { env: repo.env });
  git(repo.root, ['commit', '-qm', subject], { env: repo.env });
}

test('real index parsing preserves special paths and classifies cross-module rename', () => {
  const repo = repository();
  mkdirSync(path.join(repo.root, 'apps/desktop'), { recursive: true });
  writeFileSync(path.join(repo.root, 'apps/desktop', 'old name.ts'), 'export const value = 1;\n');
  commitAll(repo);

  mkdirSync(path.join(repo.root, 'tools/dev'), { recursive: true });
  git(repo.root, ['mv', 'apps/desktop/old name.ts', 'tools/dev/new\nname.mjs'], { env: repo.env });
  const records = readStagedRecords(repo.root);
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 'R');
  assert.deepEqual(records[0].paths, ['apps/desktop/old name.ts', 'tools/dev/new\nname.mjs']);
  assert.deepEqual(planGates(records).gates, ['dev-tooling', 'desktop']);
});

test('real copy records and ordinary target additions select the same target gate', () => {
  const repo = repository();
  mkdirSync(path.join(repo.root, 'apps/desktop'), { recursive: true });
  mkdirSync(path.join(repo.root, 'tools/dev'), { recursive: true });
  writeFileSync(path.join(repo.root, 'apps/desktop/source.ts'), 'export const value = 1;\n');
  commitAll(repo);

  cpSync(path.join(repo.root, 'apps/desktop/source.ts'), path.join(repo.root, 'tools/dev/target.mjs'));
  git(repo.root, ['add', 'tools/dev/target.mjs'], { env: repo.env });
  const added = readStagedRecords(repo.root);
  assert.deepEqual(added.map(record => record.status), ['A']);
  assert.deepEqual(planGates(added).gates, ['dev-tooling']);

  git(repo.root, ['reset', '-q'], { env: repo.env });
  writeFileSync(path.join(repo.root, 'apps/desktop/source.ts'), 'export const value = 2;\n');
  git(repo.root, ['add', 'apps/desktop/source.ts', 'tools/dev/target.mjs'], { env: repo.env });
  const records = readStagedRecords(repo.root);
  const copy = records.find(record => record.status === 'C');
  assert.ok(copy, 'Git should expose a real copy record when its source is independently modified');
  assert.deepEqual(planGates([copy]).gates, ['dev-tooling']);
  assert.deepEqual(planGates(records).gates, ['dev-tooling', 'desktop']);
});

test('real partial staging and affected untracked files fail without mutating the index or worktree', () => {
  const repo = repository();
  mkdirSync(path.join(repo.root, 'apps/desktop'), { recursive: true });
  writeFileSync(path.join(repo.root, 'apps/desktop/App.tsx'), 'export const value = 1;\n');
  commitAll(repo);

  writeFileSync(path.join(repo.root, 'apps/desktop/App.tsx'), 'export const value = 2;\n');
  git(repo.root, ['add', 'apps/desktop/App.tsx'], { env: repo.env });
  writeFileSync(path.join(repo.root, 'apps/desktop/App.tsx'), 'export const value = 3;\n');
  writeFileSync(path.join(repo.root, 'apps/desktop/new.ts'), 'export const added = true;\n');
  const before = snapshot(repo);
  const err = capture();
  const code = runPreCommit({
    root: repo.root,
    runner: () => assert.fail('quality command must not run for a polluted selected module'),
    stdout: capture().stream,
    stderr: err.stream,
  });

  assert.equal(code, 1);
  assert.match(err.read(), /Tracked unstaged paths:[\s\S]*apps\/desktop\/App\.tsx/);
  assert.match(err.read(), /Untracked paths:[\s\S]*apps\/desktop\/new\.ts/);
  assert.deepEqual(snapshot(repo), before);
});

test('real unrelated module dirt does not block or select another gate', () => {
  const repo = repository();
  mkdirSync(path.join(repo.root, 'apps/desktop'), { recursive: true });
  mkdirSync(path.join(repo.root, 'services/core-api'), { recursive: true });
  writeFileSync(path.join(repo.root, 'apps/desktop/App.tsx'), 'export const value = 1;\n');
  writeFileSync(path.join(repo.root, 'services/core-api/App.kt'), 'class App\n');
  commitAll(repo);

  writeFileSync(path.join(repo.root, 'apps/desktop/App.tsx'), 'export const value = 2;\n');
  git(repo.root, ['add', 'apps/desktop/App.tsx'], { env: repo.env });
  writeFileSync(path.join(repo.root, 'services/core-api/App.kt'), 'class ChangedApp\n');
  writeFileSync(path.join(repo.root, 'services/core-api/New.kt'), 'class New\n');
  const before = snapshot(repo);
  const gates = [];
  const code = runPreCommit({
    root: repo.root,
    runner: (_command, _args, { gate }) => {
      gates.push(gate);
      return { status: 0, signal: null };
    },
    stdout: capture().stream,
    stderr: capture().stream,
  });

  assert.equal(code, 0);
  assert.deepEqual(gates, ['desktop']);
  assert.deepEqual(snapshot(repo), before);
});

test('current tracked repository paths are explicitly mapped or exempt', () => {
  const paths = command(currentRoot, 'git', ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const unknown = paths.filter(pathname => classifyPath(pathname).kind === 'unknown');
  assert.deepEqual(unknown, []);
  assert.equal(classifyPath('apps/future-module/src/index.ts').kind, 'unknown');
});

test('real hooks accept a valid commit, reject Git default Revert, and run only the selected fake gate', () => {
  const repo = repository('taskpilot-hooks-smoke-');
  mkdirSync(path.join(repo.root, '.githooks'), { recursive: true });
  mkdirSync(path.join(repo.root, 'tools/git-hooks'), { recursive: true });

  for (const filename of ['commit-msg', 'pre-commit']) {
    cpSync(path.join(currentRoot, '.githooks', filename), path.join(repo.root, '.githooks', filename));
  }
  for (const filename of [
    'commit-msg.mjs', 'commit-message.mjs', 'pre-commit.mjs', 'pre-commit-core.mjs',
    'git.mjs', 'gates.mjs', 'staged-changes.mjs',
  ]) {
    cpSync(path.join(currentRoot, 'tools/git-hooks', filename), path.join(repo.root, 'tools/git-hooks', filename));
  }
  writeFileSync(path.join(repo.root, 'tools/git-hooks/fake-gate.mjs'), `
    import { appendFileSync } from 'node:fs';
    appendFileSync(process.env.TASKPILOT_HOOK_TEST_LOG, 'hook-tooling\\n');
    if (process.env.TASKPILOT_HOOK_TEST_FAIL === '1') process.exit(9);
  `);
  writeFileSync(path.join(repo.root, '.githooks/pnpm'), '#!/bin/sh\nexec node \"$PWD/tools/git-hooks/fake-gate.mjs\"\n');
  chmodSync(path.join(repo.root, '.githooks/pnpm'), 0o755);
  repo.env.PATH = `${path.join(repo.root, '.githooks')}${path.delimiter}${repo.env.PATH}`;
  const gateLog = `${repo.root}.gate.log`;
  repo.env.TASKPILOT_HOOK_TEST_LOG = gateLog;
  writeFileSync(gateLog, '');
  writeFileSync(path.join(repo.root, 'README.md'), '# Fixture\n');
  commitAll(repo);
  git(repo.root, ['config', 'core.hooksPath', '.githooks'], { env: repo.env });

  writeFileSync(path.join(repo.root, 'README.md'), '# Fixture\n\nvalid\n');
  git(repo.root, ['add', 'README.md'], { env: repo.env });
  git(repo.root, ['commit', '-qm', 'docs: update fixture'], { env: repo.env });

  writeFileSync(path.join(repo.root, 'README.md'), '# Fixture\n\ndefault revert\n');
  git(repo.root, ['add', 'README.md'], { env: repo.env });
  const revert = command(repo.root, 'git', ['commit', '-m', 'Revert "feat: old behavior"'], { env: repo.env, expect: 1 });
  assert.match(revert.stderr, /Rule: revert-format/);
  git(repo.root, ['reset', '-q'], { env: repo.env });
  writeFileSync(path.join(repo.root, 'README.md'), '# Fixture\n\nvalid\n');

  writeFileSync(path.join(repo.root, 'tools/git-hooks/change.mjs'), 'export const changed = true;\n');
  git(repo.root, ['add', 'tools/git-hooks/change.mjs'], { env: repo.env });
  git(repo.root, ['commit', '-qm', 'test(hooks): exercise selected gate'], { env: repo.env });
  assert.equal(readFileSync(gateLog, 'utf8'), 'hook-tooling\n');

  writeFileSync(path.join(repo.root, 'tools/git-hooks/change.mjs'), 'export const changed = false;\n');
  git(repo.root, ['add', 'tools/git-hooks/change.mjs'], { env: repo.env });
  const beforeFailure = snapshot(repo);
  const failed = command(repo.root, 'git', ['commit', '-m', 'test(hooks): reject failed gate'], { env: { ...repo.env, TASKPILOT_HOOK_TEST_FAIL: '1' }, expect: 1 });
  assert.match(failed.stderr, /hook-tooling quality gate/);
  assert.match(failed.stderr, /exited with code 9/);
  assert.match(failed.stderr, /Not run: none/);
  assert.equal(readFileSync(gateLog, 'utf8'), 'hook-tooling\nhook-tooling\n');
  assert.deepEqual(snapshot(repo), beforeFailure);
});
