#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { formatCommitMessageFailure, validateCommitMessage } from './commit-message.mjs';

export function messagePathFromArgv(argv) {
  return argv[0] === '--' ? argv[1] : argv[0];
}

export function runCommitMessageCli(messagePath, { stderr = process.stderr } = {}) {
  if (!messagePath) {
    stderr.write([
      '[commit-msg] rejected commit message',
      'Rule: message-file-required',
      'Reason: Git message file path was not provided',
      'Next: run pnpm hooks:commit-msg -- <message-file> with the Git commit message file.',
      '',
    ].join('\n'));
    return 1;
  }
  let message;
  try {
    message = readFileSync(messagePath, 'utf8');
  } catch (error) {
    stderr.write([
      '[commit-msg] rejected commit message',
      'Rule: message-file-readable',
      `Reason: ${error.message}`,
      'Next: verify the message-file path is readable, then rerun pnpm hooks:commit-msg -- <message-file>.',
      '',
    ].join('\n'));
    return 1;
  }
  const result = validateCommitMessage(message);
  if (!result.valid) {
    stderr.write(`${formatCommitMessageFailure(result)}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCommitMessageCli(messagePathFromArgv(process.argv.slice(2)));
}
