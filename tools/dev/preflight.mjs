import { spawnSync } from 'node:child_process';
import net from 'node:net';

export function parseMajorVersion(text) {
  const match = String(text).match(/(?:version\s+\"?|v)(\d+)|^(\d+)/im);
  return match ? Number(match[1] ?? match[2]) : null;
}

export function parsePnpmVersion(text) {
  return String(text).trim().match(/^(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function supportsNodeVersion(text) {
  const match = String(text).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 12);
}

function execute(command, args = []) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    error: result.error,
  };
}

export function prerequisiteChecks({ run = execute, nodeVersion = process.version, expectedPnpm = '11.9.0' } = {}) {
  const checks = [];
  checks.push({ name: 'Node.js', ok: supportsNodeVersion(nodeVersion), detail: `${nodeVersion} (requires 22.12+)` });

  const pnpm = run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version']);
  const pnpmVersion = parsePnpmVersion(pnpm.output);
  checks.push({ name: 'pnpm', ok: pnpm.ok && pnpmVersion === expectedPnpm, detail: pnpmVersion ?? (pnpm.output || 'not found') });

  const java = run('java', ['-version']);
  const javaMajor = parseMajorVersion(java.output);
  checks.push({ name: 'JDK', ok: java.ok && javaMajor === 21, detail: javaMajor ? `Java ${javaMajor}` : java.output || 'not found' });

  const docker = run('docker', ['--version']);
  checks.push({ name: 'Docker CLI', ok: docker.ok, detail: docker.output || 'not found' });
  const compose = run('docker', ['compose', 'version']);
  checks.push({ name: 'Docker Compose', ok: compose.ok, detail: compose.output || 'not found' });
  const daemon = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  checks.push({ name: 'Docker daemon', ok: daemon.ok, detail: daemon.output || 'not reachable' });
  return checks;
}

export function assertPrerequisites(options) {
  const checks = prerequisiteChecks(options);
  const failures = checks.filter(check => !check.ok);
  if (failures.length) {
    throw new Error(`Local development prerequisites failed:\n${failures.map(item => `- ${item.name}: ${item.detail}`).join('\n')}\nRun pnpm dev:doctor for the complete diagnosis.`);
  }
  return checks;
}

export function isPortOpen(port, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise(resolve => {
    const socket = net.createConnection({ port, host });
    const finish = value => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

export function portConflictMessage(port, purpose) {
  return `Port ${port} required by ${purpose} is already in use by an unrecognized process. TaskPilot will not stop or reuse it; run pnpm dev:doctor and free or reconfigure the port.`;
}
