import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLocalEnvironment } from './local-environment.mjs';
import { checkoutIdentity, defaultLocalSettings } from './local-settings.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const stateDirectory = path.join(repositoryRoot, '.taskpilot', 'dev');
export const statePath = path.join(stateDirectory, 'state.json');
export const coreApiLogPath = path.join(stateDirectory, 'core-api.log');

function port(value, fallback, key) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${key} must be an integer between 1 and 65535`);
  }
  return parsed;
}

export function localConfiguration(values, root = repositoryRoot) {
  const defaults = defaultLocalSettings(root);
  if (values.TASKPILOT_COMPOSE_PROJECT === undefined && values.TASKPILOT_POSTGRES_PASSWORD !== undefined) {
    Object.assign(defaults, {
      TASKPILOT_COMPOSE_PROJECT: 'taskpilot-local',
      TASKPILOT_POSTGRES_PORT: '5432',
      TASKPILOT_SMTP_PORT: '1025',
      TASKPILOT_MAILPIT_HTTP_PORT: '8025',
      TASKPILOT_CORE_API_PORT: '8080',
      TASKPILOT_DESKTOP_DEV_SERVER_PORT: '5173',
    });
  }
  const postgresPort = port(values.TASKPILOT_POSTGRES_PORT, defaults.TASKPILOT_POSTGRES_PORT, 'TASKPILOT_POSTGRES_PORT');
  const smtpPort = port(values.TASKPILOT_SMTP_PORT, defaults.TASKPILOT_SMTP_PORT, 'TASKPILOT_SMTP_PORT');
  const mailpitHttpPort = port(values.TASKPILOT_MAILPIT_HTTP_PORT, defaults.TASKPILOT_MAILPIT_HTTP_PORT, 'TASKPILOT_MAILPIT_HTTP_PORT');
  const coreApiPort = port(values.TASKPILOT_CORE_API_PORT, defaults.TASKPILOT_CORE_API_PORT, 'TASKPILOT_CORE_API_PORT');
  const desktopDevServerPort = port(values.TASKPILOT_DESKTOP_DEV_SERVER_PORT, defaults.TASKPILOT_DESKTOP_DEV_SERVER_PORT, 'TASKPILOT_DESKTOP_DEV_SERVER_PORT');
  const allPorts = [postgresPort, smtpPort, mailpitHttpPort, coreApiPort, desktopDevServerPort];
  if (new Set(allPorts).size !== allPorts.length) throw new Error('TaskPilot local services must use distinct ports');
  const composeProject = values.TASKPILOT_COMPOSE_PROJECT ?? defaults.TASKPILOT_COMPOSE_PROJECT;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(composeProject)) {
    throw new Error('TASKPILOT_COMPOSE_PROJECT must be a lowercase Docker Compose project name');
  }
  return {
    composeProject,
    postgresPort,
    smtpPort,
    mailpitHttpPort,
    coreApiPort,
    desktopDevServerPort,
    coreApiUrl: `http://127.0.0.1:${coreApiPort}`,
    desktopDevServerUrl: `http://127.0.0.1:${desktopDevServerPort}`,
    mailpitUrl: `http://127.0.0.1:${mailpitHttpPort}`,
  };
}

export function readConfiguration(environmentPath) {
  if (!existsSync(environmentPath)) return null;
  const values = parseLocalEnvironment(readFileSync(environmentPath, 'utf8'));
  return { values, config: localConfiguration(values) };
}

export function childCommands(platform = process.platform, root = repositoryRoot) {
  return {
    gradle: {
      command: platform === 'win32' ? path.join(root, 'gradlew.bat') : path.join(root, 'gradlew'),
      args: ['--project-dir', root, ':services:core-api:bootRun'],
    },
    gradleCompile: {
      command: platform === 'win32' ? path.join(root, 'gradlew.bat') : path.join(root, 'gradlew'),
      args: ['--project-dir', root, ':services:core-api:classes'],
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
