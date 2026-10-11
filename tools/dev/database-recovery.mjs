export const postgresVolumeLogicalName = 'taskpilot-postgres-data';

const incompatibleSchemaPatterns = [
  /org\.flywaydb\.core\.api\.exception\.FlywayValidateException:/i,
  /validate failed:[\s\S]{0,2000}(?:migration checksum mismatch|applied migration not resolved locally|resolved migration not applied|detected failed migration)/i,
  /found non-empty schema\(s\).+but no schema history table/i,
  /schema history table.+contains a failed migration/i,
];

export function isRecoverableLocalDatabaseIncompatibility(log) {
  const content = String(log ?? '');
  return incompatibleSchemaPatterns.some(pattern => pattern.test(content));
}

export function postgresVolumeName(composeProject) {
  return `${composeProject}_${postgresVolumeLogicalName}`;
}

function labelsFrom(inspect) {
  const labels = inspect?.Labels;
  return labels && typeof labels === 'object' ? labels : {};
}

export function classifyLocalPostgresVolume(inspect, composeProject) {
  if (!inspect || inspect.Name !== postgresVolumeName(composeProject)) return 'unowned';
  const labels = labelsFrom(inspect);
  return labels['com.docker.compose.project'] === composeProject
    && labels['com.docker.compose.volume'] === postgresVolumeLogicalName
    ? 'owned-disposable-local'
    : 'unowned';
}

export function startupUsedExpectedLocalDatabase(log, postgresPort) {
  const escapedUrl = `jdbc:postgresql://127.0.0.1:${postgresPort}/taskpilot`
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`Database:\\s+${escapedUrl}(?:\\s|\\(|$)`, 'i').test(String(log ?? ''));
}

export async function withOneDatabaseRecovery(start, shouldRecover, recover) {
  try {
    return await start();
  } catch (error) {
    if (!shouldRecover(error)) throw error;
    await recover(error);
    return start();
  }
}
