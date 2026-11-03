import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLocalEnvironment } from './local-environment.mjs';
import { checkoutIdentity, defaultLocalSettings } from './local-settings.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const stateDirectory = path.join(repositoryRoot, '.taskpilot', 'dev');
export const statePath = path.join(stateDirectory, 'state.json');
export const coreApiLogPath = path.join(stateDirectory, 'core-api.log');
export const gatewayLogPath = path.join(stateDirectory, 'gateway.log');

function port(value, fallback, key) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  return parsed;
}

export function localConfiguration(values, root = repositoryRoot) {
  const defaults = defaultLocalSettings(root);
  const postgresPort = port(values.TASKPILOT_POSTGRES_PORT, defaults.TASKPILOT_POSTGRES_PORT, 'TASKPILOT_POSTGRES_PORT');
  const redisPort = port(values.TASKPILOT_REDIS_PORT, defaults.TASKPILOT_REDIS_PORT, 'TASKPILOT_REDIS_PORT');
  const coreApiPort = port(values.TASKPILOT_CORE_API_PORT, defaults.TASKPILOT_CORE_API_PORT, 'TASKPILOT_CORE_API_PORT');
  const gatewayPort = port(values.TASKPILOT_GATEWAY_PORT, defaults.TASKPILOT_GATEWAY_PORT, 'TASKPILOT_GATEWAY_PORT');
  const desktopDevServerPort = port(values.TASKPILOT_DESKTOP_DEV_SERVER_PORT, defaults.TASKPILOT_DESKTOP_DEV_SERVER_PORT, 'TASKPILOT_DESKTOP_DEV_SERVER_PORT');
  const allPorts = [postgresPort, redisPort, coreApiPort, gatewayPort, desktopDevServerPort];
  if (new Set(allPorts).size !== allPorts.length) throw new Error('TaskPilot local services must use distinct ports');
  const composeProject = values.TASKPILOT_COMPOSE_PROJECT ?? defaults.TASKPILOT_COMPOSE_PROJECT;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(composeProject)) {
    throw new Error('TASKPILOT_COMPOSE_PROJECT must be a lowercase Docker Compose project name');
  }
  return {
    composeProject,
    postgresPort,
    redisPort,
    coreApiPort,
    gatewayPort,
    desktopDevServerPort,
    coreApiInternalUrl: `http://127.0.0.1:${coreApiPort}`,
    gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
    desktopDevServerUrl: `http://127.0.0.1:${desktopDevServerPort}`,
  };
}

export function readConfiguration(environmentPath) {
  if (!existsSync(environmentPath)) return null;
  const values = parseLocalEnvironment(readFileSync(environmentPath, 'utf8'));
  return { values, config: localConfiguration(values) };
}

export function childCommands(platform = process.platform, root = repositoryRoot) {
  return {
    coreApi: {
      command: platform === 'win32' ? path.join(root, 'gradlew.bat') : path.join(root, 'gradlew'),
      args: ['--project-dir', root, ':services:core-api:bootRun'],
    },
    coreApiCompile: {
      command: platform === 'win32' ? path.join(root, 'gradlew.bat') : path.join(root, 'gradlew'),
      args: ['--project-dir', root, ':services:core-api:classes'],
    },
    gateway: {
      command: platform === 'win32' ? path.join(root, 'gradlew.bat') : path.join(root, 'gradlew'),
      args: ['--project-dir', root, ':services:gateway:bootRun'],
    },
    gatewayCompile: {
      command: platform === 'win32' ? path.join(root, 'gradlew.bat') : path.join(root, 'gradlew'),
      args: ['--project-dir', root, ':services:gateway:classes'],
    },
    desktopDev: {
      command: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['--dir', root, '--filter', '@taskpilot/desktop', 'dev'],
    },
    desktopBuild: {
      command: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['--dir', root, '--filter', '@taskpilot/desktop', 'build'],
    },
  };
}

export { checkoutIdentity, defaultLocalSettings } from './local-settings.mjs';
