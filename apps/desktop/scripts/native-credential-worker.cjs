const path = require('node:path');

const [appAsar, service, operation] = process.argv.slice(2);
if (!appAsar || !service || !operation) {
  throw new Error('Usage: native-credential-worker.cjs <app.asar> <service> <operation>');
}

const { AsyncEntry } = require(path.join(appAsar, 'node_modules/@napi-rs/keyring'));
const account = 'credential-lifecycle';
const entry = () => new AsyncEntry(service, account);

async function lifecycle() {
  await entry().setPassword('taskpilot-native-smoke-v1');
  if (await entry().getPassword() !== 'taskpilot-native-smoke-v1') {
    throw new Error('Native credential restore mismatch');
  }
  await entry().setPassword('taskpilot-native-smoke-v2');
  if (await entry().getPassword() !== 'taskpilot-native-smoke-v2') {
    throw new Error('Native credential rotation mismatch');
  }
  if (!await entry().deletePassword()) {
    throw new Error('Native credential deletion reported a missing credential');
  }
}

async function verifyDeleted() {
  const remaining = await entry().getPassword();
  if (remaining != null) {
    await entry().deletePassword().catch(() => undefined);
    throw new Error('Native credential remained available in a fresh packaged process');
  }
}

const run = operation === 'lifecycle' ? lifecycle : operation === 'verify-deleted' ? verifyDeleted : undefined;
if (!run) throw new Error(`Unsupported operation: ${operation}`);

run()
  .then(() => console.log(JSON.stringify({ ok: true, operation })))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
