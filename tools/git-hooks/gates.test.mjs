import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPath, gateRegistry, pathPollutesSelectedGates, planGates } from './gates.mjs';

const cases = [
  ['apps/desktop/src/main.ts', ['desktop']],
  ['apps/desktop/tests/example.test.ts', ['desktop']],
  ['apps/desktop/AGENTS.md', []],
  ['services/core-api/src/main/kotlin/App.kt', ['core-api']],
  ['services/core-api/src/main/resources/db/migration/V1.sql', ['core-api']],
  ['services/core-api/docs/testing-strategy.md', []],
  ['tools/dev/dev.mjs', ['dev-tooling']],
  ['compose.yaml', ['dev-tooling']],
  ['.env.local.example', ['dev-tooling']],
  ['tools/git-hooks/gates.mjs', ['hook-tooling']],
  ['.githooks/pre-commit', ['hook-tooling']],
  ['package.json', ['hook-tooling', 'dev-tooling', 'desktop']],
  ['pnpm-lock.yaml', ['hook-tooling', 'dev-tooling', 'desktop']],
  ['settings.gradle.kts', ['core-api']],
  ['gradle/libs.versions.toml', ['core-api']],
  ['README.md', []],
  ['openspec/config.yaml', []],
  ['.agents/skills/.openspec-target', []],
  ['.gitignore', []],
];

for (const [pathname, expected] of cases) {
  test(`maps ${pathname}`, () => {
    const result = classifyPath(pathname);
    assert.deepEqual(result.gates, expected);
    assert.equal(result.kind, expected.length ? 'gate' : 'exempt');
  });
}

test('unknown paths fail closed', () => {
  assert.deepEqual(classifyPath('apps/new-runtime/src/index.ts'), { kind: 'unknown', gates: [] });
});

test('rename selects source and target while copy selects only target', () => {
  const rename = planGates([{ status: 'R', paths: ['apps/desktop/source.ts', 'tools/dev/target.mjs'] }]);
  assert.deepEqual(rename.gates, ['dev-tooling', 'desktop']);

  const copy = planGates([{ status: 'C', paths: ['apps/desktop/source.ts', 'tools/dev/target.mjs'] }]);
  const added = planGates([{ status: 'A', paths: ['tools/dev/target.mjs'] }]);
  assert.deepEqual(copy.gates, ['dev-tooling']);
  assert.deepEqual(copy.gates, added.gates);
});

test('deduplicates gates and preserves fixed order', () => {
  const plan = planGates([
    { status: 'M', paths: ['services/core-api/build.gradle.kts'] },
    { status: 'M', paths: ['apps/desktop/src/main.ts'] },
    { status: 'M', paths: ['package.json'] },
  ]);
  assert.deepEqual(plan.gates, ['hook-tooling', 'dev-tooling', 'desktop', 'core-api']);
  assert.deepEqual([...plan.triggers.get('desktop')], ['apps/desktop/src/main.ts', 'package.json']);
});

test('pollution is scoped to selected gates and shared paths', () => {
  assert.equal(pathPollutesSelectedGates('services/core-api/src/App.kt', ['desktop']), false);
  assert.equal(pathPollutesSelectedGates('apps/desktop/src/App.tsx', ['desktop']), true);
  assert.equal(pathPollutesSelectedGates('package.json', ['desktop']), true);
  assert.equal(pathPollutesSelectedGates('apps/desktop/notes.md', ['desktop']), false);
});

test('registry selects platform-specific logical commands', () => {
  const windows = gateRegistry('C:\\repo', 'win32');
  assert.equal(windows.get('desktop').command, 'pnpm.cmd');
  assert.equal(windows.get('core-api').command, 'C:\\repo\\gradlew.bat');
  const mac = gateRegistry('/repo', 'darwin');
  assert.equal(mac.get('desktop').command, 'pnpm');
  assert.equal(mac.get('core-api').command, '/repo/gradlew');
});
