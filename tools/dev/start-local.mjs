import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { ensureLocalEnvironment, localEnvironmentPath, repositoryRoot } from './local-environment.mjs';

const local = ensureLocalEnvironment();
const environment = { ...process.env, ...local, SPRING_PROFILES_ACTIVE: 'local' };
const compose = spawnSync(
  'docker',
  ['compose', '--env-file', localEnvironmentPath, 'up', '-d', '--wait'],
  { cwd: repositoryRoot, env: environment, stdio: 'inherit' },
);
if (compose.error) throw compose.error;
if (compose.status !== 0) process.exit(compose.status ?? 1);

const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
let desktop;
const coreApi = spawn(gradle, [':services:core-api:bootRun'], {
  cwd: repositoryRoot,
  env: environment,
  stdio: 'inherit',
});
let stopping = false;
const stop = (signal = 'SIGTERM') => {
  if (stopping) return;
  stopping = true;
  if (!coreApi.killed) coreApi.kill(signal);
  if (desktop && !desktop.killed) desktop.kill(signal);
};
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

async function waitForCoreApi() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (coreApi.exitCode !== null) throw new Error(`Core API exited with code ${coreApi.exitCode}`);
    try {
      const response = await fetch('http://127.0.0.1:8080/actuator/health');
      if (response.ok && (await response.json()).status === 'UP') return;
    } catch {
      // Expected while Spring Boot starts.
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error('Core API did not become healthy within 120 seconds');
}

try {
  await waitForCoreApi();
  console.log('Core API is healthy. Mailpit: http://127.0.0.1:8025');
  const build = spawnSync(pnpm, ['--filter', '@taskpilot/desktop', 'build'], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Desktop build failed with code ${build.status}`);
  desktop = spawn(pnpm, ['--filter', '@taskpilot/desktop', 'start'], {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
  const exitCode = await new Promise((resolve, reject) => {
    desktop.once('exit', code => resolve(code ?? 0));
    desktop.once('error', reject);
  });
  process.exitCode = exitCode;
} finally {
  stop();
}
