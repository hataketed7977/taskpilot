import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { childCommands, repositoryRoot } from './dev-config.mjs';
import { ensureLocalEnvironment } from './local-environment.mjs';
import { assertPrerequisites } from './preflight.mjs';

function run(command, args, label, environment = process.env) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with code ${result.status}`);
}

try {
  assertPrerequisites();
  const values = ensureLocalEnvironment();
  const composeEnvironment = { ...process.env, ...values };
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  run(pnpm, ['install', '--frozen-lockfile', '--prefer-offline'], 'Install locked JavaScript dependencies');
  const compile = childCommands().gradleCompile;
  run(compile.command, compile.args, 'Resolve Gradle dependencies and compile Core API');
  const desktopBuild = childCommands().desktopBuild;
  run(desktopBuild.command, desktopBuild.args, 'Compile Desktop');
  run('docker', ['compose', '--env-file', '.env.local', 'pull', '--policy', 'missing'], 'Pull missing local infrastructure images', composeEnvironment);
  console.log('\nTaskPilot development environment is ready. Run pnpm dev.');
} catch (error) {
  console.error(`TaskPilot bootstrap failed: ${error.message}`);
  process.exitCode = 1;
}
