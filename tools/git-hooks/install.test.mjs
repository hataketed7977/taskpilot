import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { installHooks } from './install.mjs';

function git(cwd, args, env) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function isolatedGitEnvironment(baseEnvironment) {
  const env = { ...baseEnvironment };
  const repositoryLocalVariables = new Set([
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_CONFIG',
    'GIT_CONFIG_COUNT',
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_PREFIX',
    'GIT_WORK_TREE',
  ]);
  for (const key of Object.keys(env)) {
    if (repositoryLocalVariables.has(key) || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  return env;
}

function isolatedRepository(baseEnvironment = process.env) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-hooks-install-'));
  const globalConfig = path.join(root, 'global.gitconfig');
  writeFileSync(globalConfig, '');
  const env = {
    ...isolatedGitEnvironment(baseEnvironment),
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
  git(root, ['init', '-q'], env);
  git(root, ['config', 'user.name', 'TaskPilot Test'], env);
  git(root, ['config', 'user.email', 'test@example.com'], env);
  writeFileSync(path.join(root, 'seed'), 'seed\n');
  git(root, ['add', 'seed'], env);
  git(root, ['commit', '-qm', 'chore: seed'], env);
  return { root, globalConfig, env };
}

function runner(env) {
  return (args, options) => spawnSync('git', args, {
    cwd: options.cwd,
    env,
    encoding: 'utf8',
    shell: false,
  });
}

function output() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

test('installs worktree-specific hooks idempotently in a normal repository', () => {
  const repo = isolatedRepository();
  const out = output();
  assert.equal(installHooks(repo.root, { run: runner(repo.env), stdout: out.stream, stderr: output().stream }), 0);
  assert.equal(git(repo.root, ['config', '--worktree', '--get', 'core.hooksPath'], repo.env), '.githooks');
  assert.equal(git(repo.root, ['config', '--get', 'extensions.worktreeConfig'], repo.env), 'true');
  const configBefore = readFileSync(path.join(repo.root, '.git', 'config.worktree'), 'utf8');
  assert.equal(installHooks(repo.root, { run: runner(repo.env), stdout: out.stream, stderr: output().stream }), 0);
  assert.equal(readFileSync(path.join(repo.root, '.git', 'config.worktree'), 'utf8'), configBefore);
  assert.match(out.read(), /current worktree uses \.githooks/);
});

test('pins an inherited expected value but refuses a conflicting effective value', () => {
  const expected = isolatedRepository();
  git(expected.root, ['config', '--global', 'core.hooksPath', './.githooks/'], expected.env);
  assert.equal(installHooks(expected.root, { run: runner(expected.env), stdout: output().stream, stderr: output().stream }), 0);
  assert.equal(git(expected.root, ['config', '--worktree', '--get', 'core.hooksPath'], expected.env), '.githooks');

  const conflict = isolatedRepository();
  git(conflict.root, ['config', '--global', 'core.hooksPath', '/custom/hooks'], conflict.env);
  const err = output();
  assert.equal(installHooks(conflict.root, { run: runner(conflict.env), stdout: output().stream, stderr: err.stream }), 1);
  assert.match(err.read(), /Current value: "\/custom\/hooks"/);
  assert.match(err.read(), /Configuration source:/);
  assert.match(err.read(), /Expected value: "\.githooks"/);
  assert.equal(git(conflict.root, ['config', '--get', 'core.hooksPath'], conflict.env), '/custom/hooks');
  assert.equal(spawnSync('git', ['config', '--worktree', '--get', 'core.hooksPath'], { cwd: conflict.root, env: conflict.env }).status, 1);
});

test('refuses a repository-local custom path without enabling worktree config', () => {
  const repo = isolatedRepository();
  git(repo.root, ['config', '--local', 'core.hooksPath', '.custom-hooks'], repo.env);
  const err = output();

  assert.equal(installHooks(repo.root, { run: runner(repo.env), stdout: output().stream, stderr: err.stream }), 1);
  assert.match(err.read(), /Current value: "\.custom-hooks"/);
  assert.match(err.read(), /Configuration source: file:/);
  assert.equal(git(repo.root, ['config', '--local', '--get', 'core.hooksPath'], repo.env), '.custom-hooks');
  assert.equal(spawnSync('git', ['config', '--get', 'extensions.worktreeConfig'], { cwd: repo.root, env: repo.env }).status, 1);
  assert.equal(existsSync(path.join(repo.root, '.git', 'config.worktree')), false);
});

test('installing one linked worktree ignores parent Git context and does not configure another worktree', () => {
  const repo = isolatedRepository({ ...process.env, GIT_INDEX_FILE: '.git/index' });
  const linkedA = path.join(repo.root, '..', `${path.basename(repo.root)}-a`);
  const linkedB = path.join(repo.root, '..', `${path.basename(repo.root)}-b`);
  git(repo.root, ['branch', 'worktree-a'], repo.env);
  git(repo.root, ['branch', 'worktree-b'], repo.env);
  git(repo.root, ['worktree', 'add', '-q', linkedA, 'worktree-a'], repo.env);
  git(repo.root, ['worktree', 'add', '-q', linkedB, 'worktree-b'], repo.env);

  assert.equal(installHooks(linkedA, { run: runner(repo.env), stdout: output().stream, stderr: output().stream }), 0);
  assert.equal(git(linkedA, ['config', '--show-origin', '--get', 'core.hooksPath'], repo.env).split(/\s+/).at(-1), '.githooks');
  assert.equal(spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: linkedB, env: repo.env }).status, 1);
  const linkedBGitDir = git(linkedB, ['rev-parse', '--git-dir'], repo.env);
  assert.equal(spawnSync('git', ['config', '--worktree', '--get', 'core.hooksPath'], { cwd: linkedB, env: repo.env }).status, 1);
  assert.equal(existsSync(path.resolve(linkedB, linkedBGitDir, 'config.worktree')), false);

  assert.equal(installHooks(linkedB, { run: runner(repo.env), stdout: output().stream, stderr: output().stream }), 0);
  assert.equal(git(linkedB, ['config', '--get', 'core.hooksPath'], repo.env), '.githooks');
});
