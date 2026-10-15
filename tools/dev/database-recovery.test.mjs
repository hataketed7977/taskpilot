import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyLocalPostgresVolume,
  classifyLocalRedisVolume,
  isRecoverableLocalDatabaseIncompatibility,
  postgresVolumeName,
  redisVolumeName,
  recoveryVolumeNames,
  startupUsedExpectedLocalDatabase,
  withOneDatabaseRecovery,
} from './database-recovery.mjs';

const project = 'taskpilot-checkout-1234';

function ownedVolume(logicalName, overrides = {}) {
  return {
    Name: `${project}_${logicalName}`,
    Labels: {
      'com.docker.compose.project': project,
      'com.docker.compose.volume': logicalName,
    },
    ...overrides,
  };
}

test('database recovery recognizes schema-history incompatibility, not arbitrary startup failures', () => {
  assert.equal(isRecoverableLocalDatabaseIncompatibility(`
    org.flywaydb.core.api.exception.FlywayValidateException: Validate failed: Migrations have failed validation
    Migration checksum mismatch for migration version 1
  `), true);
  assert.equal(isRecoverableLocalDatabaseIncompatibility('Validate failed: Applied migration not resolved locally: 7'), true);
  assert.equal(isRecoverableLocalDatabaseIncompatibility('Found non-empty schema(s) "public" but no schema history table'), true);
  assert.equal(isRecoverableLocalDatabaseIncompatibility('Connection to 127.0.0.1:5432 refused'), false);
  assert.equal(isRecoverableLocalDatabaseIncompatibility('FlywayMigrateException: syntax error in V8__new_feature.sql'), false);
  assert.equal(isRecoverableLocalDatabaseIncompatibility('A migration job was mentioned in an unrelated log line'), false);
});

test('database recovery accepts only the exact paired Compose-owned local volumes', () => {
  assert.equal(postgresVolumeName(project), 'taskpilot-checkout-1234_taskpilot-postgres-data');
  assert.equal(redisVolumeName(project), 'taskpilot-checkout-1234_taskpilot-redis-data');
  assert.deepEqual(recoveryVolumeNames(project), [
    'taskpilot-checkout-1234_taskpilot-postgres-data',
    'taskpilot-checkout-1234_taskpilot-redis-data',
  ]);
  assert.equal(classifyLocalPostgresVolume(ownedVolume('taskpilot-postgres-data'), project), 'owned-disposable-local');
  assert.equal(classifyLocalRedisVolume(ownedVolume('taskpilot-redis-data'), project), 'owned-disposable-local');
  assert.equal(classifyLocalRedisVolume(ownedVolume('taskpilot-postgres-data'), project), 'unowned');
  assert.equal(classifyLocalPostgresVolume(ownedVolume('taskpilot-postgres-data', { Name: 'another-volume' }), project), 'unowned');
  assert.equal(classifyLocalPostgresVolume(ownedVolume('taskpilot-postgres-data', { Labels: {
    'com.docker.compose.project': 'another-project',
    'com.docker.compose.volume': 'taskpilot-postgres-data',
  } }), project), 'unowned');
  assert.equal(classifyLocalPostgresVolume(ownedVolume('taskpilot-postgres-data', { Labels: {
    'com.docker.compose.project': project,
    'com.docker.compose.volume': 'another-volume',
  } }), project), 'unowned');
  assert.equal(classifyLocalPostgresVolume(null, project), 'unowned');
});


test('database recovery requires Flyway to report the exact checkout-local JDBC target', () => {
  assert.equal(startupUsedExpectedLocalDatabase(
    'Database: jdbc:postgresql://127.0.0.1:15432/taskpilot (PostgreSQL 17.10)',
    15432,
  ), true);
  assert.equal(startupUsedExpectedLocalDatabase(
    'Database: jdbc:postgresql://db.internal:5432/taskpilot (PostgreSQL 17.10)',
    15432,
  ), false);
  assert.equal(startupUsedExpectedLocalDatabase(
    'Database: jdbc:postgresql://127.0.0.1:5432/taskpilot (PostgreSQL 17.10)',
    15432,
  ), false);
});

test('database recovery retries once and never loops on a second failure', async () => {
  let attempts = 0;
  let recoveries = 0;
  await assert.rejects(
    withOneDatabaseRecovery(
      async () => {
        attempts += 1;
        throw new Error(`failure-${attempts}`);
      },
      () => true,
      async () => { recoveries += 1; },
    ),
    /failure-2/,
  );
  assert.equal(attempts, 2);
  assert.equal(recoveries, 1);
});

test('database recovery leaves unrelated startup failures untouched', async () => {
  const original = new Error('connection refused');
  let recoveries = 0;
  await assert.rejects(
    withOneDatabaseRecovery(
      async () => { throw original; },
      () => false,
      async () => { recoveries += 1; },
    ),
    error => error === original,
  );
  assert.equal(recoveries, 0);
});
