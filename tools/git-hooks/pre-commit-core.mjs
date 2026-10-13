import { spawnSync } from 'node:child_process';
import { GATE_ORDER, gateRegistry, pathPollutesSelectedGates, planGates } from './gates.mjs';
import { pathsForPollution, readStagedRecords, readUnstagedRecords, readUntrackedPaths } from './staged-changes.mjs';

function displayPath(pathname) {
  return JSON.stringify(pathname);
}

function displayCommand(command, args) {
  return [command, ...args].map(value => JSON.stringify(value)).join(' ');
}

export function findPollution(root, gates, adapters = {}) {
  const unstagedRecords = (adapters.readUnstagedRecords ?? readUnstagedRecords)(root);
  const untrackedPaths = (adapters.readUntrackedPaths ?? readUntrackedPaths)(root);
  const tracked = [...new Set(unstagedRecords.flatMap(pathsForPollution))]
    .filter(pathname => pathPollutesSelectedGates(pathname, gates));
  const untracked = [...new Set(untrackedPaths)]
    .filter(pathname => pathPollutesSelectedGates(pathname, gates));
  return { tracked, untracked };
}

const WINDOWS_COMMAND_META = /([()\][%!^"`<>&|;, *?])/g;

function escapeWindowsCommand(value) {
  return String(value).replace(WINDOWS_COMMAND_META, '^$1');
}

function escapeWindowsArgument(value) {
  let escaped = String(value);
  escaped = escaped.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/g, '$1$1');
  escaped = `"${escaped}"`;
  return escaped.replace(WINDOWS_COMMAND_META, '^$1');
}

function windowsCommandShell(environment) {
  const key = Object.keys(environment).find(name => name.toLowerCase() === 'comspec');
  return key ? environment[key] : 'cmd.exe';
}

export function spawnGate(command, args, {
  root,
  spawn = spawnSync,
  environment = process.env,
  platform = process.platform,
}) {
  const options = {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  };
  if (platform !== 'win32' || !/\.(?:bat|cmd)$/i.test(command)) {
    return spawn(command, args, options);
  }

  const commandLine = [escapeWindowsCommand(command), ...args.map(escapeWindowsArgument)].join(' ');
  return spawn(windowsCommandShell(environment), ['/d', '/s', '/c', `"${commandLine}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

function failureSummary(gates, passed, failed) {
  const failedIndex = gates.indexOf(failed);
  const notRun = failedIndex === -1 ? [] : gates.slice(failedIndex + 1);
  return [
    `Passed: ${passed.length ? passed.join(', ') : 'none'}`,
    `Failed: ${failed ?? 'none'}`,
    `Not run: ${notRun.length ? notRun.join(', ') : 'none'}`,
  ].join('\n');
}

export function runPreCommit({
  root,
  platform = process.platform,
  readStaged = readStagedRecords,
  pollutionAdapters,
  runner = spawnGate,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let records;
  try {
    records = readStaged(root);
  } catch (error) {
    stderr.write([
      '[pre-commit / staged-path analysis] rejected commit',
      `Reason: ${error.message}`,
      'Next: resolve the reported Git index error and rerun pnpm hooks:pre-commit.',
      '',
    ].join('\n'));
    return 1;
  }

  if (records.length === 0) {
    stdout.write('[pre-commit] no staged paths; no module quality gate selected\n');
    return 0;
  }

  const plan = planGates(records);
  if (plan.unknown.length > 0) {
    stderr.write([
      '[pre-commit / module mapping] rejected commit',
      'Reason: staged paths are not mapped to a quality gate or explicit exemption',
      ...plan.unknown.map(pathname => `- ${displayPath(pathname)}`),
      'Next: update tools/git-hooks/gates.mjs and its mapping tests for the owning module.',
      '',
    ].join('\n'));
    return 1;
  }

  if (plan.gates.length === 0) {
    stdout.write('[pre-commit] only explicitly exempt paths are staged; no module quality gate selected\n');
    for (const pathname of plan.exempt) stdout.write(`- ${displayPath(pathname)}\n`);
    return 0;
  }

  let pollution;
  try {
    pollution = findPollution(root, plan.gates, pollutionAdapters);
  } catch (error) {
    stderr.write([
      '[pre-commit / workspace purity] rejected commit',
      `Reason: ${error.message}`,
      'Next: resolve the reported Git worktree error and rerun pnpm hooks:pre-commit.',
      '',
    ].join('\n'));
    return 1;
  }
  if (pollution.tracked.length > 0 || pollution.untracked.length > 0) {
    const lines = [
      '[pre-commit / workspace purity] rejected commit',
      'Reason: affected module tests would read worktree content that is not in the staged snapshot.',
    ];
    if (pollution.tracked.length) {
      lines.push('Tracked unstaged paths:', ...pollution.tracked.map(pathname => `- ${displayPath(pathname)}`));
    }
    if (pollution.untracked.length) {
      lines.push('Untracked paths:', ...pollution.untracked.map(pathname => `- ${displayPath(pathname)}`));
    }
    lines.push('Next: stage, restore, or move these paths, then retry the commit.', '');
    stderr.write(lines.join('\n'));
    return 1;
  }

  const registry = gateRegistry(root, platform);
  const passed = [];
  for (const gate of plan.gates) {
    const entry = registry.get(gate);
    const triggers = [...plan.triggers.get(gate)];
    stdout.write(`\n[pre-commit / ${gate} quality gate]\n`);
    stdout.write(`Command: ${displayCommand(entry.command, entry.args)}\n`);
    stdout.write(`Triggered by:\n${triggers.map(pathname => `- ${displayPath(pathname)}`).join('\n')}\n`);

    const result = runner(entry.command, entry.args, { root, gate, platform });
    if (result.error) {
      stderr.write([
        `[pre-commit / ${gate} quality gate] rejected commit`,
        `Reason: unable to start command: ${result.error.message}`,
        `Command: ${displayCommand(entry.command, entry.args)}`,
        `Triggered by: ${triggers.map(displayPath).join(', ')}`,
        'Next: install the required tool and rerun the command shown above.',
        failureSummary(plan.gates, passed, gate),
        '',
      ].join('\n'));
      return 1;
    }
    if (result.signal) {
      stderr.write([
        `[pre-commit / ${gate} quality gate] rejected commit`,
        `Reason: command terminated by signal ${result.signal}`,
        `Command: ${displayCommand(entry.command, entry.args)}`,
        `Triggered by: ${triggers.map(displayPath).join(', ')}`,
        'Next: rerun the command shown above and inspect its output.',
        failureSummary(plan.gates, passed, gate),
        '',
      ].join('\n'));
      return 1;
    }
    if (result.status !== 0) {
      stderr.write([
        `[pre-commit / ${gate} quality gate] rejected commit`,
        `Reason: command exited with code ${result.status}`,
        `Command: ${displayCommand(entry.command, entry.args)}`,
        `Triggered by: ${triggers.map(displayPath).join(', ')}`,
        'Next: fix the reported failures and rerun the command shown above.',
        failureSummary(plan.gates, passed, gate),
        '',
      ].join('\n'));
      return 1;
    }
    passed.push(gate);
  }

  stdout.write(`\n[pre-commit] selected quality gates passed\n${failureSummary(plan.gates, passed, null)}\n`);
  return 0;
}

export { GATE_ORDER };
