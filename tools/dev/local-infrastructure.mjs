import { spawnSync } from 'node:child_process';
import { ensureLocalEnvironment, localEnvironmentPath, repositoryRoot } from './local-environment.mjs';

const action = process.argv[2];
if (!['up', 'down'].includes(action)) throw new Error('Usage: local-infrastructure.mjs <up|down>');
ensureLocalEnvironment();
const command = ['compose', '--env-file', localEnvironmentPath];
if (action === 'up') command.push('up', '-d', '--wait');
else command.push('down');
const result = spawnSync('docker', command, { cwd: repositoryRoot, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
