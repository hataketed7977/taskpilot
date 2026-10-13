export const ALLOWED_TYPES = Object.freeze([
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'perf',
  'chore',
  'revert',
]);

const EXAMPLE = 'feat(auth): add GitHub sign-in';
const REVERT_EXAMPLE = 'revert(core-api): restore previous session behavior';

function invalid(rule, reason, subject, example = EXAMPLE) {
  return { valid: false, rule, reason, subject, example };
}

export function validateCommitMessage(message) {
  const subject = String(message).split(/\r?\n/, 1)[0];
  if (subject.length === 0) {
    return invalid('subject-required', 'commit subject must not be empty', subject);
  }
  if (/^Revert\s+["']/.test(subject)) {
    return invalid(
      'revert-format',
      'Git default Revert subjects are not exempt from the repository format',
      subject,
      REVERT_EXAMPLE,
    );
  }

  const match = /^([^\s(:!]+)(?:\(([^)]*)\))?(!?): (.*)$/.exec(subject);
  if (!match) {
    return invalid(
      'subject-format',
      'subject must match <type>(<optional-scope>)<optional-!>: <description>',
      subject,
    );
  }

  const [, type, scope, breaking, description] = match;
  if (!ALLOWED_TYPES.includes(type)) {
    return invalid(
      'type-allowed',
      `type ${JSON.stringify(type)} is not allowed; expected one of: ${ALLOWED_TYPES.join(', ')}`,
      subject,
    );
  }
  if (scope !== undefined && !/^[a-z0-9-]+$/.test(scope)) {
    return invalid(
      'scope-format',
      'scope must contain only lowercase letters, digits, and hyphens',
      subject,
    );
  }
  if (breaking !== '' && breaking !== '!') {
    return invalid('breaking-marker', 'breaking marker must be a single ! before the colon', subject);
  }
  if (description.length === 0) {
    return invalid('description-required', 'description must not be empty', subject);
  }
  if (!/^[a-z0-9]/.test(description)) {
    return invalid('description-start', 'description must start with a lowercase letter or digit', subject);
  }
  if (description.endsWith('.')) {
    return invalid('description-period', 'description must not end with a period', subject);
  }

  return { valid: true, subject, type, scope: scope ?? null, breaking: breaking === '!', description };
}

export function formatCommitMessageFailure(result) {
  return [
    '[commit-msg] rejected commit message',
    `Rule: ${result.rule}`,
    `Reason: ${result.reason}`,
    `Received: ${JSON.stringify(result.subject)}`,
    `Expected: <type>(<optional-scope>)<optional-!>: <description>`,
    `Example: ${result.example}`,
    'Next: edit the commit subject to match the expected format, then retry the commit.',
  ].join('\n');
}
