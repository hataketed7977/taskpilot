import path from 'node:path';

export const GATE_ORDER = Object.freeze(['hook-tooling', 'dev-tooling', 'desktop', 'core-api']);

const ROOT_PNPM_PATHS = new Set(['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']);
const ROOT_GRADLE_PATHS = new Set(['build.gradle.kts', 'settings.gradle.kts', 'gradlew', 'gradlew.bat']);
const DEV_PATHS = new Set(['compose.yaml', '.env.local.example']);
const EXEMPT_METADATA = new Set(['.gitignore']);
const EXEMPT_DOC_ASSET_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp']);

function startsWith(pathname, prefix) {
  return pathname === prefix.slice(0, -1) || pathname.startsWith(prefix);
}

export function classifyPath(pathname) {
  if (
    pathname.endsWith('.md') ||
    startsWith(pathname, 'openspec/') ||
    startsWith(pathname, '.agents/') ||
    (startsWith(pathname, 'docs/') && EXEMPT_DOC_ASSET_EXTENSIONS.has(path.extname(pathname).toLowerCase())) ||
    EXEMPT_METADATA.has(pathname)
  ) {
    return { kind: 'exempt', gates: [] };
  }
  if (startsWith(pathname, '.githooks/') || startsWith(pathname, 'tools/git-hooks/')) {
    return { kind: 'gate', gates: ['hook-tooling'] };
  }
  if (startsWith(pathname, 'tools/dev/') || DEV_PATHS.has(pathname)) {
    return { kind: 'gate', gates: ['dev-tooling'] };
  }
  if (ROOT_PNPM_PATHS.has(pathname)) {
    return { kind: 'gate', gates: ['hook-tooling', 'dev-tooling', 'desktop'] };
  }
  if (startsWith(pathname, 'apps/desktop/')) {
    return { kind: 'gate', gates: ['desktop'] };
  }
  if (startsWith(pathname, 'services/core-api/')) {
    return { kind: 'gate', gates: ['core-api'] };
  }
  if (ROOT_GRADLE_PATHS.has(pathname) || startsWith(pathname, 'gradle/')) {
    return { kind: 'gate', gates: ['core-api'] };
  }
  return { kind: 'unknown', gates: [] };
}

export function planGates(records, classify = classifyPath) {
  const triggers = new Map(GATE_ORDER.map(gate => [gate, new Set()]));
  const exempt = new Set();
  const unknown = new Set();

  for (const record of records) {
    const paths = record.status === 'C' ? [record.paths[1]] : record.paths;
    for (const pathname of paths) {
      const result = classify(pathname);
      if (result.kind === 'exempt') exempt.add(pathname);
      else if (result.kind === 'unknown') unknown.add(pathname);
      else for (const gate of result.gates) triggers.get(gate).add(pathname);
    }
  }

  return {
    gates: GATE_ORDER.filter(gate => triggers.get(gate).size > 0),
    triggers,
    exempt: [...exempt],
    unknown: [...unknown],
  };
}

export function pathPollutesSelectedGates(pathname, gates) {
  const classification = classifyPath(pathname);
  return classification.kind === 'gate' && classification.gates.some(gate => gates.includes(gate));
}

export function gateRegistry(root, platform = process.platform) {
  const pnpm = platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const gradle = platform === 'win32' ? path.win32.join(root, 'gradlew.bat') : path.join(root, 'gradlew');
  return new Map([
    ['hook-tooling', { command: pnpm, args: ['hooks:test'] }],
    ['dev-tooling', { command: pnpm, args: ['dev:test'] }],
    ['desktop', { command: pnpm, args: ['--filter', '@taskpilot/desktop', 'qualityCheck'] }],
    ['core-api', { command: gradle, args: ['--no-daemon', ':services:core-api:qualityCheck'] }],
  ]);
}
