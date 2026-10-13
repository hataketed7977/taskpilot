import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { installHooks } from '../git-hooks/install.mjs';
import { childCommands, repositoryRoot } from './dev-config.mjs';
import { ensureLocalEnvironment } from './local-environment.mjs';
import { assertPrerequisites } from './preflight.mjs';

function run(command, args, label, environment = process.env, spawn = spawnSync) {
  console.log(`\n==> ${label}`);
  const result = spawn(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with code ${result.status}`);
}

export function bootstrap({
  assertReady = assertPrerequisites,
  ensureEnvironment = ensureLocalEnvironment,
  commands = childCommands,
  hookInstaller = installHooks,
  spawn = spawnSync,
  platform = process.platform,
  environment = process.env,
} = {}) {
  assertReady();
  const values = ensureEnvironment();
  const composeEnvironment = { ...environment, ...values };
  if (hookInstaller(repositoryRoot) !== 0) {
    throw new Error('Install repository Git hooks failed; see hooks:install diagnostics above');
  }
  const pnpm = platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  run(pnpm, ['install', '--frozen-lockfile', '--prefer-offline'], 'Install locked JavaScript dependencies', environment, spawn);
  const compile = commands(platform, repositoryRoot).gradleCompile;
  run(compile.command, compile.args, 'Resolve Gradle dependencies and compile Core API', environment, spawn);
  const desktopBuild = commands(platform, repositoryRoot).desktopBuild;
  run(desktopBuild.command, desktopBuild.args, 'Compile Desktop', environment, spawn);
  run('docker', ['compose', '--env-file', '.env.local', 'pull', '--policy', 'missing'], 'Pull missing local infrastructure images', composeEnvironment, spawn);
  console.log('\nTaskPilot development environment is ready. Run pnpm dev.');
}

export function runBootstrapCli() {
  try {
    bootstrap();
  } catch (error) {
    console.error(`TaskPilot bootstrap failed: ${error.message}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runBootstrapCli();
}
