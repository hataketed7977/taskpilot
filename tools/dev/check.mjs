import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { qualityCheckPlan } from './quality-check-plan.mjs';
import { repositoryRoot } from './dev-config.mjs';

function run(command, args, label) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with code ${result.status}`);
}

try {
  for (const step of qualityCheckPlan(repositoryRoot)) {
    const args = step.expandDevTests
      ? [
          '--test',
          ...readdirSync(path.join(repositoryRoot, 'tools', 'dev'))
            .filter(file => file.endsWith('.test.mjs'))
            .map(file => path.join('tools', 'dev', file)),
        ]
      : step.args;
    run(step.command, args, step.label);
  }
  console.log('\nTaskPilot quality gates passed.');
} catch (error) {
  console.error(`TaskPilot quality check failed: ${error.message}`);
  process.exitCode = 1;
}
