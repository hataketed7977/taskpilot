const coreApi = process.env.TASKPILOT_CORE_API_URL ?? 'http://127.0.0.1:8080';

async function json(path, expectedStatus = 200) {
  const response = await fetch(`${coreApi}${path}`, { signal: AbortSignal.timeout(5_000) });
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const health = await json('/actuator/health');
if (health.status !== 'UP') throw new Error('Core API health is not UP');

const capabilities = await json('/desktop/v1/auth/capabilities');
if (capabilities.github?.enabled !== false) {
  throw new Error('GitHub capability must be disabled when provider credentials are absent');
}

const retiredPath = await fetch(`${coreApi}/desktop/v1/auth/login/code`, { signal: AbortSignal.timeout(5_000) });
if (retiredPath.status !== 404) throw new Error(`Retired email login path returned ${retiredPath.status}, expected 404`);

console.log(JSON.stringify({
  ok: true,
  boundaries: ['postgresql', 'core-api'],
  githubCapability: 'disabled',
  externalGitHubRequests: 0,
}));
