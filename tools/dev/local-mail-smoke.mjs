import { randomBytes, randomUUID } from 'node:crypto';

const coreApi = process.env.TASKPILOT_CORE_API_URL ?? 'http://127.0.0.1:8080';
const mailpit = process.env.TASKPILOT_MAILPIT_URL ?? 'http://127.0.0.1:8025';
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `local-smoke-${suffix}@example.test`;
const deviceInstallationId = `local-smoke-${randomUUID()}`;
const originalPassword = `TaskPilot local ${suffix}!`;
const newPassword = `TaskPilot reset ${suffix}!`;

async function api(path, body, expectedStatus) {
  const response = await fetch(`${coreApi}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== expectedStatus) {
    const problem = await response.text();
    throw new Error(`${path} returned ${response.status}: ${problem}`);
  }
  return response.status === 204 ? undefined : response.json();
}

async function nextCode(subject, previousIds = new Set()) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpit}/api/v1/messages`);
    if (!response.ok) throw new Error(`Mailpit returned ${response.status}`);
    const messages = (await response.json()).messages ?? [];
    for (const message of messages) {
      if (previousIds.has(message.ID) || message.Subject !== subject) continue;
      const recipients = [...(message.To ?? []), ...(message.Cc ?? []), ...(message.Bcc ?? [])];
      if (!recipients.some(recipient => recipient.Address === email)) continue;
      const detailResponse = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(message.ID)}`);
      if (!detailResponse.ok) throw new Error(`Mailpit message lookup returned ${detailResponse.status}`);
      const detail = await detailResponse.json();
      const code = String(detail.Text ?? detail.HTML ?? '').match(/\b\d{6}\b/)?.[0];
      if (!code) throw new Error(`Verification code missing from ${subject}`);
      return { code, id: message.ID };
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${subject}`);
}

const seen = new Set();
const registration = await api('/desktop/v1/auth/registration/code', { email, deviceInstallationId }, 202);
const registrationMail = await nextCode('TaskPilot registration code', seen);
seen.add(registrationMail.id);
const registrationContinuation = await api('/desktop/v1/auth/registration/code/verify', {
  challengeId: registration.challengeId,
  email,
  code: registrationMail.code,
  deviceInstallationId,
}, 200);
await api('/desktop/v1/auth/registration', {
  continuationId: registrationContinuation.continuationId,
  continuationSecret: registrationContinuation.continuationSecret,
  email,
  displayName: 'Local Smoke',
  password: originalPassword,
  termsVersion: '2026-09-01',
}, 201);

const login = await api('/desktop/v1/auth/login/code', { email, deviceInstallationId }, 202);
const loginMail = await nextCode('TaskPilot login code', seen);
seen.add(loginMail.id);
await api('/desktop/v1/auth/login/code/verify', {
  challengeId: login.challengeId,
  email,
  code: loginMail.code,
  deviceInstallationId,
}, 200);

const reset = await api('/desktop/v1/auth/password-reset/code', { email, deviceInstallationId }, 202);
const resetMail = await nextCode('TaskPilot password reset code', seen);
const resetContinuation = await api('/desktop/v1/auth/password-reset/code/verify', {
  challengeId: reset.challengeId,
  email,
  code: resetMail.code,
  deviceInstallationId,
}, 200);
await api('/desktop/v1/auth/password-reset', {
  continuationId: resetContinuation.continuationId,
  continuationSecret: resetContinuation.continuationSecret,
  email,
  newPassword,
}, 204);
await api('/desktop/v1/auth/login/password', { email, password: newPassword }, 200);

console.log(JSON.stringify({
  ok: true,
  boundaries: ['core-api', 'postgresql', 'smtp', 'mailpit'],
  flows: ['registration', 'login-otp', 'password-reset'],
}));
