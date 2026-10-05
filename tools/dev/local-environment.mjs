import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLocalSettings } from './local-settings.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const localEnvironmentPath = path.join(repositoryRoot, '.env.local');
const requiredKeys = [
  'TASKPILOT_POSTGRES_PASSWORD',
  'TASKPILOT_AUTH_TOKEN_PEPPER_BASE64',
  'TASKPILOT_AUTH_RECOVERY_KEY_BASE64',
  'TASKPILOT_VERIFICATION_PEPPER_BASE64',
];
const localSettingKeys = Object.keys(defaultLocalSettings(repositoryRoot));

export function ensureLocalEnvironment(environmentPath = localEnvironmentPath, root = repositoryRoot) {
  if (!existsSync(environmentPath)) {
    writeFileSync(environmentPath, createLocalEnvironment(root), { mode: 0o600, flag: 'wx' });
    console.log(`Created ${path.basename(environmentPath)} with random local-only credentials and checkout-specific ports.`);
  } else {
    const values = readLocalEnvironment(environmentPath);
    const defaults = defaultLocalSettings(root);
    // Preserve the legacy Compose project for an existing checkout so its local database remains visible.
    // Newly generated environments use a checkout-specific project and volume.
    if (values.TASKPILOT_COMPOSE_PROJECT === undefined) {
      Object.assign(defaults, {
        TASKPILOT_COMPOSE_PROJECT: 'taskpilot-local',
        TASKPILOT_POSTGRES_PORT: '5432',
        TASKPILOT_SMTP_PORT: '1025',
        TASKPILOT_MAILPIT_HTTP_PORT: '8025',
        TASKPILOT_CORE_API_PORT: '8080',
        TASKPILOT_DESKTOP_DEV_SERVER_PORT: '5173',
      });
    }
    const missingSettings = Object.entries(defaults).filter(([key]) => values[key] === undefined);
    if (missingSettings.length > 0) {
      const suffix = `\n# Added by TaskPilot for checkout-local development.\n${missingSettings.map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
      writeFileSync(environmentPath, suffix, { mode: 0o600, flag: 'a' });
      console.log(`Updated ${path.basename(environmentPath)} with missing checkout-local settings; existing values were preserved.`);
    } else {
      console.log(`Using existing ${path.basename(environmentPath)}.`);
    }
  }
  if (process.platform !== 'win32') chmodSync(environmentPath, 0o600);
  return readLocalEnvironment(environmentPath);
}

export function readLocalEnvironment(environmentPath = localEnvironmentPath) {
  return parseLocalEnvironment(readFileSync(environmentPath, 'utf8'));
}

export function parseLocalEnvironment(content) {
  const values = {};
  for (const [lineNumber, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid local environment entry on line ${lineNumber + 1}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^TASKPILOT_[A-Z0-9_]+$/.test(key) || !value || values[key] !== undefined) {
      throw new Error(`Invalid local environment entry on line ${lineNumber + 1}`);
    }
    values[key] = value;
  }
  for (const key of requiredKeys) {
    if (!values[key]) throw new Error(`Local environment is missing ${key}`);
  }
  verificationMailEnvironment(values);
  return values;
}

export function verificationMailEnvironment(values) {
  const mode = values.TASKPILOT_VERIFICATION_MAIL_MODE ?? 'mailpit';
  if (!['mailpit', 'external'].includes(mode)) {
    throw new Error('TASKPILOT_VERIFICATION_MAIL_MODE must be mailpit or external');
  }
  if (mode === 'mailpit') {
    return {
      TASKPILOT_VERIFICATION_MAIL_ADAPTER: 'local',
      TASKPILOT_VERIFICATION_SMTP_HOST: '127.0.0.1',
      TASKPILOT_VERIFICATION_SMTP_PORT: values.TASKPILOT_SMTP_PORT ?? '1025',
      TASKPILOT_VERIFICATION_SMTP_FROM: 'no-reply@taskpilot.local',
      TASKPILOT_VERIFICATION_SMTP_AUTH: 'false',
      TASKPILOT_VERIFICATION_SMTP_STARTTLS: 'false',
      TASKPILOT_VERIFICATION_SMTP_SSL: 'false',
    };
  }

  for (const key of ['TASKPILOT_EXTERNAL_SMTP_HOST', 'TASKPILOT_EXTERNAL_SMTP_PORT', 'TASKPILOT_EXTERNAL_SMTP_FROM']) {
    if (!values[key]) throw new Error(`External verification mail is missing ${key}`);
  }
  const smtpPort = Number(values.TASKPILOT_EXTERNAL_SMTP_PORT);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error('TASKPILOT_EXTERNAL_SMTP_PORT must be an integer between 1 and 65535');
  }
  const usernamePresent = values.TASKPILOT_EXTERNAL_SMTP_USERNAME !== undefined;
  const passwordPresent = values.TASKPILOT_EXTERNAL_SMTP_PASSWORD !== undefined;
  if (usernamePresent !== passwordPresent) {
    throw new Error('External SMTP username and password must be configured together');
  }
  const startTls = parseBoolean(values.TASKPILOT_EXTERNAL_SMTP_STARTTLS ?? 'true', 'TASKPILOT_EXTERNAL_SMTP_STARTTLS');
  const ssl = parseBoolean(values.TASKPILOT_EXTERNAL_SMTP_SSL ?? 'false', 'TASKPILOT_EXTERNAL_SMTP_SSL');
  if (!startTls && !ssl) throw new Error('External verification SMTP must require STARTTLS or implicit SSL');
  if (startTls && ssl) throw new Error('External verification SMTP must select either STARTTLS or implicit SSL, not both');

  return {
    TASKPILOT_VERIFICATION_MAIL_ADAPTER: 'production',
    TASKPILOT_VERIFICATION_SMTP_HOST: values.TASKPILOT_EXTERNAL_SMTP_HOST,
    TASKPILOT_VERIFICATION_SMTP_PORT: String(smtpPort),
    TASKPILOT_VERIFICATION_SMTP_FROM: values.TASKPILOT_EXTERNAL_SMTP_FROM,
    TASKPILOT_VERIFICATION_SMTP_USERNAME: values.TASKPILOT_EXTERNAL_SMTP_USERNAME ?? '',
    TASKPILOT_VERIFICATION_SMTP_PASSWORD: values.TASKPILOT_EXTERNAL_SMTP_PASSWORD ?? '',
    TASKPILOT_VERIFICATION_SMTP_AUTH: String(usernamePresent),
    TASKPILOT_VERIFICATION_SMTP_STARTTLS: String(startTls),
    TASKPILOT_VERIFICATION_SMTP_SSL: String(ssl),
  };
}

function parseBoolean(value, key) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${key} must be true or false`);
}

function createLocalEnvironment(root) {
  const settings = defaultLocalSettings(root);
  return [
    '# Generated by pnpm bootstrap. Local development only; do not commit.',
    `TASKPILOT_POSTGRES_PASSWORD=${randomBytes(24).toString('base64url')}`,
    `TASKPILOT_AUTH_TOKEN_PEPPER_BASE64=${randomBytes(32).toString('base64')}`,
    `TASKPILOT_AUTH_RECOVERY_KEY_BASE64=${randomBytes(32).toString('base64')}`,
    `TASKPILOT_VERIFICATION_PEPPER_BASE64=${randomBytes(32).toString('base64')}`,
    ...localSettingKeys.map(key => `${key}=${settings[key]}`),
    '',
  ].join('\n');
}
