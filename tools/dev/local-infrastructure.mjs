import { runCli } from './dev.mjs';

const action = process.argv[2];
if (!['up', 'down'].includes(action)) throw new Error('Usage: local-infrastructure.mjs <up|down>');
await runCli([action === 'up' ? 'infra-up' : 'infra-down']);
