import assert from 'node:assert/strict';
import test from 'node:test';
import { ALLOWED_TYPES, formatCommitMessageFailure, validateCommitMessage } from './commit-message.mjs';

for (const type of ALLOWED_TYPES) {
  test(`accepts allowed type ${type}`, () => {
    assert.equal(validateCommitMessage(`${type}: valid description`).valid, true);
  });
}

test('accepts scope, breaking marker, digits, and ignores body/footer', () => {
  const result = validateCommitMessage('feat(core-api)!: 2 sessions replace one\n\nBREAKING CHANGE: details');
  assert.deepEqual(result, {
    valid: true,
    subject: 'feat(core-api)!: 2 sessions replace one',
    type: 'feat',
    scope: 'core-api',
    breaking: true,
    description: '2 sessions replace one',
  });
});

test('accepts repository-formatted revert and rejects Git default Revert subject', () => {
  assert.equal(validateCommitMessage('revert(core-api): restore previous session behavior').valid, true);
  const result = validateCommitMessage('Revert "feat(core-api): replace session contract"');
  assert.equal(result.valid, false);
  assert.equal(result.rule, 'revert-format');
  assert.match(result.example, /^revert\(/);
});

const invalidCases = [
  ['feature: invalid type', 'type-allowed'],
  ['feat(Core): uppercase scope', 'scope-format'],
  ['feat(core_api): underscore scope', 'scope-format'],
  ['feat(core api): spaced scope', 'scope-format'],
  ['feat: ', 'description-required'],
  ['feat: Uppercase description', 'description-start'],
  ['feat: trailing period.', 'description-period'],
  ['feat no colon', 'subject-format'],
  ['', 'subject-required'],
  ['fixup! feat: original', 'subject-format'],
  ['squash! feat: original', 'subject-format'],
  ['Merge branch main', 'subject-format'],
];

for (const [subject, rule] of invalidCases) {
  test(`rejects ${JSON.stringify(subject)} with ${rule}`, () => {
    const result = validateCommitMessage(subject);
    assert.equal(result.valid, false);
    assert.equal(result.rule, rule);
    const output = formatCommitMessageFailure(result);
    assert.match(output, new RegExp(`Rule: ${rule}`));
    assert.match(output, /Received:/);
    assert.match(output, /Example:/);
    assert.match(output, /Next:/);
  });
}
