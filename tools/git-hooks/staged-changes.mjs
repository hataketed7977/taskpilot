import { runGit } from './git.mjs';

function nulFields(output) {
  const fields = Buffer.isBuffer(output) ? output.toString('utf8').split('\0') : String(output).split('\0');
  if (fields.at(-1) === '') fields.pop();
  return fields;
}

export function parseNameStatus(output) {
  const fields = nulFields(output);
  const records = [];
  for (let index = 0; index < fields.length;) {
    const rawStatus = fields[index++];
    const status = rawStatus[0];
    if (!'ACMRDTUXB'.includes(status)) {
      throw new Error(`unsupported git name-status record: ${JSON.stringify(rawStatus)}`);
    }
    const pathCount = status === 'R' || status === 'C' ? 2 : 1;
    if (index + pathCount > fields.length) {
      throw new Error(`incomplete git name-status record for ${JSON.stringify(rawStatus)}`);
    }
    const paths = fields.slice(index, index + pathCount);
    index += pathCount;
    records.push({ status, rawStatus, paths });
  }
  return records;
}

export function pathsForClassification(record) {
  if (record.status === 'C') return [record.paths[1]];
  return [...record.paths];
}

export function pathsForPollution(record) {
  return record.status === 'C' ? [record.paths[1]] : [...record.paths];
}

const DIFF_ARGS = [
  '--name-status',
  '-z',
  '--find-renames',
  '--find-copies',
  '--diff-filter=ACMRDTUXB',
];

export function readStagedRecords(root, git = runGit) {
  return parseNameStatus(git(['diff', '--cached', ...DIFF_ARGS], { cwd: root }));
}

export function readUnstagedRecords(root, git = runGit) {
  return parseNameStatus(git(['diff', ...DIFF_ARGS], { cwd: root }));
}

export function readUntrackedPaths(root, git = runGit) {
  return nulFields(git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }));
}
