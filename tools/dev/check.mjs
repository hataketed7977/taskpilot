import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { childCommands, repositoryRoot } from './dev-config.mjs';

function run(command, args, label) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with code ${result.status}`);
}

try {
  const tests = readdirSync(path.join(repositoryRoot, 'tools', 'dev'))
    .filter(file => file.endsWith('.test.mjs'))
    .map(file => path.join('tools', 'dev', file));
  run(process.execPath, ['--test', ...tests], 'Launcher tests');
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  run(pnpm, ['--dir', repositoryRoot, '--filter', '@taskpilot/desktop', 'qualityCheck'], 'Desktop quality gate');
  const gradle = childCommands().gradleCompile;
  run(gradle.command, ['--project-dir', repositoryRoot, ':services:core-api:qualityCheck'], 'Core API quality gate');
  console.log('\nTaskPilot quality gates passed.');
} catch (error) {
  console.error(`TaskPilot quality check failed: ${error.message}`);
  process.exitCode = 1;
}
