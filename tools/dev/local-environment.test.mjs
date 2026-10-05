import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureLocalEnvironment, parseLocalEnvironment, verificationMailEnvironment } from './local-environment.mjs';

const validEnvironment = [
  'TASKPILOT_POSTGRES_PASSWORD=database-secret',
  'TASKPILOT_AUTH_TOKEN_PEPPER_BASE64=token-pepper',
  'TASKPILOT_AUTH_RECOVERY_KEY_BASE64=recovery-key',
  'TASKPILOT_VERIFICATION_PEPPER_BASE64=verification-pepper',
  '',
].join('\n');

test('parser accepts the required TaskPilot keys', () => {
  assert.equal(parseLocalEnvironment(validEnvironment).TASKPILOT_POSTGRES_PASSWORD, 'database-secret');
});

test('parser rejects missing secrets, unrelated keys, and blank values', () => {
  assert.throws(() => parseLocalEnvironment('TASKPILOT_POSTGRES_PASSWORD=value\n'), /missing TASKPILOT_AUTH_TOKEN/);
  assert.throws(() => parseLocalEnvironment(`${validEnvironment}OTHER_KEY=value\n`), /Invalid local environment/);
  assert.throws(() => parseLocalEnvironment(`${validEnvironment}TASKPILOT_SMTP_PORT=\n`), /Invalid local environment/);
});

test('setup creates mode 0600 random values and never overwrites an existing environment', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-local-environment-'));
  const environmentPath = path.join(directory, '.env.local');
  try {
    const generated = ensureLocalEnvironment(environmentPath);
    assert.equal(statSync(environmentPath).mode & 0o777, 0o600);
    assert.match(generated.TASKPILOT_AUTH_TOKEN_PEPPER_BASE64, /^[A-Za-z0-9+/]{43}=$/);

    const before = readFileSync(environmentPath, 'utf8');
    assert.deepEqual(ensureLocalEnvironment(environmentPath), generated);
    assert.equal(readFileSync(environmentPath, 'utf8'), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('existing environments are extended without changing credentials or legacy ports', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-local-environment-upgrade-'));
  const environmentPath = path.join(directory, '.env.local');
  try {
    writeFileSync(environmentPath, `${validEnvironment}TASKPILOT_POSTGRES_PORT=6543\n`, { mode: 0o644 });
    const upgraded = ensureLocalEnvironment(environmentPath, path.join(directory, 'checkout'));
    assert.equal(upgraded.TASKPILOT_POSTGRES_PASSWORD, 'database-secret');
    assert.equal(upgraded.TASKPILOT_POSTGRES_PORT, '6543');
    assert.equal(upgraded.TASKPILOT_COMPOSE_PROJECT, 'taskpilot-local');
    assert.equal(upgraded.TASKPILOT_CORE_API_PORT, '8080');
    assert.equal(upgraded.TASKPILOT_DESKTOP_DEV_SERVER_PORT, '5173');
    if (process.platform !== 'win32') assert.equal(statSync(environmentPath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('checked-in example contains placeholders rather than generated local secrets', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const example = readFileSync(path.join(root, '.env.local.example'), 'utf8');
  assert.match(example, /replace-with-a-local-random-password/);
  assert.doesNotMatch(example, /^[A-Za-z0-9_-]{24,}$/m);
});

test('verification mail defaults to loopback Mailpit', () => {
  const mail = verificationMailEnvironment({ TASKPILOT_SMTP_PORT: '11025' });
  assert.equal(mail.TASKPILOT_VERIFICATION_MAIL_ADAPTER, 'local');
  assert.equal(mail.TASKPILOT_VERIFICATION_SMTP_HOST, '127.0.0.1');
  assert.equal(mail.TASKPILOT_VERIFICATION_SMTP_PORT, '11025');
  assert.equal(mail.TASKPILOT_VERIFICATION_SMTP_STARTTLS, 'false');
});

test('external verification mail requires complete encrypted SMTP settings', () => {
  const external = {
    TASKPILOT_VERIFICATION_MAIL_MODE: 'external',
    TASKPILOT_EXTERNAL_SMTP_HOST: 'smtp.example.com',
    TASKPILOT_EXTERNAL_SMTP_PORT: '587',
    TASKPILOT_EXTERNAL_SMTP_FROM: 'no-reply@example.com',
    TASKPILOT_EXTERNAL_SMTP_USERNAME: 'smtp-user',
    TASKPILOT_EXTERNAL_SMTP_PASSWORD: 'smtp-secret',
  };
  const mail = verificationMailEnvironment(external);
  assert.equal(mail.TASKPILOT_VERIFICATION_MAIL_ADAPTER, 'production');
  assert.equal(mail.TASKPILOT_VERIFICATION_SMTP_STARTTLS, 'true');
  assert.equal(mail.TASKPILOT_VERIFICATION_SMTP_SSL, 'false');
  assert.equal(mail.TASKPILOT_VERIFICATION_SMTP_AUTH, 'true');
  assert.equal(mail.TASKPILOT_VERIFICATION_SMTP_PASSWORD, 'smtp-secret');

  const implicitSsl = verificationMailEnvironment({
    ...external,
    TASKPILOT_EXTERNAL_SMTP_PORT: '465',
    TASKPILOT_EXTERNAL_SMTP_STARTTLS: 'false',
    TASKPILOT_EXTERNAL_SMTP_SSL: 'true',
  });
  assert.equal(implicitSsl.TASKPILOT_VERIFICATION_SMTP_STARTTLS, 'false');
  assert.equal(implicitSsl.TASKPILOT_VERIFICATION_SMTP_SSL, 'true');

  assert.throws(
    () => verificationMailEnvironment({ ...external, TASKPILOT_EXTERNAL_SMTP_HOST: undefined }),
    /missing TASKPILOT_EXTERNAL_SMTP_HOST/,
  );
  assert.throws(
    () => verificationMailEnvironment({ ...external, TASKPILOT_EXTERNAL_SMTP_PASSWORD: undefined }),
    /configured together/,
  );
  assert.throws(
    () => verificationMailEnvironment({
      ...external,
      TASKPILOT_EXTERNAL_SMTP_STARTTLS: 'false',
      TASKPILOT_EXTERNAL_SMTP_SSL: 'false',
    }),
    /must require STARTTLS or implicit SSL/,
  );
  assert.throws(
    () => verificationMailEnvironment({
      ...external,
      TASKPILOT_EXTERNAL_SMTP_STARTTLS: 'true',
      TASKPILOT_EXTERNAL_SMTP_SSL: 'true',
    }),
    /either STARTTLS or implicit SSL/,
  );
});
