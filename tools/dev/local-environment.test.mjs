import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureLocalEnvironment, parseLocalEnvironment } from './local-environment.mjs';

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

test('checked-in example contains placeholders rather than generated local secrets', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const example = readFileSync(path.join(root, '.env.local.example'), 'utf8');
  assert.match(example, /replace-with-a-local-random-password/);
  assert.doesNotMatch(example, /^[A-Za-z0-9_-]{24,}$/m);
});
