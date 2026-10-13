import { spawnSync } from 'node:child_process';

export class GitCommandError extends Error {
  constructor(args, result) {
    const detail = result.error?.message ?? Buffer.from(result.stderr ?? '').toString('utf8').trim();
    super(`git ${args.join(' ')} failed${result.status === null ? '' : ` with code ${result.status}`}${detail ? `: ${detail}` : ''}`);
    this.name = 'GitCommandError';
    this.args = args;
    this.status = result.status;
    this.cause = result.error;
  }
}

export function runGit(args, { cwd, encoding = 'buffer', env = process.env } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env,
    encoding: encoding === 'buffer' ? undefined : encoding,
    windowsHide: true,
    shell: false,
  });
  if (result.error || result.status !== 0) throw new GitCommandError(args, result);
  return encoding === 'buffer' ? result.stdout : result.stdout.trim();
}

export function repositoryRoot(cwd = process.cwd()) {
  return runGit(['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
}
