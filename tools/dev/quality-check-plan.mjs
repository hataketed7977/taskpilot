import path from 'node:path';
import process from 'node:process';
import { childCommands } from './dev-config.mjs';

export function qualityCheckPlan(root, platform = process.platform) {
  const pnpm = platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const gradle = childCommands(platform, root).coreApiCompile.command;
  return [
    {
      command: process.execPath,
      args: ['--test', path.join(root, 'tools', 'dev', '*.test.mjs')],
      label: 'Launcher tests',
      expandDevTests: true,
    },
    {
      command: pnpm,
      args: ['--dir', root, 'hooks:test'],
      label: 'Git hook tests',
    },
    {
      command: pnpm,
      args: ['--dir', root, '--filter', '@taskpilot/desktop', 'qualityCheck'],
      label: 'Desktop quality gate',
    },
    {
      command: gradle,
      args: ['--project-dir', root, '--no-daemon', ':contracts:canonical-api:qualityCheck'],
      label: 'Canonical API contract quality gate',
    },
    {
      command: gradle,
      args: ['--project-dir', root, '--no-daemon', ':services:core-api:qualityCheck'],
      label: 'Core API quality gate',
    },
    {
      command: gradle,
      args: ['--project-dir', root, '--no-daemon', ':services:gateway:qualityCheck'],
      label: 'Gateway quality gate',
    },
  ];
}
