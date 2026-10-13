import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNameStatus, pathsForClassification, pathsForPollution } from './staged-changes.mjs';

const onePathStatuses = ['A', 'M', 'D', 'T', 'U', 'X', 'B'];
for (const status of onePathStatuses) {
  test(`parses ${status} record`, () => {
    assert.deepEqual(parseNameStatus(Buffer.from(`${status}\0path with space\0`)), [
      { status, rawStatus: status, paths: ['path with space'] },
    ]);
  });
}

test('parses rename and copy records with scores and special filenames', () => {
  const records = parseNameStatus(Buffer.from('R100\0old\nname\0new name\0C075\0source\0target\nfile\0'));
  assert.deepEqual(records, [
    { status: 'R', rawStatus: 'R100', paths: ['old\nname', 'new name'] },
    { status: 'C', rawStatus: 'C075', paths: ['source', 'target\nfile'] },
  ]);
  assert.deepEqual(pathsForClassification(records[0]), ['old\nname', 'new name']);
  assert.deepEqual(pathsForClassification(records[1]), ['target\nfile']);
  assert.deepEqual(pathsForPollution(records[1]), ['target\nfile']);
});

test('rejects malformed or unsupported records', () => {
  assert.throws(() => parseNameStatus(Buffer.from('R100\0only-source\0')), /incomplete/);
  assert.throws(() => parseNameStatus(Buffer.from('Z\0path\0')), /unsupported/);
});
