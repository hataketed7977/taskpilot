import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = (() => {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    const resources = path.join(projectDir, 'release/mac-arm64/TaskPilot.app/Contents/Resources');
    return {
      executable: path.join(projectDir, 'release/mac-arm64/TaskPilot.app/Contents/MacOS/TaskPilot'),
      appAsar: path.join(resources, 'app.asar'),
      nativeBinary: path.join(resources, 'app.asar.unpacked/node_modules/@napi-rs/keyring-darwin-arm64/keyring.darwin-arm64.node'),
      platform: 'macOS arm64',
    };
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    const resources = path.join(projectDir, 'release/win-unpacked/resources');
    return {
      executable: path.join(projectDir, 'release/win-unpacked/TaskPilot.exe'),
      appAsar: path.join(resources, 'app.asar'),
      nativeBinary: path.join(resources, 'app.asar.unpacked/node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node'),
      platform: 'Windows x64',
    };
  }
  throw new Error(`Native credential smoke supports macOS arm64 and Windows x64, received ${process.platform} ${process.arch}`);
})();

for (const artifact of [target.executable, target.appAsar, target.nativeBinary]) {
  if (!existsSync(artifact)) throw new Error(`Missing packaged artifact: ${artifact}`);
}

const worker = path.join(projectDir, 'scripts/native-credential-worker.cjs');
const service = `ai.taskpilot.desktop.native-smoke.${randomUUID()}`;
const execute = (operation) => spawnSync(
  target.executable,
  [worker, target.appAsar, service, operation],
  {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
);

let lifecycle;
let verification;
try {
  lifecycle = execute('lifecycle');
  if (lifecycle.status !== 0) {
    throw new Error(`Packaged lifecycle failed: ${lifecycle.stderr || lifecycle.stdout}`);
  }
  verification = execute('verify-deleted');
  if (verification.status !== 0) {
    throw new Error(`Fresh-process deletion check failed: ${verification.stderr || verification.stdout}`);
  }
} finally {
  if (verification?.status !== 0 || lifecycle?.status !== 0) execute('verify-deleted');
}

console.log(JSON.stringify({
  ok: true,
  platform: target.platform,
  lifecycle: ['write', 'fresh-process-restore', 'rotate', 'delete'],
}));
