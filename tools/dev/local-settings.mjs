import { createHash } from 'node:crypto';
import path from 'node:path';

export function checkoutIdentity(root) {
  const resolved = path.resolve(root);
  const hash = createHash('sha256').update(resolved).digest('hex').slice(0, 8);
  const name = path.basename(resolved).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'checkout';
  return { hash, name, composeProject: `taskpilot-${name}-${hash}` };
}

export function defaultLocalSettings(root) {
  const identity = checkoutIdentity(root);
  const slot = Number.parseInt(identity.hash.slice(0, 8), 16) % 10_000;
  return {
    TASKPILOT_COMPOSE_PROJECT: identity.composeProject,
    TASKPILOT_POSTGRES_PORT: String(15_000 + slot),
    TASKPILOT_REDIS_PORT: String(25_000 + slot),
    TASKPILOT_CORE_API_PORT: String(45_000 + slot),
    TASKPILOT_DESKTOP_DEV_SERVER_PORT: String(55_000 + slot),
  };
}
