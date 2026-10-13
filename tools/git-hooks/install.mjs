import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const EXPECTED_HOOKS_PATH = '.githooks';

function gitResult(args, { cwd, env = process.env } = {}) {
  return spawnSync('git', args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
}

function commandFailure(args, result) {
  const detail = result.error?.message ?? result.stderr.trim();
  return new Error(`git ${args.join(' ')} failed${result.status === null ? '' : ` with code ${result.status}`}${detail ? `: ${detail}` : ''}`);
}

export function readEffectiveHooksPath(root, run = gitResult) {
  const args = ['config', '--show-origin', '--get', 'core.hooksPath'];
  const result = run(args, { cwd: root });
  if (result.error) throw commandFailure(args, result);
  if (result.status === 1) return null;
  if (result.status !== 0) throw commandFailure(args, result);
  const line = result.stdout.replace(/\r?\n$/, '');
  const separator = line.indexOf('\t');
  if (separator === -1) return { source: 'unknown', value: line };
  return { source: line.slice(0, separator), value: line.slice(separator + 1) };
}

function normalizeHooksPath(value) {
  const slashNormalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return slashNormalized.replace(/^(?:\.\/)+/, '') || value;
}

export function installHooks(root, { run = gitResult, stdout = process.stdout, stderr = process.stderr } = {}) {
  let effective;
  try {
    effective = readEffectiveHooksPath(root, run);
  } catch (error) {
    stderr.write([
      '[hooks:install] failed',
      `Reason: ${error.message}`,
      'Next: resolve the Git configuration error and rerun pnpm hooks:install.',
      '',
    ].join('\n'));
    return 1;
  }

  if (effective && normalizeHooksPath(effective.value) !== EXPECTED_HOOKS_PATH) {
    stderr.write([
      '[hooks:install] refused to change core.hooksPath',
      `Current value: ${JSON.stringify(effective.value)}`,
      `Configuration source: ${effective.source}`,
      `Expected value: ${JSON.stringify(EXPECTED_HOOKS_PATH)}`,
      'Reason: an effective custom hooks path is already configured.',
      'Next: decide whether to keep, migrate, or compose the existing hook manager, then update the Git configuration explicitly.',
      '',
    ].join('\n'));
    return 1;
  }

  const steps = [
    ['config', 'extensions.worktreeConfig', 'true'],
    ['config', '--worktree', 'core.hooksPath', EXPECTED_HOOKS_PATH],
  ];
  for (const args of steps) {
    const result = run(args, { cwd: root });
    if (result.error || result.status !== 0) {
      const error = commandFailure(args, result);
      stderr.write([
        '[hooks:install] failed',
        `Reason: ${error.message}`,
        `Expected value: ${JSON.stringify(EXPECTED_HOOKS_PATH)}`,
        'Next: resolve the reported Git configuration error and rerun pnpm hooks:install.',
        '',
      ].join('\n'));
      return 1;
    }
  }

  stdout.write(`[hooks:install] current worktree uses ${EXPECTED_HOOKS_PATH}\n`);
  return 0;
}

function repositoryRoot(cwd = process.cwd(), run = gitResult) {
  const args = ['rev-parse', '--show-toplevel'];
  const result = run(args, { cwd });
  if (result.error || result.status !== 0) throw commandFailure(args, result);
  return result.stdout.trim();
}

export function runInstallCli({ cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  let root;
  try {
    root = repositoryRoot(cwd);
  } catch (error) {
    stderr.write([
      '[hooks:install] failed',
      `Reason: ${error.message}`,
      'Next: run pnpm hooks:install from a valid TaskPilot checkout.',
      '',
    ].join('\n'));
    return 1;
  }
  return installHooks(root, { stdout, stderr });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runInstallCli();
}
