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
      platform: 'macOS arm64',
    };
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    const resources = path.join(projectDir, 'release/win-unpacked/resources');
    return {
      executable: path.join(projectDir, 'release/win-unpacked/TaskPilot.exe'),
      appAsar: path.join(resources, 'app.asar'),
      platform: 'Windows x64',
    };
  }
  throw new Error(`Packaged first-use smoke supports macOS arm64 and Windows x64, received ${process.platform} ${process.arch}`);
})();

for (const artifact of [target.executable, target.appAsar]) {
  if (!existsSync(artifact)) throw new Error(`Missing packaged artifact: ${artifact}`);
}
if (!process.env.TASKPILOT_SYSTEM_BASE_URL || !process.env.TASKPILOT_SYSTEM_FIXTURE_TOKEN) {
  throw new Error('Packaged first-use smoke requires the isolated system fixture environment');
}

const worker = path.join(projectDir, 'scripts/packaged-first-use-worker.mjs');
const result = spawnSync(target.executable, [worker, target.appAsar, target.platform], {
  encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  maxBuffer: 1024 * 1024,
});
if (result.status !== 0) {
  throw new Error(`Packaged first-use worker failed: ${result.stderr || result.stdout}`);
}
const evidence = JSON.parse(result.stdout.trim());
if (evidence.ok !== true || evidence.artifact !== 'app.asar' || evidence.platform !== target.platform) {
  throw new Error('Packaged first-use worker returned invalid evidence');
}
console.log(JSON.stringify(evidence));
