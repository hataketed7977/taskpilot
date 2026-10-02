import path from 'node:path';

function labelsFrom(value) {
  if (value && typeof value === 'object') return value;
  return Object.fromEntries(String(value ?? '').split(',').flatMap(entry => {
    const separator = entry.indexOf('=');
    return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : [];
  }));
}

export function parseComposePs(output) {
  const content = String(output).trim();
  if (!content) return [];
  if (content.startsWith('[')) {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error('Docker Compose status JSON must be an array or JSON lines');
    return parsed;
  }
  return content.split(/\r?\n/).filter(Boolean).flatMap(line => {
    const parsed = JSON.parse(line);
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

export function classifyComposeProject(records, root) {
  if (records.length === 0) return { status: 'absent', services: new Set() };
  const expectedRoot = path.resolve(root).replaceAll('\\', '/').toLowerCase();
  const owned = records.every(record => {
    const labels = labelsFrom(record.Labels);
    const workingDirectory = String(labels['com.docker.compose.project.working_dir'] ?? '')
      .replaceAll('\\', '/')
      .toLowerCase();
    return workingDirectory === expectedRoot;
  });
  return {
    status: owned ? 'owned' : 'unowned',
    services: new Set(records.filter(record => record.State === 'running').map(record => record.Service)),
  };
}
