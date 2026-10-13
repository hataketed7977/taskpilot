import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { messagePathFromArgv, runCommitMessageCli } from './commit-msg.mjs';

function capture() {
  let value = '';
  return { stream: { write(chunk) { value += chunk; } }, read: () => value };
}

test('message-file CLI accepts pnpm argument separator and direct Git hook argv', () => {
  assert.equal(messagePathFromArgv(['--', '/repo/COMMIT_EDITMSG']), '/repo/COMMIT_EDITMSG');
  assert.equal(messagePathFromArgv(['/repo/COMMIT_EDITMSG']), '/repo/COMMIT_EDITMSG');
  assert.equal(messagePathFromArgv([]), undefined);
});

test('message-file CLI validates only the subject and never modifies the file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-commit-msg-'));
  const messagePath = path.join(root, 'COMMIT_EDITMSG');
  const message = 'feat(hooks): validate commit subject\n\nbody remains unrestricted.\n';
  writeFileSync(messagePath, message);

  assert.equal(runCommitMessageCli(messagePath, { stderr: capture().stream }), 0);
  assert.equal(readFileSync(messagePath, 'utf8'), message);
});

test('message-file CLI returns actionable diagnostics for invalid and unreadable files', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'taskpilot-commit-msg-'));
  const messagePath = path.join(root, 'COMMIT_EDITMSG');
  writeFileSync(messagePath, 'feature: invalid type\n');
  const invalid = capture();
  assert.equal(runCommitMessageCli(messagePath, { stderr: invalid.stream }), 1);
  assert.match(invalid.read(), /Rule: type-allowed/);
  assert.match(invalid.read(), /Received: "feature: invalid type"/);
  assert.equal(readFileSync(messagePath, 'utf8'), 'feature: invalid type\n');

  const missing = capture();
  assert.equal(runCommitMessageCli(path.join(root, 'missing'), { stderr: missing.stream }), 1);
  assert.match(missing.read(), /Rule: message-file-readable/);
  assert.match(missing.read(), /Next: .*pnpm hooks:commit-msg/);
});
