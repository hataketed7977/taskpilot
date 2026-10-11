import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ensureLocalEnvironment,
  exampleLocalEnvironment,
  federatedAuthenticationEnvironment,
  parseLocalEnvironment,
} from './local-environment.mjs';

const hmacKey = Buffer.alloc(32, 1).toString('base64');
const aeadKey = Buffer.alloc(32, 2).toString('base64');
const validEnvironment = [
  'TASKPILOT_POSTGRES_PASSWORD=database-secret',
  'TASKPILOT_REDIS_PASSWORD=redis-secret',
  `TASKPILOT_AUTH_TOKEN_PEPPER_BASE64=${Buffer.alloc(32, 3).toString('base64')}`,
  '',
].join('\n');
const completeFederated = {
  TASKPILOT_GITHUB_CLIENT_ID: 'github-client-id',
  TASKPILOT_GITHUB_CLIENT_SECRET: 'github-client-secret',
  TASKPILOT_GITHUB_CALLBACK_URI: 'http://127.0.0.1:45432/desktop/v1/auth/federated/github/callback',
  TASKPILOT_FEDERATED_HMAC_KEY_BASE64: hmacKey,
  TASKPILOT_FEDERATED_AEAD_KEY_BASE64: aeadKey,
};

test('parser accepts the required TaskPilot keys without GitHub configuration', () => {
  assert.equal(parseLocalEnvironment(validEnvironment).TASKPILOT_POSTGRES_PASSWORD, 'database-secret');
});

test('parser accepts blank optional GitHub credentials', () => {
  const parsed = parseLocalEnvironment(`${validEnvironment}TASKPILOT_GITHUB_CLIENT_ID=\nTASKPILOT_GITHUB_CLIENT_SECRET=\n`);
  assert.equal(parsed.TASKPILOT_GITHUB_CLIENT_ID, '');
  assert.equal(parsed.TASKPILOT_GITHUB_CLIENT_SECRET, '');
});

test('parser rejects missing infrastructure and session secrets, unrelated keys, and other blank values', () => {
  assert.throws(() => parseLocalEnvironment('TASKPILOT_POSTGRES_PASSWORD=value\n'), /missing TASKPILOT_REDIS_PASSWORD/);
  assert.throws(() => parseLocalEnvironment(`${validEnvironment}OTHER_KEY=value\n`), /Invalid local environment/);
  assert.throws(() => parseLocalEnvironment(`${validEnvironment}TASKPILOT_CORE_API_PORT=\n`), /Invalid local environment/);
});

test('GitHub capability fails closed for absent, partial, invalid, or reused federated configuration', () => {
  assert.equal(federatedAuthenticationEnvironment({}).enabled, false);
  for (const key of Object.keys(completeFederated)) {
    const partial = { ...completeFederated };
    delete partial[key];
    assert.equal(federatedAuthenticationEnvironment(partial).enabled, false, `${key} missing`);
  }
  assert.equal(federatedAuthenticationEnvironment({ ...completeFederated, TASKPILOT_FEDERATED_HMAC_KEY_BASE64: 'not-base64' }).enabled, false);
  assert.equal(federatedAuthenticationEnvironment({ ...completeFederated, TASKPILOT_FEDERATED_AEAD_KEY_BASE64: hmacKey }).enabled, false);
  assert.equal(federatedAuthenticationEnvironment({ ...completeFederated, TASKPILOT_GITHUB_CALLBACK_URI: 'https://example.com/callback' }).enabled, false);
});

test('complete placeholder GitHub configuration maps only to Core API environment variables', () => {
  const result = federatedAuthenticationEnvironment(completeFederated);
  assert.equal(result.enabled, true);
  assert.deepEqual(result.environment, {
    TASKPILOT_GITHUB_CLIENT_ID: 'github-client-id',
    TASKPILOT_GITHUB_CLIENT_SECRET: 'github-client-secret',
    TASKPILOT_GITHUB_CALLBACK_URI: completeFederated.TASKPILOT_GITHUB_CALLBACK_URI,
    TASKPILOT_FEDERATED_HMAC_KEY_BASE64: hmacKey,
    TASKPILOT_FEDERATED_AEAD_KEY_BASE64: aeadKey,
  });
});

