import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLocalEnvironment } from './local-environment.mjs';

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

export function localConfiguration(values) {
  const postgresPort = port(values.TASKPILOT_POSTGRES_PORT, 5432, 'TASKPILOT_POSTGRES_PORT');
  const smtpPort = port(values.TASKPILOT_SMTP_PORT, 1025, 'TASKPILOT_SMTP_PORT');
  const mailpitHttpPort = port(values.TASKPILOT_MAILPIT_HTTP_PORT, 8025, 'TASKPILOT_MAILPIT_HTTP_PORT');
  const coreApiPort = 8080;
  return {
    postgresPort,
    smtpPort,
    mailpitHttpPort,
    coreApiPort,
    coreApiUrl: `http://127.0.0.1:${coreApiPort}`,
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
    desktopDev: {
      command: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['--dir', root, '--filter', '@taskpilot/desktop', 'dev'],
    },
  };
}
