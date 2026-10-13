#!/usr/bin/env node
import process from 'node:process';
import { repositoryRoot } from './git.mjs';
import { runPreCommit } from './pre-commit-core.mjs';

let root;
try {
  root = repositoryRoot();
  process.exitCode = runPreCommit({ root });
} catch (error) {
  process.stderr.write([
    '[pre-commit / repository] rejected commit',
    `Reason: ${error.message}`,
    'Next: run this command from a valid TaskPilot checkout and retry.',
    '',
  ].join('\n'));
  process.exitCode = 1;
}
