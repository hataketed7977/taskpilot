export async function coreApiHealth(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${url}/actuator/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    return (await response.json()).status === 'UP';
  } catch {
    return false;
  }
}

export async function mailpitHealth(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${url}/api/v1/info`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(check, { timeoutMs = 120_000, intervalMs = 1_000, isAlive } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isAlive && !isAlive()) throw new Error('Process exited before becoming healthy');
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Service did not become healthy within ${Math.round(timeoutMs / 1000)} seconds`);
}