test('setup creates mode 0600 random base and federated keys without inventing GitHub credentials', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-local-environment-'));
  const environmentPath = path.join(directory, '.env.local');
  try {
    const generated = ensureLocalEnvironment(environmentPath, path.join(directory, 'checkout'));
    assert.equal(statSync(environmentPath).mode & 0o777, 0o600);
    assert.match(generated.TASKPILOT_AUTH_TOKEN_PEPPER_BASE64, /^[A-Za-z0-9+/]{43}=$/);
    assert.match(generated.TASKPILOT_FEDERATED_HMAC_KEY_BASE64, /^[A-Za-z0-9+/]{43}=$/);
    assert.match(generated.TASKPILOT_FEDERATED_AEAD_KEY_BASE64, /^[A-Za-z0-9+/]{43}=$/);
    assert.notEqual(generated.TASKPILOT_FEDERATED_HMAC_KEY_BASE64, generated.TASKPILOT_FEDERATED_AEAD_KEY_BASE64);
    assert.equal(generated.TASKPILOT_GITHUB_CLIENT_ID, '');
    assert.equal(generated.TASKPILOT_GITHUB_CLIENT_SECRET, '');

    const before = readFileSync(environmentPath, 'utf8');
    assert.match(before, /# GitHub OAuth App[\s\S]*TASKPILOT_GITHUB_CLIENT_ID=\n[\s\S]*TASKPILOT_GITHUB_CLIENT_SECRET=/);
    assert.match(before, /# Federated login security[\s\S]*TASKPILOT_FEDERATED_HMAC_KEY_BASE64=/);
    assert.deepEqual(ensureLocalEnvironment(environmentPath, path.join(directory, 'checkout')), generated);
    assert.equal(readFileSync(environmentPath, 'utf8'), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('existing environments gain checkout settings and independent federated keys without changing credentials', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-local-environment-upgrade-'));
  const environmentPath = path.join(directory, '.env.local');
  try {
    writeFileSync(
      environmentPath,
      `${validEnvironment}TASKPILOT_POSTGRES_PORT=6543\nTASKPILOT_SMTP_PORT=2525\nTASKPILOT_CUSTOM_LOCAL_VALUE=keep-me\n`,
      { mode: 0o644 },
    );
    const upgraded = ensureLocalEnvironment(environmentPath, path.join(directory, 'checkout'));
    assert.equal(upgraded.TASKPILOT_POSTGRES_PASSWORD, 'database-secret');
    assert.equal(upgraded.TASKPILOT_POSTGRES_PORT, '6543');
    assert.match(upgraded.TASKPILOT_COMPOSE_PROJECT, /^taskpilot-/);
    assert.match(upgraded.TASKPILOT_FEDERATED_HMAC_KEY_BASE64, /^[A-Za-z0-9+/]{43}=$/);
    assert.notEqual(upgraded.TASKPILOT_FEDERATED_HMAC_KEY_BASE64, upgraded.TASKPILOT_FEDERATED_AEAD_KEY_BASE64);
    assert.equal(upgraded.TASKPILOT_GITHUB_CLIENT_ID, '');
    assert.equal(upgraded.TASKPILOT_GITHUB_CLIENT_SECRET, '');
    assert.equal(upgraded.TASKPILOT_SMTP_PORT, undefined);
    assert.equal(upgraded.TASKPILOT_CUSTOM_LOCAL_VALUE, 'keep-me');
    const contents = readFileSync(environmentPath, 'utf8');
    assert.match(contents, /# GitHub OAuth App[\s\S]*TASKPILOT_GITHUB_CLIENT_ID=\n[\s\S]*TASKPILOT_GITHUB_CLIENT_SECRET=/);
    assert.doesNotMatch(contents, /TASKPILOT_SMTP_PORT/);
    assert.match(contents, /# Additional local settings[\s\S]*TASKPILOT_CUSTOM_LOCAL_VALUE=keep-me/);
    const retiredPath = `${environmentPath}.retired`;
    assert.equal(existsSync(retiredPath), true);
    assert.match(readFileSync(retiredPath, 'utf8'), /TASKPILOT_SMTP_PORT=2525/);
    if (process.platform !== 'win32') assert.equal(statSync(retiredPath).mode & 0o777, 0o600);
    assert.deepEqual(ensureLocalEnvironment(environmentPath, path.join(directory, 'checkout')), upgraded);
    assert.equal(readFileSync(environmentPath, 'utf8'), contents);
    if (process.platform !== 'win32') assert.equal(statSync(environmentPath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('retired local values are never overwritten when an archive contains a different value', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-local-environment-conflict-'));
  const environmentPath = path.join(directory, '.env.local');
  const retiredPath = `${environmentPath}.retired`;
  try {
    const active = `${validEnvironment}TASKPILOT_SMTP_PORT=2525\n`;
    const retired = 'TASKPILOT_SMTP_PORT=587\n';
    writeFileSync(environmentPath, active, { mode: 0o600 });
    writeFileSync(retiredPath, retired, { mode: 0o600 });

    assert.throws(
      () => ensureLocalEnvironment(environmentPath, path.join(directory, 'checkout')),
      /Retired local setting TASKPILOT_SMTP_PORT differs/,
    );
    assert.equal(readFileSync(environmentPath, 'utf8'), active);
    assert.equal(readFileSync(retiredPath, 'utf8'), retired);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('checked-in example exactly matches the documented generated template', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const example = readFileSync(path.join(root, '.env.local.example'), 'utf8');
  assert.equal(example, exampleLocalEnvironment());
  for (const section of [
    'Local checkout',
    'PostgreSQL',
    'Redis',
    'Core API',
    'Desktop',
    'Session security',
    'GitHub OAuth App',
    'Federated login security',
  ]) {
    assert.match(example, new RegExp(`^# ${section}$`, 'm'));
  }
  assert.match(
    example,
    /# PostgreSQL[\s\S]*TASKPILOT_POSTGRES_PORT=15432[\s\S]*TASKPILOT_POSTGRES_PASSWORD=replace-with-a-local-random-password[\s\S]*# Core API/,
  );
  assert.match(example, /^TASKPILOT_GITHUB_CLIENT_ID=$/m);
  assert.match(example, /^TASKPILOT_GITHUB_CLIENT_SECRET=$/m);
  assert.doesNotMatch(example, /MAILPIT|SMTP|VERIFICATION_PEPPER/i);
  assert.doesNotMatch(example, /^[A-Za-z0-9_-]{24,}$/m);
});
