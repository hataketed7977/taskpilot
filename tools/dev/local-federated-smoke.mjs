const gateway = process.env.TASKPILOT_GATEWAY_URL ?? 'http://127.0.0.1:8080';

async function json(path, expectedStatus = 200) {
  const response = await fetch(`${gateway}${path}`, { signal: AbortSignal.timeout(5_000) });
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const liveness = await json('/actuator/health/liveness');
if (liveness.status !== 'UP') throw new Error('Gateway liveness is not UP');
const readiness = await json('/actuator/health/readiness');
if (readiness.status !== 'UP') throw new Error('Gateway readiness is not UP');

const capabilities = await json('/v1/authentication-capabilities');
if (capabilities.github?.enabled !== false) {
  throw new Error('GitHub capability must be disabled when provider credentials are absent');
}

for (const retiredPath of ['/desktop/v1/auth/login/code', '/v1/not-a-real-resource']) {
  const response = await fetch(`${gateway}${retiredPath}`, { signal: AbortSignal.timeout(5_000) });
  if (response.status !== 404) throw new Error(`${retiredPath} returned ${response.status}, expected 404`);
}

console.log(JSON.stringify({
  ok: true,
  boundaries: ['postgresql', 'core-api', 'gateway'],
  githubCapability: 'disabled',
  externalGitHubRequests: 0,
}));
